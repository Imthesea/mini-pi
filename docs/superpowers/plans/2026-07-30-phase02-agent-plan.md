# Agent 层核心实现计划

> **对于 agentic workers:** 使用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 来逐任务实施此计划。步骤使用 `- [ ]` 复选框跟踪。

> **本文档配套文档**:
> - 设计 Spec:[2026-07-30-phase02-agent-design.md](../specs/2026-07-30-phase02-agent-design.md)
> - 上游 AI Spec:[2026-07-29-phase01-ai-core-design.md](../specs/2026-07-29-phase01-ai-core-design.md)
> - 下游 CLI Spec:[2026-07-30-phase02.5-coding-agent-design.md](../specs/2026-07-30-phase02.5-coding-agent-design.md)

**目标:** 从零搭建 `@mimi/agent` 包——完整可用的 Agent 运行时,提供 `AgentHarness` 主类、Session 双后端、压缩、钩子、Skills、Prompt templates 等核心能力。**全盘保留 pi 的 harness 设施,4500 行目标,完整优先于精简**。

**架构:** 在 `packages/ai` 之上,提供会话化、可扩展、可持久化的 Agent 运行时。核心抽象:`AgentHarness` → `createTurnState()` → `executeTurn()` → 同步 session 写入。钩子系统是面向扩展的核心。

**技术栈:** TypeScript 5.9+ / Node.js 22+ / pnpm / vitest / tsx / TypeBox 1.1.38(沿用 pi 版本)

## 全局约束

- TypeScript 5.9+,`erasableSyntaxOnly`,ES2022 target,Node16 模块
- **所有注释、文档使用中文**。每个类、每个方法至少要有中文注释说明用途
- **中文优先**:命名可用英文,但注释、README、错误消息全部中文
- vitest 用于单元测试,`examples/*.ts` 用于真实 API 集成验证
- 每个 Task 完成后必须:vitest 通过 + 对应 example 可用 `npx tsx` 跑通
- 严格 TDD:测试先写,跑挂,然后写实现,跑通,再写下一个
- 与 AI 层契约:`runAgentLoop` 内部重试,基于 `isRetryableAssistantError`;`buildAssistantMessage` 的 content 顺序 text → thinking → tools(由 AI 层保证)
- 完整保留 `CustomAgentMessages` 声明合并接口,不引入轻量 `Agent` 类

---

## Task 1: 包骨架 + 共用类型(types.ts)

**目标**: 初始化 `packages/agent` 包,定义 agent 层与 AI 层之间的共用类型。

**产出文件**:
- `packages/agent/package.json`(name: `@mimi/agent`,依赖 `@mimi/ai` workspace)
- `packages/agent/tsconfig.json`(继承 `tsconfig.base.json`)
- `packages/agent/vitest.config.ts`
- `packages/agent/src/types.ts`
- `packages/agent/src/index.ts`(暂时只 re-export types,后续 Task 增补)
- `packages/agent/__tests__/types.test.ts`

**关键类型清单**(从 pi 完整保留):
- `AgentContext`:提供给 LLM 的完整请求上下文(messages、tools、systemPrompt、abortSignal)
- `AgentEvent`:agent-loop 派发的事件(start、turn_start、text_start/delta/end、thinking_start/delta/end、toolcall_start/delta/end、tool_execution_start/end、turn_end、done、error)
- `AgentMessage`:用户/助手/工具结果消息的联合类型,**留 `CustomAgentMessages` 声明合并接口**(`interface CustomAgentMessages {}`)
- `AgentTool<T>`:工具定义,带 TypeBox schema + `execute` 函数
- `AgentLoopConfig`:循环配置(streamFn、model、context、config、maxRetries 等)
- `QueueMode`: `"all" | "one-at-a-time"`
- `ThinkingLevel`: `"off" | "minimal" | "low" | "medium" | "high"`

**测试用例**:
- `types.test.ts`:
  - `AgentContext` 必填字段不可缺
  - `AgentEvent` 的 type 联合完整覆盖所有变体
  - `CustomAgentMessages` 默认可为空接口,声明合并后被识别
  - `AgentTool<T>` 的 `parameters` 必须是 TSchema 类型(TypeBox)
  - `QueueMode` 联合只接受两个值

**验证**:
```bash
cd packages/agent && pnpm test
# 预期:types.test.ts 全过
```

- [x] Step 1: 写 `__tests__/types.test.ts`,跑挂(红)
- [x] Step 2: 写 `src/types.ts` 全部类型(从 pi `packages/agent/src/types.ts` 翻译,删除 `Agent` 类相关引用,只保留共用部分)
- [x] Step 3: 写 `src/index.ts` 只 re-export types
- [x] Step 4: 跑测试变绿
- [x] Step 5: 写 `package.json` + `tsconfig.json` + `vitest.config.ts`
- [x] Step 6: `pnpm install` 验证依赖链路

**Task 1 完成备注**:
- 实际步骤顺序与原文有偏差（见实施日志）
- vitest test 脚本改为 `vitest run && tsc --noEmit`

---

## Task 2: 核心 agent-loop 循环(agent-loop.ts)

**目标**: 实现 LLM → tool → repeat 的核心循环,这是 agent 层的"心脏"。**从 pi 完整保留**,792 行。

**产出文件**:
- `packages/agent/src/agent-loop.ts`
- `packages/agent/__tests__/agent-loop.test.ts`
- `packages/agent/examples/01-basic.ts`

**关键 API**:
- `runAgentLoop(config: AgentLoopConfig): Promise<AgentMessage[]>`:完整 LLM turn,直到 turn 自然结束
- `runAgentLoopContinue(config: AgentLoopConfig, messages: AgentMessage[]): Promise<AgentMessage[]>`:续接已有 messages

**循环结构**:
```
1. 构造 AgentContext(messages、tools、systemPrompt)
2. emit "start" + "turn_start"
3. 循环:
   3.1 streamFn(model, context, options) → AssistantMessageStream
   3.2 监听流事件:
       - text/thinking/toolcall → 转 AgentEvent 转发
       - "done" 拿到 AssistantMessage
   3.3 if 包含 toolCalls:
       - emit toolcall_end
       - emit tool_execution_start
       - 并行/串行执行 tool.execute(根据 config.parallel)
       - emit tool_execution_end
       - 把 toolResult push 到 messages
       - 继续循环
   3.4 else: turn 自然结束
4. emit "turn_end" + "done"
5. 返回 messages
```

**重试逻辑**(在 `streamFn` 之外,套一层):
- 捕获 stream 错误
- if `isRetryableAssistantError(err)` && `attempt < maxRetries`:
  - 等待 `min(maxRetryDelayMs, backoff)`
  - attempt++ 并重试
- else: 抛错

**测试用例**(`agent-loop.test.ts`):
- ✅ 最简 case:无工具的 LLM turn,验证 start → text → done 事件序列
- ✅ 单工具 case:模型返回 1 个 toolCall,执行工具,把 toolResult push,继续循环
- ✅ 多工具 case:模型返回 N 个 toolCall,串行执行
- ✅ 工具抛错:toolResult 标记 `isError: true`,模型看到错误
- ✅ 模型无 toolCall 时 turn 自然结束
- ✅ 重试 case:模拟可重试错误(429),验证重试次数 + backoff
- ✅ 不可重试错误:401,立即抛出
- ✅ AbortSignal:在循环中检测 signal.aborted,优雅退出
- ✅ Content 顺序:`buildAssistantMessage` 输出 text → thinking → tools(与 AI 层契约)

**example**(`01-basic.ts`):
- 创建 `models`(用 AI 层的 `createModels`)
- mock 一次 LLM 响应(用 AI 层的 mock helper 或直接 mock fetch)
- 启动 `runAgentLoop`,打印每个事件
- 验证: 至少看到 `start` + `text_delta` + `done` 三个事件

**验证**:
```bash
cd packages/agent && pnpm test agent-loop
npx tsx examples/01-basic.ts
# 预期:看到流式输出,正常结束
```

- [ ] Step 1: 写 `__tests__/agent-loop.test.ts` 全部 case,跑挂
- [ ] Step 2: 写 `src/agent-loop.ts` 核心循环(从 pi `packages/agent/src/agent-loop.ts` 翻译)
- [ ] Step 3: 实现重试包装层
- [ ] Step 4: 跑测试变绿
- [ ] Step 5: 写 `examples/01-basic.ts` 真实跑通
- [ ] Step 6: 提交 commit `feat(agent): core agent loop`

---

## Task 3: AgentHarness 主类(skeleton + messages + system-prompt)

**目标**: 实现 `AgentHarness` 主类的骨架,集成 agent-loop、消息转换、system prompt 拼接。**本步只做骨架**,不接 session、不接 hooks。

**产出文件**:
- `packages/agent/src/harness/agent-harness.ts`(骨架,400 行)
- `packages/agent/src/harness/messages.ts`
- `packages/agent/src/harness/system-prompt.ts`
- `packages/agent/src/harness/types.ts`(本包专用类型,Skill/PromptTemplate/HookEvent 等)
- `packages/agent/src/harness/index.ts`
- `packages/agent/__tests__/harness/agent-harness.test.ts`
- `packages/agent/__tests__/harness/messages.test.ts`
- `packages/agent/__tests__/harness/system-prompt.test.ts`

**关键 API**(`AgentHarness`):
- 构造选项:`{ model, tools, env, session, thinkingLevel?, systemPrompt?, streamOptions? }`
- `prompt(text, options?): Promise<AssistantMessage>`:启动 LLM turn
- `subscribe(): AsyncIterable<AgentHarnessEvent>`:订阅事件
- `getModel()` / `setModel(model)`:运行时换模型
- `getTools()` / `setTools(tools)`:运行时加工具
- `getThinkingLevel()` / `setThinkingLevel(level)`
- `getPhase(): AgentHarnessPhase`
- `abort(): Promise<void>`:优雅终止

**阶段机**:`AgentHarnessPhase = "idle" | "turn" | "compaction" | "branch_summary" | "retry"`
- `prompt` 必须在 idle 时调用,设 phase = "turn"
- 异常路径必须把 phase 复位回 "idle"

**消息转换**(`messages.ts`):
- `convertToLlm(messages: AgentMessage[], context): AgentMessage[]`:把 agent 消息投影为 LLM 消息
  - 过滤掉 `role: "custom"`(声明合并消息默认不发给 LLM,除非显式投影)
  - `role: "user" | "assistant" | "toolResult"` 透传
  - 已知自定义消息类型:`bashExecution` / `branchSummary` / `compactionSummary` 各自有专门处理
- `buildAssistantMessage(...)`:从累积 content blocks + tool calls 构造 `AssistantMessage`(顺序:text → thinking → tools,这是 AI 层契约)

**system prompt 拼接**(`system-prompt.ts`):
- `buildSystemPrompt({ base, skills?, promptTemplates?, env, sessionId }): string`
- 拼接顺序:base → skills XML block → prompt templates → env context → session marker
- 静态 `systemPrompt` 字符串 或 动态 `systemPromptProvider` 回调 都支持

**测试用例**:
- `agent-harness.test.ts`:
  - ✅ 构造 harness 不报错
  - ✅ `prompt()` 在 idle 时正常工作,phase 正确转换
  - ✅ `prompt()` 在非 idle 时抛 `AgentHarnessError("busy")`
  - ✅ `setModel` / `setTools` / `setThinkingLevel` 立即生效
  - ✅ `abort()` 在 turn 中能中断
  - ✅ 异常路径后 phase 回到 idle
- `messages.test.ts`:
  - ✅ `convertToLlm` 默认过滤 custom
  - ✅ `convertToLlm` 处理 bashExecution(转 user 消息)
  - ✅ `convertToLlm` 处理 branchSummary(转 user 消息)
  - ✅ `buildAssistantMessage` 输出顺序 text → thinking → tools
- `system-prompt.test.ts`:
  - ✅ 静态字符串拼接
  - ✅ skills XML block 格式正确
  - ✅ dynamic provider 回调每次 turn 调用一次

**验证**:
```bash
cd packages/agent && pnpm test harness
```

- [ ] Step 1: 写 `harness/types.ts`(`Skill` / `PromptTemplate` / `HookEvent` / `AgentHarnessEvent` 等)
- [ ] Step 2: 写 `harness/messages.ts` 三个函数
- [ ] Step 3: 写 `harness/system-prompt.ts` 拼接函数
- [ ] Step 4: 写测试 `messages.test.ts` + `system-prompt.test.ts`,跑绿
- [ ] Step 5: 写 `harness/agent-harness.ts` 骨架(phase 机器 + prompt + subscribe + abort + 模型/工具 setter)
- [ ] Step 6: 写测试 `agent-harness.test.ts`,跑绿
- [ ] Step 7: 更新 `examples/01-basic.ts` 用 harness 启动(替换直接调 agent-loop)
- [ ] Step 8: 提交 commit `feat(agent): harness skeleton + messages + system-prompt`

---

## Task 4: 钩子系统(hooks + emit + handlers)

**目标**: 实现 `DefaultAgentHarnessHooks`,这是与未来扩展系统对接的核心。**完整保留 pi 的钩子协议**(17 个事件 + 幻影结果类型 + observers/handlers 分离)。

**产出文件**:
- `packages/agent/src/harness/hooks.ts`
- `packages/agent/src/harness/agent-harness.ts`(增量,接 emit 钩子)
- `packages/agent/__tests__/harness/hooks.test.ts`
- `packages/agent/examples/07-hooks.ts`

**关键 API**:
- `AgentHarnessHooks<E, Ctx>`:公共接口
  - `context: Ctx`
  - `setContext(ctx): void`
  - `observe(handler): () => void`(只读,看所有事件)
  - `on(type, handler): () => void`(参与语义)
  - `emit<TEvent>(event, signal?): Promise<ResultOf<TEvent> | undefined>`
  - `addCleanup(cleanup): () => void`
  - `clear(): Promise<void>`
  - `dispose(): Promise<void>`
- `DefaultAgentHarnessHooks<E, Ctx>`:默认实现
- `HookEvent<TType, TResult = void>`:事件类型,带幻影结果
- `HookHandler<E, Ctx>` / `HookObserver<E, Ctx>`:handler / observer 类型

**事件清单**(17 个,完整保留 pi):
| 事件 | 幻影结果 |
|------|----------|
| `context` | `{ messages?: AgentMessage[] }` |
| `before_agent_start` | `{ messages?, systemPrompt? }` |
| `before_provider_request` | `{ streamOptions? }` |
| `before_provider_payload` | `{ payload }` |
| `after_provider_response` | undefined |
| `tool_call` | `{ block?, reason? }` |
| `tool_result` | `{ content?, details?, isError?, terminate? }` |
| `message_end` | undefined |
| `session_before_compact` / `session_compact` / `session_before_tree` / `session_tree` | 各自定义 |
| `model_update` / `thinking_level_update` / `resources_update` / `tools_update` | undefined |
| `queue_update` / `save_point` / `abort` / `settled` | undefined |

**变更语义**(从 pi 完整保留):
- `context`: 顺序转换,每个 handler 可改 `messages`
- `tool_call`: 顺序执行,遇 `block: true` 提前退出
- `tool_result`: 顺序累积补丁
- `session_before_*`: 顺序执行,遇 `cancel: true` 提前退出

**测试用例**(`hooks.test.ts`):
- ✅ `observe` 只读,返回值被忽略
- ✅ `on(type, handler)` 能修改上下文(根据事件类型)
- ✅ `on("tool_call")` 遇 `block: true` 时停止后续 handler
- ✅ `on("tool_result")` 多个 handler 顺序累积补丁
- ✅ `on("context")` 链式转换,每个 handler 看到上一个的输出
- ✅ `clear()` 移除所有 handlers 并执行 cleanups
- ✅ `dispose()` 同 `clear()` 语义
- ✅ `setContext` 立即更新 context
- ✅ emit 顺序: observers 先,再 handlers

**example**(`07-hooks.ts`):
- 创建一个 hook,`on("tool_call", ...)` 拒绝删除 `node_modules` 下的文件
- 创建一个 hook,`on("context", ...)` 在 messages 头部注入"今天是 <date>"
- 跑通,验证 hook 实际生效

**验证**:
```bash
cd packages/agent && pnpm test hooks
npx tsx examples/07-hooks.ts
```

- [ ] Step 1: 写 `hooks.test.ts` 全部 case,跑挂
- [ ] Step 2: 写 `hooks.ts` `HookEvent` / `HookHandler` / `DefaultAgentHarnessHooks`
- [ ] Step 3: 实现各事件的变更语义
- [ ] Step 4: 跑测试变绿
- [ ] Step 5: 把 hooks 接入 `agent-harness.ts`(在 phase 转换、turn 执行、tool 调用等关键点 emit)
- [ ] Step 6: 写 `examples/07-hooks.ts` 跑通
- [ ] Step 7: 提交 commit `feat(agent): hooks system`

---

## Task 5: Session 双后端(session + repos)

**目标**: 实现 Session 类(树形 entry 管理、上下文构建)+ InMemory / JSONL 双后端。**完整保留 pi**。

**产出文件**:
- `packages/agent/src/harness/session/session.ts`(主类)
- `packages/agent/src/harness/session/jsonl-storage.ts`
- `packages/agent/src/harness/session/jsonl-repo.ts`
- `packages/agent/src/harness/session/memory-storage.ts`
- `packages/agent/src/harness/session/memory-repo.ts`
- `packages/agent/src/harness/session/repo-utils.ts`
- `packages/agent/src/harness/session/index.ts`
- `packages/agent/src/harness/env/nodejs.ts`(本步同步交付,Node 执行环境)
- `packages/agent/__tests__/harness/session/session.test.ts`
- `packages/agent/__tests__/harness/session/jsonl-repo.test.ts`
- `packages/agent/__tests__/harness/session/memory-repo.test.ts`
- `packages/agent/__tests__/harness/session/repo-utils.test.ts`
- `packages/agent/__tests__/harness/env/nodejs.test.ts`
- `packages/agent/examples/03-session.ts`

**Session 类核心**:
- 树形 `entries: SessionTreeEntry[]`(联合类型:`MessageEntry | BranchSummaryEntry | CompactionEntry | CustomEntry | LeafEntry`)
- `getEntries(): SessionTreeEntry[]`
- `appendEntry(entry): Promise<void>`
- `getLeafId(): string | null`
- `setLeafId(id: string | null): Promise<void>`(**关键**:必须追加 `LeafEntry`,非仅内存更新)
- `buildContextEntries(): SessionTreeEntry[]`(压缩感知)
- `buildContext({ entryProjectors?, entryTransforms? }): AgentMessage[]`
- `fork(entryId, options): Promise<Session>`(创建分支)

**Entry 类型**:
- `MessageEntry`:`{ type: "message", id, parentId, timestamp, message: AgentMessage }`
- `BranchSummaryEntry`:`{ type: "branch_summary", id, parentId, timestamp, summary, details? }`
- `CompactionEntry`:`{ type: "compaction", id, parentId, timestamp, summary, firstKeptEntryId, tokensBefore, details? }`
- `CustomEntry`:`{ type: "custom", id, parentId, timestamp, customType, data }`(声明合并扩展点)
- `LeafEntry`:`{ type: "leaf", id, parentId, timestamp, targetId }`

**Storage 接口**:
```ts
interface SessionStorage {
  load(sessionId: string): Promise<SessionTreeEntry[]>;
  append(sessionId: string, entries: SessionTreeEntry[]): Promise<void>;
  list(): Promise<{ id: string, updatedAt: Date }[]>;
  delete(sessionId: string): Promise<void>;
}
```

**JSONL 后端**:
- 一个 session 一个文件 `<dir>/<id>.jsonl`
- 启动时重放所有 entries,重建 leaf
- append 是同步 `fs.appendFile`(因为每次只写一条,无并发风险)

**Memory 后端**:
- `Map<sessionId, SessionTreeEntry[]>` 在内存
- 测试用,无持久化

**NodeExecutionEnv**:
- 完整实现:`readFile` / `writeFile` / `stat` / `readdir` / `mkdir` / `exec`
- 全部走 `Result<T, FileError>`,不抛
- 路径安全: 不接受 symlink 自动解析

**测试用例**:
- `session.test.ts`:
  - ✅ 构造空 session
  - ✅ appendEntry 后 getEntries 返回
  - ✅ setLeafId 追加 LeafEntry(而非内存修改)
  - ✅ buildContextEntries 压缩感知(被 compaction 覆盖的 entry 不出现)
  - ✅ buildContext 默认过滤 custom
  - ✅ buildContext 接受 entryProjectors 投影 custom
  - ✅ fork 创建新 session,带 parent 引用
- `memory-repo.test.ts`:
  - ✅ create / open / list / delete
  - ✅ append 持久(单次会话内)
- `jsonl-repo.test.ts`:
  - ✅ create / open / list / delete(用 tmp 目录)
  - ✅ append 后 close,再 open 能恢复
  - ✅ 大数据量(1000 entries)性能可接受
- `nodejs.test.ts`:
  - ✅ readFile / writeFile 成功 + 失败(Result 形式)
  - ✅ stat 返回 file/dir 类型
  - ✅ exec 简单命令(ls / echo)
  - ✅ exec 超时返回 timeout 错误
  - ✅ exec 输出截断

**example**(`03-session.ts`):
- 用 JSONL storage 创建一个 session
- 跑 2 轮对话
- close,再 open,验证 entries 还在
- 输出 session 文件路径让用户查看

**验证**:
```bash
cd packages/agent && pnpm test session
cd packages/agent && pnpm test env
npx tsx examples/03-session.ts
```

- [ ] Step 1: 写 `harness/session/types.ts`(`SessionTreeEntry` 等)放在 `harness/types.ts` 同包
- [ ] Step 2: 写 `harness/session/memory-storage.ts` + `memory-repo.ts`
- [ ] Step 3: 写 `memory-repo.test.ts` 跑绿
- [ ] Step 4: 写 `harness/session/jsonl-storage.ts` + `jsonl-repo.ts` + `repo-utils.ts`
- [ ] Step 5: 写 `jsonl-repo.test.ts` + `repo-utils.test.ts` 跑绿
- [ ] Step 6: 写 `harness/session/session.ts` 主类
- [ ] Step 7: 写 `session.test.ts` 跑绿
- [ ] Step 8: 写 `harness/env/nodejs.ts`
- [ ] Step 9: 写 `nodejs.test.ts` 跑绿
- [ ] Step 10: 把 session + env 接入 `agent-harness.ts`(`prompt` 时 appendEntry)
- [ ] Step 11: 写 `examples/03-session.ts` 跑通
- [ ] Step 12: 提交 commit `feat(agent): session dual-backend + nodejs env`

---

## Task 6: 压缩 + 分支摘要(compaction)

**目标**: 实现 `compact()` + `navigateTree()`,从 pi 完整保留三件套(compaction.ts + branch-summarization.ts + utils.ts)。**手动触发,不接触发器**。

**产出文件**:
- `packages/agent/src/harness/compaction/compaction.ts`
- `packages/agent/src/harness/compaction/branch-summarization.ts`
- `packages/agent/src/harness/compaction/utils.ts`
- `packages/agent/src/harness/compaction/index.ts`
- `packages/agent/__tests__/harness/compaction/compaction.test.ts`
- `packages/agent/__tests__/harness/compaction/branch-summarization.test.ts`
- `packages/agent/__tests__/harness/compaction/utils.test.ts`
- `packages/agent/examples/04-compaction.ts`

**compaction.ts 关键 API**:
- `compact(harness, options?): Promise<CompactResult>`:执行压缩
- `prepareCompaction(entries, settings): CompactionPreparation`:选保留边界
- `estimateTokens(message: AgentMessage): number`:基于 `chars / 4` 启发式
- `shouldCompact(contextTokens, contextWindow, settings): boolean`:**只导出函数,不调用**
- `DEFAULT_COMPACTION_SETTINGS: CompactionSettings`

**branch-summarization.ts 关键 API**:
- `generateBranchSummary(entries, model, options?): Promise<{ summary, details? }>`
- `collectEntriesForBranchSummary(entries, targetId): SessionTreeEntry[]`

**utils.ts 关键 API**:
- `extractFileOpsFromMessage(message: AgentMessage): { readFiles: string[], modifiedFiles: string[] }`
- 累计到 session-level 的文件操作集合

**AgentHarness 集成**:
- `harness.compact(): Promise<void>`:手动触发
- `harness.navigateTree({ targetId }): Promise<void>`:手动触发
- 两个方法都走 `session_before_*` 钩子

**测试用例**:
- `compaction.test.ts`:
  - ✅ `estimateTokens` 对各角色消息返回合理值
  - ✅ `shouldCompact` 函数正确(虽然不调用,但保证语义正确)
  - ✅ `prepareCompaction` 选保留边界(基于 `keepRecentTokens`)
  - ✅ `compact` 真实跑通(用 mock model,或真实小模型):生成 summary + 写 CompactionEntry
  - ✅ `compact` 触发 `session_before_compact` 钩子
  - ✅ 钩子 `cancel: true` 阻止压缩
  - ✅ 钩子 `compaction` 注入已有结果,跳过 LLM 调用
- `branch-summarization.test.ts`:
  - ✅ `collectEntriesForBranchSummary` 收集从 root 到 targetId 路径上被丢弃的 entries
  - ✅ `generateBranchSummary` 真实跑通
- `utils.test.ts`:
  - ✅ `extractFileOpsFromMessage` 从 tool result 提取 read/modified 文件

**example**(`04-compaction.ts`):
- 启动 harness,跑 ~10 轮长对话(用真实 API)
- 调用 `harness.compact()`,验证 session.jsonl 中出现 CompactionEntry
- 打印压缩前后的 token 估算

**验证**:
```bash
cd packages/agent && pnpm test compaction
npx tsx examples/04-compaction.ts
```

- [ ] Step 1: 写 `harness/compaction/utils.ts`(从 pi 翻译)
- [ ] Step 2: 写 `utils.test.ts` 跑绿
- [ ] Step 3: 写 `harness/compaction/compaction.ts`(从 pi 翻译,保留 `shouldCompact` 函数)
- [ ] Step 4: 写 `compaction.test.ts` 跑绿
- [ ] Step 5: 写 `harness/compaction/branch-summarization.ts`(从 pi 翻译)
- [ ] Step 6: 写 `branch-summarization.test.ts` 跑绿
- [ ] Step 7: 接入 `agent-harness.ts`:`compact()` + `navigateTree()` 方法
- [ ] Step 8: 写 `examples/04-compaction.ts` 跑通
- [ ] Step 9: 提交 commit `feat(agent): compaction + branch summarization`

---

## Task 7: Skills + Prompt Templates

**目标**: 实现 skills / prompt templates 的加载与 system prompt 注入,以及 `skill()` / `promptFromTemplate()` 方法。

**产出文件**:
- `packages/agent/src/harness/skills.ts`
- `packages/agent/src/harness/prompt-templates.ts`
- `packages/agent/__tests__/harness/skills.test.ts`
- `packages/agent/__tests__/harness/prompt-templates.test.ts`
- `packages/agent/examples/05-skills.ts`
- `packages/agent/examples/06-prompt-templates.ts`

**skills.ts 关键 API**:
- `formatSkillsForSystemPrompt(skills: Skill[]): string` → XML block(遵循 agentskills.io)
- `formatSkillInvocation(skill: Skill, args?: Record<string, string>): string` → 调起文本
- `loadSkillFromFile(path: string): Promise<Skill>`:从 SKILL.md 加载
- `parseSkillContent(content: string): { name, description, content }`:解析 YAML frontmatter

**prompt-templates.ts 关键 API**:
- `formatPromptTemplateInvocation(template: PromptTemplate, args: Record<string, string>): string`
- 占位符语法 `{{name}}`,简单字符串替换,不做表达式求值

**AgentHarness 集成**:
- `harness.skill(name, args?): Promise<void>`:从 resources.skills 找 skill,格式化后调 `prompt`
- `harness.promptFromTemplate(name, args): Promise<void>`
- 资源通过 `setResources({ skills, promptTemplates })` 注入

**测试用例**:
- `skills.test.ts`:
  - ✅ `formatSkillsForSystemPrompt` 输出符合 agentskills.io 规范
  - ✅ `formatSkillInvocation` 生成调起文本
  - ✅ `parseSkillContent` 正确分离 frontmatter 和 body
  - ✅ `loadSkillFromFile` 真实读文件
- `prompt-templates.test.ts`:
  - ✅ `formatPromptTemplateInvocation` 替换 `{{name}}` 占位符
  - ✅ 未提供的占位符保留原样(警告)

**example**:
- `05-skills.ts`: 写一个简单 SKILL.md,loadSkillFromFile,塞进 resources,启动 harness 调 `harness.skill("git-commit")`
- `06-prompt-templates.ts`: 定义一个 `code-review` 模板,调 `harness.promptFromTemplate("code-review", { prUrl: "..." })`

**验证**:
```bash
cd packages/agent && pnpm test skills
cd packages/agent && pnpm test prompt-templates
npx tsx examples/05-skills.ts
npx tsx examples/06-prompt-templates.ts
```

- [ ] Step 1: 写 `skills.ts`(从 pi 翻译)
- [ ] Step 2: 写 `skills.test.ts` 跑绿
- [ ] Step 3: 写 `prompt-templates.ts`(从 pi 翻译)
- [ ] Step 4: 写 `prompt-templates.test.ts` 跑绿
- [ ] Step 5: 接入 `agent-harness.ts`:`skill()` + `promptFromTemplate()` + `setResources()`
- [ ] Step 6: 写 `examples/05-skills.ts` + `examples/06-prompt-templates.ts` 跑通
- [ ] Step 7: 提交 commit `feat(agent): skills + prompt templates`

---

## Task 8: 队列操作 + 自定义消息示例

**目标**: 实现 `steer()` / `followUp()` / `nextTurn()` 队列操作,以及 CustomAgentMessages 声明合并的演示。

**产出文件**:
- `packages/agent/src/harness/agent-harness.ts`(增量,加 3 个方法)
- `packages/agent/examples/08-custom-messages.ts`
- `packages/agent/__tests__/harness/agent-harness.test.ts`(增量测试)

**队列操作**:
- `harness.steer(text, options?)`:中途插入用户消息,中断当前 LLM 流
- `harness.followUp(text, options?)`:排队用户消息,等当前 turn 结束投递
- `harness.nextTurn(text, options?)`:在下一轮用户消息之前插入
- 队列模式 setter / getter(`setSteeringMode` / `setFollowUpMode`)

**自定义消息演示**(`examples/08-custom-messages.ts`):
```ts
// 在用户项目里声明合并
declare module "@mimi/agent" {
  interface CustomAgentMessages {
    notification: {
      role: "custom";
      customType: "notification";
      title: string;
      body: string;
      timestamp: number;
    };
  }
}

const msg: AgentMessage = {
  role: "custom",
  customType: "notification",
  title: "测试",
  body: "你好",
  timestamp: Date.now(),
};
```

**测试用例**:
- ✅ `followUp` 队列正确排空(等当前 turn 结束后才投递)
- ✅ `steer` 中断当前 turn 并把消息作为下一轮开头
- ✅ `nextTurn` 在下一轮用户消息前插入
- ✅ `setSteeringMode("one-at-a-time")` 后只保留最新一个 steer
- ✅ 自定义消息类型在 `convertToLlm` 中可被显式投影

**验证**:
```bash
cd packages/agent && pnpm test agent-harness
npx tsx examples/08-custom-messages.ts
```

- [ ] Step 1: 在 `agent-harness.ts` 加 `steer` / `followUp` / `nextTurn` 三个方法
- [ ] Step 2: 加对应的测试 case
- [ ] Step 3: 写 `examples/08-custom-messages.ts` 跑通
- [ ] Step 4: 提交 commit `feat(agent): queue ops + custom messages demo`

---

## Task 9: 文档输出(5 篇中文文档)

**目标**: 生成 5 篇中文文档,从 pi 翻译。**这部分是 spec 阶段就明确交付的**。

**产出文件**:
- `docs/agent-harness.md` — 生命周期、状态模型、操作阶段、Turn 执行、保存点
- `docs/hooks.md` — 钩子系统设计、事件协议、变更语义、扩展加载
- `docs/session.md` — Session 类、Entry 树、Repo、上下文构建
- `docs/compaction.md` — 压缩 + 分支摘要的完整流程与算法
- `docs/skills-and-templates.md` — Skills 与 Prompt Templates 的使用与规范

每篇文档结构:
- 概述(3-5 句)
- 关键概念(表格 + 简短说明)
- API 速查(类型签名,不带实现)
- 流程图(纯文本,ASCII)
- 已知限制(从 spec 沿用)

**验证**:
- 通读每篇,确保中文流畅、无错别字
- 所有类型签名与代码一致
- 所有流程图与实现一致

- [ ] Step 1: 写 `docs/agent-harness.md`
- [ ] Step 2: 写 `docs/hooks.md`
- [ ] Step 3: 写 `docs/session.md`
- [ ] Step 4: 写 `docs/compaction.md`
- [ ] Step 5: 写 `docs/skills-and-templates.md`
- [ ] Step 6: 提交 commit `docs(agent): 5 篇中文文档`

---

## Task 10: 全量验证 + Phase 02 收尾

**目标**: 全量测试 + 全量 examples 跑通,验证整个 `@mimi/agent` 包就绪。

**验证清单**:
```bash
# 单元测试
cd packages/agent && pnpm test
# 预期: 50+ tests pass

# 全量 examples
cd packages/agent && npx tsx examples/01-basic.ts
cd packages/agent && npx tsx examples/02-tools.ts
cd packages/agent && npx tsx examples/03-session.ts
cd packages/agent && npx tsx examples/04-compaction.ts
cd packages/agent && npx tsx examples/05-skills.ts
cd packages/agent && npx tsx examples/06-prompt-templates.ts
cd packages/agent && npx tsx examples/07-hooks.ts
cd packages/agent && npx tsx examples/08-custom-messages.ts
# 预期: 全部正常退出

# 类型检查
cd packages/agent && pnpm tsc --noEmit
# 预期: 0 error

# 与 AI 层集成
cd packages/agent && pnpm build
# 预期: dist/ 生成,无 warning
```

**Phase 02 收尾**:
- 写 `docs/project-log/phase-02-agent/log.md`(实施日志)
- 写 `my-mimipi-spec.md` 状态更新:Phase 02 标记完成
- 创建 `docs/superpowers/specs/2026-07-30-phase02-agent-design.md` 的"实施偏差"附录(参考 Phase 01 的做法)

- [ ] Step 1: 跑全量 tests,确认 50+ pass
- [ ] Step 2: 跑全量 examples,确认 8 个全部跑通
- [ ] Step 3: `tsc --noEmit` 通过
- [ ] Step 4: `pnpm build` 通过
- [ ] Step 5: 写实施日志
- [ ] Step 6: 更新 spec 附录 + 根 spec 状态
- [ ] Step 7: 提交 commit `chore(agent): phase 02 complete`

---

## 总工时估算(参考)

| Task | 内容 | 估算 |
|------|------|------|
| 1 | 包骨架 + types | 0.5h |
| 2 | agent-loop 核心 | 2-3h(792 行翻译) |
| 3 | harness skeleton + messages + system-prompt | 2-3h |
| 4 | 钩子系统 | 2-3h(17 个事件) |
| 5 | session + env | 3-4h(双后端 + 5 文件) |
| 6 | compaction | 2-3h(三件套) |
| 7 | skills + templates | 1-2h |
| 8 | 队列 + 自定义消息 | 1-2h |
| 9 | 5 篇文档 | 2-3h |
| 10 | 全量验证 | 1h |
| **合计** | | **~17-25h** |

**注意**:这只是"实现 + 测试"的估算。Debug、跨任务修正、依赖 pi 行为差异的适配,可能再 +30-50%。
