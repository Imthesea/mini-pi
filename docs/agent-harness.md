# AgentHarness 主类

> 本文档基于 `@mimi/agent` 包的实际代码整理,目标读者是 AgentHarness 的使用者(开发者)。
> 详细设计 spec 见 [2026-07-30-phase02-agent-design.md](./superpowers/specs/2026-07-30-phase02-agent-design.md);
> 实施计划见 [2026-07-30-phase02-agent-plan.md](./superpowers/plans/2026-07-30-phase02-agent-plan.md);
> 源代码入口: [agent-harness.ts](file:///f:/allProject/githubProject/my-mimipi/packages/agent/src/harness/agent-harness/agent-harness.ts)。

## 概述

`AgentHarness` 是 `@mimi/agent` 包的主类,提供面向开发者的"agent 运行时门面":它把上游 `@mimi/ai` 的流式 LLM 协议、底层的 session 持久化、面向扩展的钩子系统、以及队列化的用户消息流整合在一个对象里,让调用方能用 `prompt(text)` 一行代码启动一个完整的 LLM 多轮对话循环。本类为单文件主类,状态、订阅、配置 getter/setter、业务入口(`prompt` / `compact` / `navigateTree` / `skill` / `promptFromTemplate` / `steer` / `followUp` / `nextTurn`)全部在主类内。

核心定位:AgentHarness **不是** LLM 客户端,也不是单纯的会话存储;它是"调用者与 LLM + session + hooks + queues 之间的中介层",负责把这些子系统按确定的生命周期(状态机)串起来。

## 关键概念

### 1. 运行时角色

| 维度 | 职责 |
|------|------|
| 配置持有 | 持有构造时的不可变项(`env` / `session` / `streamFn`)和运行时可变项(`model` / `tools` / `thinkingLevel` / `resources` / `streamOptions` / `systemPrompt`),通过 `getXxx` / `setXxx` 暴露 |
| 状态机 | 维护 `AgentHarnessPhase`(`idle` / `turn` / `compaction` / `branch_summary`),通过 `assertPhase` 静态校验转换合法性 |
| 事件订阅 | 内部 `handlers` Map,`subscribe()` / `on()` 注册监听,`emit()` 派发 `AgentHarnessEvent` |
| 钩子系统 | 持有 `DefaultAgentHarnessHooks` 实例,在 prompt / abort / setModel / tool call / queue 操作等关键点 emit 钩子事件 |
| 业务入口 | `prompt` / `compact` / `navigateTree` / `skill` / `promptFromTemplate` / `steer` / `followUp` / `nextTurn` |

### 2. 私有字段(运行时状态)

| 字段 | 类型 | 说明 |
|------|------|------|
| `options` | `AgentHarnessOptions` | 构造时传入,运行时不变(env / session / streamFn) |
| `session` | `Session` | 会话持久化实例 |
| `model` | `Model<any>` | 当前 LLM 模型,setter 可换 |
| `thinkingLevel` | `ThinkingLevel \| undefined` | 思考级别 |
| `systemPrompt` | 字符串或动态提供者 | 系统提示词,setter 可换 |
| `streamOptions` | `AgentHarnessStreamOptions \| undefined` | 流式选项 |
| `resources` | `AgentHarnessResources \| undefined` | 可注入资源(skills / promptTemplates 等) |
| `tools` | `Map<string, TTool>` | 工具表,setter 整体替换 |
| `phase` | `AgentHarnessPhase` | 状态机当前值,默认 `"idle"` |
| `handlers` | `Map<string, Set<Handler>>` | 事件订阅表 |
| `hooks` | `DefaultAgentHarnessHooks` | 钩子系统实例(可注入) |
| `currentAbortController` | `AbortController \| null` | 当前 turn 的 abort 句柄,turn 结束清空 |
| `steerQueue` | `AgentMessage[]` | steer 队列(高优先级,中断当前 LLM) |
| `followUpQueue` | `AgentMessage[]` | follow-up 队列(低优先级,turn 结束投递) |
| `nextTurnQueue` | `AgentMessage[]` | nextTurn 队列(下次 prompt 入口 prepend) |
| `steeringMode` | `QueueMode` | steer 排空模式,默认 `"one-at-a-time"` |
| `followUpMode` | `QueueMode` | follow-up 排空模式,默认 `"one-at-a-time"` |

### 3. 阶段状态机

`AgentHarnessPhase` 共有 4 个值:`"idle"` / `"turn"` / `"compaction"` / `"branch_summary"`。状态转移规则:

| 当前 phase | 允许转入 | 触发方法 |
|------------|----------|----------|
| `idle` | `turn` / `compaction` / `branch_summary` | `prompt` / `compact` / `navigateTree` |
| `turn` | `idle` | turn 结束(成功 / 错误 / abort) |
| `compaction` | `idle` | 压缩完成 |
| `branch_summary` | `idle` | 分支摘要完成 |

非 `idle` 阶段调 `prompt()` / `compact()` / `navigateTree()` 会抛 `AgentHarnessError("busy")`(由 `assertPhase` 校验)。

## API 速查

### 构造

```typescript
new AgentHarness(options: AgentHarnessOptions)
```

`AgentHarnessOptions` 必填字段:`model` / `env` / `session` / `systemPrompt` / `streamFn`。可选:`tools` / `thinkingLevel` / `resources` / `streamOptions` / `hooks` / `steeringMode` / `followUpMode`。

### 订阅 / 中止

```typescript
subscribe(listener: AgentHarnessListener): () => void   // 订阅所有事件,返回退订函数
on(type: string, handler: AgentHarnessHandler): () => void  // 按类型订阅
abort(): void                                   // 中断当前 turn(若有)
```

### 阶段查询

```typescript
getPhase(): AgentHarnessPhase                   // "idle" | "turn" | "compaction" | "branch_summary"
```

### 钩子

```typescript
getHooks(): DefaultAgentHarnessHooks            // 拿到钩子系统实例,用于 observe / on / emit
```

### 业务入口

```typescript
prompt(text: string, options?: { images?: Array<{ data: string; mimeType: string }> }): Promise<AgentMessage[]>
compact(): Promise<string | undefined>          // 返回压缩摘要(若钩子未 cancel)
navigateTree(options: { targetId: string | null }): Promise<string | undefined>  // 返回新的 branch entry id
skill(name: string, args?: Record<string, string>): Promise<AgentMessage[]>
promptFromTemplate(name: string, args: Record<string, string>): Promise<AgentMessage[]>
```

### 队列操作

```typescript
steer(text: string, images?: ImageArray): void
followUp(text: string, images?: ImageArray): void
nextTurn(text: string, images?: ImageArray): void

getSteeringMode(): QueueMode                    // "one-at-a-time" | "all"
setSteeringMode(mode: QueueMode): void
getFollowUpMode(): QueueMode
setFollowUpMode(mode: QueueMode): void
```

`steer` 在 LLM 流进行中插入,优先级最高;`followUp` 等当前 turn 自然结束后投递;`nextTurn` 在下次 `prompt()` 入口 prepend。`QueueMode = "all"` 时一次性全部出队,`"one-at-a-time"` 时每次只出第一条,其余保留。

### 配置 getter / setter(共 14 个)

```typescript
getModel() / setModel(model: Model<any>): void
getTools() / setTools(tools: AgentTool<any>[]): void
getThinkingLevel() / setThinkingLevel(level: ThinkingLevel | undefined): void
getSession(): Session
getResources() / setResources(resources: AgentHarnessResources | undefined): void
getStreamOptions() / setStreamOptions(opts: AgentHarnessStreamOptions | undefined): void
getSystemPrompt() / setSystemPrompt(prompt: string | DynamicPromptProvider): void
getHooks(): DefaultAgentHarnessHooks
```

> `setModel` 末尾会 emit `model_update` 钩子事件;`setSession` 为预留 API(pi 没有,运行时不允许切换)。

### 私有方法(对外不可见)

```typescript
validateOptions(options): void                  // 构造时校验必填字段
buildHookContext(): AgentHarnessHookContext     // 构造钩子 context
loadSessionMessages(): Promise<AgentMessage[]>  // 从 session 加载历史消息
syncHookContext(): void                         // 刷新 hooks 的 context
emitHook<T>(event): Promise<T | undefined>      // 派发钩子事件(走 hooks 语义路由)
emit(event): Promise<void>                      // 派发 AgentEvent 给订阅者(遍历 "*" handlers)
bridgeBeforeToolCall() / bridgeAfterToolCall()  // 把 agent-loop 的 tool call 桥接到 hooks
buildUserContent(text, images)                  // 构造 user 消息 content(纯文本或 text+images 数组)
tryAppendSession(message): void                 // fire-and-forget 写 session,失败只 log
drainQueue(queue, mode): Promise<AgentMessage[]>  // 队列排空统一逻辑(all / one-at-a-time);消费后 emit queue_update,失败回滚(对齐 pi)
```

> 另提供 3 个测试用内部方法(下划线前缀,均返回 Promise):`_drainSteerQueue()` / `_drainFollowUpQueue()` / `_drainNextTurnQueue()`。

## 流程图

### `prompt()` 主流程

```
harness.prompt("你好")
  │
  ▼
[1] assertPhase("idle")            ← 非 idle 抛 AgentHarnessError("busy")
  │
  ▼
[2] this.phase = "turn"
  │
  ▼
[3] emit("before_agent_start")     ← hook 可返回 { messages?, systemPrompt? }
  │                                   事件携带本轮入参(prompt / images / 已拼好的 systemPrompt / resources);
  │                                   messages 追加到用户消息之后,返回 systemPrompt 则整体覆盖(含 skills 块)
  │
  ▼
[4] drain nextTurn 队列(全部消费)
  │
  ▼
[5] 构造 user message + system prompt(await session.getMetadata 拿真实 sessionId)
  │
  ▼
[6] emit("context")                ← hook 可改 messages
  │
  ▼
[7] syncHookContext + tryAppendSession(userMessage)
  │
  ▼
[8] runAgentLoop(initialMessages, ctx, config, 转发事件)
  │     ├─ getSteeringMessages: drain steer 队列(按 steeringMode)
  │     ├─ getFollowUpMessages: drain followUp 队列(按 followUpMode)
  │     ├─ beforeToolCall / afterToolCall: 桥接 hooks 的 tool_call / tool_result
  │     └─ message_end: tryAppendSession + emit("message_end") + emit(event)
  │
  ▼
[9] finally: this.phase = "idle"       ← 异常路径也走 finally
  │
  ▼
return messages
```

### `compact()` 主流程

```
harness.compact()
  │
  ▼
[1] assertPhase("idle")
  │
  ▼
[2] this.phase = "compaction"
  │
  ▼
[3] emit("session_before_compact") ← 钩子可 cancel / 注入已有结果
  │
  ▼
[4] runCompact(session, model, streamFn)
  │     ├─ 若钩子注入 compaction 则直接复用
  │     └─ 否则生成摘要 + session.appendCompaction
  │
  ▼
[5] emit("session_compact")
  │
  ▼
[6] finally: this.phase = "idle"
  │
  ▼
return summary | undefined
```

### `steer()` / `followUp()` / `nextTurn()` 时序

```
harness.steer("补充提示")                harness.prompt("...")
  │                                          │
  ▼                                          ▼
入队 this.steerQueue + emit("queue_update")     runAgentLoop 内层 while:
  │                                          │   每轮 drainSteerQueue(消费后也 emit queue_update)
  ▼                                          │   ← steer 消息被 agent-loop 看到
LLM 流中断(下次循环)                         │   重复直到 steer 队列空
                                             │
                                             ▼
                                          drainFollowUpQueue(外层 while)
                                             │   续命直到 followUp 队列空
                                             ▼
                                          turn 自然结束
```

## 已知限制

1. **单进程串行**:`AgentHarness` 不是线程安全的;同一实例不应在多进程或多线程间共享。
2. **不支持并发 turn**:`prompt()` 在 `turn` / `compaction` / `branch_summary` 阶段会被 `assertPhase` 拒绝。需要并发请开多个 `AgentHarness` 实例。
3. **session 失败不阻塞 turn**:`session.appendMessage` 失败只 `console.error`,不抛;调用方需要自行监控持久化。
4. **`.d.ts` 声明合并独立**:扩展 `CustomAgentMessages` 必须放在独立 `.d.ts` 文件,避免污染 `tsconfig.test.json` 编译(测试已 exclude examples)。
5. **钩子 ctx 的 `models` facade 在 prompt 入口为空对象**:依赖外部注册 facade 才能拿到 model 信息(预留扩展点)。
6. **队列操作无阶段校验**:`steer` / `followUp` / `nextTurn` 任何时候都能入队;消费时机由 agent-loop 的排空逻辑决定。
