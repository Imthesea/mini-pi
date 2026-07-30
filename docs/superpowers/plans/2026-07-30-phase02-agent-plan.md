# Agent 层核心实现计划

> **对于 agentic workers:** 使用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 来逐任务实施此计划。步骤使用 `- [ ]` 复选框跟踪。

> **本文档配套文档**:
> - 设计 Spec:[2026-07-30-phase02-agent-design.md](../specs/2026-07-30-phase02-agent-design.md)
> - **工程原则**:**[2026-07-30-phase02-engineering-principles.md](../specs/2026-07-30-phase02-engineering-principles.md)——每个 Task 落地前必读**
> - 上游 AI Spec:[2026-07-29-phase01-ai-core-design.md](../specs/2026-07-29-phase01-ai-core-design.md)
> - 下游 CLI Spec:[2026-07-30-phase02.5-coding-agent-design.md](../specs/2026-07-30-phase02.5-coding-agent-design.md)

**目标:** 从零搭建 `@mimi/agent` 包——完整可用的 Agent 运行时,提供 `AgentHarness` 主类、Session 双后端、压缩、钩子、Skills、Prompt templates 等核心能力。**全盘保留 pi 的 harness 设施,4500 行目标,完整优先于精简**。

**架构:** 在 `packages/ai` 之上,提供会话化、可扩展、可持久化的 Agent 运行时。核心抽象:`AgentHarness` → `createTurnState()` → `executeTurn()` → 同步 session 写入。钩子系统是面向扩展的核心。

**技术栈:** TypeScript 5.9+ / Node.js 22+ / pnpm / vitest / tsx / TypeBox 1.1.38(沿用 pi 版本)

## 全局约束

- TypeScript 5.9+,`erasableSyntaxOnly`,ES2022 target,Node16 模块
- **所有注释、文档使用中文**。每个类、每个方法至少要有中文注释说明用途
- **中文优先**:命名可用英文,但注释、README、错误消息全部中文
- vitest 用于单元测试,`examples/*.ts` 用于 mock provider 集成验证(不依赖真实 API key)
- 每个 Task 完成后必须:vitest 通过 + 对应 example 可用 `npx tsx` 跑通
- 严格 TDD:测试先写,跑挂(RED),然后写实现,跑绿(GREEN),再写下一个
- **mock provider 统一在 `packages/agent/src/__mocks__/mock-provider.ts` 实现**(Task 1 准备,后续 example 复用)
- 与 AI 层契约:`runAgentLoop` 内部重试,基于 `isRetryableAssistantError`;`buildAssistantMessage` 的 content 顺序 text → thinking → tools(由 AI 层保证)
- 完整保留 `CustomAgentMessages` 声明合并接口,不引入轻量 `Agent` 类

## 工程约束(软性,500 行软上限,超出需用户确认)

> 详细原则见 [工程原则文档](../specs/2026-07-30-phase02-engineering-principles.md)。**每个 Task 落地前必读**。

- **单文件行数软上限 ≤ 500 行**(用 `wc -l` 检查,含空行和注释)
- **可以超过 500 行**:为合理性可以超过,但必须走工程原则 § 2.2 的确认流程
- **拆分优先于合并**:能用"职责"切分就拆,能用"调用方向"切分就拆
- **避免"为拆而拆"**:对称 / 整齐 / 模板相似不构成拆分理由(见工程原则 § 1.3 反例)
- **类型就近**:内层类型放内层文件,不堆 `types.ts`
- **公共 API 入口薄**:只导出符号 + 编排
- **每写完一个文件立即 `wc -l` 检查**:
  - < 400 行:OK,继续
  - 400-500 行:警觉,评估是否还有合理拆分
  - > 500 行:**停下,走工程原则 § 2.2 确认流程**
- **本原则不豁免翻译任务**:即使是从 pi 翻译,也要按上述规则评估,不能以"翻译自 pi"为由拒绝拆分

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

**目标**: 实现 LLM → tool → repeat 的核心循环,这是 agent 层的"心脏"。**从 pi 完整保留功能,但物理拆分**——按工程原则 1.3 拆分判据执行,单文件 ≤ 500 软上限(超过需用户确认)。

> **本 Task 工程约束**(详细见 [工程原则 § 4.1](../specs/2026-07-30-phase02-engineering-principles.md)):
> - 单文件 ≤ 500 行(软上限,超过需用户确认)
> - 公共 API 入口(`agent-loop.ts`)≤ 300 行,只放编排
> - 内部实现拆到 `loop/` 子目录

**目录结构**(本 Task 产出):
```
packages/agent/src/
├── agent-loop.ts                          # 公共 API + runLoop 编排 (~200 行)
├── loop/
│   ├── stream-assistant.ts                # 流式响应 + 重试包装 (~180 行)
│   ├── tool-execution.ts                  # 工具执行入口(sequential/parallel 路由) (~120 行)
│   ├── tool-execution/
│   │   ├── sequential.ts                  # 串行执行 (~100 行)
│   │   ├── parallel.ts                    # 并行执行 (~150 行)
│   │   ├── prepare.ts                     # prepareToolCall(参数校验 + beforeToolCall 钩子) (~120 行)
│   │   ├── execute.ts                     # executePreparedToolCall(onUpdate 派发) (~90 行)
│   │   ├── finalize.ts                    # finalizeExecutedToolCall(afterToolCall 钩子) (~90 行)
│   │   ├── truncate.ts                    # failToolCallsFromTruncatedMessage (~60 行)
│   │   └── types.ts                       # 内部类型(PreparedToolCall / FinalizedToolCallOutcome 等) (~80 行)
│   ├── tool-validation.ts                 # TypeBox 参数校验 (~50 行)
│   └── helpers.ts                         # sleep / createErrorToolResult / createToolResultMessage / emit* (~100 行)

packages/agent/__tests__/
├── agent-loop.test.ts                     # 12+ cases,按 describe 块拆分 (~400 行)

packages/agent/examples/
└── 01-basic.ts                            # 用 mock provider 跑通 (~150 行)
```

**最大单文件**:180 行 ✓

**关键 API**:
- `agentLoop(prompts, context, config, signal?, streamFn?): EventStream<AgentEvent, AgentMessage[]>`:EventStream 风格入口
- `agentLoopContinue(context, config, signal?, streamFn?): EventStream<AgentEvent, AgentMessage[]>`:续接
- `runAgentLoop(prompts, context, config, emit?, signal?, streamFn?): Promise<AgentMessage[]>`:Promise 风格
- `runAgentLoopContinue(context, config, emit?, signal?, streamFn?): Promise<AgentMessage[]>`:Promise 续接
- `AgentEventSink = (event: AgentEvent) => Promise<void> | void`

**循环结构**(`agent-loop.ts` 中的 `runLoop` 状态机):
```
1. 构造 AgentContext(messages、tools、systemPrompt)
2. emit "agent_start" + "turn_start"
3. 循环:
   3.1 streamFn(model, context, options) → AssistantMessageStream
   3.2 监听流事件:
       - text/thinking/toolcall → 转 AgentEvent 转发
       - "done" 拿到 AssistantMessage
   3.3 if 包含 toolCalls:
       - emit tool_execution_start
       - 并行/串行执行 tool.execute(根据 config.toolExecution)
       - emit tool_execution_end
       - 把 toolResult push 到 messages
       - 继续循环
   3.4 else: turn 自然结束
4. emit "turn_end" + "agent_end"
5. 返回 messages
```

**重试逻辑**(在 `loop/stream-assistant.ts` 中):
- 捕获 stream 错误
- if `isRetryableAssistantError(err)` && `attempt < maxRetries`:
  - 等待 `min(maxRetryDelayMs, 1000 * 2^attempt)`
  - attempt++ 并重试
- else: 抛错或返回 error message

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
- ✅ beforeToolCall block 钩子
- ✅ afterToolCall 钩子增量覆盖
- ✅ parallel toolExecution 模式
- ✅ runAgentLoop / runAgentLoopContinue 直接 API

**example**(`01-basic.ts`):
- 用 mock provider(memory)创建 stream
- 启动 `runAgentLoop`,打印每个事件
- 验证: 至少看到 `agent_start` + `turn_start` + `message_start/end` + `agent_end`

**验证**:
```bash
cd packages/agent && pnpm test agent-loop
npx tsx examples/01-basic.ts
# 预期:看到流式输出,正常结束
```

- [ ] Step 1: 写 `__tests__/agent-loop.test.ts` 全部 case,跑挂
- [ ] Step 2: 写 `src/loop/tool-execution/types.ts`(内部类型先定义,后续依赖)
- [ ] Step 3: 写 `src/loop/helpers.ts` + `src/loop/tool-validation.ts`(纯函数,无依赖)
- [ ] Step 4: 写 `src/loop/tool-execution/{prepare,execute,finalize,truncate}.ts`(工具执行流水线)
- [ ] Step 5: 写 `src/loop/tool-execution/{sequential,parallel}.ts`(调度模式)
- [ ] Step 6: 写 `src/loop/tool-execution.ts`(路由入口)
- [ ] Step 7: 写 `src/loop/stream-assistant.ts`(流式响应 + 重试)
- [ ] Step 8: 写 `src/agent-loop.ts`(公共 API + runLoop 编排,只做编排不重复实现)
- [ ] Step 9: 跑测试变绿
- [ ] Step 10: 写 `examples/01-basic.ts` 跑通
- [ ] Step 11: `wc -l` 检查所有新文件,如有 > 500 行走工程原则 § 2.2 确认流程
- [ ] Step 12: 暂停,展示 git diff 给用户审查
- [ ] Step 13: 提交 commit `feat(agent): core agent loop`

---

## Task 3: AgentHarness 主类(skeleton + messages + system-prompt)

**目标**: 实现 `AgentHarness` 主类的骨架,集成 agent-loop、消息转换、system prompt 拼接。**本步只做骨架**,不接 session、不接 hooks。

> **本 Task 工程约束**(详细见 [工程原则 § 4.2](../specs/2026-07-30-phase02-engineering-principles.md)):
> - 单文件 ≤ 500 行(软上限,超过需用户确认)
> - `agent-harness.ts` ≤ 280 行(后续 Task 4/5/6/7/8 增量,接近 500 行要拆出子模块)

**目录结构**(本 Task 产出):
```
packages/agent/src/
├── harness/
│   ├── agent-harness/                     # AgentHarness 主类 + 拆分文件
│   │   ├── agent-harness.ts               # 主类:构造 + phase + 订阅 + abort + getter/setter + prompt (~320 行)
│   │   ├── event-bus.ts                   # EventBus 类 + Subscription 接口(优先级 1:独立类) (~64 行)
│   │   └── helpers.ts                     # buildUserContent + extractSessionId(优先级 2:纯函数) (~29 行)
│   ├── phase.ts                           # AgentHarnessPhase 状态机 + phase 转换规则 (~100 行)
│   ├── messages/
│   │   ├── convert.ts                     # convertToLlm 主入口 + custom 过滤 (~150 行)
│   │   ├── assistant.ts                   # buildAssistantMessage + content 顺序 (~120 行)
│   │   └── custom.ts                      # bashExecution / branchSummary 等自定义消息投影 (~150 行)
│   ├── system-prompt/
│   │   ├── build.ts                       # buildSystemPrompt 主入口(~150 行)
│   │   ├── parts.ts                       # 各部分拼装 (~180 行)
│   │   └── index.ts                       # 公共导出
│   ├── types/
│   │   ├── harness.ts                     # Skill / PromptTemplate / HookEvent (~150 行)
│   │   ├── events.ts                      # AgentHarnessEvent 联合 (~150 行)
│   │   └── options.ts                     # AgentHarnessOptions / 构造选项 (~120 行)
│   └── index.ts                           # 公共 API 重新聚合(从 agent-harness/ 重新导出 AgentHarness 类)

packages/agent/__tests__/harness/
├── agent-harness/
│   ├── agent-harness.test.ts              # 核心类 + 生命周期 (~250 行)
│   ├── config.test.ts                     # getter + setter 一起测 (~200 行)
│   └── prompt.test.ts                     # prompt() 业务入口 (~200 行)
├── messages/
│   ├── convert.test.ts                    # convertToLlm (~200 行)
│   ├── assistant.test.ts                  # buildAssistantMessage (~150 行)
│   └── custom.test.ts                     # 自定义消息 (~150 行)
└── system-prompt/
    ├── build.test.ts                      # buildSystemPrompt 入口 (~200 行)
    └── parts.test.ts                      # 各部分拼装 (~150 行)
```

**最大单文件**:~320 行 ✓(agent-harness.ts)
**拆分方式**:按"独立类型/独立概念"拆分(文件拆分方法论 §优先级 1 & 2),不按"类的方法"拆分

**关键 API**(`AgentHarness` 类,单文件):
- `agent-harness.ts` 包含全部方法:构造、字段、事件订阅(`subscribe`)、`getPhase()`、`abort()`、getter/setter(`getModel` / `setModel` 等共 14 个)、`prompt(text, options?)` 主流程
- 私有方法用 `#` 修饰符(`#executeTurn` / `#emit` / `#validateOptions` / `#assertNotDisposed`),内部测试方法用 `_` 前缀(`_setPhase` / `_isDisposed` / `_setCurrentAbortController`)

**为什么从 3 文件合并回 1 文件**(2026-07-30 Task 3 重构决策):

原计划把 `AgentHarness` 拆为 `agent-harness.ts` + `config.ts` + `prompt.ts` 三个文件,用 `Object.assign(prototype, {...})` + `declare module` 注入方法。实施后发现:
1. **可读性差**:`Object.assign(Class.prototype, {...})` 不直观,99% 的 TS 开发者期望在 class body 里看到方法
2. **类型绕弯**:需要 `declare module` 补类型、`this: AgentHarness` 显式标注、`as unknown as` 双重断言
3. **IDE 体验差**:跳转可能失灵,栈追踪更绕
4. **文件名歧义**:`prompt.ts` 看不出是"AgentHarness 的 prompt 方法",容易误解为"提示词模板"或"prompt 输入处理"

合并后单文件 394 行(< 500 软上限),后续 Task 4-8 增量预计:
- Task 4(hooks emit 点):+20 = ~414 行
- Task 5(session 接入):+20 = ~434 行
- Task 6(compact wrapper):+15 = ~449 行
- Task 7(skill/promptFromTemplate):+40 = ~489 行
- Task 8(steer/followUp/nextTurn):+50 = ~539 行 ⚠️ **可能超 500**

**超 500 时的应对**:届时再按工程原则 § 2.2 评估拆分,但拆分方式改为"按功能模块抽函数到辅助文件"(如 `prompt-helpers.ts`),而不是"按方法切文件 + prototype 注入"。

**测试用例**:
- `agent-harness/agent-harness.test.ts`:
  - ✅ 构造 harness 不报错
  - ✅ 事件订阅(`subscribe()`)能拿到事件
  - ✅ `getPhase()` 返回正确 phase
  - ✅ `abort()` 在 turn 中能中断
  - ✅ 异常路径后 phase 回到 idle
- `agent-harness/config.test.ts`:
  - ✅ `getModel()` / `getTools()` / `getThinkingLevel()` / `getSession()` 返回构造时的值
  - ✅ `setModel` / `setTools` / `setThinkingLevel` / `setResources` 立即生效
  - ✅ setter 触发相应钩子
- `agent-harness/prompt.test.ts`:
  - ✅ `prompt()` 在 idle 时正常工作,phase 正确转换
  - ✅ `prompt()` 在非 idle 时抛 `AgentHarnessError("busy")`
- `messages/convert.test.ts`:
  - ✅ `convertToLlm` 默认过滤 custom
  - ✅ `convertToLlm` 处理 bashExecution(转 user 消息)
  - ✅ `convertToLlm` 处理 branchSummary(转 user 消息)
- `messages/assistant.test.ts`:
  - ✅ `buildAssistantMessage` 输出顺序 text → thinking → tools
- `system-prompt/build.test.ts`:
  - ✅ 静态字符串拼接
  - ✅ dynamic provider 回调每次 turn 调用一次
- `system-prompt/parts.test.ts`:
  - ✅ skills XML block 格式正确
  - ✅ 各部分按顺序拼接

**验证**:
```bash
cd packages/agent && pnpm test harness
```

- [ ] Step 1: 写 `harness/types/{harness,events,options}.test.ts` + 跑挂(RED)→ 写 `harness/types/{harness,events,options}.ts` → 跑绿
- [ ] Step 2: 写 `harness/messages/{convert,assistant,custom}.test.ts` + 跑挂 → 写 `harness/messages/{convert,assistant,custom}.ts` → 跑绿
- [ ] Step 3: 写 `harness/system-prompt/{build,parts}.test.ts` + 跑挂 → 写 `harness/system-prompt/{build,parts}.ts` → 跑绿
- [ ] Step 4: 写 `harness/phase.test.ts` + 跑挂 → 写 `harness/phase.ts` → 跑绿
- [ ] Step 5: 写 `agent-harness/agent-harness.test.ts` + 跑挂 -> 写 agent-harness.ts + event-bus.ts + helpers.ts(标准 class + 独立拆分) -> 跑绿
- [ ] Step 6: 写 `harness/agent-harness/config.test.ts` + `harness/agent-harness/prompt.test.ts` + 跑挂 -> 跑绿(测试独立,实现已在 Step 5)
- [ ] Step 7: (已合并到 Step 5,不再单独拆 prompt.ts)
- [ ] Step 8: 更新 `examples/01-basic.ts` 用 harness 启动(替换直接调 agent-loop)
- [ ] Step 9: `wc -l` 检查所有新文件,如有 > 500 行走工程原则 § 2.2 确认流程
- [ ] Step 10: 暂停,展示 git diff 给用户审查
- [ ] Step 11: 提交 commit `feat(agent): harness skeleton + messages + system-prompt`

**Task 3 已知遗留(Tech Debt)**:

> ✅ **2026-07-30 Task 3.5 清理完成**:下表 12 个错误已全部修复(`tsc -p tsconfig.test.json` 现在 0 错误,`pnpm test` 整体 exit 0)。详细修复见 git diff,关键点:
> - `StreamFn` 改从 `@mimi/agent` 的 `types.js` 导入(因为 `@mimi/ai` 不导出 `StreamFn`)
> - `makeEchoTool` 的 `params: { text: string }` 改成 `params: any`(与 `AgentTool` 契约对齐)
> - `messages[2].toolCallId` / `toolName` 走 `role === "toolResult"` 显式 narrow
> - `r.content[0].text` 走 `if (first.type === "text")` 显式 narrow(`?.` 三元在 union 类型上不收窄)
> - `vi.fn` mock 返回值用 `as const` 保留字面量(否则 `type: "text"` 拓宽成 `string`)

**历史记录(2026-07-30 Task 3 收尾时登记,后已清理)**:

`tsc -p tsconfig.test.json` 当时有 **12 个 pre-existing 错误**,**全部位于测试文件**,由 Task 1/2 引入。Task 3 本身新增源码 `tsc` 已清零,`vitest` 127/127 通过,`examples/01-basic.ts` 跑通。

| # | 文件:行 | 错误 | 引入 Task | 修复方式 |
|---|---------|------|-----------|----------|
| 1 | `__tests__/_helpers/mock-provider.ts:29` | `Module '"@mimi/ai"' has no exported member 'StreamFn'` | Task 1 | 改从 `@mimi/agent` 的 `types.js` 导入 ✅ |
| 2 | `__tests__/agent-loop.test.ts:69` | `AgentTool<any, any>` execute 参数不兼容 | Task 2 | `makeEchoTool` params 改 `any` ✅ |
| 3 | `__tests__/agent-loop.test.ts:82` | `messages[2].toolCallId` —— `AgentMessage` 联合无该字段 | Task 2 | 显式 narrow `role === "toolResult"` ✅ |
| 4 | `__tests__/agent-loop.test.ts:83` | `messages[2].toolName` —— 同上 | Task 2 | 同上 ✅ |
| 5 | `__tests__/agent-loop.test.ts:103` | 同 #2 | Task 2 | 同 #2 ✅ |
| 6 | `__tests__/agent-loop.test.ts:245` | 同 #2 | Task 2 | 同 #2 ✅ |
| 7 | `__tests__/agent-loop.test.ts:277` | 同 #2 | Task 2 | 同 #2 ✅ |
| 8 | `__tests__/agent-loop.test.ts:314` | 同 #2 | Task 2 | 同 #2 ✅ |
| 9 | `__tests__/agent-loop.test.ts:353` | 同 #2 | Task 2 | 同 #2 ✅ |
| 10 | `__tests__/types.test.ts:217` | `r.content[0].text` —— `TextContent \| ImageContent` 无 `text` | Task 1 | 显式 `if (first.type === "text")` ✅ |
| 11 | `__tests__/types.test.ts:261` | `'r.content' is possibly 'undefined'` | Task 1 | 用 `r.content?.[0]` optional chain ✅ |
| 12 | `__tests__/types.test.ts:261` | `r.content[0].text` 同 #10 | Task 1 | 同 #10 ✅ |

---

## 全局已知遗留(Global Tech Debt)

> 在 Phase 02 任意 Task 期间遇到、但不属于该 Task 范围、且暂未修复的问题集中记录在此。

### TD-001(2026-07-30,Task 3.5 清理时关闭)~~Task 3 收尾时登记~~

**症状(原)**:`pnpm test` 中 `tsc -p tsconfig.test.json` 步骤报 12 个 pre-existing 错误(vitest 全部通过)

**解决(2026-07-30 Task 3.5)**:

| 修复 | 文件 | 方式 |
|------|------|------|
| ✅ | `__tests__/_helpers/mock-provider.ts` | `StreamFn` 改从 `@mimi/agent` 的 `types.js` 导入;`makeEchoTool` 的 `execute` 第二参改 `any` |
| ✅ | `__tests__/agent-loop.test.ts:69-353` | 8 处 `AgentTool` 不匹配由 `makeEchoTool` 修复统一解决;`toolCallId` / `toolName` 走 `role === "toolResult"` 显式 narrow |
| ✅ | `__tests__/types.test.ts:217,261` | `r.content[0].text` 走 `if (first.type === "text")` 显式 narrow;`r.content?.[0]` optional chain;`vi.fn` mock 用 `as const` 保留字面量 |

**验证**:`pnpm test` → vitest 127/127 + tsc 0 错误 + example 跑通 ✅

**状态**:✅ 已解决,2026-07-30 Task 3.5 关闭。

---

## Task 4: 钩子系统(hooks + emit + handlers)

**目标**: 实现 `DefaultAgentHarnessHooks`,这是与未来扩展系统对接的核心。**先实现 8 个核心事件 + 变更语义 + observers/handlers 分离**,其余 9 个事件留接口(预声明 + 占位),未来按需启用。

> **本 Task 工程约束**(详细见 [工程原则 § 4.3](../specs/2026-07-30-phase02-engineering-principles.md)):
> - 单文件 ≤ 500 行(软上限,超过需用户确认)
> - 8 个核心事件类型放 `hooks/types.ts`(≤ 250 行)
> - 5 种语义**不按事件拆 5 个文件**,统一放 `hooks/semantics.ts`(避免"为对称而拆")

**目录结构**(本 Task 产出):
```
packages/agent/src/
├── harness/
│   ├── hooks/
│   │   ├── types.ts                       # 8 个核心事件 + 9 个预声明事件 + HookEvent 泛型 (~250 行)
│   │   ├── semantics.ts                   # 5 种语义的纯函数(顺序转换 / 累积补丁 / block / cancel / fire-forget)(~200 行)
│   │   ├── default-hooks-state.ts         # 内部状态:handlers / observers / cleanups 三个 Map 的封装 (~120 行)
│   │   ├── default-hooks.ts               # DefaultAgentHarnessHooks 主类:构造 + observe + on + emit + addCleanup + clear + dispose (~300 行)
│   │   └── index.ts
│   └── agent-harness.ts                   # 增量:在 phase 转换 / turn 执行 / tool 调用等点 emit 8 个核心事件

packages/agent/__tests__/harness/
├── hooks/
│   ├── default-hooks.test.ts              # 核心类行为:注册 / 移除 / clear / dispose / cleanup / emit (~350 行)
│   ├── semantics.test.ts                  # 5 种语义的纯函数行为 (~300 行)
│   └── types.test.ts                      # 8 个核心 + 9 个预声明事件类型校验 (~150 行)
```

**最大单文件**:~300 行(可接受,主类方法紧密耦合)

**拆分理由**(避免冗余):
- `default-hooks.ts` 300 行 = 主类公共 API(observe / on / emit / addCleanup / clear / dispose) + 内部 state 协作 —— **dispatch 和 cleanup 与主类公共 API 紧密耦合(observe/on 调 dispatch,clear/dispose 调 cleanup),不分离**
- `default-hooks-state.ts` 120 行 = 内部数据结构,封装三个 Map 的增删改查,**纯粹的状态管理,可独立单测**
- `semantics.ts` 200 行 = 5 种语义的纯函数,统一在一个文件 —— **5 个文件每个 80-100 行本质是同模板,合并后便于读者对比共性**
- `types.ts` 250 行 = 8 个核心事件 + 9 个预声明事件(只声明类型,不实现 emit 路由)

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

**事件清单**(8 个核心 + 9 个预声明,分两批实施):

| 事件 | 状态 | 幻影结果 |
|------|------|----------|
| `context` | ✅ **核心** | `{ messages?: AgentMessage[] }` |
| `before_agent_start` | ✅ **核心** | `{ messages?, systemPrompt? }` |
| `tool_call` | ✅ **核心** | `{ block?, reason? }` |
| `tool_result` | ✅ **核心** | `{ content?, details?, isError?, terminate? }` |
| `message_end` | ✅ **核心** | undefined |
| `session_before_compact` | ✅ **核心** | `{ cancel?, compaction? }` |
| `model_update` | ✅ **核心** | undefined |
| `abort` | ✅ **核心** | undefined |
| `before_provider_request` | 🔜 预声明 | `{ streamOptions? }` |
| `before_provider_payload` | 🔜 预声明 | `{ payload }` |
| `after_provider_response` | 🔜 预声明 | undefined |
| `session_compact` / `session_before_tree` / `session_tree` | 🔜 预声明 | 各自定义 |
| `thinking_level_update` / `resources_update` / `tools_update` / `queue_update` / `save_point` / `settled` | 🔜 预声明 | undefined |

> **预声明事件** = 类型已定义 + 默认实现 emit 走 `runFireAndForgetSemantics`,handler 可注册但当前不调用具体语义;启用时只需在 `emit` 路由里加 case。

**变更语义**(`semantics.ts` 中 5 个纯函数):
- `runContextSemantics` (context 事件): 顺序转换,每个 handler 可改 `messages`,链式传递
- `runToolCallSemantics` (tool_call 事件): 顺序执行,遇 `block: true` 提前退出
- `runToolResultSemantics` (tool_result 事件): 顺序累积补丁
- `runSessionBeforeSemantics` (session_before_* 事件): 顺序执行,遇 `cancel: true` 提前退出
- `runFireAndForgetSemantics` (其他事件): 并行调用,忽略返回值

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

- [ ] Step 1: 写 `hooks/{default-hooks,semantics,types}.test.ts` 全部 case,跑挂(RED)
- [ ] Step 2: 写 `hooks/types.ts` `HookEvent` 泛型 + 8 个核心事件 + 9 个预声明事件
- [ ] Step 3: 写 `hooks/semantics.ts` 5 个语义纯函数
- [ ] Step 4: 写 `hooks/default-hooks-state.ts` 三个 Map 封装
- [ ] Step 5: 写 `hooks/default-hooks.ts` 主类(observe / on / emit / addCleanup / clear / dispose),把 dispatch / cleanup 逻辑合并到主类
- [ ] Step 6: 跑测试变绿(GREEN)
- [ ] Step 7: 把 hooks 接入 `agent-harness.ts`(在 phase 转换、turn 执行、tool 调用等关键点 emit 8 个核心事件)
- [ ] Step 8: 写 `examples/07-hooks.ts` 跑通
- [ ] Step 9: `wc -l` 检查所有新文件,如有 > 500 行走工程原则 § 2.2 确认流程
- [ ] Step 10: 暂停,展示 git diff 给用户审查
- [ ] Step 11: 提交 commit `feat(agent): hooks system (8 core events + 9 pre-declared)`

---

## Task 5: Session 双后端(session + repos)

**目标**: 实现 Session 类(树形 entry 管理、上下文构建)+ InMemory / JSONL 双后端。**完整保留 pi**。

> **本 Task 工程约束**(详细见 [工程原则 § 4.4](../specs/2026-07-30-phase02-engineering-principles.md)):
> - 单文件 ≤ 500 行(软上限,超过需用户确认)
> - Session 主类 `session.ts` ≤ 280 行
> - repos 拆到 `repos/` 子目录,每个 repo 独立可测
> - env 单独 `env/` 子目录,与 session 平级

**目录结构**(本 Task 产出):
```
packages/agent/src/
├── harness/
│   ├── session/
│   │   ├── types.ts                       # SessionTreeEntry 联合 + 各变体 (~250 行)
│   │   ├── session.ts                     # Session 主类(append / getLeaf / setLeaf / fork 等) (~350 行,含 fork 合并)
│   │   ├── context-builder.ts             # buildContextEntries + buildContext (~250 行)
│   │   ├── storage.ts                     # SessionStorage 接口 + FileError (~80 行)
│   │   ├── repos/
│   │   │   ├── memory-storage.ts          # 内存 storage 实现 (~150 行)
│   │   │   ├── memory-repo.ts             # 内存 repo(Session 适配器) (~150 行)
│   │   │   ├── jsonl-storage.ts           # JSONL storage 实现 (~200 行)
│   │   │   ├── jsonl-repo.ts              # JSONL repo(Session 适配器) (~200 行)
│   │   │   └── repo-utils.ts              # 共享工具(serialize / deserialize) (~120 行)
│   │   └── index.ts
│   ├── env/
│   │   ├── types.ts                       # ExecutionEnv 接口 + FileError + ExecOptions (~120 行)
│   │   ├── result.ts                      # Result<T, E> 工具类型 (~50 行)
│   │   ├── nodejs.ts                      # NodeExecutionEnv(readFile/writeFile/stat/exec) (~280 行)
│   │   └── index.ts
│   └── agent-harness.ts                   # 增量:接入 session(appendEntry on turn)

packages/agent/__tests__/harness/
├── session/
│   ├── session.test.ts                    # Session 主类 + fork 一起测 (~500 行软上限边界,需评估)
│   ├── memory-repo.test.ts                # 内存后端 (~200 行)
│   ├── jsonl-repo.test.ts                 # JSONL 后端 (~250 行)
│   └── repo-utils.test.ts                 # 共享工具 (~150 行)
└── env/
    └── nodejs.test.ts                     # NodeExecutionEnv (~300 行)
```

**最大单文件**:~350 行(主类 fork 已合并;若接近 500 软上限,按工程原则 § 2.2 走确认流程)

**为什么 `session.ts` + `fork` 合并**:
- fork 是 session 的一个方法,操作 session 内部状态(树形 entries + leaf)
- 拆到 `fork.ts` 后,读代码的人要跳两个文件才能理解"fork 怎么工作"
- 预估 350 行,远低于 500 软上限
- 若实际接近 500,可拆出 `session-fork.ts` 子模块,但目前没必要预先拆

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

- [ ] Step 1: 写 `harness/session/types.test.ts` + 跑挂 → 写 `harness/session/types.ts` `SessionTreeEntry` 等 → 跑绿
- [ ] Step 2: 写 `harness/session/{memory-storage,memory-repo}.test.ts` + 跑挂 → 写实现 → 跑绿
- [ ] Step 3: 写 `harness/session/{jsonl-storage,jsonl-repo,repo-utils}.test.ts` + 跑挂 → 写实现 → 跑绿
- [ ] Step 4: 写 `harness/session/session.test.ts` + 跑挂(主类 + fork)→ 写 `harness/session/session.ts`(含 fork)→ 跑绿
- [ ] Step 5: 写 `harness/session/context-builder.test.ts` + 跑挂 → 写 `harness/session/context-builder.ts` → 跑绿
- [ ] Step 6: 写 `harness/env/nodejs.test.ts` + 跑挂 → 写 `harness/env/nodejs.ts` → 跑绿
- [ ] Step 7: 把 session + env 接入 `agent-harness.ts`(`prompt` 时 appendEntry)
- [ ] Step 8: 写 `examples/03-session.ts` 跑通
- [ ] Step 9: `wc -l` 检查所有新文件,如有 > 500 行走工程原则 § 2.2 确认流程
- [ ] Step 10: 暂停,展示 git diff 给用户审查
- [ ] Step 11: 提交 commit `feat(agent): session dual-backend + nodejs env`

---

## Task 6: 压缩 + 分支摘要(compaction)

**目标**: 实现 `compact()` + `navigateTree()`,从 pi 完整保留三件套(compaction.ts + branch-summarization.ts + utils.ts)。**手动触发,不接触发器**。

> **本 Task 工程约束**(详细见 [工程原则 § 4.5](../specs/2026-07-30-phase02-engineering-principles.md)):
> - 单文件 ≤ 500 行(软上限,超过需用户确认)
> - `compact.ts` ≤ 300 行(主入口,带钩子调用;含 file-ops 内联工具)
> - `branch-summarization.ts` ≤ 250 行(独立逻辑)
> - **不**为对称拆 `should-compact.ts` 单独文件(本包内不调用,合入 settings)

**目录结构**(本 Task 产出):
```
packages/agent/src/
├── harness/
│   ├── compaction/
│   │   ├── types.ts                       # CompactionSettings / CompactionResult / BranchSummaryResult (~150 行)
│   │   ├── settings.ts                    # DEFAULT_COMPACTION_SETTINGS + shouldCompact 工具函数 (~120 行)
│   │   ├── estimate.ts                    # estimateTokens(基于 chars/4 启发式) (~80 行)
│   │   ├── prepare.ts                     # prepareCompaction(选保留边界) (~150 行)
│   │   ├── compact.ts                     # compact 主入口 + file-ops 内联(走 session_before_compact 钩子) (~300 行)
│   │   ├── branch-summarization.ts        # generateBranchSummary + collectEntriesForBranchSummary (~250 行)
│   │   └── index.ts
│   └── agent-harness.ts                   # 增量:加 compact() + navigateTree() 方法

packages/agent/__tests__/harness/compaction/
├── compact.test.ts                        # compact 主流程 + file-ops 一起测 (~350 行)
├── branch-summarization.test.ts           # branch summary (~250 行)
├── prepare.test.ts                        # prepare 选保留边界 (~150 行)
├── estimate.test.ts                       # estimateTokens (~100 行)
└── settings.test.ts                       # DEFAULT_COMPACTION_SETTINGS + shouldCompact (~100 行)
```

**最大单文件**:~300 行(主入口 + file-ops 内联,可接受)

**为什么 `should-compact.ts` 取消 + `file-ops.ts` 合并**:
- `shouldCompact` 本包内不调用(spec 8.1 明确"仅手动触发"),既然不调用,单独 80 行文件没意义;并入 `settings.ts` 约 120 行
- `extractFileOpsFromMessage` 是 compact 内部使用的工具函数,强耦合;独立 120 行文件 + 主类依赖它,跳文件;直接内联到 `compact.ts` 末尾
- **不是为拆而拆**——两个文件都服务于"compact 主流程",合在一起读最快

**compaction.ts 关键 API**:
- `compact(harness, options?): Promise<CompactResult>`:执行压缩
- `prepareCompaction(entries, settings): CompactionPreparation`:选保留边界
- `estimateTokens(message: AgentMessage): number`:基于 `chars / 4` 启发式
- `extractFileOpsFromMessage(message: AgentMessage): { readFiles: string[], modifiedFiles: string[] }`:内联在 compact.ts
- `DEFAULT_COMPACTION_SETTINGS: CompactionSettings` + `shouldCompact(...)`:在 settings.ts

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
- `compact.test.ts`:
  - ✅ `compact` 真实跑通(用 mock model):生成 summary + 写 CompactionEntry
  - ✅ `compact` 触发 `session_before_compact` 钩子
  - ✅ 钩子 `cancel: true` 阻止压缩
  - ✅ 钩子 `compaction` 注入已有结果,跳过 LLM 调用
  - ✅ `extractFileOpsFromMessage` 从 tool result 提取 read/modified 文件(内联测试)
- `branch-summarization.test.ts`:
  - ✅ `collectEntriesForBranchSummary` 收集从 root 到 targetId 路径上被丢弃的 entries
  - ✅ `generateBranchSummary` 真实跑通
- `prepare.test.ts`:
  - ✅ `prepareCompaction` 选保留边界(基于 `keepRecentTokens`)
- `estimate.test.ts`:
  - ✅ `estimateTokens` 对各角色消息返回合理值
- `settings.test.ts`:
  - ✅ `DEFAULT_COMPACTION_SETTINGS` 默认值
  - ✅ `shouldCompact` 函数正确(虽然不调用,但保证语义正确)

**example**(`04-compaction.ts`):
- 启动 harness,跑 ~10 轮长对话(用真实 API)
- 调用 `harness.compact()`,验证 session.jsonl 中出现 CompactionEntry
- 打印压缩前后的 token 估算

**验证**:
```bash
cd packages/agent && pnpm test compaction
npx tsx examples/04-compaction.ts
```

- [ ] Step 1: 写 `harness/compaction/{types,settings,estimate,prepare}.test.ts` + 跑挂 → 写实现 → 跑绿
- [ ] Step 2: 写 `harness/compaction/branch-summarization.test.ts` + 跑挂 → 写 `harness/compaction/branch-summarization.ts` → 跑绿
- [ ] Step 3: 写 `harness/compaction/compact.test.ts` + 跑挂 → 写 `harness/compaction/compact.ts`(含内联 file-ops)→ 跑绿
- [ ] Step 4: 接入 `agent-harness.ts`:`compact()` + `navigateTree()` 方法
- [ ] Step 5: 写 `examples/04-compaction.ts` 跑通
- [ ] Step 6: `wc -l` 检查所有新文件,如有 > 500 行走工程原则 § 2.2 确认流程
- [ ] Step 7: 暂停,展示 git diff 给用户审查
- [ ] Step 8: 提交 commit `feat(agent): compaction + branch summarization`

---

## Task 7: Skills + Prompt Templates

**目标**: 实现 skills / prompt templates 的加载与 system prompt 注入,以及 `skill()` / `promptFromTemplate()` 方法。

> **本 Task 工程约束**(详细见 [工程原则 § 4.6](../specs/2026-07-30-phase02-engineering-principles.md)):
> - 单文件 ≤ 500 行(软上限,超过需用户确认)
> - skills 和 prompt-templates **平级**两个子目录,不互相依赖
> - 每个子目录 ≤ 4 个文件,职责清晰

**目录结构**(本 Task 产出):
```
packages/agent/src/
├── harness/
│   ├── skills/
│   │   ├── types.ts                       # Skill 类型 (~100 行)
│   │   ├── format.ts                      # formatSkillsForSystemPrompt + formatSkillInvocation (~200 行)
│   │   ├── load.ts                        # parseSkillContent(YAML frontmatter) + loadSkillFromFile(走 ExecutionEnv) (~200 行,合并 parse+load)
│   │   └── index.ts
│   ├── prompt-templates/
│   │   ├── types.ts                       # PromptTemplate 类型 (~80 行)
│   │   ├── format.ts                      # formatPromptTemplateInvocation + 占位符替换 (~150 行)
│   │   └── index.ts
│   └── agent-harness.ts                   # 增量:加 skill() + promptFromTemplate() + setResources()

packages/agent/__tests__/harness/
├── skills.test.ts                         # skills 全部行为(含 format + parse + load)(~300 行)
└── prompt-templates.test.ts               # prompt templates 全部行为 (~200 行)
```

**最大单文件**:~200 行(可接受)

**为什么 `parse.ts` + `load.ts` 合并**:
- 都是"加载 skill"的不同阶段:parse 解析 frontmatter,load 走 env 读文件 + 调 parse
- 拆开后,读 load.ts 要看 parse.ts,跳文件;合在一起线性阅读最快
- 预估 200 行,远低于 500 软上限

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

- [ ] Step 1: 写 `skills/{types,format,load}.test.ts` + 跑挂 → 写 `skills/{types,format,load}.ts` → 跑绿
- [ ] Step 2: 写 `prompt-templates/{types,format}.test.ts` + 跑挂 → 写 `prompt-templates/{types,format}.ts` → 跑绿
- [ ] Step 3: 接入 `agent-harness.ts`:`skill()` + `promptFromTemplate()` + `setResources()`
- [ ] Step 4: 写 `examples/05-skills.ts` + `examples/06-prompt-templates.ts` 跑通
- [ ] Step 5: `wc -l` 检查所有新文件,如有 > 500 行走工程原则 § 2.2 确认流程
- [ ] Step 6: 暂停,展示 git diff 给用户审查
- [ ] Step 7: 提交 commit `feat(agent): skills + prompt templates`

---

## Task 8: 队列操作 + 自定义消息示例

**目标**: 实现 `steer()` / `followUp()` / `nextTurn()` 队列操作,以及 CustomAgentMessages 声明合并的演示。

> **本 Task 工程约束**(详细见 [工程原则 § 4.7](../specs/2026-07-30-phase02-engineering-principles.md)):
> - 单文件 ≤ 500 行(软上限,超过需用户确认)
> - **不**为对称拆 3 个独立队列文件;统一 `queue.ts` 一个文件处理 steer/followUp/nextTurn
> - **强制审视 `agent-harness/`**:如果经过 Task 4/5/6/7 增量后任何文件接近或超过 500,**走工程原则 § 2.2 确认流程**

**目录结构**(本 Task 产出):
```
packages/agent/src/
├── harness/
│   ├── agent-harness/                     # AgentHarness 主类(单文件,本步直接增量 agent-harness.ts)
│   │   ├── agent-harness.ts               # 增量 steer / followUp / nextTurn + queue getter/setter (~540 行⚠️)
│   │   └── queue.ts                       # 队列处理内部逻辑(从 agent-harness.ts 抽辅助函数,避免超 500) (~120 行)
│   ├── queue.ts                           # 队列处理纯函数:steer / followUp / nextTurn 三个函数 + QueueMode 行为差异 (~300 行,合并三个原独立文件)
│   └── index.ts                           # 公共 API 重新聚合

packages/agent/__tests__/harness/
├── agent-harness/
│   ├── prompt.test.ts                     # 增量测试:steer / followUp / nextTurn (~350 行)
│   └── config.test.ts                     # 增量测试:queue mode setter / getter (~220 行)
├── queue.test.ts                          # 队列处理纯函数统一测试(~300 行)
```

**最大单文件**:~300 行(可接受,队列处理模式统一)

**为什么合并 `queue/` 子目录的 3 个文件**:
- 三个队列操作本质是同一种模式(drain queue + 决定何时投递 + QueueMode 行为差异),**为对称而拆**
- 合并 `queue.ts` 约 300 行,5 个纯函数(`enqueueSteer` / `drainSteerQueue` / `enqueueFollowUp` / `drainFollowUpQueue` / `enqueueNextTurn`),读者能在一个文件里看到所有 3 种队列处理 + QueueMode 差异
- 单独 `queue/` 子目录 + `agent-harness/queue.ts` 是双重抽象,统一为单个 `harness/queue.ts` + `agent-harness/queue.ts` 协作更清晰

**agent-harness.ts 行数预警**(Task 3 重构决策:独立类型/独立概念拆分):
- Task 3 末尾:320 行(agent-harness.ts) + 64 行(event-bus.ts) + 29 行(helpers.ts) = 413 行
- Task 8 末尾:320 + ~50(queue getter/setter) + ~80(steer/followUp/nextTurn) = ~450 行 agent-harness.ts,低于 500 软上限 ✓

**队列操作**:
- `harness.steer(text, options?)`:中途插入用户消息,中断当前 LLM 流
- `harness.followUp(text, options?)`:排队用户消息,等当前 turn 结束投递
- `harness.nextTurn(text, options?)`:在下一轮用户消息之前插入
- 队列模式 setter / getter(`setSteeringMode` / `setFollowUpMode` / `getSteeringMode` / `getFollowUpMode`)放 `agent-harness.ts` 的 getter/setter 区域

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

- [ ] Step 1: 写 `harness/queue.test.ts` + 跑挂(RED)→ 写 `harness/queue.ts`(enqueueSteer / drainSteerQueue / enqueueFollowUp / drainFollowUpQueue / enqueueNextTurn)→ 跑绿
- [ ] Step 2: 写 `harness/agent-harness/queue.ts` 队列处理辅助函数(从 agent-harness.ts 抽,解决超 500 问题)
- [ ] Step 3: 写 `config.test.ts` 增量测试 + 跑挂 -> 写 agent-harness.ts 增量 setter/getter -> 跑绿
- [ ] Step 4: 写 `prompt.test.ts` 增量测试 + 跑挂 -> 写 agent-harness.ts 增量 `steer()` / `followUp()` / `nextTurn()` -> 跑绿
- [ ] Step 5: 写 `examples/08-custom-messages.ts` 跑通
- [ ] Step 6: `wc -l` 检查所有新文件,如有 > 500 行走工程原则 § 2.2 确认流程
- [ ] Step 7: 暂停,展示 git diff 给用户审查
- [ ] Step 8: 提交 commit `feat(agent): queue ops + custom messages demo`

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

**review checklist**(每篇文档必须过):
- [ ] 中文流畅,无错别字
- [ ] 所有类型签名与代码一致(签名拼写、参数顺序、返回类型)
- [ ] 所有流程图与实现一致(分支、判断、顺序)
- [ ] 关键概念表格覆盖所有 public API
- [ ] 已知限制从 spec 沿用,不遗漏
- [ ] 文档结构统一(5 个章节齐全)
- [ ] 文件路径引用正确(以 `file:///` 协议)

**验证**:
- 通读每篇,确保中文流畅、无错别字
- 所有类型签名与代码一致
- 所有流程图与实现一致

- [ ] Step 1: 写 `docs/agent-harness.md`
- [ ] Step 2: 写 `docs/hooks.md`
- [ ] Step 3: 写 `docs/session.md`
- [ ] Step 4: 写 `docs/compaction.md`
- [ ] Step 5: 写 `docs/skills-and-templates.md`
- [ ] Step 6: 用 review checklist 自检每篇
- [ ] Step 7: 暂停,展示 git diff 给用户审查
- [ ] Step 8: 提交 commit `docs(agent): 5 篇中文文档`

---

## Task 10: 全量验证 + Phase 02 收尾

**目标**: 全量测试 + 全量 examples 跑通,验证整个 `@mimi/agent` 包就绪。

**验证清单**(全部必须通过才算 Phase 02 完成):
```bash
# 单元测试
cd packages/agent && pnpm test
# 预期: ≥ 50 tests pass,0 fail

# 全量 examples(全部用 mock provider 跑,不需要真实 API key)
cd packages/agent && npx tsx examples/01-basic.ts
cd packages/agent && npx tsx examples/02-tools.ts
cd packages/agent && npx tsx examples/03-session.ts
cd packages/agent && npx tsx examples/04-compaction.ts
cd packages/agent && npx tsx examples/05-skills.ts
cd packages/agent && npx tsx examples/06-prompt-templates.ts
cd packages/agent && npx tsx examples/07-hooks.ts
cd packages/agent && npx tsx examples/08-custom-messages.ts
# 预期: 8 个全部正常退出,0 error

# 类型检查
cd packages/agent && pnpm tsc --noEmit
# 预期: 0 error

# 与 AI 层集成
cd packages/agent && pnpm build
# 预期: dist/ 生成,无 warning

# 行数扫描(自动检查所有新文件 < 500)
cd packages/agent && pnpm run check:line-count
# 预期: 全部文件 < 500 软上限(超 500 需用户已确认)
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
| 4 | 钩子系统 | 1.5-2.5h(**8 个核心事件 + 9 个预声明,合并 semantics/dispatch/cleanup**)|
| 5 | session + env | 3-4h(双后端 + 5 文件,fork 合并入 session) |
| 6 | compaction | 1.5-2.5h(三件套,但 file-ops 内联、should-compact 取消) |
| 7 | skills + templates | 1-2h(parse+load 合并) |
| 8 | 队列 + 自定义消息 | 1-1.5h(3 队列合并为 1 个 queue.ts) |
| 9 | 5 篇文档 | 2-3h(加 review checklist) |
| 10 | 全量验证 | 1h |
| **合计** | | **~16-22h**(比原估算略减,因部分文件合并) |

**注意**:这只是"实现 + 测试"的估算。Debug、跨任务修正、依赖 pi 行为差异的适配,可能再 +30-50%。
