# Agent 层核心设计 Spec

> 本文档是 my-mimipi 项目 `packages/agent` 的详细技术设计。
> 上游 AI 层设计见 [phase01-ai-core-design.md](./2026-07-29-phase01-ai-core-design.md)。
> 下游 CLI 入口(基于本层)见 [phase02.5-coding-agent-design.md](./2026-07-30-phase02.5-coding-agent-design.md)。
> 项目整体方案见根目录 `my-minipi-spec.md`。

## 概述

### 目标

从 pi 项目的 `packages/agent`(~8,000 行,涵盖两套 Agent 类 + harness 设施)整合出一套**完整可用的 Agent 运行时**(预计 ~4,500 行)。AI 层负责"如何调用一次 LLM 并拿到流",Agent 层负责"如何把 LLM、工具、消息、会话、压缩、钩子、持久化组成一个能拿出去用的运行时"。

### 与 pi 的对比

| 维度 | pi `packages/agent` | 本项目 `packages/agent` |
|------|-------------------|---------------------|
| Agent 类 | 两套(`Agent` 轻量 + `AgentHarness` 重型) | 只保留 `AgentHarness` |
| 源文件 | ~30 | ~25(按子目录组织,严格 ≤ 500 行) |
| 核心循环 | 1 (`agent-loop.ts`) | 1 (从 pi 完整保留,含 5 个子模块) |
| Session 后端 | 2 (InMemory + JSONL) | 2 (完整保留) |
| 自定义消息 | 4 种 + 声明合并 | 4 种 + 声明合并(完整保留) |
| 压缩 | 线性 compaction + branch summary | 完整保留(7 个文件) |
| Skills / Templates | 完整 | 完整(5 个文件 + 2 个 example) |
| 执行环境 | Node.js / browser | 仅 Node.js(无 browser) |
| 钩子系统 | 完整 | 完整(20 个事件:8 核心 + 12 预声明) |
| 行数 | ~8,000 | ~4,500(目标) |

### 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 保留 `Agent`(轻量)还是 `AgentHarness`(重型) | **只保留 `AgentHarness`** | Session / 记忆 / 压缩都是必须品,直接拿重型方案;轻量 Agent 是中间层抽象,没有用户场景 |
| Session 存储后端 | **InMemory + JSONL 双后端** | InMemory 适合测试和临时场景,JSONL 适合持久化(coding-agent 必须) |
| AgentMessage 扩展机制 | **完整保留 `CustomAgentMessages` 声明合并** | 上层扩展(bashExecution / notification / artifact 等)零摩擦,跟 pi 完全兼容 |
| Compaction | **完整保留三件套** | 压缩 + 分支摘要 + 文件操作追踪,缺一不可 |
| Browser env | **不实现** | 本项目无 browser 目标 |
| 删 `proxy.ts`、`node.ts` | 是 | `proxy.ts` 是部署层(走代理服务器);`node.ts` 已并入 `env/nodejs.ts` |

---

## 1. 技术选型

### 1.1 核心依赖

| 依赖 | 来源 | 用途 |
|------|------|------|
| `@mimi/ai` | 内部 | 消息类型、Stream、Models、Provider、工具定义、错误分类 |
| `@mimi/coding-agent-utils` | 暂不引入 | pi 的工具集(`TypeBox 1.1.38` 等)直接复用 pi 同版本 |
| `typebox/compile` | pi 同版本(1.1.38) | 工具参数 schema 编译 |
| `typebox/error` | 同上 | 编译错误格式化 |
| `typebox/value` | 同上 | schema 校验 |
| `node:fs/promises` | Node 内置 | JSONL 持久化 |
| `node:child_process` | Node 内置 | `env/nodejs.ts` 的 shell 执行 |

**与 AI 层契约**:agent 层不直接调用 `provider.complete()` / `provider.stream()`;通过 `models.stream(model, context, options)` 间接调用。**重试逻辑在 agent 层**(基于 `isRetryableAssistantError` 判断),不在 AI 层。

### 1.2 运行时

TypeScript 5.9+ / Node.js 22+ / pnpm / vitest。与 AI 层保持一致。

### 1.3 测试策略

| 层次 | 工具 | 内容 | 数据 |
|------|------|------|------|
| **单元测试** | vitest | agent-loop 状态机、Session 读写、InMemory/JSONL Repo、Compaction token 估算、Branch summary、Hook 协议转换、消息转换、Skills 解析、Prompt template 格式化 | 纯逻辑,内存中构造;JSONL 用临时目录;**34 个测试文件,~450 tests** |
| **集成验证** | `examples/*.ts` | 真实 LLM 调用:基础对话、工具调用、Session 持久化、压缩、手动钩子注入、Skills 加载、Prompt templates | 真实 API Key,真实场景(**从 Task 7 起 examples 全部走真实 DeepSeek API**) |

---

## 2. 目录结构

> 当前实现(Task 7 末尾实测)与本 spec 一致,目录按"职责子目录"组织,每个子目录有 `index.ts` 公共 API 出口。

```
packages/agent/
  package.json              # name: "@mimi/agent", type: "module"
  tsconfig.json
  vitest.config.ts

  src/
    index.ts                # 公共 API 导出(薄壳,~120 行)
    types.ts                # 共用类型:AgentContext, AgentEvent, AgentMessage, AgentTool, AgentLoopConfig, QueueMode, ThinkingLevel
    agent-loop.ts           # 核心循环公共入口(只做编排)
    loop/                   # agent-loop 内部实现(严格 ≤ 500 行)
      helpers.ts            # 纯函数辅助
      stream-assistant.ts   # 流式响应 + 重试
      tool-validation.ts    # TypeBox 参数校验
      tool-execution.ts     # 工具执行入口(路由)
      tool-execution/       # 执行子流水线
        types.ts            # 内部类型
        prepare.ts          # prepareToolCall(参数校验 + beforeToolCall 桥接)
        execute.ts          # executePreparedToolCall(onUpdate 派发)
        finalize.ts         # finalizeExecutedToolCall(afterToolCall 桥接)
        truncate.ts         # failToolCallsFromTruncatedMessage
        sequential.ts       # 串行执行
        parallel.ts         # 并行执行
    harness/                # AgentHarness 运行时外壳
      index.ts              # 模块公共 API(薄壳)
      phase.ts              # phase 状态机
      errors.ts             # AgentHarnessError / HarnessConfigError
      agent-harness/        # AgentHarness 主类 + 子文件
        agent-harness.ts    # AgentHarness 主类(479 行,Task 7 末尾实测)
        event-bus.ts        # 事件总线(独立类)
        helpers.ts          # 纯函数辅助
        hooks-bridge.ts     # hooks ↔ agent-loop 桥接
        compaction-ops.ts   # compact / navigateTree 委托(Task 6 抽出)
        turn-execution.ts   # executeTurn 委托(Task 6 抽出)
        hook-context-builder.ts  # buildHookContext + loadSessionMessages(Task 6 抽出)
        subscription-factory.ts  # createSubscription(Task 6 抽出)
        skill-ops.ts        # runSkillOp + runPromptFromTemplateOp(Task 7 抽出)
        is-agent-harness.ts # isAgentHarness 类型守卫(Task 7 抽出)
      types/                # AgentHarness 公共类型
        harness.ts          # Skill / PromptTemplate / HookEvent
        events.ts           # AgentHarnessEvent 联合
        options.ts          # AgentHarnessOptions / 构造选项
      messages/             # 消息转换
        convert.ts          # convertToLlm 主入口 + custom 过滤
        assistant.ts        # buildAssistantMessage + content 顺序
        custom.ts           # 自定义消息投影
      system-prompt/        # system prompt 拼接
        index.ts            # 模块公共 API
        build.ts            # buildSystemPrompt 主入口
        parts.ts            # 各部分拼装
        types.ts            # 内部类型
      hooks/                # 钩子系统(20 个事件:8 核心 + 12 预声明)
        index.ts            # 模块公共 API
        types.ts            # 20 个事件类型 + 公共联合
        semantics.ts        # 5 种语义纯函数
        default-hooks.ts    # DefaultAgentHarnessHooks 主类
        default-hooks-state.ts  # 内部状态封装
      session/              # Session 双后端
        types.ts            # 11 种 SessionTreeEntry 联合
        session.ts          # Session 主类
        context-builder.ts  # buildContextEntries(压缩感知)
        storage.ts          # SessionStorage / SessionRepo 接口
        uuidv7.ts           # uuidv7 短 id 生成器
        repo-utils.ts       # 共享工具
        repos/
          memory-storage.ts # InMemorySessionStorage
          memory-repo.ts    # InMemorySessionRepo
          jsonl-storage.ts  # JsonlSessionStorage
          jsonl-repo.ts     # JsonlSessionRepo(cwd 编码目录)
        index.ts            # 模块公共 API
      env/                  # ExecutionEnv(仅 Node.js)
        types.ts            # ExecutionEnv 接口
        result.ts           # Result / ok / err + 错误转换
        nodejs.ts           # NodeExecutionEnv 实现
        index.ts            # 模块公共 API
      compaction/           # 压缩 + 分支摘要(Task 6)
        types.ts            # CompactionSettings / CompactionResult 等
        settings.ts         # DEFAULT_COMPACTION_SETTINGS + shouldCompact
        estimate.ts         # estimateTokens(chars/4 启发式)
        prepare.ts          # prepareCompaction(选保留边界)
        branch-summarization.ts  # generateBranchSummary
        compact.ts          # compact 主入口 + 内联 file-ops
        index.ts            # 模块公共 API
      skills/               # Skills(Task 7)
        types.ts            # Skill / SkillFrontmatter / ParsedSkill
        format.ts           # formatSkillsForSystemPrompt + formatSkillInvocation
        load.ts             # parseSkillContent + loadSkillFromFile
        errors.ts           # SkillParseError
        index.ts            # 模块公共 API
      prompt-templates/     # Prompt Templates(Task 7)
        types.ts            # PromptTemplate / PromptTemplateArgs
        format.ts           # formatPromptTemplateInvocation
        index.ts            # 模块公共 API

  src/__tests__/            # vitest 单元测试(34 个测试文件,~450 tests)
    types.test.ts
    agent-loop.test.ts
    harness/
      phase.test.ts
      types/{harness,events,options}.test.ts
      messages/{convert,assistant,custom}.test.ts
      system-prompt/{build,parts}.test.ts
      agent-harness/{agent-harness,config,prompt}.test.ts
      hooks/{types,semantics,default-hooks}.test.ts
      session/{types,memory-storage,memory-repo,jsonl-storage,jsonl-repo,session,context-builder,repo-utils}.test.ts
      env/nodejs.test.ts
      compaction/{types,settings,estimate,prepare,branch-summarization,compact}.test.ts
      skills/{format,load}.test.ts
      prompt-templates/format.test.ts

  examples/                 # 真实 DeepSeek API 集成示例(6 个)
    01-basic.ts             # Task 2/3:基础 harness + 工具调用
    03-session.ts           # Task 5:Session 双后端 + 持久化
    04-compaction.ts        # Task 6:压缩(真实 DeepSeek API)
    05-skills.ts            # Task 7:Skills(真实 DeepSeek API)
    06-prompt-templates.ts  # Task 7:Prompt Templates(真实 DeepSeek API)
    07-hooks.ts             # Task 4:钩子系统演示
```

---

## 3. 核心接口设计

### 3.1 AgentHarness 主类

```ts
import type { AgentHarness } from "@mimi/agent";

const harness = new AgentHarness({
  model,                       // 当前 model
  thinkingLevel: "medium",
  systemPrompt: "你是一个有帮助的助手",
  tools: [readFileTool, writeFileTool],
  env: new NodeExecutionEnv({ cwd: process.cwd() }),
  session: await openOrCreateSession({ storage: new JsonlSessionStorage({ dir: "./sessions" }) }),
  hooks: new DefaultAgentHarnessHooks({}),  // 可选,内置默认实现
});

// 一次性启动
await harness.prompt("今天天气怎么样?");

// 流式接收事件
for await (const event of harness.subscribe()) {
  switch (event.type) {
    case "text_delta": console.log(event.delta);
    case "tool_call": console.log("调用工具:", event.name);
    case "message_end": console.log("消息结束");
  }
}

// 中途换模型(影响下一个 turn 快照)
harness.setModel(newModel);

// 中途加工具
harness.setTools([...harness.getTools(), newTool]);

// 中途加载 skill
await harness.skill("git-commit");

// 通过模板启动
await harness.promptFromTemplate("code-review", { prUrl });

// 中途插话(steer)
harness.steer("顺便加上单元测试");

// 排队 follow-up
harness.followUp("再加个 e2e 测试");

// 触发压缩
await harness.compact();

// 树形跳转(branch summary)
await harness.navigateTree({ targetId: someEntryId });

// 优雅终止
await harness.abort();
```

### 3.2 AgentHarnessOptions

```ts
export interface AgentHarnessOptions<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  /** 当前 LLM model */
  model: Model<any>;
  /** 工具集合 */
  tools: AgentTool<any>[];
  /** 可用资源(skills、prompt templates) */
  resources?: AgentHarnessResources<TSkill, TPromptTemplate>;
  /** 执行环境(必填,本项目只实现 NodeExecutionEnv) */
  env: ExecutionEnv;
  /** 已打开的 session,或空 session */
  session: Session;
  /** Thinking level */
  thinkingLevel?: ThinkingLevel;
  /** 静态 system prompt,或动态 system-prompt provider 回调 */
  systemPrompt?: string | ((ctx: SystemPromptContext) => string | Promise<string>);
  /** 流选项 */
  streamOptions?: AgentHarnessStreamOptions;
  /** 钩子实例(可选,默认 DefaultAgentHarnessHooks) */
  hooks?: AgentHarnessHooks<AgentHarnessEvent<TSkill, TPromptTemplate>, AgentHarnessHookContext>;
  /** 压缩设置(可选) */
  compaction?: CompactionSettings;
  /** 队列模式 */
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
}
```

### 3.3 核心类型

```ts
// 阶段机
export type AgentHarnessPhase =
  | "idle"      // 空闲,接受结构性操作
  | "turn"      // LLM turn 进行中
  | "compaction"// 压缩中
  | "branch_summary"  // 分支摘要中
  | "retry";    // 重试中(由 agent-loop 内部用)

// Turn 快照(单次 LLM turn 使用的具体状态)
export interface AgentHarnessTurnState {
  messages: AgentMessage[];      // 已持久化的会话消息
  systemPrompt: string;          // 已解析的 system prompt
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];       // 全部 tools
  activeTools: string[];         // 当前激活的 tool names
  streamOptions: AgentHarnessStreamOptions;
  sessionId: string;
}

// 队列模式
export type QueueMode = "all" | "one-at-a-time";

// 钩子 context
export interface AgentHarnessHookContext {
  harness: AgentHarness;  // 注意:实际是 facade,不是原始 harness(防止死锁)
  session: SessionFacade;
  models: ModelFacade;
}
```

### 3.4 钩子系统

**完整保留 pi 的 `DefaultAgentHarnessHooks`**。钩子通过事件 `emit()` 派发,每个事件可携带"幻影结果类型",handlers 可以返回该结果。

**钩子事件清单(20 个 = 8 核心 + 12 预声明)**:

> **8 核心事件**(agent-harness 实际 emit):`context`、`before_agent_start`、`tool_call`、`tool_result`、`message_end`、`session_before_compact`、`model_update`、`abort`
>
> **12 预声明事件**(types.ts 已声明,后续 Task 启用):`before_provider_request`、`before_provider_payload`、`after_provider_response`、`session_compact`、`session_before_tree`、`session_tree`、`thinking_level_update`、`resources_update`、`tools_update`、`queue_update`、`save_point`、`settled`

| 事件 | 分类 | 携带结果 | 用途 |
|------|------|----------|------|
| `context` | 核心 | `{ messages?: AgentMessage[] }` | 转换发送给 LLM 的消息链(可过滤/重排) |
| `before_agent_start` | 核心 | `{ messages?, systemPrompt? }` | 注入额外消息或修改 system prompt |
| `tool_call` | 核心 | `{ block?, reason? }` | 拦截工具调用(可阻止) |
| `tool_result` | 核心 | `{ content?, details?, isError?, terminate? }` | 修补工具结果 |
| `message_end` | 核心 | undefined | 消息结束时通知 |
| `session_before_compact` | 核心 | `{ cancel?, compaction? }` | 压缩前拦截(可取消或注入已有压缩) |
| `model_update` | 核心 | undefined | 模型变更通知 |
| `abort` | 核心 | undefined | 终止通知 |
| `before_provider_request` | 预声明 | `{ streamOptions? }` | 修补流选项(headers、metadata) |
| `before_provider_payload` | 预声明 | `{ payload }` | 修补 provider 请求体 |
| `after_provider_response` | 预声明 | undefined | provider 返回后只读观察 |
| `session_compact` | 预声明(Task 6 起可 emit) | undefined | 压缩完成后通知 |
| `session_before_tree` | 预声明(Task 6 起可 emit) | `{ cancel?, summary?, customInstructions?, replaceInstructions?, label? }` | 树形跳转前拦截 |
| `session_tree` | 预声明(Task 6 起可 emit) | undefined | 树形跳转完成后通知 |
| `thinking_level_update` / `resources_update` / `tools_update` | 预声明 | undefined | 配置变更通知 |
| `queue_update` | 预声明(Task 8 启用) | undefined | 队列变化通知 |
| `save_point` / `settled` | 预声明 | undefined | 保存点与结算通知 |

**钩子接口**:

```ts
export interface AgentHarnessHooks<E extends HookEvent<string, unknown>, Ctx> {
  context: Ctx;
  setContext(ctx: Ctx): void;
  observe(handler: HookObserver<E, Ctx>): () => void;     // 只读
  on<TType extends E["type"]>(
    type: TType,
    handler: HookHandler<Extract<E, { type: TType }>, Ctx>,
  ): () => void;                                           // 参与语义
  emit<TEvent extends E>(
    event: TEvent,
    signal?: AbortSignal,
  ): Promise<ResultOf<TEvent> | undefined>;
  addCleanup(cleanup: () => void | Promise<void>): () => void;
  clear(): Promise<void>;
  dispose(): Promise<void>;
}
```

### 3.5 事件协议

AgentHarness 发出 `AgentHarnessEvent`,它是 `AgentEvent`(底层 agent-loop 发出)与 `AgentHarnessOwnEvent`(harness 特有)的联合。

**AgentEvent**(来自 agent-loop.ts):
```
start → turn_start
     → text_start → text_delta* → text_end
     → thinking_start → thinking_delta* → thinking_end
     → toolcall_start → toolcall_delta* → toolcall_end
     → tool_execution_start → tool_execution_end
     → turn_end
     → done | error
```

**AgentHarnessOwnEvent**(harness 特有):
- 配置变更:`model_update`、`thinking_level_update`、`resources_update`、`tools_update`
- 队列:`queue_update`
- 钩子事件(见 3.4 表格)
- 保存点:`save_point`、`abort`、`settled`

---

## 4. 状态模型

Harness 状态分四类(从 pi 完整保留):

### 4.1 Harness 配置(运行时)
- `model`、`thinkingLevel`、`tools`、`activeToolNames`
- `resources`(skills + prompt templates)
- `streamOptions`
- `systemPrompt` 或 `systemPromptProvider`

getter 返回最新配置;setter 立即更新,影响**下一个 turn**,不影响当前 turn。

### 4.2 Turn 快照
每次结构性操作前用 `createTurnState()` 浅拷贝出快照,该 turn 内所有逻辑使用同一快照。

### 4.3 Session(已持久化)
- `Session.buildContextEntries()` 返回压缩感知的 entry 序列
- `Session.buildContext()` 投影为 `AgentMessage[]`(可选 `entryProjectors` 投影自定义条目)
- 自定义条目默认从模型上下文中省略

### 4.4 待写入队列
- 进行中 turn 的 session 写入排队为 `PendingSessionWrite`
- 基于 entry 形状,不含生成字段(`id`、`parentId`、`timestamp`)
- 在保存点、操作结算、失败清理时刷新

---

## 5. 关键流程

### 5.1 Turn 执行(对应 `prompt` / `skill` / `promptFromTemplate`)

```
1. 断言 phase === "idle"  → 同步设为 "turn"
2. createTurnState()      → 浅拷贝快照
3. 从快照派生调用文本     → 用户消息 / skill 调用文本 / template 调用文本
4. executeTurn()          → 内部:
   4.1 构造 AgentContext
   4.2 调 runAgentLoop(snapshot, config)
   4.3 监听 AgentEvent  →  同步刷新 session 写入(到 PendingSessionWrite)
5. 调 hooks.emit({ type: "save_point" })
6. 调 phase = "idle"
```

### 5.2 队列操作(对应 `steer` / `followUp` / `nextTurn`)

- `steer`:中途插入用户消息,中断当前 LLM 流并把消息作为下一轮开头
- `followUp`:排队一个用户消息,等当前 turn 自然结束再投递
- `nextTurn`:在下一轮用户消息之前插入(用于预置上下文)

队列模式(`all` / `one-at-a-time`)是活跃状态,运行时变更影响下一次排空。排空在 save_point 等安全点进行。

### 5.3 压缩流程

```
compact():
1. 断言 phase === "idle"  → 同步设为 "compaction"
2. 调 hooks.emit({ type: "session_before_compact" })
   - handler 可返回 { cancel: true } 取消压缩
   - handler 可返回 { compaction: { summary, firstKeptEntryId, ... } } 注入已有结果
3. prepareCompaction()  → 选保留边界,估算 token
4. model.stream(summarizationContext)  → 生成 summary
5. 写入 compaction entry 到 session
6. 调 hooks.emit({ type: "session_compact" })
7. phase = "idle"
```

### 5.4 树形跳转(对应 `navigateTree`)

```
navigateTree({ targetId }):
1. 断言 phase === "idle"  → 同步设为 "branch_summary"
2. 调 hooks.emit({ type: "session_before_tree" })
3. generateBranchSummary()  → 从 entryId 派生的上下文生成 summary
4. 写入 branch_summary entry
5. 调 hooks.emit({ type: "session_tree" })
6. phase = "idle"
```

---

## 6. 与 AI 层的契约

### 6.1 复用

| 来源 | 用途 |
|------|------|
| `@mimi/ai` 的 `Model`、`AssistantMessage`、`Context` | agent-loop 内部消息构造 |
| `@mimi/ai` 的 `stream()` / `complete()`(经 `models` 集合) | agent-loop 调 LLM |
| `@mimi/ai` 的 `isRetryableAssistantError` | agent-loop 重试判断 |
| `@mimi/ai` 的 TypeBox 工具定义 | `AgentTool` 的 `parameters` 字段 |
| `@mimi/ai` 的 `getApiKeyAndHeaders` 流程 | agent-loop 解析凭据(由 `models` 内部完成) |

### 6.2 重试责任划分

- **AI 层**:不重试(ai 层 spec 已明确)
- **Agent 层**:在 `runAgentLoop` 内部,对**可重试错误**(`isRetryableAssistantError` 为 true)进行重试
- **默认重试参数**:`maxRetries = 2`(从 pi 沿用),`maxRetryDelayMs = 60000`
- 暴露为 `AgentHarnessStreamOptions` 的字段(见 3.2)

### 6.3 内容数组顺序

`buildAssistantMessage` 的 content 数组顺序必须为 `text → thinking → tools`(AI 层 spec 已固化)。agent 层不做任何修改,直接信任 AI 层。

### 6.4 流式事件

`AssistantMessageEventStream` 的事件名(无 `type` 字段,用 discriminator)完整保留:
- `start`、`text_start`、`text_delta`、`text_end`
- `thinking_start`、`thinking_delta`、`thinking_end`
- `toolcall_start`、`toolcall_delta`、`toolcall_end`
- `done`、`error`

agent-loop 把这些事件再包装成 `AgentEvent`(带 `type` 字段 + 内容)。

---

## 7. Session 存储

### 7.1 双后端

| 后端 | 用途 | 持久化 | 性能 |
|------|------|--------|------|
| `InMemorySessionStorage` + `MemorySessionRepo` | 测试、临时场景、单元测试 | 否 | 快 |
| `JsonlSessionStorage` + `JsonlSessionRepo` | 生产场景、coding-agent | 是(JSONL 文件) | 中 |

### 7.2 Entry 类型

Session 是树形结构,每条 entry 是 `SessionTreeEntry` 的联合:

```ts
type SessionTreeEntry =
  | MessageEntry           // 用户/助手/工具消息
  | BranchSummaryEntry     // 分支摘要(由 navigateTree 产生)
  | CompactionEntry        // 压缩(由 compact 产生)
  | CustomEntry            // 自定义条目(由声明合并扩展)
  | LeafEntry;             // leaf 游标变更(每次 setLeafId 追加)
```

**关键约束**:`setLeafId` 不是仅内存的游标更新,必须追加 `LeafEntry`,重新打开存储时从最后一条 leaf 变更重建当前 leaf。

### 7.3 上下文构建

```ts
Session.buildContextEntries() → SessionTreeEntry[]
  // 压缩感知:返回未被 compaction 覆盖的 entry

Session.buildContext({ entryProjectors?, entryTransforms? }) → AgentMessage[]
  // 从 buildContextEntries 投影为消息
  // 自定义条目默认省略
  // entryProjectors 投影自定义条目
  // entryTransforms 在默认压缩变换后运行
```

---

## 8. 压缩与分支摘要

### 8.1 线性压缩(`compaction.ts`)

**输入**:整个 session 的 messages
**输出**:`{ summary: string, firstKeptEntryId: string, tokensBefore: number, details? }`
**触发**:**仅手动** `harness.compact()`

> **与 pi 一致**:pi 的 agent 层只暴露 `AgentHarness.compact()` 方法,虽然 `shouldCompact()` 函数与 `DEFAULT_COMPACTION_SETTINGS.enabled = true` 在 `compaction.ts` 已定义,但 **agent 包内**从不在 turn 之后自动调用(整个 `packages/agent/src/` 搜索 `shouldCompact` 调用 0 次)。
> `shouldCompact` 预留给上层(coding-agent)使用,本项目同样保留函数 + 常量导出,但不接触发器。

**关键算法**:
1. 估算当前 token 数(`estimateTokens` 函数,基于 `chars / 4` 启发式)
2. 选择保留边界:`firstKeptEntryId` = 保留最新 N 个 token 对应的 entry
3. 调 LLM 生成 summary
4. 写 `CompactionEntry`

### 8.2 分支摘要(`branch-summarization.ts`)

**输入**:`targetId`(目标 leaf)
**输出**:`{ summary: string, details? }`
**触发**:手动 `harness.navigateTree({ targetId })`

**关键算法**:
1. 收集从 root 到 targetId 的路径上"被丢弃"的 entry(`collectEntriesForBranchSummary`)
2. 调 LLM 生成 summary
3. 写 `BranchSummaryEntry`

### 8.3 文件操作追踪(`utils.ts`)

**目的**:压缩后的 summary 中保留"哪些文件被读/写"信息,模型上下文不至于完全失忆。

**实现**:
- `extractFileOpsFromMessage(message)` 从消息中提取 `readFiles` / `modifiedFiles`
- 累计到 session-level 的 `readFiles` / `modifiedFiles` 集合
- 压缩时一并写入 `CompactionEntry.details`

---

## 9. Skills 与 Prompt Templates

### 9.1 Skills

```ts
interface Skill {
  name: string;             // 稳定 ID
  description: string;      // 短描述,出现在 system prompt
  content: string;          // 完整指令
  filePath: string;         // 绝对路径,模型可见
  disableModelInvocation?: boolean;  // 排除出模型可见列表,但仍可应用显式调用
}
```

- 从 `SKILL.md` 文件加载(格式跟 pi 一致,遵循 agentskills.io 规范)
- 通过 `resources.skills` 注入
- `formatSkillsForSystemPrompt(skills)` 拼接为 XML block,塞入 system prompt

### 9.2 Prompt Templates

```ts
interface PromptTemplate {
  name: string;
  description?: string;
  content: string;          // 模板内容,占位符用 {{name}}
}
```

- 通过 `resources.promptTemplates` 注入
- `harness.promptFromTemplate(name, args)` 用 `formatPromptTemplateInvocation` 替换占位符,再走正常 turn 流程

---

## 10. 执行环境(仅 Node.js)

### 10.1 `NodeExecutionEnv`

```ts
export class NodeExecutionEnv implements ExecutionEnv {
  constructor(options?: { cwd?: string; env?: Record<string, string> }) {}
  
  // 文件操作
  readFile(path: string): Promise<Result<string, FileError>>;
  writeFile(path: string, content: string): Promise<Result<void, FileError>>;
  stat(path: string): Promise<Result<FileStat, FileError>>;
  readdir(path: string): Promise<Result<string[], FileError>>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<Result<void, FileError>>;
  
  // Shell 执行(带超时、输出截断)
  exec(command: string, options?: { cwd?: string; timeoutMs?: number; maxOutputBytes?: number }): Promise<Result<ShellOutput, ExecError>>;
}
```

**约定**:
- 失败用 `Result<T, FileError>` 返回,**不抛出**(由调用方决定如何处理)
- 错误类型稳定:`{ code: "not_found" | "permission_denied" | "is_directory" | ... }`,不依赖 Node.js 内部错误码
- 路径规范化:不接受 symlink 自动解析

### 10.2 不实现 BrowserExecutionEnv

本项目不实现 browser 适配。如果未来需要,加一个 `env/browser.ts` 即可。

---

## 11. 错误处理

| 层次 | 风格 | 例子 |
|------|------|------|
| 底层能力(`ExecutionEnv`、文件、shell) | `Result<T, TError>`(不抛出) | `readFile` 失败 |
| 助手函数(辅助工具) | `Result<T, TError>`(不抛出) | 资源加载、压缩辅助 |
| 编排层(`Session`、`AgentHarness`) | reject/throw(高层变更) | `harness.prompt` 失败 |
| 公共错误 | `AgentHarnessError`,code 归一化 | `busy`、`invalid_argument`、`hook`、`compaction`、`session` |

**`AgentHarnessError` codes**:
- `busy` — 结构性操作时 phase !== "idle"
- `invalid_argument` — 未知 tool / skill / template
- `invalid_state` — 不一致的状态(如 `nextTurn` 当 idle 时)
- `session` — session 错误
- `compaction` — 压缩错误
- `branch_summary` — 分支摘要错误
- `hook` — 钩子错误
- `unknown` — 兜底

子系统错误(如 `SessionError`、`CompactionError`)作为 `cause` 保留。

---

## 12. 文档输出

完成实现后,在 `docs/` 下生成以下文档(从 pi 翻译为中文):

| 文档 | 内容 |
|------|------|
| `docs/agent-harness.md` | AgentHarness 生命周期、状态模型、操作阶段、Turn 执行、保存点 |
| `docs/hooks.md` | 钩子系统设计、事件协议、变更语义、扩展加载 |
| `docs/session.md` | Session 类、Entry 树、Repo、上下文构建 |
| `docs/compaction.md` | 压缩 + 分支摘要的完整流程与算法 |
| `docs/skills-and-templates.md` | Skills 与 Prompt Templates 的使用与规范 |

---

## 13. 实施路线(摘要)

完整 plan 见 [2026-07-30-phase02-agent-plan.md](../plans/2026-07-30-phase02-agent-plan.md)。

> **当前进度(2026-07-31 Task 7 末尾)**:Task 1-7 已完成,Task 8-10 待办。`@mimi/agent` 共 71 个源文件(其中 8 个为子目录 `index.ts` 公共 API 入口,63 个为业务实现,~9400 行)+ 34 个测试文件(~6900 行)/ 450 测试通过 + 6 个 examples(01/03/04/05/06/07,共 ~1700 行)。最新 commit: `54b7707`(Task 7 skills + prompt templates)。

| Task | 内容 | 验证 |
|------|------|------|
| Task 1 | `agent-loop.ts` + `types.ts` 包骨架 | `types.test.ts` 跑通 |
| Task 2 | `agent-loop.ts` 核心循环 + `loop/` 子目录拆分 | `agent-loop.test.ts` 跑通,`examples/01-basic.ts` 跑通 |
| Task 3 | `harness/agent-harness/` 主体 + `messages/` + `system-prompt/` | `agent-harness.test.ts` 跑通,`examples/01-basic.ts` 完整跑通 |
| Task 4 | `harness/hooks/`(20 事件 + 5 语义)+ `hooks-bridge.ts` | `hooks/*.test.ts` 跑通,`examples/07-hooks.ts` 跑通 |
| Task 5 | `harness/session/` 双后端 + `harness/env/` + `harness/types/` | session 测试 + nodejs 测试 + `examples/03-session.ts` 跑通 |
| Task 6 | `harness/compaction/`(线性压缩 + 分支摘要)+ `compaction-ops.ts` | compaction 测试 + `examples/04-compaction.ts` 跑通 |
| Task 7 | `harness/skills/` + `harness/prompt-templates/` + `skill-ops.ts` | skills/templates 测试 + `examples/05-06.ts` 跑通 |
| Task 8 | 队列操作(`steer` / `followUp` / `nextTurn`)+ 自定义消息示例 | 队列测试 + `examples/08-custom-messages.ts` 跑通 |
| Task 9 | 5 篇中文文档(`agent-harness.md` / `hooks.md` / `session.md` / `compaction.md` / `skills-and-templates.md`) | 文档 review 通过 |
| Task 10 | 全量测试 + 全量 examples 跑通 + Phase 02 收尾 | 450+ tests pass,`tsc --noEmit` 0 错误 |

---

## 14. 风险与待办

| 风险 | 应对 |
|------|------|
| `agent-loop.ts` 792 行复杂度高 | 严格按 TDD,先写最简 case(纯对话无工具),再写工具 case,再写错误/重试 case |
| Session JSONL 持久化需要并发安全 | 沿用 pi 的 append-only 模式 + 启动时重放 leaf entries,不在写入时加锁 |
| 钩子重入可能导致死锁 | handler 不应 await `harness.waitForIdle()`;harness facade 设计替代方案(未来工作) |
| 声明合并需要 TypeScript 5+ 配合 | 已在 tsconfig 中开启 `"declaration": true` 与 `"composite": true` |
| 压缩 token 估算不准 | 用 `Model.contextWindow - reserveTokens` 作粗估,允许用户通过 `compaction.reserveTokens` 调整 |
| `CustomAgentMessages` 的事件流处理 | 转换函数 `convertToLlm` 与 `buildAssistantMessage` 必须显式处理每个自定义类型,无 default fallthrough |

---

## 15. 实施偏差附录(2026-08-01 Phase 02 收尾)

> 本节是 Phase 02 实施完成后,与原始 spec / plan 的偏差记录。供后续 Phase 参考,不影响已交付功能。

### 15.1 规模与文件数偏差

| 维度 | spec/plan 预估 | 实际 | 偏差 |
|------|----------------|------|------|
| 源文件数 | 71(Task 7 末尾) | 73(最终) | +2(Task 8 加 queue.ts + queue-bridge) |
| 测试用例 | 450 | 499 | +49(Queue 19 + prompt 增量 20 + config 增量 8 + 调优) |
| examples | 6 | 7 | +1(`08-custom-messages.ts`) |
| 文档 | 5 篇 | 5 篇 | 0 |
| Commit | 8 | 9 | +1(Task 8 单独 commit) |

### 15.2 Hook 事件数偏差

- spec 早期版本写 17 个核心 + 3 预声明 = 20 个
- 实际 8 核心 + 12 预声明 = 20 个(2026-07-31 doc 同步 commit `956507b`)
- 12 预声明中,只有 `queue_update` 实际启用(在 Task 8 期间)
- 其余 9 个(`session_compact` / `session_tree` / `thinking_level_update` / `resources_update` / `tools_update` / `save_point` / `settled` / `before_provider_request` / `before_provider_payload` / `after_provider_response`)类型已声明,默认走 fire-and-forget 但不主动 emit

### 15.3 AgentHarness 拆行偏差

- spec 早期 soft limit 500 行(从工程原则沿用)
- Task 3-7 期间 `agent-harness.ts` 在 479-495 行之间
- Task 8 增量后,`agent-harness.ts` 实测 682 行(超 500 软限 182 行)
- 已在文件头加 explicit justification(私有字段封装 + 主类作为业务入口,继续拆会破坏 `#` 字段封装)
- 未来再加功能需进一步拆分(候选:`queue.ts` 中部分方法提取到 `queue-bridge.ts` / `subscription-factory.ts` 合并到主类)

### 15.4 Session Entry 类型扩展

- spec 原始列 5 种:`MessageEntry` / `BranchSummaryEntry` / `CompactionEntry` / `CustomEntry` / `LeafEntry`
- 实际 11 种(2026-07-31 spec 同步 commit `24fa020`):增加 `ThinkingLevelChangeEntry` / `ModelChangeEntry` / `ActiveToolsChangeEntry` / `CustomMessageEntry` / `LabelEntry` / `SessionInfoEntry`
- 这 6 个新类型用于支持 `setModel` / `setThinkingLevel` / `setResources` / label 检索 等运行时操作,所有变更都走 append-only

### 15.5 文档输出偏差

- spec 第 12 节定 5 篇英文文档
- 实际 5 篇中文文档(用户偏好,沟通语言为中文)
- 5 篇结构统一(概述 / 关键概念 / API 速查 / 流程图 / 已知限制)
- 文件路径引用全部用 `file:///` 协议绝对路径(便于跨平台跳转)
- 流程图用 ASCII 纯文本(避免 mermaid 渲染依赖)

### 15.6 Skill / Template 数量偏差

- spec 第 9 节只提"通过 resources 注入"
- 实际额外规范:`loadSkillFromFile` 走 `ExecutionEnv.readFile`(不直读 fs,保证可移植)
- Skill 名称唯一性由调用方保证,代码不检查
- 占位符统一 `{{name}}`,未提供的占位符保留原样不抛错(避免破坏 markdown)

### 15.7 队列实现偏差

- spec 早期提到"5 种 QueueMode"(隐含 nextTurn 也有 mode)
- 实际 `nextTurn` 不需要 QueueMode(只是 prompt 入口 prepend,语义与 steer/followUp 不同)
- `QueueOpDeps` 接口依赖注入,保持 `#` 字段封装(plan 已规定)

### 15.8 验证范围偏差

- spec 第 13 节定:450+ tests pass,`tsc --noEmit` 0 错误
- 实际最终验证:499 tests pass,`tsc --noEmit` 0 错误,`pnpm build` 0 warning,7 个 examples 全部 exit=0
- 测试覆盖率:核心模块都有对应测试文件,平均每个源文件 5-8 个测试用例

### 15.9 后续 Phase 需要注意的遗留问题

1. `agent-harness.ts` 682 行,接近 700 行硬性心理上限;下次大改动前需拆分
2. 9 个预声明 hook 事件未启用,需按需启用
3. `resources_update` / `tools_update` / `thinking_level_update` 钩子未主动 emit
4. JSONL 后端假设单进程写入,多进程并发会行交错
5. `extractFileOpsFromMessage` 是启发式,不支持自定义工具 schema
6. 压缩 token 估算不精确(`chars / 4` 启发式)
7. CustomEntry 不会自动投影到 context(必须提供 `entryProjectors`)

---

**Phase 02 完成 ✅**(2026-08-01)
