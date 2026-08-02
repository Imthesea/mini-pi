# 钩子系统(Hooks)

> 本文档基于 `@mimi/agent` 包的钩子系统实际代码整理。
> 详细设计 spec 见 [2026-07-30-phase02-agent-design.md](./superpowers/specs/2026-07-30-phase02-agent-design.md);
> 源代码入口: [hooks/index.ts](file:///f:/allProject/githubProject/my-mimipi/packages/agent/src/harness/hooks/index.ts)。

## 概述

`@mimi/agent` 的钩子系统是"面向扩展的核心":AgentHarness 在 20 个关键点 emit 事件,允许用户注册 handler 拦截 / 修改 / 取消系统行为。钩子系统设计上有三个核心概念:**事件(Event)** + **语义(Semantics)** + **上下文(Context)**。事件用 `HookEvent<TType, TResult>` 泛型定义,语义定义 handler 的"组合规则"(顺序转换 / 累积 / 遇 block 退出 / 遇 cancel 退出 / fire-and-forget),上下文为 handler 提供 session / models 等只读门面。默认实现是 `DefaultAgentHarnessHooks`,通过 `harness.getHooks()` 拿到实例,调用 `observe` 旁观 / `on` 参与语义 / `emit` 派发事件。

本系统采用"8 个核心 + 12 个预声明"两阶段实施策略:核心事件全部启用,预声明事件类型已定义但默认不 emit,留作未来扩展的接缝。

## 关键概念

### 1. 事件清单(20 个)

| 事件类型 | 启用状态 | 幻影结果 (`TResult`) | 语义 | 触发点 |
|----------|----------|----------------------|------|--------|
| `context` | ✅ 核心 | `{ messages?: AgentMessage[] }` | 链式转换 | `executeTurn` 调 `runAgentLoop` 前 |
| `before_agent_start` | ✅ 核心 | `{ messages?, systemPrompt? }` | 链式转换(2 字段) | `prompt()` 入口,事件携带 `prompt` / `images` / `systemPrompt` / `resources` |
| `tool_call` | ✅ 核心 | `{ block?: boolean, reason?: string }` | 遇 `block` 退出 | `AgentLoopConfig.beforeToolCall` |
| `tool_result` | ✅ 核心 | `{ content?, details?, isError?, terminate? }` | 累积补丁 | `AgentLoopConfig.afterToolCall` |
| `message_end` | ✅ 核心 | `void` | fire-and-forget | `runAgentLoop` emit sink |
| `session_before_compact` | ✅ 核心 | `{ cancel?: boolean, compaction?: CompactionResult }` | 遇 `cancel` 退出 | `compact()` 入口 |
| `model_update` | ✅ 核心 | `void` | fire-and-forget | `setModel()` 末尾 |
| `abort` | ✅ 核心 | `void` | fire-and-forget | `abort()` 末尾 |
| `before_provider_request` | 🔜 预声明 | `{ streamOptions? }` | fire-and-forget | 未来 LLM 调用前 |
| `before_provider_payload` | 🔜 预声明 | `{ payload }` | fire-and-forget | 未来 payload 组装后 |
| `after_provider_response` | 🔜 预声明 | `void` | fire-and-forget | 未来 LLM 响应后 |
| `session_compact` | 🔜 预声明 | `void` | fire-and-forget | 未来 `compact()` 完成 |
| `session_before_tree` | 🔜 预声明 | `{ cancel?: boolean }` | 遇 `cancel` 退出 | 未来 `navigateTree()` 入口 |
| `session_tree` | 🔜 预声明 | `void` | fire-and-forget | 未来 `navigateTree()` 完成 |
| `thinking_level_update` | 🔜 预声明 | `void` | fire-and-forget | 未来 `setThinkingLevel` |
| `resources_update` | 🔜 预声明 | `void` | fire-and-forget | 未来 `setResources` |
| `tools_update` | 🔜 预声明 | `void` | fire-and-forget | 未来 `setTools` |
| `queue_update` | ✅ 已启用 | `void` | fire-and-forget | 入队(`steer`/`followUp`/`nextTurn` 末尾)与消费(队列 drain 时) |
| `save_point` | 🔜 预声明 | `void` | fire-and-forget | 未来保存点 |
| `settled` | 🔜 预声明 | `void` | fire-and-forget | 未来 turn 结算 |

> 8 核心 + 12 预声明 = 20 个;`queue_update` 虽然放在预声明中,实际已启用(Task 8 增量)。

### 2. 5 种变更语义

| 语义函数 | 应用事件 | 行为 |
|----------|----------|------|
| `runContextSemantics` | `context` | 顺序链式转换,每个 handler 可改 `messages`,下一个 handler 看到上一个的输出 |
| `runBeforeAgentStartSemantics` | `before_agent_start` | 顺序链式转换,可同时改 `messages` 和 `systemPrompt`;事件携带本轮入参(`prompt` / `images` / `systemPrompt` / `resources`),handler 可读到已拼好的 systemPrompt 再决定是否覆盖 |
| `runToolCallSemantics` | `tool_call` | 顺序执行,遇 `{ block: true }` 提前退出,合并 `reason` |
| `runToolResultSemantics` | `tool_result` | 顺序累积补丁,每个 handler 增量覆盖 `content` / `details` / `isError` / `terminate` |
| `runSessionBeforeSemantics` | `session_before_compact` / `session_before_tree` | 顺序执行,遇 `{ cancel: true }` 提前退出,或注入 `compaction` 跳过 LLM |
| `runFireAndForgetSemantics` | 其他 14 个 | 并行调用,忽略返回值 |

### 3. Handler vs Observer

| 角色 | 注册方式 | 用途 | 参与语义? |
|------|----------|------|-----------|
| **Handler** | `hooks.on(type, handler)` | 拦截 / 修改 / 取消系统行为 | ✅ |
| **Observer** | `hooks.observe(observer)` | 只读观察,记录 / debug / 监控 | ❌(返回值被忽略) |

Handler 数量不限(链式调用);Observer 数量不限(并行触发)。

### 4. 上下文对象

```typescript
interface AgentHarnessHookContext {
  harness: AgentHarness;                       // 当前 harness 实例
  session?: SessionFacade;                      // 会话门面(只读)
  models?: ModelFacade;                         // 模型门面
  loadSessionMessages(session): Promise<AgentMessage[]>;  // 加载历史消息
}
```

`SessionFacade` 暴露 `getId()` / `getMessages()`;`ModelFacade` 暴露 `getCurrent()`。`harness` 提供完整实例(handler 可调 `getPhase` / `abort` / 任何公开方法)。

### 5. 清理与生命周期

- `addCleanup(fn)`:注册 turn 结束后的清理函数(失败不抛,记 log)
- `clear()`:移除所有 handlers / observers,执行所有 cleanups,保留 context
- `dispose()`:同 `clear()`,但额外把 `context` 置为 undefined,不可再 emit

## API 速查

### 公共类型

```typescript
interface HookEvent<TType extends string, TResult = void> {
  type: TType;
  result?: TResult;                             // 幻影字段,handler 可返回新值
}

type HookHandler<E, Ctx> = (event: E, ctx: Ctx) => MaybePromise<Partial<E["result"]> | void | undefined>;
type HookObserver<E> = (event: E) => void;
type ResultOf<E> = E extends HookEvent<string, infer R> ? R : never;
```

### 钩子系统公共 API

```typescript
interface AgentHarnessHooks<E, Ctx> {
  readonly context: Ctx;
  setContext(ctx: Ctx): void;
  observe(handler: HookObserver<E>): () => void;            // 返回 unsubscribe
  on<T extends E["type"]>(type: T, handler: HookHandler<Extract<E, { type: T }>, Ctx>): () => void;
  emit<TEvent extends E>(event: TEvent, signal?: AbortSignal): Promise<ResultOf<TEvent> | undefined>;
  addCleanup(cleanup: () => void | Promise<void>): () => void;
  clear(): Promise<void>;
  dispose(): Promise<void>;
}
```

### 默认实现

```typescript
class DefaultAgentHarnessHooks implements AgentHarnessHooks<AgentHarnessHookEvent, AgentHarnessHookContext> {
  constructor(options?: { context?: AgentHarnessHookContext });
  // 实现上述全部方法
}
```

### 5 个语义纯函数

```typescript
function runContextSemantics(event, ctx, handlers): Promise<ContextHookEvent["result"] | undefined>;
function runBeforeAgentStartSemantics(event, ctx, handlers): Promise<BeforeAgentStartHookEvent["result"] | undefined>;
function runToolCallSemantics(event, ctx, handlers): Promise<ToolCallHookEvent["result"] | undefined>;
function runToolResultSemantics(event, ctx, handlers): Promise<ToolResultHookEvent["result"] | undefined>;
function runSessionBeforeSemantics(event, ctx, handlers): Promise<{ cancel?: boolean; compaction?: CompactionResult } | undefined>;
function runFireAndForgetSemantics(event, ctx, handlers): Promise<void>;
```

> 语义函数全部在 [semantics.ts](file:///f:/allProject/githubProject/my-mimipi/packages/agent/src/harness/hooks/semantics.ts) 中,可独立单测。

## 流程图

### `emit()` 内部派发流程

```
hooks.emit(event, signal?)
  │
  ▼
[1] 校验未 dispose(context 存在)
  │
  ▼
[2] 先派发给 observers(并行,fire-and-forget)
  │   observers 不参与语义,只记录
  │
  ▼
[3] 按 event.type 路由到对应语义函数:
  │
  ├─ "context"              → runContextSemantics
  ├─ "before_agent_start"   → runBeforeAgentStartSemantics
  ├─ "tool_call"            → runToolCallSemantics
  ├─ "tool_result"          → runToolResultSemantics
  ├─ "session_before_*"     → runSessionBeforeSemantics
  └─ 其他                   → runFireAndForgetSemantics
  │
  ▼
[4] 语义函数按规则调用 handlers,合并结果
  │
  ▼
[5] 返回最终 ResultOf<E> | undefined
```

### `tool_call` 遇 `block` 退出语义

```
emit("tool_call", { toolCall, abortSignal })
  │
  ▼
handlers[0]: 返回 { block: true, reason: "危险操作" }   ← 立即合并
  │
  ▼
[提前退出,不再调 handlers[1..n]]
  │
  ▼
返回 { block: true, reason: "危险操作" }
  │
  ▼
hooks-bridge.ts 收到 result → 转成 error toolResult
  │
  ▼
LLM 看到 toolResult.isError=true + content 含 "危险操作"
```

### `tool_result` 累积补丁语义

```
emit("tool_result", { toolResult, details, isError })
  │
  ▼
handlers[0]: 返回 { content: [{ type: "text", text: "patched-1" }] }
  │   ← 累积:base.content 替换为 handlers[0].content
  │
  ▼
handlers[1]: 返回 { isError: false, details: { x: 1 } }
  │   ← 累积:isError 改为 false,details 合并
  │
  ▼
handlers[2]: 返回 undefined
  │   ← 不修改,累积值继续传递
  │
  ▼
返回 { content: [...], isError: false, details: { x: 1 } }
```

## 已知限制

1. **预声明事件未启用**:`before_provider_request` / `session_compact` / `session_before_tree` / `session_tree` / `thinking_level_update` / `resources_update` / `tools_update` / `save_point` / `settled` 等 9 个事件类型已定义,默认走 `runFireAndForgetSemantics` 但不主动 emit,需手动调 `hooks.emit({ type: "..." })` 才会触发。
2. **Observer 无清理机制**:`observe(handler)` 返回的 unsubscribe 只能移除自己;若 handler 内部注册资源,需自行管理。
3. **Handler 异常被吞**:handler 抛错时,语义函数会 `console.error` 然后继续(不会中断链),错误不会重抛给 emit 调用方。
4. **没有异步取消信号**:`emit` 接受 `AbortSignal`,但语义函数内部的 await 不会主动检查 signal,需要 handler 自行处理。
5. **清理时不清 session**:`clear()` / `dispose()` 只清理 hooks 自己的 handlers / observers / cleanups,不会触碰 `session` 或 `harness` 内部状态。
6. **Context 的 `models` facade 默认空对象**:`DefaultAgentHarnessHooks` 构造时 context 中的 `models` 为 undefined,需要外部代码(如 `setContext`)注入。
7. **钩子不是 actor 模型**:所有 handler 都在调用 `emit` 的线程上执行,没有独立的事件循环;CPU 密集型 handler 会阻塞 LLM 流。
