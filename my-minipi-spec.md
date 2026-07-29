# Mimipi — AI 层简化改造方案

> Status: Draft v0.1
> Owner: TBD
> Last updated: 2026-07-29

---

## 前言

本文档是对 **pi 项目** (`F:\allProject\githubProject\pi`) 做减法改造的设计方案。目标是去掉繁杂的认证、35+ 个 Provider、OAuth 流程等重型设施，保留核心的 AI 层抽象，打造一个最小化可运行的 Agent 项目基础。

改造策略：**逐层推进**。先从 AI 层（最底层）开始，保证该层每个组件都有可运行的样例，验证通过后再往上做 agent 层、coding-agent 层、TUI 层。

---

## 1. 项目背景

### 1.1 为什么要简化 pi？

pi 是一个功能完善的四层 Agent CLI 项目，但它面向的是"通用 CLI 工具"场景，导致：
- **认证过重**：支持 API Key + OAuth（设备码、PKCE 回调服务器、凭证刷新），大多数场景只需要环境变量
- **Provider 过多**：~35 个 Provider，维护成本高，大多数用户只用 2-3 个
- **耦合过深**：各层之间有复杂的依赖和事件系统，不利于理解和二次开发

### 1.2 目标

打造一个**自己的 Agent 项目**，核心原则：
- **最小化可运行** — 每个组件都能独立跑通
- **无繁杂认证** — 只用环境变量，不搞 QR 码/OAuth/交互式登录
- **逐层验证** — 先做 AI 层，跑通样例；再做 agent 层，跑通样例...
- **架构清晰** — 保留 pi 的核心抽象模式，去掉非必要的复杂度
- **中文优先** — 注释、文档全部中文；每个类、每个方法至少要有中文注释说明用途

### 1.3 pi 原始架构回顾

```
pi 项目 (4 层 monorepo)：

┌─────────────────────────────────────────┐
│  coding-agent  (CLI 入口, 会话管理)      │  ← 后面再做
├─────────────────────────────────────────┤
│  agent         (Agent 运行时, 工具循环)   │  ← 后面再做
├─────────────────────────────────────────┤
│  ai            (统一多 Provider LLM API) │  ← 第一期：先做这层
├─────────────────────────────────────────┤
│  tui           (终端 UI 库)              │  ← 后面再做
└─────────────────────────────────────────┘
```

### 1.4 AI 层的核心抽象（pi 中需要保留的部分）

pi 的 AI 层有四个核心概念，这是我们要保留和简化的：

| 概念 | 说明 | pi 中的文件 |
|------|------|------------|
| **类型系统** | Model, Context, Message, Tool, AssistantMessage 等统一类型 | `types.ts` |
| **Provider 接口** | 描述一个 AI 提供商：模型列表 + 认证 + 流式调用 | `models.ts` (Provider interface) |
| **Models 集合** | 管理多个 Provider，解析认证，分发请求 | `models.ts` (Models interface) |
| **事件流** | 统一的流式事件协议 | `utils/event-stream.ts` |

### 1.5 AI 层中要删减的部分

| 删减内容 | 原因 |
|----------|------|
| OAuth 全部实现（~7 个文件） | 只要环境变量 |
| CredentialStore（文件存储 + 锁） | 不需要持久化凭证 |
| 35 个 Provider → 3 个 | 只保留 Anthropic / OpenAI / DeepSeek |
| 图像生成（images.ts 等） | 不是核心功能 |
| 懒加载 API（*.lazy.ts） | 直接导入，不需要按需加载 |
| 动态模型刷新（refreshModels） | 模型列表静态定义 |
| 延迟工具（deferred-tools.ts） | 简化，工具直接传入 |
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
my-mimipi/
  package.json              # root: workspaces monorepo
  tsconfig.base.json        # 共享 tsconfig
  pnpm-workspace.yaml       # workspace 配置
  README.md

  packages/
    ai/                     # 第一期：AI 层（就是现在要做的）
      package.json          # name: "@mimi/ai", type: "module"
      tsconfig.json
      src/
        index.ts            # 公共 API 导出
        types.ts            # 所有核心类型
        stream.ts           # EventStream + AssistantMessageEventStream (从 pi 原样保留)
        provider.ts         # Provider 接口 + Models 集合 + createModels
        auth.ts             # envApiKey() — 3 行，整个认证模块
        utils/
          retry.ts          # isRetryableAssistantError (简化版)
          error-body.ts     # normalizeProviderError (简化版)
          json-parse.ts     # parseStreamingJson (工具参数流式解析)
          text.ts           # contentText 辅助函数
        api/
          anthropic.ts      # Anthropic Messages API + anthropicProvider()
          openai.ts         # OpenAI Completions API + openaiProvider() + deepseekProvider()
          transform-messages.ts
      examples/
        01-core-types.ts    # Phase 1: 创建类型、使用 EventStream
        02-auth-and-models.ts
        03-anthropic-chat.ts
        04-openai-chat.ts
        05-deepseek-chat.ts
        06-tool-use.ts
        07-multi-turn.ts

    agent/                  # 第二期：Agent 运行时（后面再做）
    coding-agent/           # 第三期：CLI + TUI（后面再做）

  docs/                     # 📝 项目级文档
    superpowers/
      specs/                # 组件级详细设计
      plans/                # TDD 任务拆解
    project-log/            # 实施日志
```

### 2.8 依赖

| 依赖 | 用途 |
|------|------|
| `@anthropic-ai/sdk` | 调用 Anthropic Messages API |
| `openai` | 调用 OpenAI 和 DeepSeek（兼容）Chat Completions API |
| `typebox` | Tool 参数 Schema 类型，与 agent 层兼容 |
| `typescript` + `tsx` + `@types/node` + `vitest` | 开发、运行、测试 |

---

## 3. 详细设计

### 3.1 核心类型 (`types.ts`)

（待展开：Model, Context, Message, Tool, AssistantMessage, StreamOptions 等接口定义）

### 3.2 事件流 (`stream.ts`)

（待展开：EventStream 类的接口和实现要点）

### 3.3 Provider 与 Models (`provider.ts`)

（待展开：Provider 接口精简版、Models 接口精简版、createModels 工厂）

### 3.4 认证 (`auth.ts`)

（待展开：envApiKey 的单函数实现）

### 3.5 API 实现 — Anthropic (`api/anthropic.ts`)

（待展开：如何调用 Anthropic Messages API，消息和工具的格式转换）

### 3.6 API 实现 — OpenAI + DeepSeek (`api/openai.ts`)

（待展开：OpenAI Completions API，两个 Provider 共用实现，通过 baseUrl + env var 区分）

### 3.7 消息规范化 (`api/transform-messages.ts`)

（待展开：简化版，只做图片降级）

### 3.8 错误处理 (`utils/retry.ts` + `utils/error-body.ts`)

（待展开：错误分类、重试判断）

---

## 4. 实施规划

### 4.1 总体阶段

```
Phase 1: 项目脚手架 + 核心类型    (无 API 依赖)
Phase 2: 事件流                    (无 API 依赖)
Phase 3: Provider/Models 框架      (无 API 依赖，用 mock 验证)
Phase 4: Anthropic API 实现        (需 ANTHROPIC_API_KEY)
Phase 5: OpenAI API 实现           (需 OPENAI_API_KEY)
Phase 6: DeepSeek API 实现         (需 DEEPSEEK_API_KEY)
Phase 7: 集成验证 + 样例           (端到端)
```

### 4.2 Phase 1：项目脚手架 + 核心类型

**目标**：初始化 TypeScript 项目，定义所有核心类型

**新建文件**：`package.json`, `tsconfig.json`, `src/types.ts`

**交付标准 (DoD)**：
- [ ] `package.json` + `tsconfig.json` 配置完成，`tsc --noEmit` 通过
- [ ] `types.ts` 定义完成：Model, Context, Message, Tool, AssistantMessage, StreamOptions, 事件类型
- [ ] 样例 `examples/01-core-types.ts`：创建 Model 对象、构建 Context、验类型

### 4.3 Phase 2：事件流

**目标**：实现 EventStream 类，支持推送事件和异步迭代

**新建文件**：`src/stream.ts`

**交付标准 (DoD)**：
- [ ] `EventStream<T, R>` 泛型类实现（从 pi 原样复制）
- [ ] `AssistantMessageEventStream` 实现
- [ ] 样例：创建流 → push 事件 → for await 消费 → `.result()` 拿到最终结果

### 4.4 Phase 3：Provider/Models 框架

**目标**：实现 Provider 接口、Models 集合

**新建文件**：`src/auth.ts`, `src/provider.ts`, `src/index.ts`

**交付标准 (DoD)**：
- [ ] `auth.ts`：`envApiKey()` 单函数
- [ ] `provider.ts`：Provider 接口 + ModelsImpl + createModels()
- [ ] `index.ts`：公共 API 导出
- [ ] 样例 `examples/02-auth-and-models.ts`：注册 mock Provider、查找模型、验证 auth 流程

### 4.5 Phase 4：Anthropic API 实现

**目标**：实现 Anthropic Messages API 的流式调用

**新建文件**：`src/api/transform-messages.ts`, `src/api/anthropic.ts`, `src/utils/text.ts`

**交付标准 (DoD)**：
- [ ] `api/anthropic.ts`：anthropicProvider() + stream 实现
- [ ] 消息格式转换（统一 Message → Anthropic MessageParam）
- [ ] 工具格式转换（TypeBox Schema → Anthropic Tool）
- [ ] 流式事件映射（Anthropic SDK 事件 → AssistantMessageEvent）
- [ ] 样例 `examples/03-anthropic-chat.ts`：`ANTHROPIC_API_KEY=xxx npx tsx ...` → 流式输出

### 4.6 Phase 5：OpenAI API 实现

**目标**：实现 OpenAI Chat Completions API

**新建文件**：`src/api/openai.ts`, `src/utils/json-parse.ts`

**交付标准 (DoD)**：
- [ ] `api/openai.ts`：openaiProvider() + stream 实现
- [ ] 消息格式转换（统一 Message → OpenAI ChatCompletionMessageParam）
- [ ] 样例 `examples/04-openai-chat.ts`：`OPENAI_API_KEY=xxx npx tsx ...` → 流式输出

### 4.7 Phase 6：DeepSeek API 实现

**目标**：DeepSeek 复用 OpenAI 实现，只改 baseUrl 和 env var

**修改文件**：`src/api/openai.ts`（新增 deepseekProvider()）

**交付标准 (DoD)**：
- [ ] `deepseekProvider()` 导出，baseUrl 指向 `https://api.deepseek.com`
- [ ] 样例 `examples/05-deepseek-chat.ts`：`DEEPSEEK_API_KEY=xxx npx tsx ...` → 流式输出

### 4.8 Phase 7：集成验证

**目标**：端到端验证，三种 Provider + 工具调用 + 多轮对话

**新建文件**：`examples/06-tool-use.ts`, `examples/07-multi-turn.ts`, `src/utils/retry.ts`, `src/utils/error-body.ts`

**交付标准 (DoD)**：
- [ ] `06-tool-use.ts`：定义天气查询 Tool → 流式调用 → 模型返回 toolCall → 验证参数正确
- [ ] `07-multi-turn.ts`：用户消息 → 模型回复 → 工具结果 → 继续对话 → 最终回复
- [ ] 错误处理完善：未设置 API Key 时给出清晰提示，网络错误可重试
- [ ] 所有示例 `npx tsx` 直接运行，无交互式认证

---

## 5. 文档与验证方法论

> 参考 `post-training-slot-extractor` 项目的 **Superpowers** 方法论：Brainstorm → Spec → Plan → Execute (TDD) → Log

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

两层验证：

| 层次 | 工具 | 内容 | 数据 |
|------|------|------|------|
| **单元测试** | vitest | EventStream、auth、provider 查找、消息转换、错误分类 | 纯逻辑，无外部依赖 |
| **集成验证** | `examples/*.ts` | 真实 API 调用：Anthropic / OpenAI / DeepSeek 流式对话、工具调用、多轮对话 | 真实 API Key，真实场景，无 mock |

### 5.4 每 Phase 完成后的文档更新节奏

1. 更新 `docs/project-log/phase-0X-xxx/log.md`（做了什么、遇到什么问题、怎么解决的）
2. 写 `docs/superpowers/phase-0X.md`（该 Phase 的架构记录）
3. 如果实施中发现了方案问题，回头更新 `docs/my-minipi-spec.md`

---

## 6. 待讨论问题

1. ~~项目名？~~ → `@mimi/ai`，monorepo 根目录 `my-mimipi`
2. ~~发布方式？~~ → monorepo workspaces，`packages/ai`、`packages/agent`...
3. ~~测试策略？~~ → vitest 单元测试 + `examples/*.ts` 真实场景
4. ~~TypeBox 版本？~~ → 1.1.38，与 pi 保持一致

---

## 6. 附录

### 6.1 pi 项目关键文件索引

| 文件 | 作用 |
|------|------|
| `packages/ai/src/types.ts` | 核心类型定义 |
| `packages/ai/src/models.ts` | Provider/Models/CreateProvider |
| `packages/ai/src/utils/event-stream.ts` | EventStream 实现 |
| `packages/ai/src/auth/helpers.ts` | envApiKeyAuth |
| `packages/ai/src/providers/anthropic.ts` | Anthropic Provider 工厂 |
| `packages/ai/src/api/anthropic-messages.ts` | Anthropic API 实现 |

### 6.2 参考文档

- pi 项目: `F:\allProject\githubProject\pi`
- 参考 Spec: `F:\allProject\githubProject\post-training-slot-extractor\finetune-spec.md`
