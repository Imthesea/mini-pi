# Mimipi — AI 层 + Agent 层 改造方案

> Status: Phase 02 进行中(Task 1-4 完成,Task 5-10 待办)
> Owner: TBD
> Last updated: 2026-07-31

---

## 前言

本文档是对 **pi 项目** (`F:\allProject\githubProject\pi`) 做减法改造的设计方案。目标是去掉繁杂的认证、35+ 个 Provider、OAuth 流程等重型设施,保留核心的 AI 层与 Agent 层抽象,打造一个最小化可运行的 Agent 项目基础。

改造策略:**逐层推进**。Phase 01 完成 AI 层(Provider + 事件流 + 错误处理),Phase 02 进行 Agent 层(AgentHarness 运行时 + 会话 + 钩子 + 压缩 + 队列),保证每层每个组件都有可运行的样例,验证通过后再往上做 coding-agent 层、TUI 层。

---

## 1. 项目背景

### 1.1 为什么要简化 pi?

pi 是一个功能完善的四层 Agent CLI 项目,但它面向的是"通用 CLI 工具"场景,导致:
- **认证过重**:支持 API Key + OAuth(设备码、PKCE 回调服务器、凭证刷新),大多数场景只需要环境变量
- **Provider 过多**:~35 个 Provider,维护成本高,大多数用户只用 2-3 个
- **耦合过深**:各层之间有复杂的依赖和事件系统,不利于理解和二次开发

精简目标:从 pi 的 `packages/ai` + `packages/agent`(~33,000 行,35+ Provider)抽出最小化可运行的 AI + Agent 两层(目标 ~6,000 行)。

### 1.2 目标

打造一个**自己的 Agent 项目**,核心原则:
- **最小化可运行** — 每个组件都能独立跑通
- **无繁杂认证** — 只用环境变量,不搞 QR 码/OAuth/交互式登录
- **逐层验证** — 先做 AI 层(Phase 01 ✅),再做 agent 层(Phase 02 进行中),跑通样例
- **架构清晰** — 保留 pi 的核心抽象模式,去掉非必要的复杂度
- **中文优先** — 注释、文档全部中文;每个类、每个方法至少要有中文注释说明用途
- **可扩展优先** — 每个模块即使当前只有一个文件,也以目录形式组织(如 `auth/`、`provider/`、`stream/`、`harness/`),通过 `index.ts` 导出公共 API。后续扩展时只需在目录内新增文件,不影响外部 import 路径
- **拆分优先于合并** — 单文件 500 行软上限,按"独立类型/独立概念"拆分,避免"为对称而拆"

### 1.3 pi 原始架构回顾

```
pi 项目 (4 层 monorepo):

┌─────────────────────────────────────────┐
│  coding-agent  (CLI 入口, 会话管理)      │  ← Phase 03(下一步)
├─────────────────────────────────────────┤
│  agent         (Agent 运行时, 工具循环)   │  ← Phase 02(进行中, Task 1-4 ✅)
├─────────────────────────────────────────┤
│  ai            (统一多 Provider LLM API) │  ← Phase 01(已完成 ✅)
├─────────────────────────────────────────┤
│  tui           (终端 UI 库)              │  ← 不在改造范围
└─────────────────────────────────────────┘
```

### 1.4 AI 层的核心抽象(Phase 01 ✅)

pi 的 AI 层有四个核心概念,这是我们要保留和简化的:

| 概念 | 说明 | pi 中的文件 |
|------|------|------------|
| **类型系统** | Model, Context, Message, Tool, AssistantMessage 等统一类型 | `types.ts` |
| **Provider 接口** | 描述一个 AI 提供商:模型列表 + 认证 + 流式调用 | `models.ts` (Provider interface) |
| **Models 集合** | 管理多个 Provider,解析认证,分发请求 | `models.ts` (Models interface) |
| **事件流** | 统一的流式事件协议 | `utils/event-stream.ts` |

### 1.5 Agent 层的核心抽象(Phase 02 进行中)

pi 的 Agent 层在 AI 层之上,提供会话化、可扩展、可持久化的 Agent 运行时,核心抽象:

| 概念 | 说明 | 状态 |
|------|------|------|
| **AgentLoop** | 核心 turn 循环:LLM → tool → repeat,带重试 + 事件流 | ✅ Task 2 |
| **AgentHarness** | 运行时外壳:phase 状态机 + 配置管理 + 事件订阅 + abort | ✅ Task 3 |
| **Hooks 系统** | 17 个事件(8 核心 + 9 预声明)+ 5 种变更语义,扩展对接层 | ✅ Task 4 |
| **Session 双后端** | 树形 entry 管理 + InMemory/JSONL 持久化 + 上下文构建 | ⬜ Task 5(下一步) |
| **Compaction** | 自动压缩 + 分支摘要 | ⬜ Task 6 |
| **Skills + Prompt Templates** | 可复用能力注入 | ⬜ Task 7 |
| **Queue 队列** | steer / followUp / nextTurn | ⬜ Task 8 |
| **中文文档** | 5 篇核心文档 | ⬜ Task 9 |
| **全量验证** | 50+ tests + 8 examples | ⬜ Task 10 |

### 1.6 AI 层中要删减的部分

| 删减内容 | 原因 |
|----------|------|
| OAuth 全部实现(~7 个文件) | 只要环境变量 |
| CredentialStore(文件存储 + 锁) | 不需要持久化凭证 |
| 35 个 Provider → 3 个 | 只保留 Anthropic / OpenAI / DeepSeek |
| 图像生成(images.ts 等) | 不是核心功能 |
| 懒加载 API(*.lazy.ts) | 直接导入,不需要按需加载 |
| 动态模型刷新(refreshModels) | 模型列表静态定义 |
| 延迟工具(deferred-tools.ts) | 简化,工具直接传入 |
| 大量 compat 字段 | 只保留必需的 |

---

## 2. 技术选型

> 每个决策遵循模板：候选方案 → 筛选 → 决策 → 理由

### 2.1 Provider 选择

| 候选 | 筛选 | 决策 | 理由 |
|------|------|------|------|
| pi 全部 35 个 Provider | 只保留：1) 使用最广的；2) API 形状不同的；3) 有一个 OpenAI 兼容的证明可扩展性 | **Anthropic + OpenAI + DeepSeek** | Anthropic 和 OpenAI 是两大主流 API，形状不同（Messages vs Completions）。DeepSeek 证明 OpenAI 兼容模式可以零成本扩展 |

### 2.2 认证方案

| 候选 | 筛选 | 决策 | 理由 |
|------|------|------|------|
| pi 完整认证（OAuth + 凭证存储 + 设备码 + PKCE） | 必须最小化、无交互、无持久化 | **单函数 `envApiKey(envVar)`**，从 `process.env` 读取 | 每个 Provider 在请求时读自己的环境变量。无 CredentialStore、无 OAuth、无 refresh、无 login/logout。整个 auth 模块 3 行代码 |

### 2.3 流式协议设计

| 候选 | 筛选 | 决策 | 理由 |
|------|------|------|------|
| pi EventStream / Node.js Readable / AsyncGenerator | 必须与后续 agent 层兼容 | **保留 pi 的 `AssistantMessageEventStream`** (原样) | agent 层依赖 `text_delta`、`toolcall_start`、`thinking_delta` 等事件类型。改了协议 agent 层就不能用了。且 pi 的 EventStream 实现已经很简洁（89 行） |

### 2.4 工具 Schema 方案

| 候选 | 筛选 | 决策 | 理由 |
|------|------|------|------|
| TypeBox / Zod / 纯 JSON Schema | 必须与 agent 层兼容，不能增加额外依赖 | **保留 TypeBox** | 与 pi 一致，类型层面零运行时开销，agent 层同样用 TypeBox。30KB 的代价可忽略 |

### 2.5 API 实现方式

| 候选 | 筛选 | 决策 | 理由 |
|------|------|------|------|
| 懒加载（pi 的 `lazyApi()`）/ 直接导入 | 3 个 Provider 不需要按需加载 | **直接导入** | 懒加载是为 35 个 Provider 的 bundle size 优化。3 个 Provider 直接 import 即可，调试更简单 |

### 2.6 语言与运行时

| 候选 | 筛选 | 决策 | 理由 |
|------|------|------|------|
| TypeScript / Python / Go | 与 pi 保持一致，agent 层后续复用类型 | **TypeScript + Node.js** | 直接从 pi 迁移类型定义，零翻译成本。`tsx` 直接跑 TS 无需编译步骤 |

### 2.7 目录结构

```
my-mimipi/                            # monorepo 根
  package.json                        # pnpm workspace 配置
  tsconfig.base.json
  pnpm-workspace.yaml
  .gitignore

  packages/ai/                        # @mimi/ai — Phase 01 完成 ✅
    package.json
    tsconfig.json
    vitest.config.ts
    .env.example
    src/
      index.ts                        # 公共 API
      types.ts                        # 核心类型
      auth/index.ts                   # envApiKey() + dotenv 自动加载
      provider/index.ts               # Provider + ModelsImpl + createModels()
      stream/index.ts                 # EventStream + AssistantMessageEventStream
      api/
        anthropic.ts                  # Anthropic Messages API(真实 SDK)
        openai.ts                     # OpenAI Provider(继承 BaseOpenAICompatProvider)
        deepseek.ts                   # DeepSeek Provider(继承 BaseOpenAICompatProvider)
        openai-compat-base.ts         # OpenAI 兼容家族共用基类 + 工具
      utils/
        transform-messages.ts         # 图片降级
        assistant-message.ts
        retry.ts                      # isRetryableAssistantError
        error-body.ts                 # normalizeProviderError
      __tests__/                      # 7 文件, 51 tests
    examples/
      01-core-types.ts
      02-anthropic-mock.ts
      03-deepseek-chat.ts
      04-openai-mock.ts
      06-tool-use.ts
      07-multi-turn.ts

  packages/agent/                     # @mimi/agent — Phase 02 进行中(4/10 Task)
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      index.ts                        # 公共 API re-export(126 行)
      types.ts                        # agent 层共用类型(AgentContext / AgentLoopConfig / ...)(389 行)
      agent-loop.ts                   # 公共 API + runLoop 编排(TDD: 17 tests,447 行)
      loop/
        helpers.ts                    # 纯函数辅助(71 行)
        stream-assistant.ts           # 流式响应 + 重试(203 行)
        tool-validation.ts            # TypeBox 参数校验(239 行)
        tool-execution.ts             # 路由入口(34 行)
        tool-execution/
          types.ts                    # 内部类型(PreparedToolCall 等,58 行)
          prepare.ts                  # prepareToolCall(参数校验 + beforeToolCall 桥接,63 行)
          execute.ts                  # executePreparedToolCall(onUpdate 派发,95 行)
          finalize.ts                 # finalizeExecutedToolCall(afterToolCall 桥接,63 行)
          truncate.ts                 # failToolCallsFromTruncatedMessage(49 行)
          sequential.ts               # 串行执行(78 行)
          parallel.ts                 # 并行执行(100 行)
      harness/                        # AgentHarness 运行时外壳
        index.ts                      # 模块公共 API(89 行)
        phase.ts                      # phase 状态机(71 行)
        errors.ts                     # AgentHarnessError / HarnessConfigError(45 行)
        agent-harness/
          agent-harness.ts            # AgentHarness 主类(447 行,含 37 行注释)
          event-bus.ts                # 事件总线(独立类,76 行)
          helpers.ts                  # 纯函数辅助(buildUserContent / extractSessionId,34 行)
          hooks-bridge.ts             # hooks ↔ agent-loop 桥接(118 行)
        types/                        # AgentHarness 公共类型
          harness.ts                  # Skill / PromptTemplate / HookEvent(92 行)
          events.ts                   # AgentHarnessEvent 联合(22 行)
          options.ts                  # AgentHarnessOptions / 构造选项(122 行)
        messages/                     # 消息转换
          convert.ts                  # convertToLlm 主入口 + custom 过滤(35 行)
          assistant.ts                # buildAssistantMessage + content 顺序(54 行)
          custom.ts                   # 自定义消息投影(54 行)
        system-prompt/                # system prompt 拼接
          index.ts                    # 模块公共 API(6 行)
          build.ts                    # buildSystemPrompt 主入口(44 行)
          parts.ts                    # 各部分拼装(58 行)
          types.ts                    # 内部类型(12 行)
        hooks/                        # 钩子系统(Task 4 新增)
          index.ts                    # 模块公共 API(72 行)
          types.ts                    # 17 个事件类型 + 公共联合(296 行)
          semantics.ts                # 5 种语义纯函数(265 行)
          default-hooks.ts            # DefaultAgentHarnessHooks 主类(257 行)
          default-hooks-state.ts      # 内部状态封装(195 行)
      __tests__/                      # 17 文件, 218 tests
        types.test.ts
        agent-loop.test.ts
        harness/
          phase.test.ts
          types/{harness,events,options}.test.ts
          messages/{convert,assistant,custom}.test.ts
          system-prompt/{build,parts}.test.ts
          agent-harness/{agent-harness,config,prompt}.test.ts
          hooks/{types,semantics,default-hooks}.test.ts
    examples/
      01-basic.ts                     # Task 3
      07-hooks.ts                     # Task 4(新增)

  docs/
    my-minipi-spec.md                 # 本文档
    superpowers/specs/                # 设计 Spec
      2026-07-29-phase01-ai-core-design.md        (Phase 01 ✅)
      2026-07-29-openai-decompose-design.md       (Phase 01 ✅)
      2026-07-30-phase02-agent-design.md          (Phase 02)
      2026-07-30-phase02-engineering-principles.md (Phase 02)
      2026-07-30-phase02.5-coding-agent-design.md  (Phase 03,草案)
    superpowers/plans/                # 实施 Plan
      2026-07-29-phase01-ai-core-plan.md           (Phase 01 ✅)
      2026-07-29-openai-decompose-plan.md          (Phase 01 ✅)
      2026-07-30-phase02-agent-plan.md             (Phase 02,Task 1-4 ✅)
      2026-07-30-phase02.5-coding-agent-plan.md    (Phase 03,草案)
    project-log/                       # 实施日志
      phase-01-ai-core/log.md                     (Phase 01 ✅)
```

### 2.8 依赖

**`@mimi/ai` 与 `@mimi/agent` 共享依赖**:

| 依赖 | 用途 |
|------|------|
| `@anthropic-ai/sdk` | 调用 Anthropic Messages API(由 `@mimi/ai` 引入) |
| `openai` | 调用 OpenAI 和 DeepSeek(兼容)Chat Completions API(由 `@mimi/ai` 引入) |
| `typebox` | Tool 参数 Schema 类型,两包共享 |
| `typescript` + `tsx` + `@types/node` + `vitest` | 开发、运行、测试(workspace devDeps) |

**`@mimi/agent` 独占依赖**:

| 依赖 | 用途 |
|------|------|
| `@mimi/ai` (workspace) | Model / AssistantMessage / Message / Tool / StreamFn 等基础类型 |
| `typebox` | Tool 参数 Schema(在 `examples/*.ts` 与 `__tests__/_helpers` 中复用) |

**为什么 agent 层依赖 `@mimi/ai` 而不是独立**:
- 重用类型(`Model` / `AssistantMessage` / `Tool` / `Context` / `StreamFn`)避免双份维护
- `streamFn` 契约直接对应 `@mimi/ai` 的 `Models.stream` 输出
- agent 包的体积由 workspace 内部引用解决,monorepo 用户无感知

### 2.9 Phase 02 agent 层技术选型(2026-07-30 增补)

> Phase 02 是基于 Phase 01 的 AI 层做 agent 运行时,以下决策是 Phase 02 独有的。

#### 2.9.1 钩子系统设计

| 候选 | 筛选 | 决策 | 理由 |
|------|------|------|------|
| 完全重写 / 沿用 pi `DefaultAgentHarnessHooks` | 必须最小化、与 agent-loop 兼容、扩展性优先 | **沿用 pi 协议,精简实现** | pi 协议已成熟(17 事件 + 5 语义);简化到 8 核心事件先实现,9 预声明事件留类型占位。完整协议在 `docs/superpowers/specs/2026-07-30-phase02-agent-design.md` § 3.4 |

#### 2.9.2 Session 后端

| 候选 | 筛选 | 决策 | 理由 |
|------|------|------|------|
| 仅 InMemory / 仅 JSONL / 双后端 | 演示与生产都要兼顾 | **双后端:InMemory(测试) + JSONL(持久化)** | pi 的两套都保留,JSONL append-only + 启动重放 leaf entries,无锁写入 |

#### 2.9.3 重试责任分配

| 候选 | 筛选 | 决策 | 理由 |
|------|------|------|------|
| AI 层重试 / Agent 层重试 / 两层都重试 | 责任清晰、可观测 | **Agent 层独占** | AI 层只做错误分类(`isRetryableAssistantError`),`runAgentLoop` 内部重试,避免两层都做退避循环(职责重叠且难以诊断) |

#### 2.9.4 拆分原则(单文件 500 行软上限)

| 候选 | 筛选 | 决策 | 理由 |
|------|------|------|------|
| 一个大文件 / 按职责拆 / 按方法拆 | 维护性优先 | **按"独立类型/独立概念"拆,避免"为对称而拆"** | 完整规则见 [`2026-07-30-phase02-engineering-principles.md`](../f:/allProject/githubProject/my-mimipi/docs/superpowers/specs/2026-07-30-phase02-engineering-principles.md) § 1.3 |

> **为什么是软上限而非硬限制**:为合理性可以超 500 行,但必须走工程原则 § 2.2 的确认流程(用户明确同意)。
> **测量方式**:`wc -l` 看总行,`grep -v '^\s*//' | wc -l` 看代码行。
> **注释不计入阈值**(2026-07-30 Task 2 决定,用户明确"详细注释不算行数")。

---

## 3. 详细设计

### 3.1 核心类型 (`packages/ai/src/types.ts`)

AI 层的"宪法",所有 Provider/Models 共享的协议层。从 pi 完整保留并精简,只保留必需字段。

**内容块**:四种原子内容类型
- `TextContent`(`type: "text"`)— 普通文本
- `ThinkingContent`(`type: "thinking"`)— 模型内部推理过程
- `ImageContent`(`type: "image"`)— base64 图片,带 `mimeType`
- `ToolCall`(`type: "toolCall"`)— 工具调用,带 `id` / `name` / `arguments` / 可选 `rawArguments` / `parseError`

**消息**:三种角色 + 统一联合
- `UserMessage`(`role: "user"`)— content 是 string 或 content 块数组
- `AssistantMessage`(`role: "assistant"`)— content 是 `(Text | Thinking | ToolCall)[]`,**顺序约定** `text → thinking → tools`(由 AI 层保证,agent 层依赖此约定)
- `ToolResultMessage`(`role: "toolResult"`)— `toolCallId` / `toolName` / `content` / `isError`

**Model**:统一模型描述(`id` / `name` / `api` / `provider` / `baseUrl` / `reasoning` / `input` / `cost` / `contextWindow` / `maxTokens`)。`api` 是字面量联合 `"anthropic-messages" | "openai-completions"`,带 `(string & {})` 后门允许扩展。

**Context**:LLM 调用上下文(`systemPrompt?` / `messages` / `tools?`)

**Tool**:TypeBox Schema(`parameters: TSchema`)

**StopReason**:`"stop" | "length" | "toolUse" | "error" | "aborted"` — 驱动 agent 循环的分支

**AssistantMessageEvent**:11 种流式事件(`start` / `text_start` / `text_delta` / `text_end` / `thinking_*` / `toolcall_*` / `done` / `error`)。每个事件携带 `partial: AssistantMessage`,让消费者能增量渲染 UI。

**类型守卫**:`hasApi<TApi>(model, api)` 在动态查找时做类型窄化,避免到处 `as` 断言。

### 3.2 事件流 (`packages/ai/src/stream/index.ts`)

**EventStream<T, R>** 泛型异步流,从 pi 原样保留。两条通道连接生产者(LLM SDK)和消费者(调用方):

```
生产者 push(event) ──→ queue[]  ──→ 消费者 for-await
                  └─→ waiting[] ──→ (resolve 直通,事件不进 queue)
```

**关键设计**:
- `done=true` 后 push 直接 return(流终止不可逆)
- `isComplete(event)` 判定终止事件,`extractResult(event)` 从终止事件提取 result
- 内部 `finalResultPromise` 在终止事件到来或 `end(result)` 时 resolve
- `[Symbol.asyncIterator]()` 三态循环:queue 有数据 → yield;queue 空且 done → return;queue 空且 !done → await 阻塞

**AssistantMessageEventStream** 是 LLM 专用子类:
- `isComplete = (e) => e.type === "done" || e.type === "error"`
- `extractResult` 从 `done.message` 或 `error.error` 拿 `AssistantMessage`

后续可扩展:缓冲流(批量投递)、过滤流(按 type 过滤)、合并流(多源 merge)等,都只需继承 `EventStream`。

### 3.3 Provider 与 Models (`packages/ai/src/provider/index.ts`)

**Provider 接口**:描述一个 AI 提供商的能力。
```
id / name / baseUrl                    ← 标识
getApiKey()                            ← 单函数读环境变量
getModels() / getModel(id)             ← 静态模型列表
stream(model, context, options)        ← 流式调用
complete(model, context, options)      ← 非流式(默认 = stream().result())
```

**Models 接口**:Provider 集合,负责请求分发。
- `set(provider)` / `remove(id)` — 注册表管理
- `list()` / `get(id)` — Provider 查找
- `getModels(providerId?)` — 模型列表(可按 Provider 过滤)
- `getModel(provider, modelId)` — 精确查找
- `stream(model, context, options)` — **统一流式入口**,根据 `model.provider` 分发
- `complete(model, context, options)` — **非流式入口**,委托给 `provider.complete()`

**ModelsImpl 内部实现**:
- 用 `Map<string, Provider>` 存 Provider
- `resolveAuth()` 统一做 Provider 存在性 + API Key 校验,失败时返回含 `stopReason="error"` 的 AssistantMessage
- **失败不抛错**:无论 auth/provider 校验是否通过,`stream()` 都返回流对象,错误从 `error` 事件取(B2 修复)
- `complete()` 失败时包装为 `stopReason="error"` 的结果返回(不抛错),让上层(agent 层)决定是否重试

**createModels()**:工厂函数,返回 `new ModelsImpl()`。

### 3.4 认证 (`packages/ai/src/auth/index.ts`)

**核心:单函数 `envApiKey(envVar)`**——3 行代码:
```ts
export function envApiKey(envVar: string): string | undefined {
  const value = process.env[envVar];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
}
```

**自动加载 .env**:
- 优先加载 `packages/ai/.env`(相对当前文件)
- 找不到则回退到当前工作目录的 `.env`
- 用 `dotenv.config({ path })` 而不是覆盖 process.env,保证用户手动 export 的值优先级最高

**为什么极简**:
- 35 个 Provider 的 OAuth/凭证存储/PKCE 全部不要
- 每个 Provider 在请求时调一次 `envApiKey` 即可
- 用户在 `.env` 配一次,所有请求自动读

### 3.5 API 实现 — Anthropic (`packages/ai/src/api/anthropic.ts`)

调用 Anthropic Messages API,依赖 `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY`。

**模型列表**:1 个(`claude-sonnet-4-20250514`),后续按需加。

**消息转换** `convertMessages(messages)`:
- user 字符串 → `{ role, content: string }`
- user 块数组 → `content: ContentBlock[]`(text / image 两种块)
- assistant → 跳过 `thinking` 块(多轮回传不需要),text 块和 tool_use 块保留
- toolResult → 单独的 `user` 消息,content 是 `tool_result` 块,带 `tool_use_id` / `content` / `is_error`

**工具转换** `convertTools(tools)`:`TypeBox Schema → Anthropic InputSchema`(`structuredClone` 即可,运行时是 JSON-Schema 兼容对象)。

**reasoning 映射** `mapReasoningBudget(level)`:
- `true` → 16000(默认预算)
- `"low" | "medium" | "high"` → 4000 / 8000 / 32000

**流式实现** `anthropicStream()`:
- 立刻创建 `AssistantMessageEventStream` 同步返回(异步 SDK 调用在 IIFE 里跑)
- 监听 SDK 事件:`message_start` 读 input tokens / `content_block_start` 推 start 事件 / `content_block_delta` 推 delta 事件 / `content_block_stop` 推 end 事件 + 解析 tool args / `message_delta` 推 usage + stopReason / `message_stop` 推 done 事件
- **工具参数解析失败不抛错**:`rawArguments` + `parseError` 字段保留诊断信息,`arguments` 留空 `{}`
- **abort signal 透传**:`client.messages.stream(params, { signal })` 让用户取消时真正中断 SDK 请求

**`createErrorAssistantMessage(model, message)`**:失败时构造含 `stopReason="error"` 的 AssistantMessage。

**`mapStopReason(raw)`**:`end_turn` → `stop` / `max_tokens` → `length` / `tool_use` → `toolUse`。

### 3.6 API 实现 — OpenAI 兼容家族 (`openai-compat-base.ts` + `openai.ts` + `deepseek.ts`)

3 个文件:`openai-compat-base.ts` 承载 OpenAI 兼容家族的共用基类与工具(`BaseOpenAICompatProvider` 抽象类 + `_convertMessages` / `convertTools` / `openAICompatibleStream` / `buildAssistantMessage` / `mapOpenAIFinishReason`),`openai.ts` 与 `deepseek.ts` 各自只承载自家配置并继承基类。差异点(`baseUrl` / `envVar` / `reasoningFormat`)通过 `OpenAICompatConfig` 注入。

**`mapOpenAIFinishReason` 映射规则**:
- `tool_calls` → `toolUse`
- `length` → `length`
- `content_filter` → `stop`(内容被安全过滤按自然结束)
- 其它(null / 未知)→ `stop`

**`_convertMessages`**:user / assistant / tool 三种角色转换。DeepSeek 特殊:有 thinking 内容时必须传回 `reasoning_content` 字段。

**流式状态管理三个纯函数**(避免 8 个 let 闭包散落):
- `createStreamState(model)` — 初始化空状态(text / thinking / tool block index / accumulated strings)
- `processChunk(chunk, state, stream)` — 处理单个 chunk,推 `text_delta` / `thinking_delta` / `toolcall_delta` 事件
- `finalizeStream(state, stream)` — 循环结束,推 `text_end` / `thinking_end` / `toolcall_end`,返回完整 ToolCall 列表

**`buildAssistantMessage`**:按 `text → thinking → tools` 顺序构造 content(与 `processChunk` 的 block index 分配一致,保证 `partial.content` 与 `done.message.content` 对齐)。

**`BaseOpenAICompatProvider` 抽象基类**:子类只需 `super(config)`,基类负责 id/name/baseUrl 派生 + 5 个方法实现(stream / complete / getApiKey / getModels / getModel)。后续扩展 moonshot / qwen 等 OpenAI 兼容 Provider,零成本继承。

### 3.7 消息规范化 (`packages/ai/src/utils/transform-messages.ts`)

**单一职责**:非视觉模型的图片降级为 `"[图片]"` 占位文本。

```ts
export function transformMessages(messages, model): Message[] {
  if (model.input.includes("image")) return messages;  // 支持图片 → 原样
  return messages.map(downgradeImagesInContent);        // 否则降级
}
```

**处理范围**:
- `user` 消息中的 image 块 → text `"[图片]"`
- `toolResult` 消息中的 image 块(多轮对话工具返回截图场景)
- `assistant` 消息:content 联合类型不含 image,理论上不需要处理(防御性保留)

**设计动机**:Provider 不感知"图片降级"这个概念,只看到最终 messages。每个 API 实现统一调 `transformMessages` 即可。

### 3.8 错误处理 (`utils/retry.ts` + `utils/error-body.ts`)

**`isRetryableAssistantError(error)`**:判断是否值得重试。

**`NON_RETRYABLE` 关键词**(9 个,全部不重试):
`insufficient_quota` / `billing_not_active` / `invalid_api_key` / `incorrect_api_key` / `invalid_request_error` / `model_not_found` / `permission` / `unauthorized` / `authentication`

**`RETRYABLE` 关键词**(21 个,都重试):
- 限流:`overloaded` / `rate_limit` / `rate_limit_exceeded` / `too many requests` / `429`
- 服务器:`500` / `502` / `503` / `504` / `server_error` / `internal_server_error`
- 网络:`timeout` / `timed out` / `econnreset` / `econnrefused` / `enetunreach` / `network` / `connection` / `stream_closed` / `connection_error` / `broken pipe` / `socket hang up`

**匹配策略**:单词边界 `\b` 包裹 pattern,避免 `"500"` 误匹配 `"port 5000"`;含空格的 pattern 用 `includes` 即可。**先匹配 NON_RETRYABLE 再匹配 RETRYABLE**——避免 `rate_limit_exceeded` 被错误归类。

**`extractErrorMessage(error)`**:从各种错误形状(字符串 / Error / 对象含 message/error/msg)提取消息字符串。

**`normalizeProviderError(error)`**:把 SDK 抛出的原始错误统一为 `{ status, message }` 形状,用于在 error 事件中携带 HTTP 状态码。

**重试责任放在 agent 层**(2026-07-30 决定):
- AI 层只做错误分类 + 报告,**不做退避循环**
- `runAgentLoop` 内部基于 `isRetryableAssistantError` 做指数退避
- 避免两层都做退避循环导致的职责重叠和难以诊断的 bug

---

### 3.9 Agent Loop 核心 (`packages/agent/src/agent-loop.ts`,Task 2)

实现 **LLM → tool → repeat** 的核心循环——agent 层的心脏。**只关心编排**,不关心 LLM 协议解析(委托给 `loop/stream-assistant.ts`)或工具执行(委托给 `loop/tool-execution/`)。

**两个公共入口**:
- `agentLoop(prompts, context, config, signal?, streamFn?)` → `EventStream<AgentEvent, AgentMessage[]>`(订阅式,UI 用)
- `runAgentLoop(prompts, context, config, emit?, signal?, streamFn?)` → `Promise<AgentMessage[]>`(命令式,脚本用)

**统一入口设计**:`prompts` 默认 `[]`。**新会话模式**(`prompts` 非空)= 派发 `message_start/end`,newMessages 含 prompts;**续接模式**(`prompts` 空)= 不派发 prompt 事件,入口静态校验"context 最后一条不能是 assistant"。

**关键不变量**:
1. `agent_start ↔ agent_end` 严格成对(任何路径都 emit)
2. `turn_start ↔ turn_end` 严格成对
3. `message_start ↔ message_end` 严格成对
4. `context.messages` 始终反映"到目前为止的对话"(包括 partial assistant message)
5. **函数从不 throw**(除入口静态判定错误):LLM 错误编码到 `AssistantMessage.stopReason === "error"`,状态机自行退出

**双层 while 状态机**:
- **外层 while** = agent 整体生命周期(支持 follow-up 续命)
- **内层 while** = 当前 session 的工具循环 + steer 注入

**每轮 9 阶段**:`turn_start` → 注入 pendingMessages → `streamAssistantResponse` → 错误处理 → 提取 tool calls → `turn_end` → `prepareNextTurn` → `shouldStopAfterTurn` → poll steering。

**特殊场景**:
- `stopReason="length"`(截断):调 `failToolCallsFromTruncatedMessage` 把所有 tool call 标记为错误,让模型下轮重发
- `terminate=true`(工具通过 `toolResult.terminate` 请求):立即退出内层循环

**重试独占**:`stream-assistant.ts` 内部基于 `isRetryableAssistantError` 做指数退避,`maxRetries` 由 `AgentLoopConfig` 注入。

### 3.10 AgentHarness 运行时外壳 (`packages/agent/src/harness/agent-harness/agent-harness.ts`,Task 3+4)

**职责**:
1. 持有运行时配置(model / tools / env / session / resources / systemPrompt)
2. 维护 phase 状态机(idle / turn / compaction)
3. 暴露事件订阅接口(`subscribe()`)
4. 提供 abort 能力
5. 配置管理(`getXxx` / `setXxx` 共 14 个)
6. 业务入口(`prompt()`)
7. 钩子系统集成(emit 8 个核心事件)

**封装规则**:
- 字段用 `#` 私有修饰符(严格 ES private)
- 内部方法用 `_` 前缀(约定,供同模块测试调用):`_setPhase` / `_isDisposed` / `_setCurrentAbortController` / `_syncHookContext`

**Phase 状态机**:`phase.ts` 定义 `AgentHarnessPhase` 字面量联合 + `assertPhase()` 转换检查。`abort()` 绕过 canTransition 检查,作为"逃生舱"强制回 idle(被中断的 harness 不能永远卡在 turn 状态)。

**`prompt(text, options?)` 业务入口**:
1. emit `before_agent_start` 钩子(handler 可改 messages / systemPrompt)
2. 断言 phase === "idle",切到 "turn"
3. 构造 user 消息 + system prompt + AgentContext
4. emit `context` 钩子(handler 可链式改 messages)
5. 调 `runAgentLoop`,转发事件到订阅者(`message_end` 事件时同时 emit 钩子系统的 `message_end`)
6. try/finally 保证 phase 必回 idle

**事件总线**:`agent-harness/event-bus.ts` 独立类(`EventBus`),提供 `subscribe(handler)` → `unsubscribe`,`emit(event)` 同步派发到所有订阅者。`subscribe()` 返回的 `Subscription` 支持 `for await` 异步迭代 + `cancel()` 取消订阅。

**配置管理**:14 个 getter/setter 配对。setter 触发 `assertNotDisposed()` 检查(防止 dispose 后误用),部分 setter 触发钩子事件(如 `setModel` → emit `model_update`)。

**行数现状**:`agent-harness.ts` **447 行**(含 37 行注释)。未来 Task 5 接入 session / Task 6 加 compact / Task 7 加 skills / Task 8 加 queue 后预计 530+ 行,届时按工程原则 § 2.2 评估是否拆分。

### 3.11 钩子系统总览 (`packages/agent/src/harness/hooks/`,Task 4)

为扩展层提供的统一对接点——未来 Skill / Queue / 第三方插件都通过 hooks 接入,不直接改 agent-loop 内部。

**17 个事件**(8 核心 + 9 预声明):
| 类别 | 事件 | 状态 | 触发时机 |
|------|------|------|----------|
| **8 核心** | `before_agent_start` | ✅ | harness.prompt() 入口 |
| | `context` | ✅ | 每次 LLM 调用前 |
| | `tool_call` | ✅ | 每个 toolCall 执行前 |
| | `tool_result` | ✅ | 每个 toolCall 执行后 |
| | `message_end` | ✅ | 每条 message 派发 message_end 时 |
| | `model_update` | ✅ | setModel() 末尾 |
| | `abort` | ✅ | abort() 末尾 |
| | `session_before_compact` | ⬜ 占位 | Task 6 接入 |
| **9 预声明** | `before_provider_request` / `before_provider_payload` / `after_provider_response` | ⬜ 占位 | 未来 Task 9 接入 |
| | `session_compact` / `session_before_tree` / `session_tree` | ⬜ 占位 | 未来 Task 6 接入 |
| | `thinking_level_update` / `resources_update` / `tools_update` / `queue_update` / `save_point` / `settled` | ⬜ 占位 | 未来 Task 接入 |

**4 个文件**(完整可读):
- `types.ts`(296 行)— 17 个事件类型 + 公共联合 + ResultOf 泛型 + Facade 接口
- `semantics.ts`(265 行)— 5 种语义纯函数
- `default-hooks.ts`(257 行)— `DefaultAgentHarnessHooks` 主类
- `default-hooks-state.ts`(195 行)— 内部状态封装(handlers / observers / cleanups 三个 Map)

**`AgentHarnessHookContext`**:emit 时传给 handler 的"环境信息",含 `harness` / `session: SessionFacade` / `models: ModelFacade` / `messages: AgentMessage[]`。**Facade 而非原始引用**——handler 看到的是只读视图,避免误改内部状态。

**`ResultOf<E>` 泛型**:从 `HookEvent` 的 `__result` 字段提取"handler 可能的返回结果",让 `emit()` 调用方能静态推导类型。

**派发顺序**:
1. **observers 先派发**(`runFireAndForgetSemantics`,`Promise.all` 并行,单 observer 抛错被吞)
2. **handlers 再派发**(按 `event.type` 路由到对应 5 种语义函数)

**8 核心事件 emit 位置**:

| 事件 | 位置 | 桥接方式 |
|------|------|----------|
| `before_agent_start` | `prompt()` 入口 | `agent-harness.ts` 直接 emit |
| `context` | `#executeTurn` 调 `runAgentLoop` 前 | `agent-harness.ts` 直接 emit |
| `tool_call` | `bridgeBeforeToolCall` 包装 | `hooks-bridge.ts` 桥接到 `AgentLoopConfig.beforeToolCall` |
| `tool_result` | `bridgeAfterToolCall` 包装 | `hooks-bridge.ts` 桥接到 `AgentLoopConfig.afterToolCall` |
| `message_end` | `runAgentLoop` emit sink | `agent-harness.ts` 在 `message_end` 事件时同步 emit |
| `model_update` | `setModel()` 末尾 | `agent-harness.ts` 直接 emit |
| `abort` | `abort()` 末尾 | `agent-harness.ts` 直接 emit |
| `session_before_compact` | (Task 6 接入) | 当前未 emit |

### 3.12 钩子 5 种变更语义 (`packages/agent/src/harness/hooks/semantics.ts`)

5 个纯函数,每个处理一种 handler 列表的"派发语义"——按 event.type 路由到对应函数。

| 语义函数 | 适用事件 | 行为 | 终止条件 |
|----------|----------|------|----------|
| **`runContextSemantics`** | `context` | 链式 messages 转换:每个 handler 看到上一个的 messages,返回新 messages 给下一个 | 全部 handler 跑完 |
| **`runToolCallSemantics`** | `tool_call` | 顺序执行,遇 `block=true` 立即停止 | 遇 `block=true` 提前返回 |
| **`runToolResultSemantics`** | `tool_result` | 累积 4 字段(content / details / isError / terminate)——每个 handler 可独立覆盖任何子集 | 全部 handler 跑完 |
| **`runSessionBeforeSemantics`** | `session_before_compact` / `session_before_tree` | 字段级累积,遇 `cancel=true` 提前退出 | 遇 `cancel=true` 提前返回 |
| **`runFireAndForgetSemantics`** | 其他所有事件 | `Promise.all` 并行调用,handler 返回值忽略,抛错被吞 | 全部 handler 完成 |

**为什么是 5 个独立函数而不是 1 个 dispatcher**:每种语义的"累积规则"不同(链式 / 遇 block 停 / 字段合并 / 遇 cancel 停 / 全部忽略),强行合并会变成大量 if 分支,反而难读。**5 个函数横向对比**更清晰(每个函数 ~50 行,差异点突出)。

**为什么放在一个文件**:5 个函数每个 50-80 行,本质是"对 handler 列表跑某种语义"的同模板 5 个 case。拆 5 文件会触发工程原则 § 1.3"避免为对称而拆"反例。合在一个文件,便于读者对比共性(签名一致:都接 `event + handlers + ctx + signal`)。

**设计动机**(工程原则 § 1.3 实践):
- 每种语义的"终止条件"是核心约束(决定实现细节)
- 5 个纯函数 = 5 个独立可测的单元
- `DefaultAgentHarnessHooks` 的 `dispatchHandlers()` 只是个 `switch (event.type)` 路由

---

## 4. 实施规划

### 4.1 总体阶段

```
Phase 01: AI 层(已完成 ✅)
  Phase 1:  项目脚手架 + 核心类型
  Phase 2:  事件流
  Phase 3:  Provider/Models 框架
  Phase 4+5:Anthropic + OpenAI API
  Phase 6:  DeepSeek API 实现
  Phase 7:  错误处理 + 集成验证

Phase 02: Agent 层(进行中,4/10 Task 完成)
  Task 1:  包骨架 + 共用类型                         ✅ commit b06e3a0
  Task 2:  核心 agent-loop 循环                      ✅ commit 9f6be26
  Task 3:  AgentHarness 主类(skeleton + messages + system-prompt) ✅ commit 736d060
  Task 3.5: TD-001 清理(12 个 pre-existing tsc 错误)✅ 合并到 Task 3 commit
  Task 4:  钩子系统(8 核心 + 9 预声明 + 5 语义)     ✅ 代码完成,⬜ 待 commit
  Task 5:  Session 双后端(InMemory + JSONL)          ⬜ 下一步
  Task 6:  Compaction + 分支摘要                     ⬜
  Task 7:  Skills + Prompt Templates                 ⬜
  Task 8:  Queue 队列(steer / followUp / nextTurn)   ⬜
  Task 9:  中文文档(5 篇)                            ⬜
  Task 10: 全量验证 + 收尾                           ⬜

Phase 03: coding-agent 层(CLI 入口,草案)
```

> **当前测试统计**(2026-07-31):
> - `@mimi/ai` 51 tests pass
> - `@mimi/agent` 218 tests pass(17 个测试文件,涵盖 agent-loop + AgentHarness + hooks)
> - **总计 269 tests pass**,`tsc -p tsconfig.test.json` 0 错误

### 4.2 Phase 01: AI 层(已完成 ✅)

#### 4.2.1 Phase 1-1:项目脚手架 + 核心类型

**目标**:初始化 TypeScript 项目,定义所有核心类型

**实际产出**:`package.json`, `tsconfig.json`, `pnpm-workspace.yaml`, `src/types.ts`

**交付标准 (DoD)**:
- [x] `package.json` + `tsconfig.json` 配置完成,`tsc --noEmit` 通过
- [x] `types.ts` 定义完成:Model, Context, Message, Tool, AssistantMessage, StreamOptions, 事件类型
- [x] 样例 `examples/01-core-types.ts`:创建 Model 对象、构建 Context、验类型

#### 4.2.2 Phase 1-2:事件流

**目标**:实现 EventStream 类,支持推送事件和异步迭代

**实际产出**:`src/stream/index.ts`, `src/__tests__/stream.test.ts`(5 tests)

**交付标准 (DoD)**:
- [x] `EventStream<T, R>` 泛型类实现(从 pi 原样复制)
- [x] `AssistantMessageEventStream` 实现
- [x] vitest 测试覆盖 push/iterate/result/end 全路径

#### 4.2.3 Phase 1-3:Provider/Models 框架

**目标**:实现 Provider 接口、Models 集合

**实际产出**:`src/auth/index.ts`, `src/provider/index.ts`, `src/index.ts`(模块目录化)

**交付标准 (DoD)**:
- [x] `auth/index.ts`:`envApiKey()` + dotenv 自动加载
- [x] `provider/index.ts`:Provider 接口 + ModelsImpl + createModels()
- [x] `index.ts`:公共 API 导出
- [x] 模块目录化重构:`auth/` / `provider/` / `stream/` 各自独立目录,`index.ts` 导出(`commit faffffc`)

#### 4.2.4 Phase 1-4+5:Anthropic + OpenAI API

**目标**:Anthropic 真实 SDK + OpenAI 真实 API(需代理)

**实际产出**:
- Anthropic:`src/api/anthropic.ts` — 真实 SDK 实现(`@anthropic-ai/sdk`)
- OpenAI:`src/api/openai-compat-base.ts`(共用基类 + 工具)+ `src/api/openai.ts`(`openaiProvider()`,继承基类)
- 共用:`src/utils/transform-messages.ts`

**交付标准 (DoD)**:
- [x] `api/anthropic.ts`:真实 SDK 实现,依赖 ANTHROPIC_API_KEY
- [x] `api/openai-compat-base.ts` + `api/openai.ts`:openaiProvider() + 消息/工具转换 + 流式事件映射
- [x] 样例 `examples/02-anthropic-mock.ts`(mock 框架演示)、`examples/04-openai-mock.ts`(mock 框架演示)

#### 4.2.5 Phase 1-6:DeepSeek API 实现

**目标**:DeepSeek 独立 Provider,真实 API 验证通过

**实际产出**:`src/api/deepseek.ts`(继承 `BaseOpenAICompatProvider`) + `src/api/openai-compat-base.ts`(抽离共用基类,承载 OpenAI 兼容家族逻辑)

**交付标准 (DoD)**:
- [x] `deepseekProvider()` 导出在 `src/api/deepseek.ts`,baseUrl 指向 `https://api.deepseek.com`
- [x] reasoning 格式使用 DeepSeek style(`thinking: { type }`)
- [x] `openai-compat-base.ts` 抽象出 `BaseOpenAICompatProvider` + `openAICompatibleStream` 共用逻辑
- [x] `openai.ts` 与 `deepseek.ts` 只承载自家配置,不重复实现
- [x] 样例 `examples/03-deepseek-chat.ts`:流式输出 ✅
- [x] 样例 `examples/06-tool-use.ts`:工具调用 ✅
- [x] 样例 `examples/07-multi-turn.ts`:多轮对话 ✅

#### 4.2.6 Phase 1-7:错误处理 + 集成验证

**目标**:错误分类、工具调用、多轮对话,端到端验证

**实际产出**:`src/utils/retry.ts`(错误分类)+ `src/utils/error-body.ts`(错误规范化),`src/utils/assistant-message.ts`

**交付标准 (DoD)**:
- [x] `06-tool-use.ts`:DeepSeek 真实 API,模型正确调用 `get_weather({"city":"北京"})`
- [x] `07-multi-turn.ts`:用户消息 → 工具调用 → 结果注入 → 最终回答 ✅
- [x] 修复:消息转换支持 `reasoning_content` 回传(DeepSeek 要求)
- [x] 错误处理:未设 Key 清晰提示,错误分类正确(`isRetryableAssistantError`)
- [x] `tsc --noEmit` 零错误,`vitest run` 51 passed

### 4.3 Phase 02: Agent 层(进行中,4/10)

#### 4.3.1 Task 1:包骨架 + 共用类型 ✅

**目标**:初始化 `@mimi/agent` 包,定义 agent 层与 AI 层之间的共用类型(在 `@mimi/agent/src/types.ts`,**不**覆盖 `@mimi/ai` 的 `types.ts`)

**实际产出**:`package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`, `src/index.ts`, `src/__tests__/types.test.ts`(18 tests)

**关键设计**:
- `AgentContext` / `AgentLoopConfig` 分离:**Context 装业务/状态**(systemPrompt / messages / tools),**Config 装机制/可注入项**(model / convertToLlm / streamFn / hooks / retry)
- `ToolExecutionMode`:`"sequential" | "parallel"` — 工具执行模式
- `QueueMode`:`"all" | "one-at-a-time"` — 队列处理模式
- `HookEvent` 幻影结果泛型:每个事件类型可携带"handler 返回值"的类型

**交付标准 (DoD)**:
- [x] `package.json` + `tsconfig.json` + `vitest.config.ts` 配置完成
- [x] `types.ts` 定义 `AgentContext` / `AgentLoopConfig` / `HookEvent` 等 agent 层专用类型
- [x] `__tests__/types.test.ts` 18 tests pass(类型测试用 `expectTypeOf` 静态校验)

#### 4.3.2 Task 2:核心 agent-loop 循环 ✅

**目标**:实现 `runAgentLoop` — LLM → tool → repeat 的核心 turn 循环,带重试 + 事件流

**实际产出**:
- `src/agent-loop.ts`(公共 API + 编排)
- `src/loop/stream-assistant.ts`(流式响应 + 重试)
- `src/loop/tool-validation.ts` / `tool-execution.ts` / `tool-execution/{prepare,execute,finalize,truncate,sequential,parallel}.ts`(6 个职责文件)
- `src/loop/helpers.ts`(纯函数)
- `__tests__/agent-loop.test.ts`(17 tests,含 mock provider)

**关键设计**:
- **重试责任独占**:`runAgentLoop` 内部重试,基于 `isRetryableAssistantError`(AI 层只做错误分类)
- **工具执行按职责拆 6 文件**:prepare / execute / finalize / truncate / sequential / parallel(每个文件一个生命周期阶段)
- **公共 API 收敛为 2 函数**:`runAgentLoop` / `agentLoop`(合并原 4 函数,简化 API 表面)
- **AgentContext / AgentLoopConfig 分离**:见 Task 1

**交付标准 (DoD)**:
- [x] `pnpm test` 17 tests pass(agent-loop.test.ts)
- [x] `examples/01-basic.ts` 跑通
- [x] 重试逻辑在 agent 层(不依赖 AI 层退避循环)
- [x] 所有单文件 < 500 行软上限(agent-loop.ts 略大但通过 § 2.2 确认)

#### 4.3.3 Task 3:AgentHarness 主类(skeleton + messages + system-prompt)✅

**目标**:实现 `AgentHarness` 主类骨架:phase 状态机 + 配置管理 + 事件订阅 + abort。本步**不接 session,不接 hooks**

**实际产出**:
- `src/harness/agent-harness/agent-harness.ts`(`AgentHarness` 主类,**447 行**,含 37 行注释)
- `src/harness/agent-harness/event-bus.ts`(事件总线,独立类,76 行)
- `src/harness/agent-harness/helpers.ts`(纯函数辅助,34 行)
- `src/harness/phase.ts`(phase 状态机,71 行)
- `src/harness/errors.ts`(`AgentHarnessError` / `HarnessConfigError`,45 行)
- `src/harness/types/{harness,events,options}.ts`(公共类型,各 22/92/122 行)
- `src/harness/messages/{convert,assistant,custom}.ts`(消息转换,各 35/54/54 行)
- `src/harness/system-prompt/{index,build,parts,types}.ts`(system prompt 拼接 + 内部类型)
- `__tests__/harness/`(12 测试文件覆盖 Task 3,共 96 tests,加上 Task 1+2 的 types/agent-loop = 131 tests)

**关键设计**:
- **标准 class body 拆分**:Task 3 早期用 `Object.assign(Class.prototype, {...})` mixin 拆分,被用户否决,合并回 1 个标准 class body + 独立 `event-bus.ts` / `helpers.ts`(独立类型/独立概念)
- **拆分原则固化**(`docs/superpowers/specs/2026-07-30-phase02-engineering-principles.md` § 1.3):按"独立类型/独立概念"拆,不按"类的方法"拆
- **500 行软上限 + 注释不计入**:`agent-harness.ts` 447 行(含 37 行注释);详细注释行不算行数(2026-07-30 Task 2 决定)
- **TD-001 清理**(Task 3.5 合并到本 commit):12 个 pre-existing `tsc` 错误,全部位于测试文件,本 Task 末尾统一修复

**交付标准 (DoD)**:
- [x] `pnpm test` 131 tests pass(Task 1+2+3,vitest + tsc 0 错误)
- [x] `examples/01-basic.ts` 完整跑通(用 harness 启动,替换直接调 agent-loop)
- [x] commit `736d060`(含 Task 3.5 TD-001 清理)

#### 4.3.4 Task 4:钩子系统(8 核心 + 9 预声明 + 5 语义)⏳

**目标**:实现 `DefaultAgentHarnessHooks` — 与未来扩展系统对接的核心。先实现 8 个核心事件 + 变更语义 + observers/handlers 分离,其余 9 个事件留接口(预声明 + 占位),未来按需启用

**实际产出**:
- `src/harness/hooks/types.ts`(17 个事件类型,296 行)
- `src/harness/hooks/semantics.ts`(5 个语义纯函数,265 行)
- `src/harness/hooks/default-hooks.ts`(`DefaultAgentHarnessHooks` 主类,257 行)
- `src/harness/hooks/default-hooks-state.ts`(内部状态封装,195 行)
- `src/harness/hooks/index.ts`(模块公共 API)
- `src/harness/agent-harness/hooks-bridge.ts`(钩子 ↔ agent-loop 桥接,118 行)
- `examples/07-hooks.ts`(钩子系统演示,370 行)
- `__tests__/harness/hooks/{types,semantics,default-hooks}.test.ts`(87 tests)

**关键设计**:
- **5 种变更语义**:
  1. `runContextSemantics` — context 事件,链式 messages 转换
  2. `runToolCallSemantics` — tool_call 事件,遇 block=true 提前退出
  3. `runToolResultSemantics` — tool_result 事件,累积 4 字段(content / details / isError / terminate)
  4. `runSessionBeforeSemantics` — session_before_* 事件,遇 cancel=true 提前退出
  5. `runFireAndForgetSemantics` — 其他事件,`Promise.all` 并行,忽略返回值
- **派发顺序**:observers 先全部派发(fire-and-forget),再 handlers(走对应语义)
- **8 核心事件 emit 点**(在 `agent-harness.ts`):
  | 事件 | 位置 |
  |------|------|
  | `before_agent_start` | `prompt()` 入口 |
  | `context` | `#executeTurn` 调 `runAgentLoop` 前 |
  | `tool_call` | `hooks-bridge.bridgeBeforeToolCall` |
  | `tool_result` | `hooks-bridge.bridgeAfterToolCall` |
  | `message_end` | runAgentLoop emit sink |
  | `model_update` | `setModel()` 末尾 |
  | `abort` | `abort()` 末尾 |
  | `session_before_compact` | (Task 6 接入) |

**交付标准 (DoD)**:
- [x] `pnpm test` 218 tests pass(Task 1+2+3+4,vitest 17 文件 + tsc 0 错误)
- [x] `examples/07-hooks.ts` 跑通(3 hook 全部触发,tool_call block 成功)
- [x] 所有单文件 < 500 行(最大 `agent-harness.ts` 447 行,含 37 行注释)
- [⬜] 提交 commit `feat(agent): hooks system (8 core events + 9 pre-declared)`(等用户确认 diff 后 commit)

#### 4.3.5 Task 5:Session 双后端 ⬜(下一步)

**目标**:实现 Session 类(树形 entry 管理 + 上下文构建)+ InMemory/JSONL 双后端 + NodeExecutionEnv

**计划产出**:
- `src/harness/session/{types,memory-storage,memory-repo,jsonl-storage,jsonl-repo,repo-utils,session,context-builder}.ts`
- `src/harness/env/{nodejs,env}.ts`
- `__tests__/harness/session/` + `__tests__/harness/env/`
- `examples/03-session.ts`

#### 4.3.6 Task 6:Compaction + 分支摘要 ⬜

**目标**:自动压缩 + 分支摘要,接入 `agent-harness.compact()` / `navigateTree()`

#### 4.3.7 Task 7:Skills + Prompt Templates ⬜

**目标**:可复用能力注入,接入 `agent-harness.skill()` / `promptFromTemplate()` / `setResources()`

#### 4.3.8 Task 8:Queue 队列 ⬜

**目标**:steer / followUp / nextTurn 队列处理,接入 `agent-harness.steer()` / `followUp()` / `nextTurn()`

#### 4.3.9 Task 9:中文文档(5 篇) ⬜

**目标**:写 5 篇核心中文文档 + 用 review checklist 自检

**计划文档**:
- `docs/agent-harness.md` — 生命周期、状态模型、操作阶段、Turn 执行、保存点
- `docs/hooks.md` — 钩子系统设计、事件协议、变更语义、扩展加载
- `docs/session.md` — Session 类、Entry 树、Repo、上下文构建
- `docs/compaction.md` — 压缩 + 分支摘要的完整流程与算法
- `docs/skills-and-templates.md` — Skills 与 Prompt Templates 的使用与规范

#### 4.3.10 Task 10:全量验证 + Phase 02 收尾 ⬜

**目标**:50+ tests pass,8 examples 跑通,Phase 02 收尾 commit

**验证清单**:
- [ ] 跑全量 tests,确认 50+ pass(目标 269 → 300+)
- [ ] 跑全量 examples,确认 8 个全部跑通
- [ ] `tsc --noEmit` 通过
- [ ] `pnpm build` 通过
- [ ] 写实施日志
- [ ] 更新 spec 附录 + 根 spec 状态

---

## 5. 文档与验证方法论

> 参考 `post-training-slot-extractor` 项目的 **Superpowers** 方法论:Brainstorm → Spec → Plan → Execute (TDD) → Log

### 5.1 四层文档体系

```
Phase 文件（战略/架构）
  ↓
Spec 文件（详细设计：Schema、算法、决策表）
  ↓
Plan 文件（可执行任务列表：TDD 步骤、精确代码片段、命令）
  ↓
子 Agent 执行（按 Plan 的 TDD 步骤逐任务实施）
  ↓
Log 文件（复盘：实际发生了什么、问题、教训）
```

| 层次 | 目录 | 内容 | 粒度 |
|------|------|------|------|
| **主方案** | `docs/my-minipi-spec.md` | 整体架构决策、技术选型、接口设计 | 项目级 |
| **Phase 定义** | `docs/superpowers/phase-0X.md` | 该 Phase 的目标、核心合同、DoD | Phase 级 |
| **Spec 设计** | `docs/superpowers/specs/` | 单个组件的详细设计：精确类型定义、数据流、决策表 | 组件级 |
| **Plan 任务** | `docs/superpowers/plans/` | TDD 任务拆解：测试 → 失败 → 实现 → 通过 → 提交 | 任务级 |
| **实施日志** | `docs/project-log/` | 按 Phase 记录：做了什么、遇到什么问题、怎么解决 | 叙事级 |

### 5.2 命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| Phase 文件 | `phase-0X.md` | `phase-01.md` |
| Spec 文件 | `YYYY-MM-DD-phase0X-topic.md` | `2026-07-29-phase01-core-types.md` |
| Plan 文件 | `YYYY-MM-DD-phase0X-topic.md` | `2026-07-29-phase01-scaffold-plan.md` |
| 日志文件 | `project-log/phase-0X-topic/log.md` | `project-log/phase-01-scaffold/log.md` |

### 5.3 测试策略

两层验证:

| 层次 | 工具 | 内容 | 数据 |
|------|------|------|------|
| **单元测试** | vitest | EventStream、auth、provider 查找、消息转换、错误分类、agent-loop 状态机、Session 读写、Compaction token 估算、Hook 协议转换 | 纯逻辑,内存中构造;JSONL 用临时目录 |
| **集成验证** | `examples/*.ts` | 真实 LLM 调用:基础对话、工具调用、Session 持久化、压缩、手动钩子注入、Skills 加载、Prompt templates | mock provider(无需 API key) / 真实 API Key 真实场景 |

### 5.4 每 Phase 完成后的文档更新节奏

1. 更新 `docs/project-log/phase-0X-xxx/log.md`(做了什么、遇到什么问题、怎么解决的)
2. 写 `docs/superpowers/phase-0X.md`(该 Phase 的架构记录)
3. **如果主方案 `my-minipi-spec.md` 的进度落后**(Phase 完成 / 推进但 spec 仍写"已规划"),**回头更新 spec** 标记当前 Phase / Task 状态
4. 实施 Plan 文件每个 Task 完成后,**勾上对应 step 复选框 + 写"Task N 完成备注"**

---

## 6. 待讨论问题

1. ~~项目名?~~ → `@mimi/ai` + `@mimi/agent`,monorepo 根目录 `my-mimipi`
2. ~~发布方式?~~ → monorepo workspaces,`packages/ai`、`packages/agent`...
3. ~~测试策略?~~ → vitest 单元测试 + `examples/*.ts` mock provider 集成(monorepo 阶段)+ 真实 API 端到端
4. ~~TypeBox 版本?~~ → 1.1.38,与 pi 保持一致
5. ~~单文件行数限制?~~ → 500 行软上限,注释不计入(2026-07-30 Task 2 决定)
6. ~~文件拆分原则?~~ → 按"独立类型/独立概念"拆,避免"为对称而拆"(2026-07-30 Task 3 重构,固化到工程原则 § 1.3)
7. ~~重试责任?~~ → Agent 层独占(`runAgentLoop` 内部),AI 层只做错误分类(2026-07-30 决定)

---

## 7. 附录

> **当前状态(2026-07-31)**:Phase 01 完成 ✅ + Phase 02 进行中(4/10 Task 代码完成,Task 4 待 commit,Task 5 下一步)
> - `@mimi/ai`:**51 tests pass**(Phase 01 收尾)
> - `@mimi/agent`:**218 tests pass**(Phase 02 Task 1-4 代码完成,Task 4 等用户确认 diff 后 commit)
> - **总计 269 tests pass** + `tsc -p tsconfig.test.json` 0 错误
> - 详见 `docs/project-log/phase-01-ai-core/log.md` 与(待写)`docs/project-log/phase-02-agent/log.md`

### 7.1 `@mimi/ai` 关键文件索引(Phase 01)

| 文件 | 作用 |
|------|------|
| `packages/ai/src/types.ts` | 核心类型定义(Model / Message / Tool / AssistantMessage / StreamOptions) |
| `packages/ai/src/auth/index.ts` | `envApiKey()` + dotenv 自动加载 |
| `packages/ai/src/provider/index.ts` | Provider 接口 + ModelsImpl + createModels() |
| `packages/ai/src/stream/index.ts` | EventStream 实现(从 pi 原样) |
| `packages/ai/src/api/anthropic.ts` | Anthropic Provider(真实 SDK) |
| `packages/ai/src/api/openai-compat-base.ts` | OpenAI 兼容家族共用基类(`BaseOpenAICompatProvider` + 工具) |
| `packages/ai/src/api/openai.ts` | OpenAI Provider(继承基类) |
| `packages/ai/src/api/deepseek.ts` | DeepSeek Provider(继承基类) |
| `packages/ai/src/utils/transform-messages.ts` | 图片降级 |
| `packages/ai/src/utils/retry.ts` | 错误分类(`isRetryableAssistantError`,供 agent 层判断是否重试) |
| `packages/ai/src/utils/error-body.ts` | 错误规范化(`normalizeProviderError`) |
| `packages/ai/src/utils/assistant-message.ts` | `createErrorAssistantMessage` 辅助函数 |

### 7.2 `@mimi/agent` 关键文件索引(Phase 02,4/10)

> 全部在 `packages/agent/` 下,标注行数为 2026-07-31 实测(`wc -l`)

#### 7.2.0 公共入口

| 文件 | 作用 | 行数 |
|------|------|------|
| `src/index.ts` | 公共 API re-export | 126 |
| `src/harness/index.ts` | harness 模块公共 API | 89 |

#### 7.2.1 公共层(Task 1+2)

| 文件 | 作用 | 行数 |
|------|------|------|
| `src/types.ts` | agent 层共用类型(`AgentContext` / `AgentLoopConfig` / `HookEvent` 幻影结果) | **389** |
| `src/agent-loop.ts` | 公共 API `runAgentLoop` / `agentLoop` + turn 编排 | **447** |
| `src/loop/stream-assistant.ts` | 流式响应 + 错误分类 + 重试 | **203** |
| `src/loop/tool-validation.ts` | 工具参数 schema 验证 | **239** |
| `src/loop/tool-execution.ts` | 工具执行路由入口 | **34** |
| `src/loop/helpers.ts` | 纯函数辅助 | **71** |
| `src/loop/tool-execution/types.ts` | 内部类型(`PreparedToolCall` 等) | **58** |
| `src/loop/tool-execution/{prepare,execute,finalize,truncate,sequential,parallel}.ts` | 工具执行 7 个生命周期文件 | 49 / 95 / 63 / 63 / 78 / 100 / 63 |

#### 7.2.2 AgentHarness(Task 3)

| 文件 | 作用 | 行数 |
|------|------|------|
| `src/harness/agent-harness/agent-harness.ts` | `AgentHarness` 主类(phase 状态机 + 配置管理 + 事件订阅 + abort) | **447** |
| `src/harness/agent-harness/event-bus.ts` | 事件总线(独立类) | 76 |
| `src/harness/agent-harness/helpers.ts` | 纯函数辅助(`buildUserContent` / `extractSessionId`) | 34 |
| `src/harness/phase.ts` | phase 状态机 | 71 |
| `src/harness/errors.ts` | `AgentHarnessError` / `HarnessConfigError` | 45 |
| `src/harness/types/harness.ts` | `Skill` / `PromptTemplate` / `HookEvent` 泛型 | 92 |
| `src/harness/types/events.ts` | `AgentHarnessEvent` 联合 | 22 |
| `src/harness/types/options.ts` | `AgentHarnessOptions` 构造选项 | 122 |
| `src/harness/messages/convert.ts` | `convertToLlm` 主入口 + custom 过滤 | 35 |
| `src/harness/messages/assistant.ts` | `buildAssistantMessage` + content 顺序 | 54 |
| `src/harness/messages/custom.ts` | 自定义消息投影 | 54 |
| `src/harness/system-prompt/index.ts` | 模块公共 API | 6 |
| `src/harness/system-prompt/build.ts` | `buildSystemPrompt` 主入口 | 44 |
| `src/harness/system-prompt/parts.ts` | 各部分拼装 | 58 |
| `src/harness/system-prompt/types.ts` | 内部类型 | 12 |

#### 7.2.3 钩子系统(Task 4)

| 文件 | 作用 | 行数 |
|------|------|------|
| `src/harness/hooks/types.ts` | 17 个事件类型(8 核心 + 9 预声明)+ 公共联合 + `ResultOf` 泛型 + Facade 接口 | **296** |
| `src/harness/hooks/semantics.ts` | 5 个变更语义纯函数 | **265** |
| `src/harness/hooks/default-hooks.ts` | `DefaultAgentHarnessHooks` 主类(observe / on / emit / cleanup) | **257** |
| `src/harness/hooks/default-hooks-state.ts` | 内部状态封装(handlers / observers / cleanups Map) | **195** |
| `src/harness/hooks/index.ts` | 模块公共 API re-export | 72 |
| `src/harness/agent-harness/hooks-bridge.ts` | 钩子 ↔ agent-loop 桥接(`beforeToolCall` / `afterToolCall` 包装) | 118 |

### 7.3 examples 索引

| 包 | 文件 | 状态 | 说明 |
|----|------|------|------|
| `@mimi/ai` | `examples/01-core-types.ts` | ✅ | 类型系统验证 |
| `@mimi/ai` | `examples/02-anthropic-mock.ts` | ✅ | Anthropic 框架(mock,经批准) |
| `@mimi/ai` | `examples/03-deepseek-chat.ts` | ✅ | DeepSeek 真实 API 流式对话 |
| `@mimi/ai` | `examples/04-openai-mock.ts` | ✅ | OpenAI 框架(mock,经批准) |
| `@mimi/ai` | `examples/06-tool-use.ts` | ✅ | 工具调用(DeepSeek 真实 API) |
| `@mimi/ai` | `examples/07-multi-turn.ts` | ✅ | 多轮对话(用户消息 → 工具 → 注入 → 回答) |
| `@mimi/agent` | `examples/01-basic.ts` | ✅ | 用 `AgentHarness` 启动(替换直接调 agent-loop) |
| `@mimi/agent` | `examples/03-session.ts` | ⬜ | Task 5 计划:Session 持久化 + 上下文构建 |
| `@mimi/agent` | `examples/04-compaction.ts` | ⬜ | Task 6 计划:压缩 + 分支摘要 |
| `@mimi/agent` | `examples/05-skills.ts` | ⬜ | Task 7 计划:加载 Skill 到 system prompt |
| `@mimi/agent` | `examples/06-prompt-templates.ts` | ⬜ | Task 7 计划:通过 prompt template 启动 |
| `@mimi/agent` | `examples/07-hooks.ts` | ✅ | Task 4:tool_call 拦截 + context 注入 + observer |
| `@mimi/agent` | `examples/08-custom-messages.ts` | ⬜ | Task 8 计划:声明合并扩展自定义消息类型 |

### 7.4 参考文档

- **pi 项目**:`F:\allProject\githubProject\pi`(我们改造的对象)
- **设计 Spec**(本项目):
  - [`2026-07-29-phase01-ai-core-design.md`](../f:/allProject/githubProject/my-mimipi/docs/superpowers/specs/2026-07-29-phase01-ai-core-design.md) — Phase 01 设计
  - [`2026-07-29-openai-decompose-design.md`](../f:/allProject/githubProject/my-mimipi/docs/superpowers/specs/2026-07-29-openai-decompose-design.md) — OpenAI 拆分设计
  - [`2026-07-30-phase02-agent-design.md`](../f:/allProject/githubProject/my-mimipi/docs/superpowers/specs/2026-07-30-phase02-agent-design.md) — Phase 02 设计(含钩子系统 § 3.4)
  - [`2026-07-30-phase02-engineering-principles.md`](../f:/allProject/githubProject/my-mimipi/docs/superpowers/specs/2026-07-30-phase02-engineering-principles.md) — 工程原则(拆分规则)
  - [`2026-07-30-phase02.5-coding-agent-design.md`](../f:/allProject/githubProject/my-mimipi/docs/superpowers/specs/2026-07-30-phase02.5-coding-agent-design.md) — Phase 03 草案
- **实施 Plan**(本项目):
  - [`2026-07-29-phase01-ai-core-plan.md`](../f:/allProject/githubProject/my-mimipi/docs/superpowers/plans/2026-07-29-phase01-ai-core-plan.md) — Phase 01 实施
  - [`2026-07-29-openai-decompose-plan.md`](../f:/allProject/githubProject/my-mimipi/docs/superpowers/plans/2026-07-29-openai-decompose-plan.md) — OpenAI 拆分实施
  - [`2026-07-30-phase02-agent-plan.md`](../f:/allProject/githubProject/my-mimipi/docs/superpowers/plans/2026-07-30-phase02-agent-plan.md) — Phase 02 实施(Task 1-4 ✅)
- **参考 Spec**(外部):
  - `F:\allProject\githubProject\post-training-slot-extractor\finetune-spec.md` — Superpowers 方法论参考
