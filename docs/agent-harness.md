# AgentHarness 主类

> 本文档基于 `@mimi/agent` 包的实际代码整理,目标读者是 AgentHarness 的使用者(开发者)。
> 详细设计 spec 见 [2026-07-30-phase02-agent-design.md](./superpowers/specs/2026-07-30-phase02-agent-design.md);
> 实施计划见 [2026-07-30-phase02-agent-plan.md](./superpowers/plans/2026-07-30-phase02-agent-plan.md);
> 源代码入口: [agent-harness.ts](file:///f:/allProject/githubProject/my-mimipi/packages/agent/src/harness/agent-harness/agent-harness.ts)。

## 概述

`AgentHarness` 是 `@mimi/agent` 包的主类,提供面向开发者的"agent 运行时门面":它把上游 `@mimi/ai` 的流式 LLM 协议、底层的 session 持久化、面向扩展的钩子系统、以及队列化的用户消息流整合在一个对象里,让调用方能用 `prompt(text)` 一行代码启动一个完整的 LLM 多轮对话循环。本类采用"主类 + 拆分文件"组织:状态、生命周期、订阅、配置 getter/setter、业务入口(`prompt` / `compact` / `navigateTree` / `skill` / `promptFromTemplate` / `steer` / `followUp` / `nextTurn`)全部在主类,具体执行细节(turn 编排、钩子桥接、压缩、队列协作)拆到 9 个子文件,主类只做编排、委托与封装。

核心定位:AgentHarness **不是** LLM 客户端,也不是单纯的会话存储;它是"调用者与 LLM + session + hooks + queues 之间的中介层",负责把这些子系统按确定的生命周期(状态机)串起来。

## 关键概念

### 1. 运行时角色

| 维度 | 职责 |
|------|------|
| 配置持有 | 持有构造时的不可变项(`env` / `session` / `streamFn`)和运行时可变项(`model` / `tools` / `thinkingLevel` / `resources` / `streamOptions` / `systemPrompt`),通过 `getXxx` / `setXxx` 暴露 |
| 状态机 | 维护 `AgentHarnessPhase`(`idle` / `turn` / `compaction` / `branch_summary`),通过 `assertPhase` 静态校验转换合法性 |
| 事件总线 | 内部 `EventBus`,`subscribe()` 返回 `AsyncIterable<Subscription>`,用于实时消费 `AgentHarnessEvent` 联合 |
| 钩子系统 | 持有 `DefaultAgentHarnessHooks` 实例,在 prompt / abort / setModel / executeTurn / queue 操作等关键点 emit 8 个核心事件 |
| 业务入口 | `prompt` / `compact` / `navigateTree` / `skill` / `promptFromTemplate` / `steer` / `followUp` / `nextTurn` |
| 资源管理 | `dispose()` 同步清空订阅、钩子、三个队列(steer / followUp / nextTurn) |

### 2. 私有字段(运行时状态)

| 字段 | 类型 | 说明 |
|------|------|------|
| `#options` | `AgentHarnessOptions` | 构造时传入,运行时不变(env / session / streamFn) |
| `#runtime` | 内嵌对象 | 6 个可变配置字段,setter 写入此处,影响"下一个 turn 快照" |
| `#phase` | `AgentHarnessPhase` | 状态机当前值,默认 `"idle"` |
| `#eventBus` | `EventBus` | 内部事件总线,`subscribe()` 委托给它 |
| `#hooks` | `DefaultAgentHarnessHooks` | 钩子系统实例(可注入) |
| `#currentAbortController` | `AbortController \| null` | 当前 turn 的 abort 句柄,turn 结束清空 |
| `#disposed` | `boolean` | 防重复清理 |
| `#steerQueue` | `readonly AgentMessage[]` | steer 队列(高优先级,中断当前 LLM) |
| `#followUpQueue` | `readonly AgentMessage[]` | follow-up 队列(低优先级,turn 结束投递) |
| `#nextTurnQueue` | `readonly AgentMessage[]` | nextTurn 队列(下次 prompt 入口 prepend) |
| `#steeringMode` | `QueueMode` | steer 排空模式,默认 `"all"` |
| `#followUpMode` | `QueueMode` | follow-up 排空模式,默认 `"all"` |

### 3. 阶段状态机

`AgentHarnessPhase` 共有 4 个值:`"idle"` / `"turn"` / `"compaction"` / `"branch_summary"`。状态转移规则:

| 当前 phase | 允许转入 | 触发方法 |
|------------|----------|----------|
| `idle` | `turn` / `compaction` / `branch_summary` | `prompt` / `compact` / `navigateTree` |
| `turn` | `idle` | turn 结束(成功 / 错误 / abort) |
| `compaction` | `idle` | 压缩完成 |
| `branch_summary` | `idle` | 分支摘要完成 |

非 `idle` 阶段调 `prompt()` 会抛 `AgentHarnessError("busy")`。

## API 速查

### 构造

```typescript
new AgentHarness(options: AgentHarnessOptions)
```

`AgentHarnessOptions` 必填字段:`model` / `env` / `session` / `systemPrompt` / `streamFn`。可选:`tools` / `thinkingLevel` / `resources` / `streamOptions` / `hooks` / `steeringMode` / `followUpMode`。

### 订阅 / 中止

```typescript
subscribe(): Subscription                        // AsyncIterable<AgentHarnessEvent>
abort(): void                                   // 中断当前 turn(若有)
dispose(): Promise<void>                        // 清空所有资源
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
prompt(text: string, options?: AgentHarnessStreamOptions): Promise<AgentMessage[]>
compact(): Promise<string | undefined>          // 返回新 session leaf id(若有)
navigateTree(options: { targetId: string }): Promise<void>
skill(name: string, args?: Record<string, string>): Promise<void>
promptFromTemplate(name: string, args: Record<string, string>): Promise<void>
```

### 队列操作

```typescript
steer(text: string, options?: { images?: ImageArray }): void
followUp(text: string, options?: { images?: ImageArray }): void
nextTurn(text: string, options?: { images?: ImageArray }): void

getSteeringMode(): QueueMode                    // "all" | "one-at-a-time"
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
getResources() / setResources(resources: AgentHarnessResources | undefined): void
getStreamOptions() / setStreamOptions(opts: AgentHarnessStreamOptions | undefined): void
getSystemPrompt() / setSystemPrompt(prompt: string | DynamicPromptProvider): void
getSession(): Session<any> | undefined
getEnv(): ExecutionEnv
getStreamFn(): StreamFn
```

> `setModel` 末尾会 emit `model_update` 钩子事件;`setThinkingLevel` / `setResources` 暂不 emit(预留接口)。

### 私有方法(对外不可见)

```typescript
#validateOptions(options): void                 // 构造时校验必填字段
#assertNotDisposed(): void                      // 业务方法入口检查
#buildHookContext(): AgentHarnessHookContext    // 构造钩子 context
#loadSessionMessages(session): Promise<AgentMessage[]>
#buildQueueOpDeps(): QueueOpDeps                // 给 queue.ts 注入依赖,保持 # 字段封装
#emit(event): Promise<void>                     // 事件总线派发
```

## 流程图

### `prompt()` 主流程

```
harness.prompt("你好")
  │
  ▼
[1] assertNotDisposed()
  │
  ▼
[2] assertPhase("idle")            ← 非 idle 抛 AgentHarnessError("busy")
  │
  ▼
[3] #phase = "turn"
  │
  ▼
[4] _setCurrentAbortController(new AbortController())
  │
  ▼
[5] emit("before_agent_start")     ← hook 可改 messages / systemPrompt
  │
  ▼
[6] executeTurn()  ─────────────────────────────────┐
  │   ├─ buildContext (从 session 加载 + 处理 nextTurnQueue prepend)
  │   ├─ emit("context")                              │ turn-execution.ts
  │   ├─ runAgentLoop(prompts, ctx, config)           │
  │   │     ├─ 外层 while: 处理 steer/follow-up 续命 │
  │   │     │   ├─ 内层 while: tool call 循环         │
  │   │     │   └─ drainSteerQueue / drainFollowUpQueue│
  │   │   └─ emit("message_end") per message          │
  │   └─ return messages                              │
  │                                                  ◀┘
  ▼
[7] #currentAbortController = null
  │
  ▼
[8] #phase = "idle"                ← 异常路径也走 finally
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
[2] #phase = "compaction"
  │
  ▼
[3] emit("session_before_compact") ← 钩子可 cancel / 注入已有结果
  │
  ▼
[4] runCompactOp()
  │   ├─ prepareCompaction(选保留边界,基于 keepRecentTokens)
  │   ├─ estimateTokens + extractFileOpsFromMessage
  │   ├─ generateBranchSummary(LLM 生成 summary)
  │   ├─ session.appendEntry(CompactionEntry)
  │   └─ session.setLeafId(newId)
  │
  ▼
[5] emit("session_compact")
  │
  ▼
[6] #phase = "idle"
  │
  ▼
return newLeafId | undefined
```

### `steer()` / `followUp()` / `nextTurn()` 时序

```
harness.steer("补充提示")                harness.prompt("...")
  │                                          │
  ▼                                          ▼
入队 #steerQueue + emit("queue_update")     runAgentLoop 内层 while:
  │                                          │   每轮调 drainSteerQueue
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
6. **9 个预声明事件未启用**:`before_provider_request` / `before_provider_payload` / `after_provider_response` / `thinking_level_update` / `resources_update` / `tools_update` / `save_point` / `settled` / `queue_update` 中,只有 `queue_update` 已 emit,其余类型已声明但需后续按需启用。
7. **拆分行数预警**:主类 `agent-harness.ts` 实测 682 行,超过 500 软限 182 行(文件头已加 explicit justification),未来再加功能需进一步拆分。
