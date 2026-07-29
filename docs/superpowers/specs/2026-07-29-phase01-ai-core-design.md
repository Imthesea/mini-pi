# AI 层核心设计 Spec

> 本文档是 my-mimipi 项目 `packages/ai` 的详细技术设计。
> 项目整体方案见根目录 `my-minipi-spec.md`。

## 概述

### 目标

从 pi 项目的 `packages/ai`（~25,000 行，35+ Provider）精简出一个最小化可运行的 AI 层（~1,020 行，3 个 Provider）。

### 核心原则

- **最小化可运行** — 每个组件都能独立跑通
- **无繁杂认证** — 只用环境变量 + .env 文件，不搞 OAuth/QR 码/交互式登录
- **逐层验证** — 每个 Phase 都有 `examples/` 下的可运行样例
- **中文优先** — 注释、文档全部中文；每个类、每个方法至少要有中文注释
- **debug 优先** — 保留 `onPayload`/`onResponse`，错误分类清晰

### 与 pi 的对比

| 维度 | pi `packages/ai` | 本项目 `packages/ai` |
|------|------------------|---------------------|
| 源文件 | ~120+ | 12 |
| Provider | 35+ | 3（Anthropic / OpenAI / DeepSeek） |
| API 实现 | 10 | 2 |
| 认证文件 | ~15 | 1（3 行函数） |
| 依赖 | ~20 runtime | 3 runtime + dotenv |
| 行数 | ~25,000 | ~1,020 |

---

## 1. 技术选型

### 1.1 Provider 选择

| 候选 | 筛选 | 决策 | 理由 |
|------|------|------|------|
| pi 全部 35 个 Provider | 只保留：1) 使用最广的；2) API 形状不同的；3) 有一个 OpenAI 兼容的证明可扩展性 | **Anthropic + OpenAI + DeepSeek** | Anthropic 和 OpenAI 是两大主流 API（Messages vs Completions），形状不同。DeepSeek 证明 OpenAI 兼容模式可零成本扩展 |

**模型列表（初始最小化，每 Provider 1 个）**：

| Provider | 模型 ID | 名称 |
|----------|---------|------|
| anthropic | `claude-sonnet-4-20250514` | Claude Sonnet 4 |
| openai | `gpt-5.5` | GPT-5.5 |
| deepseek | `deepseek-v4-flash` | DeepSeek-V4-Flash |

### 1.2 认证方案

| 决策 | 实现 |
|------|------|
| 认证方式 | 单函数 `envApiKey(envVar)` + `.env` 文件自动加载 |
| 凭证存储 | 无。不持久化，不刷新 |
| 交互式登录 | 无。不弹提示框 |

### 1.3 流式协议

**保留 pi 的 `AssistantMessageEventStream` 原样**（`utils/event-stream.ts`，89 行）。

事件协议：
```
start → text_start → text_delta* → text_end
      → thinking_start → thinking_delta* → thinking_end
      → toolcall_start → toolcall_delta* → toolcall_end
      → done | error
```

### 1.4 工具 Schema

**保留 TypeBox 1.1.38**，与 pi 保持一致，便于后续迁移 agent 层。

### 1.5 运行时

TypeScript 5.9+ / Node.js 22+ / pnpm。

### 1.6 测试策略

| 层次 | 工具 | 内容 | 数据 |
|------|------|------|------|
| **单元测试** | vitest | EventStream、auth、provider 查找、消息转换、错误分类 | 纯逻辑，无外部依赖 |
| **集成验证** | `examples/*.ts` | 真实 API 调用：流式对话、工具调用、多轮对话 | 真实 API Key，真实场景，无 mock |

---

## 2. 目录结构

```
packages/ai/
  package.json              # name: "@mimi/ai", type: "module"
  tsconfig.json
  vitest.config.ts
  .env.example              # 模板，列出需要的环境变量

  src/
    index.ts                # 公共 API 导出 + dotenv 自动加载
    types.ts                # 所有核心类型（Model, Context, Message, Tool 等）
    stream.ts               # EventStream<T,R> + AssistantMessageEventStream（从 pi 原样）
    provider.ts             # Provider 接口 + Models 集合 + createModels()
    auth.ts                 # envApiKey() + dotenv 加载
    utils/
      retry.ts              # isRetryableAssistantError 错误分类
      error-body.ts         # normalizeProviderError 错误规范化
      json-parse.ts         # parseStreamingJson 工具参数流式解析
      text.ts               # contentText 辅助函数
    api/
      anthropic.ts          # Anthropic Messages API 实现 + anthropicProvider()
      openai.ts             # OpenAI Completions API 实现 + openaiProvider() + deepseekProvider()
      transform-messages.ts # 消息规范化（简化版，图片降级）

  src/__tests__/            # vitest 单元测试
    stream.test.ts
    auth.test.ts
    provider.test.ts
    retry.test.ts
    transform-messages.test.ts

  examples/                 # 🔴 集成验证 — 每个 Phase 的真实场景测试
    01-core-types.ts        # Phase 1: 创建类型、使用 EventStream
    02-auth-and-models.ts   # Phase 2: 认证 + Models 集合
    03-anthropic-chat.ts    # Phase 3: Anthropic 流式对话
    04-openai-chat.ts       # Phase 4: OpenAI 流式对话
    05-deepseek-chat.ts     # Phase 5: DeepSeek 流式对话
    06-tool-use.ts          # Phase 6: 带工具调用的对话
    07-multi-turn.ts        # Phase 7: 多轮对话 + 端到端
```

---

## 3. 核心接口设计

### 3.1 类型系统 (`src/types.ts`, ~100 行)

**API 与 Provider 标识**：

```typescript
/** 支持的 API 类型 */
type KnownApi = "anthropic-messages" | "openai-completions";
type Api = KnownApi | (string & {});

/** 支持的 Provider */
type KnownProvider = "anthropic" | "openai" | "deepseek";
type ProviderId = KnownProvider | string;
```

**Model 接口**：

```typescript
/** 统一的模型描述 */
interface Model<TApi extends Api = Api> {
  id: string;              // 模型 ID
  name: string;            // 显示名称
  api: TApi;               // 所属 API 类型
  provider: ProviderId;    // 所属 Provider
  baseUrl: string;         // API 地址
  reasoning: boolean;      // 是否支持深度思考
  input: ("text" | "image")[];   // 支持的输入类型
  cost: ModelCost;         // 价格（$/百万 token）
  contextWindow: number;   // 上下文窗口大小
  maxTokens: number;       // 最大输出 token
}

/** 模型价格（$/百万 token） */
interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
```

**消息系统**：

```typescript
/** 文本内容块 */
interface TextContent {
  type: "text";
  text: string;
}

/** 思考内容块 */
interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

/** 工具调用 */
interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/** 用户消息 */
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

/** 助手消息 */
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: ProviderId;
  model: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}

/** 工具结果消息 */
interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  timestamp: number;
}

/** 统一消息类型 */
type Message = UserMessage | AssistantMessage | ToolResultMessage;

/** 停止原因 */
type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
```

**用量与价格**：

```typescript
/** 用量统计 */
interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}
```

**上下文与工具**：

```typescript
/** 调用上下文 */
interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

/** 工具定义（使用 TypeBox Schema） */
interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
}
```

**流式选项**：

```typescript
/** 流式调用选项 */
interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  apiKey?: string;
  reasoning?: boolean | "low" | "medium" | "high";
  /** 请求发出前的回调：可检查或替换原始请求体，用于 debug */
  onPayload?: (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;
  /** 收到 HTTP 响应后的回调：可检查响应头、状态码等元信息 */
  onResponse?: (response: { status: number; headers: Record<string, string> }, model: Model<Api>) => void | Promise<void>;
}
```

**事件流协议**：

```typescript
/** 流式事件类型 */
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: Exclude<StopReason, "error" | "aborted">; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };
```

### 3.2 事件流 (`src/stream.ts`, ~89 行)

**从 pi 原样保留**。两个类：

```typescript
/**
 * 泛型事件流：支持推送事件、异步迭代、最终结果 Promise。
 * T = 事件类型，R = 最终结果类型
 */
class EventStream<T, R = T> implements AsyncIterable<T> {
  push(event: T): void;
  end(result?: R): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
  result(): Promise<R>;
}

/**
 * LLM 专用事件流。
 * 终端事件为 "done"（成功）或 "error"（失败/中止）。
 * 最终结果为 AssistantMessage。
 */
class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {}
```

### 3.3 Provider 与 Models (`src/provider.ts`, ~80 行)

```typescript
/**
 * Provider 接口：描述一个 AI 提供商的完整能力。
 * 包括模型列表、API Key 获取、流式调用。
 */
interface Provider<TApi extends Api = Api> {
  readonly id: string;
  readonly name: string;
  readonly baseUrl?: string;

  /** 从环境变量读取 API Key，未配置时返回 undefined */
  getApiKey(): string | undefined;

  /** 返回该 Provider 的所有模型（静态列表） */
  getModels(): readonly Model<TApi>[];
  /** 按 ID 查找单个模型 */
  getModel(id: string): Model<TApi> | undefined;

  /** 流式调用模型 */
  stream(model: Model<TApi>, context: Context, options?: StreamOptions): AssistantMessageEventStream;
  /** 非流式调用（收集流的结果） */
  complete(model: Model<TApi>, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
}

/**
 * Models 集合：管理多个 Provider，负责分发请求。
 */
interface Models {
  /** 注册 Provider（有同 ID 的会替换） */
  set(provider: Provider): void;
  /** 移除 Provider */
  remove(id: string): void;

  /** 列出所有已注册的 Provider */
  list(): readonly Provider[];
  /** 按 ID 查找 Provider */
  get(id: string): Provider | undefined;

  /** 获取所有/某个 Provider 的模型列表 */
  getModels(providerId?: string): readonly Model<Api>[];
  /** 精确查找模型 */
  getModel(provider: string, modelId: string): Model<Api> | undefined;

  /** 流式调用：自动根据 model.provider 分发到对应 Provider */
  stream(model: Model<Api>, context: Context, options?: StreamOptions): AssistantMessageEventStream;
  /** 非流式调用 */
  complete(model: Model<Api>, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
}

/** 创建 Models 实例 */
function createModels(): Models;
```

### 3.4 认证 (`src/auth.ts`, ~10 行)

```typescript
/**
 * 从环境变量读取 API Key。
 * 自动加载项目根目录的 .env 文件（通过 dotenv）。
 * 找不到时返回 undefined，由上层 Models.stream() 提供明确错误提示。
 */
export function envApiKey(envVar: string): string | undefined;
```

**入口文件 `src/index.ts` 中自动加载 `.env`**：

```typescript
import dotenv from "dotenv";
dotenv.config(); // 自动加载 packages/ai/.env（如存在）
```

**错误提示示例**：

```
Provider "anthropic" 未配置。
请在 packages/ai/.env 文件中设置 ANTHROPIC_API_KEY=sk-ant-...，
或通过 StreamOptions.apiKey 手动传入。
```

### 3.5 Anthropic API (`src/api/anthropic.ts`, ~250 行)

**消息转换规则**：

| 统一格式 | Anthropic 格式 |
|----------|---------------|
| `UserMessage { content: "hello" }` | `{ role: "user", content: [{ type: "text", text: "hello" }] }` |
| `UserMessage { content: [TextContent, ImageContent] }` | `{ role: "user", content: [{ type: "text", ... }, { type: "image", source: ... }] }` |
| `AssistantMessage { content: [TextContent, ToolCall] }` | `{ role: "assistant", content: [{ type: "text", ... }, { type: "tool_use", ... }] }` |
| `ToolResultMessage { toolCallId, content }` | `{ role: "user", content: [{ type: "tool_result", tool_use_id, content }] }` |

> **注意**：Anthropic 要求 tool_result 放在 `role: "user"` 消息中。

**思考（thinking）参数**：
- `options.reasoning = true` → Anthropic `{ thinking: { type: "enabled", budget_tokens: 16000 } }`
- `options.reasoning = "high"` → 同 enabled
- 未设置 → 不传 thinking 参数

**流式事件映射**：

```
Anthropic SDK 事件                     →  我们的事件
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
message_start                         →  start
content_block_start (text)            →  text_start
content_block_delta (text_delta)      →  text_delta
content_block_stop                    →  text_end
content_block_start (thinking)        →  thinking_start
content_block_delta (thinking_delta)  →  thinking_delta
content_block_stop                    →  thinking_end
content_block_start (tool_use)        →  toolcall_start
content_block_delta (input_json_delta) →  toolcall_delta
content_block_stop                    →  toolcall_end
message_stop                          →  done
error                                 →  error
```

**Provider 导出**：

```typescript
/** 创建 Anthropic Provider 实例 */
export function anthropicProvider(): Provider<"anthropic-messages">;
```

### 3.6 OpenAI + DeepSeek API (`src/api/openai.ts`, ~300 行)

一个文件承载两个 Provider，共享核心实现，通过配置区分。

**消息转换规则**：

| 统一格式 | OpenAI 格式 |
|----------|------------|
| `UserMessage { content: "hello" }` | `{ role: "user", content: "hello" }` |
| `UserMessage { content: [TextContent, ImageContent] }` | `{ role: "user", content: [{ type: "text", ... }, { type: "image_url", ... }] }` |
| `AssistantMessage { content: [TextContent, ToolCall] }` | `{ role: "assistant", content: "...", tool_calls: [...] }` |
| `ToolResultMessage { toolCallId, content }` | `{ role: "tool", tool_call_id: ..., content: "..." }` |

> **与 Anthropic 的关键差异**：OpenAI 的 tool_result 用独立的 `role: "tool"`，不是嵌在 user 里。

**思考参数格式差异**：

| Provider | 参数格式 |
|----------|---------|
| OpenAI | `{ reasoning_effort: "low" | "medium" | "high" }` |
| DeepSeek | `{ thinking: { type: "enabled" } }` |

通过 `reasoningFormat` 配置项区分。

**流式事件映射**：

```
OpenAI SDK 事件 (chat.completions streaming)  →  我们的事件
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
stream 开始                                →  start
chunk.choices[].delta.content              →  text_delta
chunk.choices[].delta.reasoning_content    →  thinking_delta
chunk.choices[].delta.tool_calls[]         →  toolcall_start / toolcall_delta
finish_reason = "stop"                     →  done
finish_reason = "tool_calls"               →  done (reason: "toolUse")
error                                       →  error
```

**Provider 导出**：

```typescript
/** 创建 OpenAI Provider 实例 */
export function openaiProvider(): Provider<"openai-completions">;
/** 创建 DeepSeek Provider 实例（OpenAI 兼容） */
export function deepseekProvider(): Provider<"openai-completions">;
```

### 3.7 消息规范化 (`src/api/transform-messages.ts`, ~60 行)

```typescript
/**
 * 规范化消息列表，供各 API 实现调用。
 * 当前只做一件事：将发送给非视觉模型的图片内容降级为占位文本。
 */
export function transformMessages(messages: Message[], model: Model<Api>): Message[];
```

### 3.8 错误处理 (`src/utils/retry.ts` + `src/utils/error-body.ts`, ~90 行)

**错误分类**：

```typescript
/**
 * 判断错误是否可重试。
 * - 不可重试：配额耗尽、计费问题、权限不足、模型不存在、参数错误
 * - 可重试：  过载、限流、5xx、网络错误、流中断
 */
export function isRetryableAssistantError(error: unknown): boolean;
```

分类规则：

| 不可重试（直接报错） | 可重试（上层 agent 决定） |
|---------------------|--------------------------|
| `insufficient_quota` / 计费问题 | `overloaded` / 过载 |
| `invalid_api_key` / 权限不足 | `rate_limit` / `429` / 限流 |
| `model_not_found` / 模型不存在 | `500` / `502` / `503` / 服务端故障 |
| `invalid_request_error` / 参数错误 | 网络错误 / `ECONNRESET` / `timeout` |
| | 流提前中断 / `connection_error` |

> **重试逻辑不在 AI 层**。AI 层只负责错误分类和报告。重试策略（等待多久、多少次）由后续的 agent 层在 agent loop 中实现。

**错误规范化**：

```typescript
/**
 * 将不同 SDK 的错误统一为 { status?, message, body? } 格式。
 * 用于日志记录和排错。
 */
export function normalizeProviderError(error: unknown): NormalizedError;
```

---

## 4. 依赖

```json
{
  "name": "@mimi/ai",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@anthropic-ai/sdk": "0.91.1",
    "openai": "6.26.0",
    "typebox": "1.1.38",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0",
    "tsx": "^4.22.0",
    "vitest": "^2.0.0"
  }
}
```

| 依赖 | 用途 |
|------|------|
| `@anthropic-ai/sdk` | 调用 Anthropic Messages API |
| `openai` | 调用 OpenAI 和 DeepSeek Chat Completions API |
| `typebox` 1.1.38 | Tool 参数 Schema，与 pi / 后续 agent 层兼容 |
| `dotenv` | 自动加载 `.env` 文件 |
| `vitest` | 单元测试 |
| `tsx` | 直接运行 TypeScript 样例 |

---

## 5. 实施计划

### Phase 概览

```
Phase 1: 项目脚手架 + 核心类型   (无外部依赖，纯类型 + EventStream)
Phase 2: 事件流                  (stream.ts 从 pi 原样)
Phase 3: Provider/Models 框架    (provider.ts + auth.ts，用 mock 验证)
Phase 4: Anthropic API 实现      (需 ANTHROPIC_API_KEY)
Phase 5: OpenAI API 实现         (需 OPENAI_API_KEY)
Phase 6: DeepSeek API 实现       (需 DEEPSEEK_API_KEY)
Phase 7: 集成验证 + 错误处理     (端到端，多轮对话)
```

每个 Phase 的交付：
- `src/` 下对应源文件通过 `vitest` 单元测试
- `examples/` 下对应样例用 `npx tsx` 可真实跑通
- `docs/project-log/` 下的日志记录实施过程
- 该 Phase 通过用户验收后，再进入下一 Phase

### 5.1 Phase 1：项目脚手架 + 核心类型

**目标**：初始化 monorepo，定义所有核心类型

**待创建文件**：
- `package.json`（根目录，workspaces）
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `packages/ai/package.json`
- `packages/ai/tsconfig.json`
- `packages/ai/vitest.config.ts`
- `packages/ai/.env.example`
- `packages/ai/src/types.ts`

**DoD**：
- [ ] `pnpm install` 成功
- [ ] `tsc --noEmit` 零错误
- [ ] `npx tsx examples/01-core-types.ts` 跑通（创建 Model、构建 Context、验 EventStream 空跑）
- [ ] `npx vitest run` 通过

### 5.2 Phase 2：事件流

**目标**：从 pi 原样导入 EventStream + AssistantMessageEventStream

**待创建文件**：
- `packages/ai/src/stream.ts`
- `packages/ai/src/__tests__/stream.test.ts`

**DoD**：
- [ ] `stream.ts` 从 pi 导入并验证编译
- [ ] vitest 测试覆盖 push/iterate/result/end 全路径
- [ ] 样例更新：创建流、push 事件、for await 消费、`.result()` 拿到最终结果

### 5.3 Phase 3：Provider/Models 框架

**目标**：实现 Provider 接口、Models 集合、auth 模块

**待创建文件**：
- `packages/ai/src/auth.ts`
- `packages/ai/src/provider.ts`
- `packages/ai/src/index.ts`
- `packages/ai/src/__tests__/auth.test.ts`
- `packages/ai/src/__tests__/provider.test.ts`

**DoD**：
- [ ] `auth.ts`：`envApiKey()` + dotenv 自动加载
- [ ] `provider.ts`：Provider 接口 + ModelsImpl + createModels()
- [ ] `index.ts`：公共 API 导出
- [ ] vitest 测试覆盖 auth 和 provider
- [ ] 样例 `examples/02-auth-and-models.ts`：用 mock Provider 验证注册/查找/分发流程

### 5.4 Phase 4：Anthropic API 实现

**目标**：实现 Anthropic Messages API 流式调用

**待创建文件**：
- `packages/ai/src/utils/text.ts`
- `packages/ai/src/api/transform-messages.ts`
- `packages/ai/src/api/anthropic.ts`
- `packages/ai/src/__tests__/transform-messages.test.ts`
- `packages/ai/examples/03-anthropic-chat.ts`

**DoD**：
- [ ] 消息格式转换正确（User/Assistant/ToolResult）
- [ ] 流式事件映射正确（text/thinking/toolcall）
- [ ] `onPayload`/`onResponse` 回调正常工作
- [ ] `ANTHROPIC_API_KEY=xxx npx tsx examples/03-anthropic-chat.ts` → 流式输出
- [ ] vitest 测试通过

### 5.5 Phase 5：OpenAI API 实现

**目标**：实现 OpenAI Chat Completions API

**待创建文件**：
- `packages/ai/src/utils/json-parse.ts`
- `packages/ai/src/api/openai.ts`
- `packages/ai/examples/04-openai-chat.ts`

**DoD**：
- [ ] 消息格式转换正确（与 Anthropic 的 tool_result 位置不同）
- [ ] 流式事件映射正确
- [ ] `OPENAI_API_KEY=xxx npx tsx examples/04-openai-chat.ts` → 流式输出
- [ ] vitest 测试通过

### 5.6 Phase 6：DeepSeek API 实现

**目标**：DeepSeek 复用 OpenAI 实现

**修改文件**：`packages/ai/src/api/openai.ts`（新增 `deepseekProvider()`）

**新增文件**：`packages/ai/examples/05-deepseek-chat.ts`

**DoD**：
- [ ] `deepseekProvider()` 导出，baseUrl 指向 DeepSeek
- [ ] reasoning 参数格式使用 DeepSeek 风格（`thinking: { type }`）
- [ ] `DEEPSEEK_API_KEY=xxx npx tsx examples/05-deepseek-chat.ts` → 流式输出

### 5.7 Phase 7：集成验证 + 错误处理

**目标**：端到端验证，工具调用，多轮对话，错误处理

**待创建文件**：
- `packages/ai/src/utils/retry.ts`
- `packages/ai/src/utils/error-body.ts`
- `packages/ai/src/__tests__/retry.test.ts`
- `packages/ai/examples/06-tool-use.ts`
- `packages/ai/examples/07-multi-turn.ts`

**DoD**：
- [ ] `06-tool-use.ts`：定义 Tool（TypeBox），流式调用，模型返回 toolCall，验证参数
- [ ] `07-multi-turn.ts`：用户消息 → 模型回复 → 工具结果 → 继续对话 → 最终回复
- [ ] 错误处理：未设 Key 清晰提示，网络错误分类正确
- [ ] 所有 Provider 的 7 个样例全部可运行
- [ ] `npx vitest run` 全部通过

---

## 6. 删减清单（对比 pi）

| pi 模块 | 处理 | 原因 |
|---------|------|------|
| `auth/` 全部（~15 文件） | **删除**，替换为 3 行 `envApiKey()` + dotenv | 不需要 OAuth/凭证存储/刷新/登录 |
| 35 个 Provider → 3 个 | **删除** 32 个 Provider 文件 + 对应的 API 实现 | 只需要最核心的 3 个 |
| 图像生成（`images*.ts`） | **删除** | 非核心功能 |
| 懒加载 API（`*.lazy.ts`） | **删除** | 3 个 Provider 直接 import 即可 |
| 动态模型刷新（`refreshModels`） | **删除** | 模型静态定义，无需动态发现 |
| 延迟工具（`deferred-tools.ts`） | **删除** | 简化，工具直接全部传入 |
| `CredentialStore`（InMemory + 文件锁） | **删除** | 无持久化凭证 |
| `Models.getAuth/checkAuth/login/logout` | **删除** | 认证简化为每请求读 env |
| `ApiOptionsMap`, `ApiStreamOptions` 泛型 | **删除** | 不再需要跨未知 API 的分发 |
| `OpenAICompletionsCompat` (30+ 字段) | **删除** | 仅内联需要的 3 个字段 |
| `AnthropicMessagesCompat` | **删除** | 仅内联需要的字段 |
| `OpenRouterRouting`, `VercelGatewayRouting` | **删除** | 无 OpenRouter/Vercel |
| `Transport`, `CacheRetention`, `ProviderEnv` | **删除** | 不涉及 |
| `ThinkingLevelMap`, `ThinkingBudgets` | **删除** | 用 boolean/string 替代 |
| `ModelCostTier`（阶梯价格） | **删除** | 简化为 flat rate |
| `TextSignatureV1` | **删除** | OpenAI response metadata 不需要 |
| `ProviderStreams`, `StreamFunction` 类型 | **删除** | 不需要函数类型别名 |
| `calculateCost()`, `getSupportedThinkingLevels()` 等工具函数 | **删除** | 不需要 |
