# Agent 层核心设计 Spec

> 本文档是 my-mimipi 项目 `packages/agent` 的详细技术设计。
> 上游 AI 层设计见 [phase01-ai-core-design.md](./2026-07-29-phase01-ai-core-design.md)。
> 下游 CLI 入口见 [phase02.5-coding-agent-design.md](./2026-07-30-phase02.5-coding-agent-design.md)。
> 项目整体方案见根目录 `my-minipi-spec.md`。
> 工程原则见 [2026-07-30-phase02-engineering-principles.md](./2026-07-30-phase02-engineering-principles.md)。

## 概述

### 目标

从 pi 项目的 `packages/agent`(~8,000 行,涵盖两套 Agent 类 + harness 设施)整合出一套**完整可用的 Agent 运行时**(预计 ~4,500 行)。AI 层负责"如何调用一次 LLM 并拿到流",Agent 层负责"如何把 LLM、工具、消息、会话、压缩、钩子、持久化组成一个能拿出去用的运行时"。

### 与 pi 的对比

| 维度 | pi `packages/agent` | 本项目 `packages/agent` |
|------|-------------------|---------------------|
| Agent 类 | 两套(`Agent` 轻量 + `AgentHarness` 重型) | 只保留 `AgentHarness` |
| 源文件 | ~30 | ~25(按子目录组织,主类 500-1000 行,真独立模块 ≤ 300 行) |
| 核心循环 | 1 (`agent-loop.ts`) | 1(从 pi 完整保留,含 5 个子模块) |
| Session 后端 | 2 (InMemory + JSONL) | 2(完整保留) |
| 自定义消息 | 4 种 + 声明合并 | 4 种 + 声明合并(完整保留) |
| 压缩 | 线性 compaction + branch summary | 完整保留(7 个文件) |
| Skills / Templates | 完整 | 完整(5 个文件 + 2 个 example) |
| 执行环境 | Node.js / browser | 仅 Node.js(无 browser) |
| 钩子系统 | 完整 | 完整(20 个事件:8 核心 + 12 预声明) |
| 行数 | ~8,000 | ~4,500(目标) |

### 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 保留 `Agent`(轻量)还是 `AgentHarness`(重型) | **只保留 `AgentHarness`** | Session / 记忆 / 压缩都是必须品,直接拿重型方案 |
| Session 存储后端 | **InMemory + JSONL 双后端** | InMemory 适合测试和临时场景,JSONL 适合持久化 |
| AgentMessage 扩展机制 | **完整保留 `CustomAgentMessages` 声明合并** | 上层扩展零摩擦,跟 pi 完全兼容 |
| Compaction | **完整保留三件套** | 压缩 + 分支摘要 + 文件操作追踪,缺一不可 |
| Browser env | **不实现** | 本项目无 browser 目标 |
| `agent-harness.ts` 文件组织 | **主类单文件 500-1000 行,不拆子文件** | 业务方法直接写在主类(原 pi 风格),1:1 翻译原 pi 方法体 |
| 字段封装 | **`private` 不用 `#`** | TS 编译时私有已经够,`#` 在本项目无实际收益 |

---

## 1. 技术选型

| 依赖 | 来源 | 用途 |
|------|------|------|
| `@mimi/ai` | 内部 | 消息类型、Stream、Models、Provider、工具定义、错误分类 |
| `typebox/compile` / `typebox/error` / `typebox/value` | pi 同版本(1.1.38) | 工具参数 schema 编译/校验 |
| `node:fs/promises` / `node:child_process` | Node 内置 | JSONL 持久化 / shell 执行 |

**与 AI 层契约**:agent 层不直接调用 `provider.complete()` / `provider.stream()`;通过 `models.stream(model, context, options)` 间接调用。**重试逻辑在 agent 层**(基于 `isRetryableAssistantError`),不在 AI 层。`buildAssistantMessage` 的 content 数组顺序必须为 `text → thinking → tools`(由 AI 层保证),agent 层不做任何修改。运行时 TypeScript 5.9+ / Node.js 22+ / pnpm / vitest。

**测试策略**:单元测试用 vitest(agent-loop 状态机、Session 读写、Repo、Compaction token 估算、Branch summary、Hook 协议转换、消息转换、Skills 解析、Prompt template 格式化);集成验证用 `examples/*.ts` 真实 LLM 调用。

---

## 2. 目录结构

```
packages/agent/
  package.json              # name: "@mimi/agent", type: "module"
  tsconfig.json
  vitest.config.ts

  src/
    index.ts                # 公共 API 导出(薄壳)
    types.ts                # 共用类型
    agent-loop.ts           # 核心循环公共入口(~200 行)
    loop/                   # agent-loop 内部实现(真独立模块,每文件 ≤ 300 行)
      helpers.ts
      stream-assistant.ts
      tool-validation.ts
      tool-execution.ts
      tool-execution/       # 执行子流水线
        types.ts
        prepare.ts
        execute.ts
        finalize.ts
        truncate.ts
        sequential.ts
        parallel.ts
    harness/                # AgentHarness 运行时外壳
      index.ts              # 模块公共 API(薄壳)
      agent-harness.ts      # 主类单文件(500-1000 行,业务方法直接写在主类)
      phase.ts              # phase 状态机
      errors.ts             # AgentHarnessError / HarnessConfigError
      types/                # AgentHarness 公共类型(harness.ts / events.ts / options.ts)
      messages/             # 真独立模块:convert.ts / assistant.ts / custom.ts
      system-prompt/        # 真独立模块:build.ts / parts.ts
      hooks/                # 真独立模块:types.ts(20 个事件) / semantics.ts(5 语义) / default-hooks.ts / default-hooks-state.ts
      session/              # 真独立模块:types.ts(11 种 entry) / session.ts(主类) / context-builder.ts / storage.ts / repos/(memory-*, jsonl-*, repo-utils)
      env/                  # 真独立模块:types.ts / result.ts / nodejs.ts
      compaction/           # 真独立模块:types.ts / settings.ts / estimate.ts / prepare.ts / branch-summarization.ts / compact.ts
      skills/               # 真独立模块:types.ts / format.ts / load.ts
      prompt-templates/     # 真独立模块:types.ts / format.ts

  __tests__/                # vitest 单元测试
    types.test.ts
    agent-loop.test.ts
    harness/
      phase.test.ts
      types/{harness,events,options}.test.ts
      messages/{convert,assistant,custom}.test.ts
      system-prompt/{build,parts}.test.ts
      agent-harness/{agent-harness,config,prompt}.test.ts
      hooks/{types,semantics,default-hooks}.test.ts
      session/{types,memory-*,jsonl-*,session,context-builder,repo-utils}.test.ts
      env/nodejs.test.ts
      compaction/{types,settings,estimate,prepare,branch-summarization,compact}.test.ts
      skills/{format,load}.test.ts
      prompt-templates/format.test.ts

  examples/                 # 真实 DeepSeek API 集成示例
    01-basic.ts
    03-session.ts
    04-compaction.ts
    05-skills.ts
    06-prompt-templates.ts
    07-hooks.ts
    08-custom-messages.ts
```

**关键设计原则**:`agent-harness.ts` 主类**单文件** 500-1000 行,业务方法(steer / followUp / nextTurn / compact / navigateTree / skill / promptFromTemplate / executeTurn)直接写在主类。**不**拆 `agent-harness/{config,prompt,queue,event-bus,subscription-factory,hooks-bridge,turn-execution,hook-context-builder,compaction-ops,skill-ops,is-agent-harness}.ts` 等胶水子文件,也不**用 `runXxxOp(deps, ...)` 协作层模式**(详见工程原则 § 1.3)。真独立模块(hooks / session / compaction / skills / messages / prompt-templates / env)按子目录组织,每文件 ≤ 300 行。

---

## 3. 核心接口

### 3.1 AgentHarness(主类,单文件)

```ts
const harness = new AgentHarness({
  model, thinkingLevel, systemPrompt, tools, env,
  session, hooks, resources, streamOptions, compaction,
  steeringMode, followUpMode,
});

// 一次性启动
await harness.prompt("今天天气怎么样?");

// 流式接收事件(push 模式,与 pi 1:1)
const unsubscribe = harness.subscribe((event) => { /* ... */ });
// 调 unsubscribe() 取消订阅

// 中途换模型 / 加工具 / 加载 skill / 通过模板启动
harness.setModel(newModel);
harness.setTools([...harness.getTools(), newTool]);
await harness.skill("git-commit");
await harness.promptFromTemplate("code-review", { prUrl });

// 中途插话 / 排队 / 触发压缩 / 树形跳转
harness.steer("顺便加上单元测试");
harness.followUp("再加个 e2e 测试");
await harness.compact();
await harness.navigateTree({ targetId: someEntryId });

// 优雅终止
await harness.abort();
```

**主类实现要点**:
- 字段全部用 `private`(不用 `#`)
- 业务方法直接 `this.xxx` 操作,不走协作层
- 队列方法直接 `this.steerQueue.push(...)` + `this.emitAsync({ type: "queue_update" })`;消费统一走 `drainQueue`(消费后也 emit queue_update,失败回滚,对齐 pi)
- `compact()` / `navigateTree()` 内联实现,调真独立模块的纯函数(`prepareCompaction` / `compact` / `generateBranchSummary`)
- `executeTurn()` 内联实现,直接 `this.runtime` / `this.hooks` / `this.options.session`,不拆 `turn-execution.ts`
- **`executeTurn` 拆为 5 个命名步骤私有方法**(`_prepareTurnInput` / `_syncSessionForTurn` / `_buildTurnPrompt` / `_combineInitialMessages` / `_buildTurnContext` / `_runAgentLoopAndForward`),主方法只剩 28 行编排
- **抽 4 个内部 helper 消除重复**(都写在主类内,不是新文件):
  - `getSessionInternal()` — 5 处 `as Session<any> | undefined` 强转的唯一来源
  - `appendSessionMessage(session, message)` — 2 处"fire-and-forget append + log"块
  - `emitAsync(event)` — 8 处 `void this.hooks.emit(...)`(包住 `void` + `as any`)
  - `emitAwait<T>(event)` — 2 处 `(await this.hooks.emit(...))` 强转(generic 类型化)

### 3.2 AgentHarnessOptions(完整字段)

```ts
interface AgentHarnessOptions<TSkill, TPromptTemplate> {
  model: Model<any>;
  tools: AgentTool<any>[];
  resources?: AgentHarnessResources<TSkill, TPromptTemplate>;  // skills + promptTemplates
  env: ExecutionEnv;                              // 本项目只实现 NodeExecutionEnv
  session: Session;                                // 已打开的 session
  thinkingLevel?: ThinkingLevel;
  systemPrompt?: string | ((ctx: SystemPromptContext) => string | Promise<string>);
  streamOptions?: AgentHarnessStreamOptions;
  hooks?: AgentHarnessHooks<AgentHarnessEvent, AgentHarnessHookContext>;
  compaction?: CompactionSettings;
  steeringMode?: QueueMode;                        // "all" | "one-at-time"
  followUpMode?: QueueMode;
}
```

### 3.3 核心类型

```ts
// 阶段机
type AgentHarnessPhase = "idle" | "turn" | "compaction" | "branch_summary" | "retry";

// Turn 快照(单次 LLM turn 使用的具体状态)
interface AgentHarnessTurnState {
  messages: AgentMessage[];
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];
  activeTools: string[];
  streamOptions: AgentHarnessStreamOptions;
  sessionId: string;
}

// 钩子 context(harness 是 facade,不是原始 harness,防止死锁)
interface AgentHarnessHookContext {
  harness: AgentHarness;
  session: SessionFacade;
  models: ModelFacade;
}
```

### 3.4 钩子系统(完整保留 pi)

钩子通过事件 `emit()` 派发,每个事件可携带"幻影结果类型",handlers 可以返回该结果。

**20 个事件(8 核心 + 12 预声明)**:

| 事件 | 分类 | 携带结果 | 用途 |
|------|------|----------|------|
| `context` | 核心 | `{ messages? }` | 转换发送给 LLM 的消息链 |
| `before_agent_start` | 核心 | `{ messages?, systemPrompt? }` | 注入额外消息或修改 system prompt;事件携带本轮入参(`prompt` / `images` / `systemPrompt` / `resources`),覆盖时整体替换(含 skills 块) |
| `tool_call` | 核心 | `{ block?, reason? }` | 拦截工具调用 |
| `tool_result` | 核心 | `{ content?, details?, isError?, terminate? }` | 修补工具结果 |
| `message_end` | 核心 | undefined | 消息结束时通知 |
| `session_before_compact` | 核心 | `{ cancel?, compaction? }` | 压缩前拦截 |
| `model_update` | 核心 | undefined | 模型变更通知 |
| `abort` | 核心 | undefined | 终止通知 |
| `session_compact` / `session_before_tree` / `session_tree` / `queue_update` | 预声明 | 各种 | 各种 |
| `before_provider_request` / `before_provider_payload` / `after_provider_response` | 预声明 | 各种 | provider 钩入点 |
| `thinking_level_update` / `resources_update` / `tools_update` / `save_point` / `settled` | 预声明 | undefined | 配置/生命周期 |

**钩子接口**:`AgentHarnessHooks<E, Ctx>` 暴露 `context` / `setContext` / `observe`(只读)/ `on`(参与语义)/ `emit` / `addCleanup` / `clear` / `dispose`。语义(`semantics.ts`):`runContextSemantics` 链式转换 messages / `runToolCallSemantics` 顺序执行遇 block 退出 / `runToolResultSemantics` 累积补丁 / `runSessionBeforeSemantics` 遇 cancel 退出 / `runFireAndForgetSemantics` 并行忽略返回。

**事件协议**:`AgentHarnessEvent = AgentEvent | AgentHarnessOwnEvent`。`AgentEvent` 来自 agent-loop(`start` / `turn_start` / `text_*` / `thinking_*` / `toolcall_*` / `tool_execution_*` / `turn_end` / `done` / `error`)。`AgentHarnessOwnEvent` 是 harness 特有(配置变更 / 队列 / 钩子事件转发 / 保存点 / abort / settled)。

---

## 4. 状态模型

Harness 状态分四类(从 pi 完整保留):

| 类别 | 字段 | 语义 |
|------|------|------|
| **Harness 配置(运行时)** | `model` / `thinkingLevel` / `tools` / `activeToolNames` / `resources` / `streamOptions` / `systemPrompt` | getter 返回最新;setter 立即更新,影响**下一个 turn**,不影响当前 turn |
| **Turn 快照** | `createTurnState()` 浅拷贝 | 每次结构性操作前浅拷贝,该 turn 内所有逻辑使用同一快照 |
| **Session(已持久化)** | 树形 `entries` | `Session.buildContextEntries()` 压缩感知,`Session.buildContext({ entryProjectors? })` 投影为 `AgentMessage[]`,自定义条目默认从模型上下文省略 |
| **待写入队列** | `PendingSessionWrite` | 基于 entry 形状(不含生成字段),在保存点、操作结算、失败清理时刷新 |

---

## 5. 关键流程

### 5.1 Turn 执行(`prompt` / `skill` / `promptFromTemplate`)

```
1. 断言 phase === "idle"  → 同步设为 "turn"
2. createTurnState()      → 浅拷贝快照
3. 从快照派生调用文本     → user 消息 / skill 调用文本 / template 调用文本
4. executeTurn() 内部(主类私有方法,5 步拆分):
   4.1 构造 AgentContext
   4.2 调 runAgentLoop(snapshot, config)
   4.3 监听 AgentEvent  →  同步刷新 session 写入(到 PendingSessionWrite)
5. 调 hooks.emit({ type: "save_point" })
6. 调 phase = "idle"
```

### 5.2 队列操作(`steer` / `followUp` / `nextTurn`)

主类内直接实现,跟原 pi 1:1 对齐:

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

**`steer`** 在 LLM 流进行中插入,中断当前 LLM 流;**`followUp`** 排队等当前 turn 自然结束再投递;**`nextTurn`** 在下次 `prompt()` 入口 prepend。

**QueueMode 行为差异**:`"all"` 排空全部 / `"one-at-a-time"` 每次排空点只取最早一条,其余保留。**消费统一走主类私有方法 `drainQueue(queue, mode)`**(`queue.splice(0)` 或 `queue.splice(0, 1)`),消费后 emit `queue_update`(入队、出队都通知订阅者),emit 失败时 `queue.unshift(...messages)` 回滚——与 pi 的 `drainQueuedMessages` 1:1 对齐。生产入口:`prompt()` 消费 nextTurn、`getSteeringMessages` / `getFollowUpMessages` 消费 steer / followUp;另提供 3 个测试用内部方法 `_drainSteerQueue()` / `_drainFollowUpQueue()` / `_drainNextTurnQueue()`(均返回 Promise)。

### 5.3 压缩(`compact`)

```ts
async compact(customInstructions?: string): Promise<string | undefined> {
  assertPhase(this.getPhase(), "idle", "compact");
  this._setPhase("compaction");
  try {
    // 1. emit session_before_compact(handler 可 cancel / 注入结果)
    // 2. 决定 result:优先用 hook 注入,否则调真独立模块的纯函数 runCompact()
    // 3. 写 CompactionEntry 到 session
    // 4. emit session_compact
    return result.summary;
  } finally { this._setPhase("idle"); }
}
```

### 5.4 树形跳转(`navigateTree`)

主类内直接实现,调 `collectEntriesForBranchSummary` / `generateBranchSummary` / `session.moveTo` / `hooks.emit("session_tree")`。流程同 `compact`,从 `branch_summary` phase 走。

---

## 6. Session 存储

**双后端**:

| 后端 | 用途 | 持久化 |
|------|------|--------|
| `InMemorySessionStorage` + `MemorySessionRepo` | 测试、临时场景 | 否 |
| `JsonlSessionStorage` + `JsonlSessionRepo` | 生产场景、coding-agent | 是(JSONL 文件,一个 session 一个文件,启动时重放 entries 重建 leaf) |

**Entry 类型**:Session 是树形结构,每条 entry 是 `SessionTreeEntry` 的联合(`MessageEntry` / `BranchSummaryEntry` / `CompactionEntry` / `CustomEntry` / `LeafEntry` 等 11 种)。

**关键约束**:`setLeafId` 不是仅内存的游标更新,必须追加 `LeafEntry`,重新打开存储时从最后一条 leaf 变更重建当前 leaf。JSONL header 第一行 `{"type":"header","version":3,...}`,未来格式不兼容时拒绝旧文件。

**上下文构建**:
- `Session.buildContextEntries()` → `SessionTreeEntry[]`(压缩感知)
- `Session.buildContext({ entryProjectors?, entryTransforms? })` → `AgentMessage[]`(从 buildContextEntries 投影,自定义条目默认省略)

---

## 7. 压缩与分支摘要

**8.1 线性压缩(`compaction.ts`)** — **输入**:整个 session 的 messages;**输出**:`{ summary, firstKeptEntryId, tokensBefore, details? }`;**触发**:**仅手动** `harness.compact()`(agent 包内从不在 turn 之后自动调用,`shouldCompact` 预留给上层 coding-agent)。算法:估算当前 token 数(`estimateTokens` `chars / 4` 启发式)→ 选保留边界 → 调 LLM 生成 summary → 写 `CompactionEntry`。

**8.2 分支摘要(`branch-summarization.ts`)** — **输入**:`targetId`(目标 leaf);**输出**:`{ summary, details? }`;**触发**:手动 `harness.navigateTree({ targetId })`。算法:收集从 root 到 targetId 路径上"被丢弃"的 entry → 调 LLM 生成 summary → 写 `BranchSummaryEntry`。

**8.3 文件操作追踪**:压缩后 summary 保留"哪些文件被读/写"信息。`extractFileOpsFromMessage` 从消息中提取 `readFiles` / `modifiedFiles`,累计到 session-level 集合,压缩时一并写入 `CompactionEntry.details`。

---

## 8. Skills 与 Prompt Templates

**Skills**(`interface Skill { name; description; content; filePath; disableModelInvocation? }`):
- 从 `SKILL.md` 文件加载(格式跟 pi 一致,遵循 agentskills.io 规范)
- 通过 `resources.skills` 注入
- `formatSkillsForSystemPrompt(skills)` 拼接为 XML block 塞入 system prompt
- `harness.skill(name, args)` 调起后走正常 turn 流程

**Prompt Templates**(`interface PromptTemplate { name; description?; content }`):
- 占位符语法 `{{name}}`,简单字符串替换,不做表达式求值
- `harness.promptFromTemplate(name, args)` 替换占位符后走正常 turn 流程

---

## 9. 执行环境(仅 Node.js)

`NodeExecutionEnv` 提供 `readFile` / `writeFile` / `stat` / `readdir` / `mkdir` / `exec`,**失败用 `Result<T, FileError>` 返回,不抛出**。错误类型稳定(`code: "not_found" | "permission_denied" | "is_directory" | ...`)。不实现 BrowserExecutionEnv(本项目无 browser 目标)。

---

## 10. 错误处理

| 层次 | 风格 | 例子 |
|------|------|------|
| 底层能力(`ExecutionEnv`、文件、shell) | `Result<T, TError>`(不抛出) | `readFile` 失败 |
| 助手函数(辅助工具) | `Result<T, TError>`(不抛出) | 资源加载、压缩辅助 |
| 编排层(`Session`、`AgentHarness`) | reject/throw(高层变更) | `harness.prompt` 失败 |
| 公共错误 | `AgentHarnessError`,code 归一化 | `busy` / `invalid_argument` / `invalid_state` / `session` / `compaction` / `branch_summary` / `hook` / `unknown` |

子系统错误(如 `SessionError`、`CompactionError`)作为 `cause` 保留。
