# Agent 层核心实现计划

> 配套:
> - 设计 Spec: [2026-07-30-phase02-agent-design.md](../specs/2026-07-30-phase02-agent-design.md)
> - **工程原则(最高决策依据)**: [2026-07-30-phase02-engineering-principles.md](../specs/2026-07-30-phase02-engineering-principles.md) — 每个 Task 落地前必读

**目标**: 从零搭建 `@mimi/agent` 包,完整可用 Agent 运行时,提供 `AgentHarness` 主类、Session 双后端、压缩、钩子、Skills、Prompt templates 等核心能力。完整保留 pi 的 harness 设施,目标 ~4500 行。

**当前进度(2026-08-02)**: Task 1-12 已完成。@mimi/agent 共 74 个源文件(~9900 行)+ 35 个测试文件(~7000 行)/ 499 测试通过 + 8 个 examples 全部跑通(01 mock,03/04/05/06/07/08 真实 API)。Task 11 解决"拆 9 个胶水子文件"问题;Task 12 解决"主类内重复代码 + 编号步骤方法"问题。

**技术栈**: TypeScript 5.9+ / Node.js 22+ / pnpm / vitest / tsx / TypeBox 1.1.38(沿用 pi 版本)

## 全局约束

- **所有注释 / 文档中文**;命名可用英文
- vitest 用于单元测试,`examples/*.ts` 用于集成验证(**使用真实 DeepSeek API**;mock 放 `__tests__/_helpers/` 下)
- 每个 Task 必须:vitest 通过 + 对应 example 可 `npx tsx` 跑通
- 严格 TDD:测试先写,跑挂(RED),写实现,跑绿(GREEN)
- 与 AI 层契约: `runAgentLoop` 内部重试,基于 `isRetryableAssistantError`;`buildAssistantMessage` content 顺序 text → thinking → tools
- 完整保留 `CustomAgentMessages` 声明合并接口,不引入轻量 `Agent` 类

**工程规则**: 主类 500-1000 OK / 真独立模块 ≤ 300 / 6 条反模式禁令 / 4 个内部 helper 模式。详见 [工程原则 § 1.2-1.4](../specs/2026-07-30-phase02-engineering-principles.md)。每写完一个文件立即 `wc -l` 检查。

**目录结构**: 详见 [设计 Spec § 2](../specs/2026-07-30-phase02-agent-design.md)。

**关键设计决策**: 详见 [设计 Spec § 0](../specs/2026-07-30-phase02-agent-design.md)。

---

## Task 1: 包骨架 + 共用类型

**目标**: 初始化 `packages/agent` 包,定义 agent 层与 AI 层之间的共用类型。

**产出**:
- `package.json` / `tsconfig.json` / `vitest.config.ts`
- `src/types.ts` / `src/index.ts`
- `__tests__/types.test.ts`

**关键类型**(从 pi 完整保留):
- `AgentContext` / `AgentEvent`(20 种变体)/ `AgentMessage` / `AgentTool<T>` / `AgentLoopConfig`
- `QueueMode`: `"all" | "one-at-a-time"`
- `ThinkingLevel`: `"off" | "minimal" | "low" | "medium" | "high"`
- `AgentMessage` 保留 `CustomAgentMessages` 声明合并接口

**测试**: 类型联合 + 声明合并可识别 + AgentTool schema 校验。

**验证**: `pnpm test` → types.test.ts 全过。

- [x] Step 1-6: 测试 RED → 实现 → 跑绿 → 写 package.json/tsconfig/vitest.config → pnpm install 验证

**实际产出**: vitest 脚本 `vitest run && tsc --noEmit`。commit `b06e3a0`。

---

## Task 2: 核心 agent-loop 循环

**目标**: 实现 LLM → tool → repeat 核心循环(从 pi 完整保留),`agent-loop.ts` 公共入口 + `loop/` 子目录拆 5 个真独立模块 + `loop/tool-execution/` 拆 7 个分片文件。

**最大单文件**: 180 行 ✓

**关键 API**:
- `agentLoop(prompts, context, config, signal?, streamFn?): EventStream<AgentEvent, AgentMessage[]>`
- `agentLoopContinue(context, config, signal?, streamFn?): EventStream<...>`
- `runAgentLoop(prompts, context, config, emit?, signal?, streamFn?): Promise<AgentMessage[]>`
- `runAgentLoopContinue(context, config, emit?, signal?, streamFn?): Promise<AgentMessage[]>`
- `AgentEventSink = (event: AgentEvent) => Promise<void> | void`

**循环结构**(`agent-loop.ts` `runLoop` 状态机): 构造 AgentContext → emit "agent_start" + "turn_start" → 循环(streamFn → 转 AgentEvent 转发 / 含 toolCall 则执行 + push toolResult 继续 / 否则 turn 自然结束)→ emit "turn_end" + "agent_end"。

**重试逻辑**(`loop/stream-assistant.ts`): 捕获 stream 错误,`isRetryableAssistantError(err) && attempt < maxRetries` 时等 `min(maxRetryDelayMs, 1000 * 2^attempt)` 重试,否则抛错或返回 error message。

**测试**(`agent-loop.test.ts`): 最简无工具 turn / 单/多工具 / 工具抛错 / 模型无 toolCall 自然结束 / 重试(429)与不可重试(401)错误 / AbortSignal / content 顺序 / beforeToolCall block 钩子 / afterToolCall 钩子增量 / parallel toolExecution / runAgentLoop Continue API。

**验证**: `pnpm test agent-loop` + `npx tsx examples/01-basic.ts`。

- [x] Step 1-13: 测试 RED → 5 个真独立模块(loop/tool-execution/types → loop/helpers + tool-validation → loop/tool-execution/{prepare,execute,finalize,truncate} → loop/tool-execution/{sequential,parallel} → loop/tool-execution.ts → loop/stream-assistant.ts → agent-loop.ts)→ 跑绿 → 01-basic.ts → wc -l 检查 → commit `9f6be26`

---

## Task 3: AgentHarness 主类(skeleton + messages + system-prompt)

**目标**: 实现 `AgentHarness` 主类骨架,集成 agent-loop、消息转换、system prompt 拼接。**本步只做骨架**,不接 session、不接 hooks。

**关键决策**(主类文件组织):
- `agent-harness.ts` 主类**单文件**,不预先拆 `agent-harness/{config,prompt,queue}.ts`
- 业务方法(prompt / subscribe / abort / 后续 steer / followUp / nextTurn / compact / navigateTree / skill / promptFromTemplate)直接写在主类内
- 1:1 翻译原 pi 的方法体(原 pi `agent-harness.ts` 982 行单文件,主类方法内联)
- 真独立模块(hooks / session / compaction / messages / system-prompt)按子目录组织

**行数预估**:
- Task 3 末尾: 400 行(构造 + 字段 + 配置 getter/setter + prompt + subscribe + abort)
- Task 4-8 末尾累计: 450 → 480 → 560 → 600 → 640 行

**测试**: 构造 harness / 事件订阅 / phase 转换 / getter+setter / prompt() 业务入口 / convertToLlm / buildSystemPrompt 各部分。

**验证**: `pnpm test harness`。

- [x] Step 1-10: harness/types 3 文件 → messages 3 文件 → system-prompt 2 文件 → phase → agent-harness 主类 + prompt.test + config.test → 更新 01-basic.ts → wc -l → commit `736d060`

---

## Task 4: 钩子系统

**目标**: 实现 `DefaultAgentHarnessHooks` + 8 核心事件 + 5 变更语义 + observers/handlers 分离。其余 12 个事件留接口(预声明 + 占位),未来按需启用。

**最大单文件**: 300 行(`default-hooks.ts`,主类 API + dispatch + cleanup 紧密耦合)

**关键判断**:
- `default-hooks.ts` 300 行 = 公共 API(observe / on / emit / addCleanup / clear / dispose) + 内部 state 协作,**合在主类**
- `semantics.ts` 200 行 = 5 个语义纯函数合一个文件(5 个文件每个 80-100 行本质是同模板,合并便于对比共性)

**关键 API**:
- `AgentHarnessHooks<E, Ctx>`: context / setContext / observe / on / emit / addCleanup / clear / dispose
- `DefaultAgentHarnessHooks<E, Ctx>`: 默认实现
- `HookEvent<TType, TResult = void>`: 事件类型,带幻影结果
- `HookHandler<E, Ctx>` / `HookObserver<E, Ctx>`

**事件清单**(20 个 = 8 核心 + 12 预声明,详见 [设计 Spec § 3.4](../specs/2026-07-30-phase02-agent-design.md#34-钩子系统完整保留-pi))。

**变更语义**(`semantics.ts` 5 纯函数):
- `runContextSemantics` 顺序转换,链式传递 messages
- `runToolCallSemantics` 顺序执行,遇 `block: true` 提前退出
- `runToolResultSemantics` 顺序累积补丁
- `runSessionBeforeSemantics` 顺序执行,遇 `cancel: true` 提前退出
- `runFireAndForgetSemantics` 并行调用,忽略返回值

**测试**: observe 只读 / on 修改上下文 / block 提前退出 / 累积补丁 / 链式转换 / clear + dispose / setContext / emit 顺序(observers 先,再 handlers)。

**验证**: `pnpm test hooks` + `npx tsx examples/07-hooks.ts`。

- [x] Step 1-11: 3 文件测试 RED → types.ts HookEvent 泛型 + 20 事件 → semantics.ts 5 纯函数 → default-hooks-state.ts 三个 Map 封装 → default-hooks.ts 主类 → 跑绿 → 接入 agent-harness.ts(phase 转换/turn 执行/tool 调用等关键点 emit 8 核心事件)→ 07-hooks.ts → wc -l → commit `59a583d`

> commit message 写 "(8 core + 9 pre-declared + 5 semantics)",后续 Task 5/6 扩展到 20 事件(新增 `session_compact` / `session_before_tree` / `session_tree`),本计划后续按 20 事件口径记录。

---

## Task 5: Session 双后端 + env

**目标**: 实现 Session 类(树形 entry 管理、上下文构建、fork)+ InMemory / JSONL 双后端 + NodeExecutionEnv。**完整保留 pi**。

**最大单文件**: 350 行(`session.ts`,主类 + fork,需评估;500 行警戒)

**Session 核心**:
- 树形 `entries: SessionTreeEntry[]`(11 种联合 — message / thinking_level_change / model_change / active_tools_change / compaction / branch_summary / custom / custom_message / label / session_info / leaf)
- `appendEntry(entry)` / `getLeafId()` / `setLeafId(id)`(**关键:必须追加 `LeafEntry`**,非仅内存更新) / `buildContextEntries()`(压缩感知) / `buildContext({ entryProjectors?, entryTransforms? })` / `fork(entryId, options)`

**Storage 接口**:
```ts
interface SessionStorage {
  load(sessionId: string): Promise<SessionTreeEntry[]>;
  append(sessionId: string, entries: SessionTreeEntry[]): Promise<void>;
  list(): Promise<{ id: string, updatedAt: Date }[]>;
  delete(sessionId: string): Promise<void>;
}
```

**JSONL 后端**: 一个 session 一个文件 `<dir>/<id>.jsonl`,启动时重放 entries 重建 leaf,append 用 `fs.appendFile`(单条写无并发风险)。

**Memory 后端**: `Map<sessionId, SessionTreeEntry[]>`,无持久化。

**NodeExecutionEnv**: `readFile` / `writeFile` / `stat` / `readdir` / `mkdir` / `exec`,全部 `Result<T, FileError>`,不抛。

**测试**: session 主类(空 / append / setLeaf 追加 LeafEntry / buildContextEntries 压缩感知 / buildContext 默认过滤 custom / entryProjectors 投影 / fork) / repos(create / open / list / delete / JSONL 持久化 / 1000 entries 性能) / nodejs(读 / 写 / 删 / exec / timeout / 跨平台)。

**验证**: `pnpm test session env` + `npx tsx examples/03-session.ts`。

- [x] Step 1-12: session/types → memory-storage + memory-repo → jsonl-storage + jsonl-repo + repo-utils → session 主类(含 fork)→ context-builder → env/nodejs → 接入 agent-harness.ts → 03-session.ts → 全量验证(vitest 366/366 + tsc 0 + pnpm build 0)→ commit `e2e325b`

**关键设计决策**:
- **LeafEntry 显式记录**: 切 leaf 是 append 一条 `LeafEntry`,非仅内存修改
- **JSONL 版本号 3**: header 第一行 `{"type":"header","version":3,...}`
- **cwd 编码**: `/home/user/proj` → `--home-user-proj--`(`/` `\` `:` 合并为 `-`,跨平台)
- **session 失败不阻塞 turn**: `session.appendMessage` 失败只 log,不抛

---

## Task 6: 压缩 + 分支摘要

**目标**: 实现 `compact()` + `navigateTree()`。**手动触发,不接触发器**(spec 8.1 明确)。

**最大单文件**: 300 行(`compact.ts`,主入口 + file-ops 内联)

**关键判断**:
- `should-compact.ts` 取消: 本包内不调用,合入 `settings.ts`
- `extractFileOpsFromMessage` 内联到 `compact.ts` 末尾(主类强依赖,跳文件没必要)
- `compact()` / `navigateTree()` 业务方法**直接写在主类 `agent-harness.ts`**([工程原则 § 1.3 反模式 5](../specs/2026-07-30-phase02-engineering-principles.md))

**compaction.ts 关键 API**:
- `compact(harness, options?): Promise<CompactResult>`
- `prepareCompaction(entries, settings): CompactionPreparation`
- `estimateTokens(message: AgentMessage): number`(`chars / 4` 启发式)
- `extractFileOpsFromMessage(message)`: 内联在 compact.ts
- `DEFAULT_COMPACTION_SETTINGS` + `shouldCompact(...)`: 在 settings.ts

**branch-summarization.ts 关键 API**:
- `generateBranchSummary(entries, model, options?): Promise<{ summary, details? }>`
- `collectEntriesForBranchSummary(entries, targetId): SessionTreeEntry[]`

**主类 `compact()` 实现**:
```ts
async compact(customInstructions?: string): Promise<...> {
  if (this.phase !== "idle") throw new AgentHarnessError("busy", "compact() requires idle harness");
  this.phase = "compaction";
  try {
    const preparation = prepareCompaction(branchEntries, DEFAULT_COMPACTION_SETTINGS);
    // ... 直接处理钩子 + compact + session.appendCompaction
  } finally { this.phase = "idle"; }
}
```

**测试**: compact(真实跑通 / 触发 `session_before_compact` / cancel 阻止 / 注入已有结果跳过 LLM / extractFileOps 提取 read/modified) / branch-summarization(collectEntries + generateBranchSummary 真实跑通) / prepare / estimate / settings。

**验证**: `pnpm test compaction` + `npx tsx examples/04-compaction.ts`。

- [x] Step 1-8: types+settings+estimate+prepare → branch-summarization → compact(含内联 file-ops)→ 接入 agent-harness.ts(compact() + navigateTree())→ 04-compaction.ts → wc -l → commit `8594b4a`

---

## Task 7: Skills + Prompt Templates

**目标**: 实现 skills / prompt templates 加载与 system prompt 注入,以及 `skill()` / `promptFromTemplate()` 方法。

**最大单文件**: 200 行

**关键判断**: `parseSkillContent` + `loadSkillFromFile` 合并到 `load.ts` — 都是"加载 skill"的不同阶段,拆开后要跳文件,合在一起线性阅读最快。

**skills 关键 API**:
- `formatSkillsForSystemPrompt(skills: Skill[]): string` → XML block(agentskills.io)
- `formatSkillInvocation(skill: Skill, args?: Record<string, string>): string` → 调起文本
- `loadSkillFromFile(path: string): Promise<Skill>`
- `parseSkillContent(content: string): { name, description, content }`: 极简 YAML frontmatter(不引入 yaml 库)

**prompt-templates 关键 API**:
- `formatPromptTemplateInvocation(template, args)`: 占位符语法 `{{name}}`,简单字符串替换,不做表达式求值

**主类 `skill()` / `promptFromTemplate()` 实现**:
```ts
async skill(name: string, additionalInstructions?: string): Promise<...> {
  const skill = (this.options.resources?.skills ?? []).find(s => s.name === name);
  if (!skill) throw new AgentHarnessError("invalid_argument", `Unknown skill: ${name}`);
  return this.executeTurn(turnState, formatSkillInvocation(skill, additionalInstructions));
}
```

**测试**: skills(formatSkillsForSystemPrompt 符合规范 / formatSkillInvocation 调起文本 / parseSkillContent 分离 frontmatter / loadSkillFromFile 真实读文件) / prompt-templates(formatPromptTemplateInvocation 替换 `{{name}}` / 未提供占位符保留原样)。

**验证**: `pnpm test skills prompt-templates` + `npx tsx examples/05-skills.ts examples/06-prompt-templates.ts`。

- [x] Step 1-7: skills 3 文件 + prompt-templates 2 文件 → 接入 agent-harness.ts(skill + promptFromTemplate + setResources)→ 05-skills.ts + 06-prompt-templates.ts(真实 DeepSeek)→ wc -l(主类 ~600 行)→ commit `54b7707`

**关键设计决策**:
- **Skill frontmatter 极简 YAML 解析**: 仅支持 `name` / `description` 字段(不引入 yaml 库)
- **占位符语法统一**: skills 和 prompt-templates 都用 `{{name}}`

---

## Task 8: 队列操作 + 自定义消息示例

**目标**: 实现 `steer()` / `followUp()` / `nextTurn()` 队列操作 + CustomAgentMessages 声明合并演示。

**主类 `steer` / `followUp` / `nextTurn` 实现**(1:1 翻译原 pi):
```ts
async steer(text: string, options?: { images?: ImageContent[] }): Promise<void> {
  if (this.phase === "idle") throw new AgentHarnessError("invalid_state", "Cannot steer while idle");
  this.steerQueue.push(createUserMessage(text, options?.images));
  await this.emitQueueUpdate();
}
async followUp(text: string, options?: { images?: ImageContent[] }): Promise<void> {
  if (this.phase === "idle") throw new AgentHarnessError("invalid_state", "Cannot follow up while idle");
  this.followUpQueue.push(createUserMessage(text, options?.images));
  await this.emitQueueUpdate();
}
nextTurn(text: string, options?: { images?: ImageContent[] }): void {
  this.nextTurnQueue.push(createUserMessage(text, options?.images));
}
```

**关键决策**:
- **不拆** `harness/queue.ts` 顶层 5 个纯函数 — 它们依赖主类队列状态,**不是真独立可测**;drain 逻辑直接写在主类 `_drainSteerQueue` / `_drainFollowUpQueue` 私有方法,`this.steerQueue = []` 或 `this.steerQueue = [first, ...rest]`
- **不拆** `agent-harness/queue.ts` 协作层([工程原则 § 1.3 反模式 5](../specs/2026-07-30-phase02-engineering-principles.md))

**最大单文件**: 640 行(主类,500-1000 OK)

**队列操作**:
- `harness.steer(text, options?)`: 中途插入用户消息,中断当前 LLM 流
- `harness.followUp(text, options?)`: 排队用户消息,等当前 turn 结束投递
- `harness.nextTurn(text, options?)`: 在下一轮用户消息之前插入
- 队列模式 setter / getter(`setSteeringMode` / `setFollowUpMode` / `getSteeringMode` / `getFollowUpMode`)

**QueueMode 行为差异**: `"all"` 排空全部 / `"one-at-a-time"` 每次排空点只取最早一条,其余保留。

> **后续变更(2026-08-02,对齐 pi 的 `drainQueuedMessages`)**:drain 逻辑收敛为主类私有方法 `drainQueue(queue, mode)`,用 `queue.splice(0)` / `queue.splice(0, 1)` 取值;消费后 emit `queue_update`(入队、出队都通知订阅者),emit 失败时 `queue.unshift(...messages)` 回滚。`_drainSteerQueue` / `_drainFollowUpQueue` / `_drainNextTurnQueue` 保留为测试用内部方法,均返回 `Promise`。

**自定义消息演示**(`examples/08-custom-messages.ts`):
```ts
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
```

**测试**: ✅ followUp 排空 / ✅ steer 中断 / ✅ nextTurn 插入 / ✅ `setSteeringMode("one-at-a-time")` 后只保留最新 / ✅ 自定义消息 `convertToLlm` 显式投影。

**验证**: `pnpm test agent-harness` + `npx tsx examples/08-custom-messages.ts`。

- [x] Step 1-6: prompt.test 增量测试 → agent-harness 增量 steer/followUp/nextTurn → config.test 增量测试 → QueueMode getter/setter → 08-custom-messages.ts → wc -l → commit `d61e9a0`

**关键设计决策**:
- **声明合并放独立 .d.ts 文件**: example 用 `08-custom-messages.d.ts` 扩展 `CustomAgentMessages.notification`,避免污染 `tsconfig.test.json`
- **nextTurn 没有 QueueMode**: 仅在 prompt 入口一次性 prepend,语义与 steer/followUp 不同

---

## Task 9: 文档输出(5 篇中文文档)

**目标**: 生成 5 篇中文文档,从 pi 翻译。spec 阶段明确交付。

**产出文件**:
- `docs/agent-harness.md` — 生命周期、状态模型、Turn 执行、保存点
- `docs/hooks.md` — 钩子系统设计、事件协议、变更语义、扩展加载
- `docs/session.md` — Session 类、Entry 树、Repo、上下文构建
- `docs/compaction.md` — 压缩 + 分支摘要完整流程与算法
- `docs/skills-and-templates.md` — Skills 与 Prompt Templates 使用与规范

**每篇文档结构**: 概述(3-5 句) / 关键概念(表格 + 简短说明) / API 速查(类型签名,不带实现) / 流程图(纯文本 ASCII) / 已知限制(从 spec 沿用)。

**review checklist**(每篇必须过): 中文流畅无错别字 / 类型签名与代码一致 / 流程图与实现一致 / 关键概念表覆盖所有 public API / 已知限制从 spec 沿用 / 文档结构统一(5 章节齐全) / 文件路径用 `file:///` 协议。

- [x] Step 1-8: 5 篇文档 → review checklist 自检 → 暂停 → 展示 diff → commit `9f29334`

---

## Task 10: 全量验证 + Phase 02 收尾

**目标**: 全量测试 + 全量 examples 跑通。

**验证清单**:
```bash
cd packages/agent && pnpm test                # ≥ 499 pass
cd packages/agent && npx tsx examples/0*.ts   # 7 个全部正常退出
cd packages/agent && pnpm tsc --noEmit        # 0 error
cd packages/agent && pnpm build               # dist/ 生成,无 warning
```

**Phase 02 收尾**:
- 写 `docs/project-log/phase-02-agent/log.md`(实施日志)
- 更新 `my-mimipi-spec.md` 状态:Phase 02 标记完成

- [x] Step 1-7: 跑全量 tests(499 pass)→ 跑全量 examples(7 个跑通)→ tsc 0 → pnpm build 0 → 写实施日志 → 更新根 spec → commit `e174ccb`

---

## Task 11: AgentHarness 架构对齐(2026-08-02)

**目标**: 让 `agent-harness.ts` 主类代码与工程原则 § 1.3 6 条反模式禁令**完全对齐**。

**背景**: Task 3-8 实施时拆出 9 个 `agent-harness/` 子文件 + `#` 硬私有字段 + `#buildQueueOpDeps()` 闭包委托 + `harness: this` 整体传参。**违反**工程原则 § 1.3 反模式 1/2/3/5/6。

**回退内容**:
- **删 9 个 `agent-harness/` 子文件**:
  - `event-bus.ts`(68 行)→ 主类内 private 字段
  - `subscription-factory.ts`(50 行)→ 主类内 private 方法
  - `hooks-bridge.ts`(118 行)→ 主类内 private 方法
  - `turn-execution.ts`(180 行)→ executeTurn 主类内 private 方法
  - `hook-context-builder.ts`(85 行)→ buildHookContext 主类内 private 方法,**不再传 `harness: this`**
  - `compaction-ops.ts`(172 行)→ runCompactOp / runNavigateTreeOp 主类内 private 方法
  - `skill-ops.ts`(79 行)→ runSkillOp / runPromptFromTemplateOp 主类内 private 方法
  - `queue.ts`(107 行)→ 队列操作主类内 private 方法,直接 `this.steerQueue.push(...)`
  - `is-agent-harness.ts`(13 行)→ 类型守卫主类内 static 方法
- **`#` 硬私有字段全部改 `private`**(反模式 1)
- **业务方法直接 `this.xxx` 操作**,不再 `runXxxOp(this.#buildXxxDeps(), ...)` 绕法(反模式 3 + 5)
- **`harness: this` 整体传参改为只传值**(反模式 2)
- `agent-harness.ts` 单文件 700-900 行(原 pi 982 行)
- `harness/queue.ts`(148 行)`drainByMode` 等纯逻辑合回主类

**保留的独立模块**(均为真独立可测): `harness/hooks/` / `harness/session/` / `harness/compaction/` / `harness/messages/` / `harness/system-prompt/` / `harness/skills/` / `harness/prompt-templates/` / `harness/env/` / `harness/types/`。

**对齐验证清单**: ✅ 跑全量 tests(499 pass)/ ✅ 跑全量 examples(7 跑通)/ ✅ tsc 0 / ✅ pnpm build 0 / ✅ wc -l 主类 700-900 行 / ✅ 9 个胶水子文件全删 / ✅ 主类内 0 处 `this.#` / ✅ commit `79e6ef2`。

- [x] Step 1-7: 按依赖顺序合回 9 个文件逻辑(queue → turn-execution → hook-context → subscription → event-bus → hooks-bridge → compaction-ops → skill-ops → is-agent-harness)→ `#` 改 `private` → `harness: this` 改只传值 → 删 9 子文件 → 跑测试修复回归 → 展示 diff → commit `79e6ef2`

---

## Task 12: 主类内部 helper 抽取 + executeTurn 步骤化(2026-08-02)

**目标**: 在 Task 11 基础上,清理主类内部"小重复"。

**背景**: Task 11 把 9 个胶水子文件合并回主类后,主类从 640 → 1053 行。出现新的小重复:5 处 `as Session<any> | undefined` 强转 / 7 处 `as any` 强转 / 8 处 `void this.hooks.emit(...)` / 2 处"session.appendMessage + catch log"块;`executeTurn` 一个方法 90+ 行,带 9 个 `// 0.~9.` 编号注释。

**对齐工程原则 § 1.1**: "让读者第一遍能看懂"——重复代码 + 编号步骤方法都是可读性杀手; "哪怕增加代码量"——优先级高于"代码行数最少"。

**改动**:
1. **抽 4 个内部 helper**(都写在主类内,不是新文件):
   - `getSessionInternal()` — 取代 5 处 `as Session<any> | undefined`
   - `appendSessionMessage(session, message)` — 取代 2 处"fire-and-forget append + log"块
   - `emitAsync(event)` — 取代 8 处 `void this.hooks.emit(...)`(包住 `void` + `as any`)
   - `emitAwait<T>(event)` — 取代 2 处 `(await this.hooks.emit(...))` 强转(generic 类型化)
2. **修 `getSession(): any` / `setSession(session: any)` 类型** → 改为 `Session<any> | undefined`
3. **拆 `executeTurn` 为 5 个命名步骤**: 主方法从 90 行降到 28 行(只剩编排);5 个步骤私有方法:`_prepareTurnInput` / `_syncSessionForTurn` / `_buildTurnPrompt` / `_combineInitialMessages` / `_buildTurnContext` / `_runAgentLoopAndForward`
4. **小修**: `buildHookContext` 注释("facade 保留"说成"未做")更准确 / `subscribe()` 中 `unsubscribe: () => {}` 改为 `null!`,先拿到 unsubscribe 再塞进 internal(消除"先占位再填"反模式) / 文件头注释从 39 行精简到 30 行(emit 位置表移到各方法内)

**对齐验证清单**: ✅ 跑全量 tests(499 pass,无增删)/ ✅ 跑全量 examples(7 跑通)/ ✅ tsc 0 / ✅ pnpm build 0 / ✅ wc -l 主类 1053 → 1119 行(+66 行,主流程更清晰)/ ✅ 业务方法 0 处 `as any` 强转 / ✅ 4 个新 helper 内部共 3 处 `as any`(2 emit + 1 session),从 12 处集中到 3 处。

- [x] Step 1-8: 加 4 个 helper → 替换 5 处 `as Session<any>` + 修 getSession/setSession 类型 → 替换 8 处 `void this.hooks.emit(...)` + 2 处 `(await ...)` 强转 → 拆 executeTurn 5 步 → 小修 3 处 → 跑测试修复 → 展示 diff → commit

---

## Task 14 修订(2026-08-02)

**动机**:用户指出 `subscribe()` 不应偏离原 pi 的 push 模式。原 Task 12 重构引入了 `subscribe(): AsyncIterable<AgentHarnessEvent>`(返回 Subscription,支持 `for await` + `.cancel()`),虽然 spec 里显式要求,但实际工程上有 3 个问题:

1. 引入 4 个"过细的内部类型"(`Subscriber` / `Resolver` / `SubscriptionInternal` / `Subscription` + 1 个 `SubscriptionInternalSymbol`),按工程原则 § 1.1 "3 个快速判断"严格评估,**不能独立测试 + 脱离主类无独立意义**,应该合回主类或干脆删掉
2. 60 行 `subscribe()` 实现 + 闭包内部状态,读者要打开看 5 个类型定义才能完整理解"订阅机制"
3. 与原 pi 1:1 翻译原则相违背(工程原则 § 1.1 末行) — pi 的 `subscribe(listener) → unsubscribe` 只有 11 行,一目了然

**决定**:回退到 push 模式,与 pi 1:1 翻译。

**改动**:
1. **删 5 个类型**:`Subscriber` / `Resolver` / `SubscriptionInternal` / `Subscription` 公共接口 / `SubscriptionInternalSymbol`
2. **改 `subscribe()` 签名**:`subscribe(listener: AgentHarnessListener): () => void`
3. **新增 `AgentHarnessListener` 类型**(export):`(event, signal?) => void | Promise<void>`,与 pi 1:1
4. **删 `addSubscriber()` 私有方法**:直接 push 到 `this.subscribers: Set<AgentHarnessListener>`,unsub 就是 `() => this.subscribers.delete(listener)`
5. **`emit()` 方法不变**:本来就是遍历 `this.subscribers` 调用,无 AsyncIterable 改造
6. **改 4 个 example**: `01-basic` / `04-compaction` / `07-hooks` / `08-custom-messages`
7. **改 2 个 test**: `agent-harness.test.ts` / `prompt.test.ts`
8. **改 spec § 3.1**: API 示例从 `for await (const event of harness.subscribe())` 改为 `harness.subscribe(listener) => unsubscribe()`
9. **删 `Subscription` re-export**:`src/index.ts` + `src/harness/index.ts` 改为导出 `AgentHarnessListener`

**对齐验证清单**: ✅ 跑全量 tests(480 pass)/ ✅ 跑全量 examples(4 用到 subscribe 的全部跑通:01 / 04 / 07 / 08)/ ✅ tsc 0 / ✅ wc -l 主类 1029 → ~960 行(减约 70 行,删 4 个类型 + 简化 subscribe + 注释)

**原则回归**:此次修订把"为简洁而简洁"拉回到"1:1 翻译 pi + 显式标注偏离"的工程原则 § 1.1 框架内。`AsyncIterable` 那条 spec 当时写得"自认更好",但没记录理由;本次发现 spec 偏离没带来实质收益(仅"整链 AsyncIterable"的形式美感),不值得为此增加 70 行 + 5 个类型。**留给未来:若真发现 push 模式不够用(例如需要 backpressure),再重新评估 AsyncIterable 化,但要在 spec 里先写清理由**。

---

## Task 13 修订(2026-08-02)

**动机**:Task 12 完成后,继续做"小修"清理(用户问"还有没有可以继续优化的地方")。

**改动**:
1. **删 2 个真死代码**:`_setCurrentAbortController`(无任何调用方)+ `_isDisposed`(无任何调用方)
2. **`_syncHookContext` 改 `private`**:从 `public _` 灰色地带改为标准 private
3. **`prompt()` 入口统一用 `emitAwait` helper**:消掉 1 处 `as ... | undefined` 强转,删 1 个 `BeforeAgentStartHookEvent` import
4. **`getSession()` 返回类型从 `any` 改为 `Session<any> | undefined`**
5. **`setSession()` 加 13 行 JSDoc** 明确"运行时切换 session"语义,标注"预留 API"

**对齐验证清单**: ✅ 跑全量 tests(480 pass)/ ✅ 跑 01-basic example 跑通 / ✅ tsc 0

---


