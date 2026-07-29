# AI 层核心实现计划

> **对于 agentic workers:** 使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 来逐任务实施此计划。步骤使用 `- [ ]` 复选框跟踪。

> **本文档状态（2026-07-29）：历史计划，已完成。**
>
> 本计划是 Phase 01 实施前的初稿。实际实施中发现若干偏差，已通过 Phase 2/3 重构（`commit faffffc` 模块目录化 + `commit 3722301`/`97590e8`/`4c3519b` openai.ts 拆分）修正：
>
> - 单文件 `auth.ts` / `stream.ts` / `provider.ts` → 目录形式 `auth/index.ts` / `stream/index.ts` / `provider/index.ts`
> - `src/api/transform-messages.ts` → `src/utils/transform-messages.ts`
> - `src/api/openai.ts`（承载 OpenAI + DeepSeek）→ 拆分为 `openai.ts` + `deepseek.ts` + 共用基类 `openai-compat-base.ts`
> - `utils/text.ts`（contentText）从未创建，移除
> - examples 文件名变更：`02-auth-and-models` / `03-anthropic-chat` / `04-openai-chat` / `05-deepseek-chat` 实际为 `02-anthropic-mock` / `04-openai-mock` / `03-deepseek-chat` / `06-tool-use` / `07-multi-turn`
> - `ModelsImpl.complete()` 中的重试循环已移出（重试责任在 agent 层）
> - ModelCost / Usage 删除 cacheRead / cacheWrite 字段
>
> 以下各 Task 的代码块为"计划稿"——可能与最终代码有细节差异，以仓库代码与 `docs/project-log/phase-01-ai-core/log.md` 为准。

**目标：** 从零搭建 `@mimi/ai` 包——最小化多 Provider LLM API 层，支持 Anthropic/OpenAI/DeepSeek 流式调用。

**架构：** monorepo（`pnpm workspaces`），先建 `packages/ai`。核心抽象：Provider 接口 → Models 集合 → stream() 分发。类型系统从 pi 精简而来，认证只用 env var + dotenv，事件流原样保留 pi 的 EventStream。

**技术栈：** TypeScript 5.9+ / Node.js 22+ / pnpm / vitest / tsx / Anthropic SDK / OpenAI SDK / TypeBox 1.1.38 / dotenv

## 全局约束

- TypeScript 5.9+，`erasableSyntaxOnly`，ES2022 target，Node16 模块
- **所有注释、文档使用中文**。每个类、每个方法至少要有中文注释说明用途
- **中文优先**：命名可用英文，但注释、README、错误消息全部中文
- vitest 用于单元测试，`examples/*.ts` 用于真实 API 集成验证
- 每个 Task 完成后必须：vitest 通过 + 对应 example 可用 `npx tsx` 跑通
- API Key 从 `.env` 文件 + 环境变量读取，无交互式登录
- 模型列表静态定义，初始每个 Provider 1 个模型
- 保留 `onPayload` / `onResponse` debug 回调

---

### Task 1: Monorepo 脚手架 + 核心类型

**目标**：初始化 pnpm workspace monorepo，定义所有核心 TypeScript 类型。

**产出文件**：
- `package.json`（根目录，workspaces）
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `packages/ai/package.json`
- `packages/ai/tsconfig.json`
- `packages/ai/vitest.config.ts`
- `packages/ai/.env.example`
- `packages/ai/src/types.ts`
- `packages/ai/examples/01-core-types.ts`

**接口约定**：
- 产生：`Model<TApi>`, `Context`, `Message`, `AssistantMessage`, `Tool`, `Usage`, `StopReason`, `StreamOptions`, `AssistantMessageEvent` 等类型（后续所有 Task 依赖）
- 产生：`EventStream<T,R>`, `AssistantMessageEventStream` 类（在 `types.ts` 中 import 自 `stream.ts`，Task 2 创建）

- [ ] **Step 1: 创建根目录 package.json**

```bash
cd F:\allProject\githubProject\my-mimipi
```

创建 `package.json`：
```json
{
  "name": "my-mimipi",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  }
}
```

- [ ] **Step 2: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: 创建 tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "erasableSyntaxOnly": true
  }
}
```

- [ ] **Step 4: 创建 packages/ai/package.json**

```json
{
  "name": "@mimi/ai",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
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

- [ ] **Step 5: 创建 packages/ai/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 6: 创建 packages/ai/vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 7: 创建 packages/ai/.env.example**

```
# Anthropic API Key
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI API Key
OPENAI_API_KEY=sk-...

# DeepSeek API Key
DEEPSEEK_API_KEY=sk-...
```

- [ ] **Step 8: 安装依赖**

```bash
cd F:\allProject\githubProject\my-mimipi
pnpm install
```

- [ ] **Step 9: 创建 packages/ai/src/types.ts**

```typescript
/**
 * AI 层核心类型定义。
 * 从 pi 项目的 types.ts 精简而来，只保留必需的字段和类型。
 */

import type { TSchema } from "typebox";

// ── API / Provider 标识 ──

/** 支持的 API 类型 */
export type KnownApi = "anthropic-messages" | "openai-completions";
export type Api = KnownApi | (string & {});

/** 支持的 Provider */
export type KnownProvider = "anthropic" | "openai" | "deepseek";
export type ProviderId = KnownProvider | string;

// ── 内容块 ──

/** 文本内容块 */
export interface TextContent {
  type: "text";
  text: string;
}

/** 思考内容块（模型的内部推理过程） */
export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

/** 图片内容块 */
export interface ImageContent {
  type: "image";
  data: string;   // base64 编码
  mimeType: string; // "image/jpeg" | "image/png"
}

/** 工具调用块 */
export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
}

// ── 消息 ──

/** 用户消息 */
export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

/** 助手消息 */
export interface AssistantMessage {
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
export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  timestamp: number;
}

/** 统一消息类型 */
export type Message = UserMessage | AssistantMessage | ToolResultMessage;

/** 停止原因 */
export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

// ── 用量 ──

/** 用量统计 */
export interface Usage {
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

/** 模型价格（$/百万 token） */
export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// ── 模型 ──

/** 统一的模型描述 */
export interface Model<TApi extends Api = Api> {
  id: string;              // 模型 ID
  name: string;            // 显示名称
  api: TApi;               // 所属 API 类型
  provider: ProviderId;    // 所属 Provider
  baseUrl: string;         // API 地址
  reasoning: boolean;      // 是否支持深度思考
  input: ("text" | "image")[];   // 支持的输入类型
  cost: ModelCost;         // 价格
  contextWindow: number;   // 上下文窗口大小
  maxTokens: number;       // 最大输出 token
}

// ── 工具 ──

/** 工具定义（使用 TypeBox Schema） */
export interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
}

// ── 上下文 ──

/** 调用上下文 */
export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

// ── 流式选项 ──

/** HTTP 响应信息（用于 debug 回调） */
export interface ProviderResponse {
  status: number;
  headers: Record<string, string>;
}

/** 流式调用选项 */
export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  apiKey?: string;
  reasoning?: boolean | "low" | "medium" | "high";
  /** 请求发出前的回调：可检查或替换原始请求体，用于 debug */
  onPayload?: (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;
  /** 收到 HTTP 响应后的回调：可检查响应头、状态码等元信息 */
  onResponse?: (response: ProviderResponse, model: Model<Api>) => void | Promise<void>;
}

// ── 事件流协议 ──

/** 流式事件类型 */
export type AssistantMessageEvent =
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

- [ ] **Step 10: 编写第一个 example**

创建 `packages/ai/examples/01-core-types.ts`：
```typescript
/**
 * Example 01：核心类型验证。
 * 创建 Model / Context 对象，验证类型系统能正常运转。
 * 无需 API Key。
 */

import type { Model, Context, UserMessage, AssistantMessage } from "../src/types.js";

// 创建模型定义
const model: Model<"anthropic-messages"> = {
  id: "claude-sonnet-4-20250514",
  name: "Claude Sonnet 4",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 3.0, output: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
  contextWindow: 200000,
  maxTokens: 8192,
};

// 创建上下文
const context: Context = {
  systemPrompt: "你是一个有帮助的助手。",
  messages: [
    {
      role: "user",
      content: "你好！",
      timestamp: Date.now(),
    } satisfies UserMessage,
  ],
};

console.log("✅ 模型:", model.name);
console.log("✅ Provider:", model.provider);
console.log("✅ 上下文消息数:", context.messages.length);
console.log("✅ 所有类型检查通过！");
```

- [ ] **Step 11: 编译验证**

```bash
cd F:\allProject\githubProject\my-mimipi\packages\ai
npx tsc --noEmit
```

预期：零错误。

- [ ] **Step 12: 运行 example**

```bash
cd F:\allProject\githubProject\my-mimipi\packages\ai
npx tsx examples/01-core-types.ts
```

预期输出：
```
✅ 模型: Claude Sonnet 4
✅ Provider: anthropic
✅ 上下文消息数: 1
✅ 所有类型检查通过！
```

- [ ] **Step 13: Commit**

```bash
cd F:\allProject\githubProject\my-mimipi
git add -A
git commit -m "feat: Task 1 — monorepo 脚手架 + 核心类型定义

- 初始化 pnpm workspace monorepo
- 创建 @mimi/ai 包
- 从 pi 精简导入核心类型（Model, Context, Message 等）
- 添加 example 01：类型系统验证"
```

---

### Task 2: 事件流

**目标**：从 pi 原样导入 EventStream + AssistantMessageEventStream，添加 vitest 测试。

**产出文件**：
- `packages/ai/src/stream/index.ts`
- `packages/ai/src/__tests__/stream.test.ts`

**接口约定**：
- 产生：`EventStream<T,R>` 类（push, end, result, async iterator）
- 产生：`AssistantMessageEventStream` 类
- 消费：`types.ts`（AssistantMessageEvent, AssistantMessage）

- [ ] **Step 1: 创建 stream.ts（从 pi 原样复制）**

```typescript
/**
 * 泛型事件流：支持推送事件、异步迭代、最终结果 Promise。
 * T = 事件类型，R = 最终结果类型。
 *
 * 从 pi 项目的 utils/event-stream.ts 原样保留。
 */
export class EventStream<T, R = T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiting: ((value: IteratorResult<T>) => void)[] = [];
  private done = false;
  private finalResultPromise: Promise<R>;
  private resolveFinalResult!: (result: R) => void;
  private isComplete: (event: T) => boolean;
  private extractResult: (event: T) => R;

  constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
    this.isComplete = isComplete;
    this.extractResult = extractResult;
    this.finalResultPromise = new Promise((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }

  /** 推送一个事件到流中。如果是终端事件，标记流为完成。 */
  push(event: T): void {
    if (this.done) return;

    if (this.isComplete(event)) {
      this.done = true;
      this.resolveFinalResult(this.extractResult(event));
    }

    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  /** 手动结束流。 */
  end(result?: R): void {
    this.done = true;
    if (result !== undefined) {
      this.resolveFinalResult(result);
    }
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter({ value: undefined as any, done: true });
    }
  }

  /** 异步迭代器：支持 for await...of 消费事件。 */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise<IteratorResult<T>>((resolve) => this.waiting.push(resolve));
        if (result.done) return;
        yield result.value;
      }
    }
  }

  /** 获取最终结果的 Promise。 */
  result(): Promise<R> {
    return this.finalResultPromise;
  }
}

import type { AssistantMessage, AssistantMessageEvent } from "./types.js";

/**
 * LLM 专用事件流。
 * 终端事件为 "done"（成功）或 "error"（失败/中止）。
 * 最终结果为 AssistantMessage。
 */
export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("非法的终端事件类型");
      },
    );
  }
}
```

- [ ] **Step 2: 创建 stream.test.ts**

```typescript
/**
 * EventStream 和 AssistantMessageEventStream 的单元测试。
 */
import { describe, it, expect } from "vitest";
import { EventStream, AssistantMessageEventStream } from ;
import type { AssistantMessage } from "../types.js";

describe("EventStream", () => {
  it("推送事件后可以异步迭代消费", async () => {
    const stream = new EventStream<number, number>(
      (n) => n === 999,  // 999 是终端标记
      (n) => n,
    );

    stream.push(1);
    stream.push(2);
    stream.push(999);  // 终端

    const received: number[] = [];
    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toEqual([1, 2, 999]);
  });

  it("通过 result() 获取最终结果", async () => {
    const stream = new EventStream<string, string>(
      (s) => s.startsWith("DONE:"),
      (s) => s.slice(5),  // 去掉 "DONE:" 前缀
    );

    stream.push("hello");
    stream.push("DONE:world");

    const result = await stream.result();
    expect(result).toBe("world");
  });

  it("手动 end() 结束流", async () => {
    const stream = new EventStream<string, string>(
      () => false,
      () => "never",
    );

    stream.push("a");
    stream.end("manual_result");

    const received: string[] = [];
    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toEqual(["a"]);
    expect(await stream.result()).toBe("manual_result");
  });

  it("done 后再 push 不会影响 result", async () => {
    const stream = new EventStream<number, number>(
      (n) => n > 0,
      (n) => n,
    );

    stream.push(1);  // 终端
    stream.push(2);  // 被忽略

    expect(await stream.result()).toBe(1);
  });
});

describe("AssistantMessageEventStream", () => {
  it("done 事件返回 message，error 事件返回 error", async () => {
    const stream = new AssistantMessageEventStream();

    // 测试 done
    const doneMsg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      api: "anthropic-messages" as const,
      provider: "anthropic",
      model: "claude",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    const stream1 = new AssistantMessageEventStream();
    stream1.push({ type: "done", reason: "stop", message: doneMsg });
    expect(await stream1.result()).toBe(doneMsg);

    // 测试 error
    const errorMsg: AssistantMessage = {
      ...doneMsg,
      stopReason: "error",
      errorMessage: "网络错误",
    };

    const stream2 = new AssistantMessageEventStream();
    stream2.push({ type: "error", reason: "error", error: errorMsg });
    expect(await stream2.result()).toBe(errorMsg);
  });
});
```

- [ ] **Step 3: 运行测试验证失败（如果 stream.ts 尚未创建）**

如果 stream.ts 已创建，直接运行：
```bash
cd F:\allProject\githubProject\my-mimipi\packages\ai
npx vitest run src/__tests__/stream.test.ts
```

预期：全部 PASS。

- [ ] **Step 4: Commit**

```bash
cd F:\allProject\githubProject\my-mimipi
git add -A
git commit -m "feat: Task 2 — EventStream 事件流实现

- 从 pi 原样导入 EventStream<T,R> + AssistantMessageEventStream
- 添加 vitest 单元测试（push/iterate/result/end 全路径）"
```

---

### Task 3: 认证 + Provider/Models 框架

**目标**：实现 auth.ts、provider.ts、index.ts 入口。用 mock Provider 验证框架正确性。

**产出文件**：
- `packages/ai/src/auth.ts`
- `packages/ai/src/provider.ts`
- `packages/ai/src/index.ts`
- `packages/ai/src/__tests__/auth.test.ts`
- `packages/ai/src/__tests__/provider.test.ts`
- `packages/ai/examples/02-anthropic-mock.ts`（原计划 02-auth-and-models.ts，移至 Task 4 实施）

**接口约定**：
- 产生：`envApiKey(envVar)` 函数
- 产生：`Provider<TApi>` 接口
- 产生：`Models` 接口
- 产生：`createModels()` 工厂
- 产生：`ModelsError` 错误类
- 消费：`types.ts`（Model, Context, StreamOptions, AssistantMessageEventStream）
- 消费：`stream.ts`（AssistantMessageEventStream）
- 消费：`auth.ts`（envApiKey）

- [ ] **Step 1: 创建 auth.ts**

```typescript
/**
 * 认证模块 —— 整个模块只有一个函数。
 * 从环境变量读取 API Key，自动加载 .env 文件。
 * 不存储凭证、不刷新 token、不弹登录框。
 */

import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 加载 packages/ai/.env 文件（如果存在）
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config(); // 回退到当前工作目录的 .env
}

/**
 * 从环境变量读取 API Key。
 * 找不到时返回 undefined，由上层提供错误提示。
 */
export function envApiKey(envVar: string): string | undefined {
  const value = process.env[envVar];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
}
```

- [ ] **Step 2: 创建 auth.test.ts**

```typescript
/**
 * envApiKey 的单元测试。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { envApiKey } from "../auth/index.js";

describe("envApiKey", () => {
  const VAR = "TEST_MIMI_API_KEY";

  beforeEach(() => {
    delete process.env[VAR];
  });

  afterEach(() => {
    delete process.env[VAR];
  });

  it("环境变量存在时返回其值", () => {
    process.env[VAR] = "test-key-123";
    expect(envApiKey(VAR)).toBe("test-key-123");
  });

  it("环境变量不存在时返回 undefined", () => {
    expect(envApiKey(VAR)).toBeUndefined();
  });

  it("环境变量为空字符串时返回 undefined", () => {
    process.env[VAR] = "   ";
    expect(envApiKey(VAR)).toBeUndefined();
  });

  it("自动 trim 首尾空格", () => {
    process.env[VAR] = "  key-with-spaces  ";
    expect(envApiKey(VAR)).toBe("key-with-spaces");
  });
});
```

- [ ] **Step 3: 创建 provider.ts**

```typescript
/**
 * Provider 接口与 Models 集合。
 * 这是 AI 层的核心框架——管理多个 AI 提供商，分发流式请求。
 */

import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  StreamOptions,
} from "./types.js";
import { envApiKey } from "./auth.js";

// ── 错误类 ──

/** Models 操作错误 */
export class ModelsError extends Error {
  code: "auth" | "provider" | "stream";

  constructor(code: "auth" | "provider" | "stream", message: string) {
    super(message);
    this.name = "ModelsError";
    this.code = code;
  }
}

// ── Provider 接口 ──

/**
 * Provider 接口：描述一个 AI 提供商的完整能力。
 * 包括模型列表、API Key 获取、流式调用。
 * 每个 API 实现模块（api/anthropic.ts, api/openai.ts）返回符合此接口的对象。
 */
export interface Provider<TApi extends Api = Api> {
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

// ── Models 接口 ──

/**
 * Models 集合：管理多个 Provider，负责分发请求。
 * 上层（agent 层）通过此接口使用 AI 能力，不需要知道具体 Provider 的存在。
 */
export interface Models {
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

// ── 实现 ──

/**
 * Models 接口的具体实现。
 * 内部用一个 Map<string, Provider> 管理 Provider 注册表。
 */
class ModelsImpl implements Models {
  private providers = new Map<string, Provider>();

  set(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  remove(id: string): void {
    this.providers.delete(id);
  }

  list(): readonly Provider[] {
    return Array.from(this.providers.values());
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  getModels(providerId?: string): readonly Model<Api>[] {
    if (providerId !== undefined) {
      const entry = this.providers.get(providerId);
      if (!entry) return [];
      try {
        return entry.getModels() as Model<Api>[];
      } catch {
        return [];
      }
    }
    const models: Model<Api>[] = [];
    for (const entry of this.providers.values()) {
      try {
        models.push(...(entry.getModels() as Model<Api>[]));
      } catch {
        // 异常 Provider 跳过
      }
    }
    return models;
  }

  getModel(provider: string, modelId: string): Model<Api> | undefined {
    return (this.getModels(provider) as Model<Api>[]).find((m) => m.id === modelId);
  }

  stream(model: Model<Api>, context: Context, options?: StreamOptions): AssistantMessageEventStream {
    const provider = this.providers.get(model.provider);
    if (!provider) {
      throw new ModelsError("provider", `未知的 Provider: ${model.provider}`);
    }

    const apiKey = options?.apiKey ?? provider.getApiKey();
    if (!apiKey) {
      throw new ModelsError(
        "auth",
        `Provider "${model.provider}" 未配置。请在 packages/ai/.env 文件中设置对应的 API Key，或通过 StreamOptions.apiKey 手动传入。`,
      );
    }

    return provider.stream(model, context, { ...options, apiKey });
  }

  async complete(model: Model<Api>, context: Context, options?: StreamOptions): Promise<AssistantMessage> {
    return this.stream(model, context, options).result();
  }
}

/**
 * 创建 Models 集合实例。
 * 这是 AI 层的主入口——上层代码通过此函数获取 Models，然后注册 Provider、发起调用。
 */
export function createModels(): Models {
  return new ModelsImpl();
}
```

- [ ] **Step 4: 创建 provider.test.ts**

```typescript
/**
 * Provider 与 Models 的单元测试（使用 mock Provider，无需 API Key）。
 */
import { describe, it, expect } from "vitest";
import { createModels, ModelsError } from "../provider/index.js";
import type { Provider, Models } from "../provider/index.js";
import { AssistantMessageEventStream } from "../stream/index.js";
import type { Api, Model, Context, StreamOptions } from "../types.js";

/** 创建一个 mock Provider 用于测试 */
function mockProvider(): Provider<Api> {
  const models: Model<Api>[] = [{
    id: "mock-model",
    name: "Mock Model",
    api: "anthropic-messages" as const,
    provider: "mock",
    baseUrl: "https://mock.example.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  }];

  return {
    id: "mock",
    name: "Mock Provider",
    baseUrl: "https://mock.example.com",
    getApiKey: () => "mock-key-123",
    getModels: () => models,
    getModel: (id) => models.find((m) => m.id === id),
    stream: (model, context, options) => {
      const stream = new AssistantMessageEventStream();
      // 模拟返回一条消息
      setTimeout(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: {
            role: "assistant",
            content: [{ type: "text", text: `mock response to: ${context.messages.length} messages` }],
            api: "anthropic-messages",
            provider: "mock",
            model: model.id,
            usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop",
            timestamp: Date.now(),
          },
        });
      }, 0);
      return stream;
    },
    complete: async (model, context, options) => {
      return (await this.stream(model, context, options)).result();
    },
  };
}

describe("Models", () => {
  it("可以注册和查找 Provider", () => {
    const models = createModels();
    const provider = mockProvider();

    models.set(provider);
    expect(models.list()).toHaveLength(1);
    expect(models.get("mock")).toBe(provider);
  });

  it("set() 相同 ID 会替换", () => {
    const models = createModels();
    const p1 = mockProvider();
    const p2 = mockProvider(); // 同 ID

    models.set(p1);
    models.set(p2);
    expect(models.list()).toHaveLength(1);
  });

  it("remove() 可以删除 Provider", () => {
    const models = createModels();
    models.set(mockProvider());
    models.remove("mock");
    expect(models.list()).toHaveLength(0);
  });

  it("getModels() 返回所有模型", () => {
    const models = createModels();
    models.set(mockProvider());

    const allModels = models.getModels();
    expect(allModels).toHaveLength(1);
    expect(allModels[0].id).toBe("mock-model");
  });

  it("getModel() 精确查找", () => {
    const models = createModels();
    models.set(mockProvider());

    const found = models.getModel("mock", "mock-model");
    expect(found?.id).toBe("mock-model");

    const notFound = models.getModel("mock", "nonexistent");
    expect(notFound).toBeUndefined();
  });

  it("通过 mock Provider 完成流式调用", async () => {
    const models = createModels();
    const provider = mockProvider();
    models.set(provider);

    const model = models.getModel("mock", "mock-model")!;
    const result = await models.complete(model, {
      messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    });

    expect(result.stopReason).toBe("stop");
    expect(result.content[0]).toHaveProperty("type", "text");
    expect((result.content[0] as any).text).toContain("mock response");
  });

  it("Provider 未注册时报错", () => {
    const models = createModels();
    const badModel: Model<Api> = {
      id: "nonexistent",
      name: "Bad",
      api: "anthropic-messages" as const,
      provider: "nonexistent",
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 0,
      maxTokens: 0,
    };

    expect(() => models.stream(badModel, {
      messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
    })).toThrow(ModelsError);
  });
});
```

- [ ] **Step 5: 创建 index.ts**

```typescript
/**
 * @mimi/ai —— 最小化多 Provider LLM API 层。
 *
 * 使用方式：
 *   import { createModels, anthropicProvider, openaiProvider, deepseekProvider } from "@mimi/ai";
 *   const models = createModels();
 *   models.set(anthropicProvider());
 *   models.set(openaiProvider());
 *   const result = await models.complete(model, context);
 */

// 核心框架
export { createModels } from "./provider/index.js";
export type { Provider, Models } from "./provider/index.js";
export { ModelsError } from "./provider/index.js";

// 事件流
export { EventStream, AssistantMessageEventStream } from "./stream.js";

// 认证
export { envApiKey } from "./auth.js";

// 类型（全部 re-export）
export type * from "./types.js";
```

- [ ] **Step 6: 创建 examples/02-anthropic-mock.ts**（原计划 02-auth-and-models.ts，后调整为 Anthropic 框架 mock 演示，移至 Task 4 实施）

```typescript
/**
 * Example 02：认证 + Models 框架验证。
 * 使用 mock Provider 验证注册、查找、分发流程。
 * 无需 API Key。
 */

import { createModels } from "../src/provider.js";
import { AssistantMessageEventStream } from "../src/stream.js";
import { envApiKey } from "../src/auth.js";
import type { Provider, Models } from "../src/provider.js";
import type { Api, Model, Context } from "../src/types.js";

// ── 构建 mock Provider ──
function createMockProvider(): Provider<Api> {
  const models: Model<Api>[] = [{
    id: "mock-1",
    name: "Mock Model",
    api: "anthropic-messages",
    provider: "mock",
    baseUrl: "https://mock.example.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 256,
  }];

  return {
    id: "mock",
    name: "Mock Provider",
    getApiKey: () => undefined,
    getModels: () => models,
    getModel: (id) => models.find((m) => m.id === id),
    stream: (model, context, options) => {
      const stream = new AssistantMessageEventStream();
      stream.push({
        type: "start",
        partial: {
          role: "assistant",
          content: [],
          api: "anthropic-messages",
          provider: "mock",
          model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      });
      setTimeout(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: {
            role: "assistant",
            content: [{ type: "text", text: `Mock 响应——你问了 ${context.messages.length} 条消息` }],
            api: "anthropic-messages",
            provider: "mock",
            model: model.id,
            usage: { input: 5, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 8, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop",
            timestamp: Date.now(),
          },
        });
      }, 10);
      return stream;
    },
    complete: async (model, context, options) => {
      return (await this.stream(model, context, options)).result();
    },
  };
}

// ── 主流程 ──
console.log("=== Example 02: 认证 + Models 框架验证 ===\n");

// 1. 检查环境变量
const hasAnthropic = envApiKey("ANTHROPIC_API_KEY");
const hasOpenAI = envApiKey("OPENAI_API_KEY");
const hasDeepSeek = envApiKey("DEEPSEEK_API_KEY");
console.log(`环境变量状态:`);
console.log(`  ANTHROPIC_API_KEY: ${hasAnthropic ? "✅ 已设置" : "⚠️ 未设置（示例 03 需要）"}`);
console.log(`  OPENAI_API_KEY:    ${hasOpenAI ? "✅ 已设置" : "⚠️ 未设置（示例 04 需要）"}`);
console.log(`  DEEPSEEK_API_KEY:  ${hasDeepSeek ? "✅ 已设置" : "⚠️ 未设置（示例 05 需要）"}`);
console.log();

// 2. 创建 Models 集合，注册 mock Provider
const models = createModels();
models.set(createMockProvider());
console.log(`✅ 已注册 ${models.list().length} 个 Provider`);

// 3. 查找模型
const mockModel = models.getModel("mock", "mock-1");
console.log(`✅ 找到模型: ${mockModel?.name} (${mockModel?.provider}/${mockModel?.id})`);

// 4. 流式调用
console.log("\n📡 流式调用 mock Provider:\n");
const stream = models.stream(mockModel!, {
  messages: [{ role: "user", content: "Hello!", timestamp: Date.now() }],
});

for await (const event of stream) {
  if (event.type === "start") console.log("  [流开始]");
  else if (event.type === "done") {
    const text = event.message.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
    console.log(`  [完成] ${text}`);
  }
}

console.log("\n✅ Mock Provider 流式调用成功！");
```

- [ ] **Step 7: 运行 vitest 测试**

```bash
cd F:\allProject\githubProject\my-mimipi\packages\ai
npx vitest run
```

预期：全部 PASS。

- [ ] **Step 8: 运行 example**

```bash
cd F:\allProject\githubProject\my-mimipi\packages\ai
npx tsx examples/02-anthropic-mock.ts
```

预期输出：Anthropic 框架 mock 流程演示成功。

- [ ] **Step 9: Commit**

```bash
cd F:\allProject\githubProject\my-mimipi
git add -A
git commit -m "feat: Task 3 — 认证 + Provider/Models 框架

- auth.ts: envApiKey() + dotenv .env 自动加载
- provider.ts: Provider 接口 + Models 集合 + createModels()
- index.ts: 公共 API 导出
- vitest 测试 + example 02 验证"
```

---

### Task 4: Anthropic API 实现

**目标**：实现 Anthropic Messages API 流式调用。这是第一个需要真实 API Key 的 Task。

**产出文件**：
- `packages/ai/src/utils/transform-messages.ts`（原计划 `api/transform-messages.ts`，Phase 2 重构时迁移）
- `packages/ai/src/api/anthropic.ts`
- `packages/ai/src/__tests__/transform-messages.test.ts`
- `packages/ai/examples/02-anthropic-mock.ts`（原计划 03-anthropic-chat.ts，后调整为 mock 框架演示）

**接口约定**：
- 产生：`anthropicProvider(): Provider<"anthropic-messages">`
- 产生：`transformMessages(messages, model)` 消息规范化
- 消费：`types.ts`, `stream/index.ts`, `provider/index.ts`, `auth/index.ts`, `utils/transform-messages.ts`

- [ ] **Step 1: 创建 utils/transform-messages.ts**（原 `api/transform-messages.ts`，不再单独建 utils/text.ts —— contentText 实际未被消费）

```typescript
/**
 * 注：原计划在此 Step 创建 utils/text.ts（contentText 辅助函数），实际未创建
 * —— 重构阶段评估 contentText 无消费方，移除以减少代码体积。
 * 如未来需要再补建。
 */

- [ ] **Step 2: 创建 utils/transform-messages.ts**（原 `api/transform-messages.ts`，Phase 2 重构时移入 utils）

```typescript
/**
 * 消息规范化：将统一格式的 Message 列表做预处理。
 * 目前只做图片降级——非视觉模型会将图片替换为占位文本。
 */

import type { Message, Model, Api } from "../types.js";

/**
 * 规范化消息列表，供各 API 实现调用。
 * 非视觉模型的图片内容会被替换为 "[图片]" 占位文本。
 */
export function transformMessages(messages: Message[], model: Model<Api>): Message[] {
  // 如果模型支持图片，不做任何处理
  if (model.input.includes("image")) return messages;

  // 非视觉模型：图片降级为占位文本
  return messages.map((msg) => {
    if (msg.role !== "user") return msg;
    if (typeof msg.content === "string") return msg;

    const hasImage = msg.content.some((c) => c.type === "image");
    if (!hasImage) return msg;

    return {
      ...msg,
      content: msg.content.map((c) => {
        if (c.type === "image") return { type: "text" as const, text: "[图片]" };
        return c;
      }),
    };
  });
}
```

- [ ] **Step 3: 创建 transform-messages.test.ts**

```typescript
/**
 * transformMessages 的单元测试。
 */
import { describe, it, expect } from "vitest";
import { transformMessages } from "../utils/transform-messages.js";
import type { Model, Message } from "../types.js";

const visionModel: Model<"anthropic-messages"> = {
  id: "claude-vision",
  name: "Claude Vision",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

const textOnlyModel: Model<"anthropic-messages"> = {
  ...visionModel,
  id: "text-only",
  input: ["text"],
};

describe("transformMessages", () => {
  it("视觉模型保留图片内容不变", () => {
    const messages: Message[] = [{
      role: "user",
      content: [{ type: "image", data: "base64...", mimeType: "image/png" }],
      timestamp: 0,
    }];

    const result = transformMessages(messages, visionModel);
    expect(result[0]).toBe(messages[0]); // 同一个引用
  });

  it("非视觉模型将图片替换为 [图片] 占位符", () => {
    const messages: Message[] = [{
      role: "user",
      content: [{ type: "text", text: "看这张图:" }, { type: "image", data: "base64...", mimeType: "image/png" }],
      timestamp: 0,
    }];

    const result = transformMessages(messages, textOnlyModel);
    const content = (result[0] as any).content;
    expect(content[0]).toEqual({ type: "text", text: "看这张图:" });
    expect(content[1]).toEqual({ type: "text", text: "[图片]" });
  });

  it("纯文本消息不变", () => {
    const messages: Message[] = [{
      role: "user",
      content: "hello",
      timestamp: 0,
    }];

    const result = transformMessages(messages, textOnlyModel);
    expect(result[0]).toBe(messages[0]);
  });
});
```

- [ ] **Step 4: 创建 api/anthropic.ts**

```typescript
/**
 * Anthropic Messages API 实现。
 * 将统一格式转换为 Anthropic SDK 格式，流式事件映射回我们的事件协议。
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageCreateParams,
  MessageParam,
  ContentBlock,
  RawMessageStreamEvent,
  Tool,
} from "@anthropic-ai/sdk/resources/messages.mjs";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  Provider,
  StreamOptions,
  ToolCall,
} from "../types.js";
import { AssistantMessageEventStream } from "../stream/index.js";
import { envApiKey } from "../auth/index.js";
import { transformMessages } from "./transform-messages.js";

// ── 模型列表 ──

/** Anthropic 模型列表 */
const ANTHROPIC_MODELS: Record<string, Model<"anthropic-messages">> = {
  "claude-sonnet-4-20250514": {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3.0, output: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
};

// ── 消息转换 ──

/** 将统一格式的消息转换为 Anthropic 格式 */
function convertMessages(messages: Context["messages"]): MessageParam[] {
  const result: MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content });
      } else {
        const blocks: ContentBlock[] = msg.content.map((c) => {
          if (c.type === "text") return { type: "text" as const, text: c.text };
          if (c.type === "image") {
            return {
              type: "image" as const,
              source: { type: "base64" as const, media_type: c.mimeType as any, data: c.data },
            };
          }
          return { type: "text" as const, text: "" };
        });
        result.push({ role: "user", content: blocks });
      }
    } else if (msg.role === "assistant") {
      // Anthropic 要求 tool_use 和 text 放在同一消息的 content 数组中
      result.push({
        role: "assistant",
        content: msg.content.map((c) => {
          if (c.type === "text") return { type: "text" as const, text: c.text };
          if (c.type === "thinking") return { type: "text" as const, text: c.thinking };
          if (c.type === "toolCall") {
            return {
              type: "tool_use" as const,
              id: c.id,
              name: c.name,
              input: c.arguments,
            };
          }
          return { type: "text" as const, text: "" };
        }),
      });
    } else if (msg.role === "toolResult") {
      // Anthropic：tool_result 必须放在 user 消息中
      result.push({
        role: "user",
        content: [{
          type: "tool_result" as const,
          tool_use_id: msg.toolCallId,
          content: msg.content.map((c) => (c.type === "text" ? c.text : "")).join(""),
          is_error: msg.isError,
        }],
      });
    }
  }

  return result;
}

/** 将 TypeBox Tool 转换为 Anthropic 格式 */
function convertTools(tools: Context["tools"]): Tool[] {
  if (!tools) return [];
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: JSON.parse(JSON.stringify(t.parameters)),
  }));
}

// ── 流式实现 ──

/** 创建 Anthropic Provider 实例 */
export function anthropicProvider(): Provider<"anthropic-messages"> {
  return {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",

    getApiKey: () => envApiKey("ANTHROPIC_API_KEY"),

    getModels: () => Object.values(ANTHROPIC_MODELS),
    getModel: (id) => ANTHROPIC_MODELS[id],

    stream(model, context, options) {
      return anthropicStream(model, context, options);
    },

    async complete(model, context, options) {
      return this.stream(model, context, options).result();
    },
  };
}

/** Anthropic 流式调用的核心实现 */
function anthropicStream(
  model: Model<"anthropic-messages">,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const apiKey = options?.apiKey ?? envApiKey("ANTHROPIC_API_KEY");

  if (!apiKey) {
    stream.push({
      type: "error",
      reason: "error",
      error: createErrorAssistantMessage(model, "Provider \"anthropic\" 未配置。请设置 ANTHROPIC_API_KEY 环境变量。"),
    });
    return stream;
  }

  const client = new Anthropic({ apiKey });

  // 规范化消息
  const messages = transformMessages(context.messages, model);

  // 构建请求参数
  const params: MessageCreateParams = {
    model: model.id,
    max_tokens: options?.maxTokens ?? model.maxTokens,
    system: context.systemPrompt,
    messages: convertMessages(messages),
    tools: convertTools(context.tools),
  };

  // thinking 参数
  if (options?.reasoning) {
    (params as any).thinking = { type: "enabled", budget_tokens: 16000 };
  }

  // onPayload debug 回调
  (async () => {
    try {
      // debug: 让上层检查请求体
      if (options?.onPayload) {
        await options.onPayload(params, model);
      }

      // 创建初始 partial
      const initialPartial: AssistantMessage = {
        role: "assistant",
        content: [],
        api: "anthropic-messages",
        provider: "anthropic",
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };

      const sdkStream = client.messages.stream(params);

      // onResponse debug 回调（SDK 流不直接暴露原始 HTTP 响应，这里简化处理）
      if (options?.onResponse) {
        await options.onResponse({ status: 200, headers: {} }, model);
      }

      // 跟踪当前正在构建的 content 块索引
      let contentIndex = 0;
      let currentContent: any = null;

      for await (const event of sdkStream) {
        switch (event.type) {
          case "message_start":
            stream.push({ type: "start", partial: { ...initialPartial, timestamp: Date.now() } });
            break;

          case "content_block_start":
            currentContent = event.content_block;
            if (event.content_block.type === "text") {
              stream.push({ type: "text_start", contentIndex, partial: { ...initialPartial } });
            } else if (event.content_block.type === "thinking") {
              stream.push({ type: "thinking_start", contentIndex, partial: { ...initialPartial } });
            } else if (event.content_block.type === "tool_use") {
              stream.push({ type: "toolcall_start", contentIndex, partial: { ...initialPartial } });
            }
            break;

          case "content_block_delta":
            if (event.delta.type === "text_delta") {
              stream.push({ type: "text_delta", contentIndex, delta: event.delta.text, partial: { ...initialPartial } });
            } else if (event.delta.type === "thinking_delta") {
              stream.push({ type: "thinking_delta", contentIndex, delta: event.delta.thinking, partial: { ...initialPartial } });
            } else if (event.delta.type === "input_json_delta") {
              stream.push({ type: "toolcall_delta", contentIndex, delta: event.delta.partial_json, partial: { ...initialPartial } });
            }
            break;

          case "content_block_stop":
            if (currentContent?.type === "text") {
              stream.push({ type: "text_end", contentIndex, content: (currentContent as any).text ?? "", partial: { ...initialPartial } });
            } else if (currentContent?.type === "thinking") {
              stream.push({ type: "thinking_end", contentIndex, content: (currentContent as any).thinking ?? "", partial: { ...initialPartial } });
            } else if (currentContent?.type === "tool_use") {
              const tc = currentContent as any;
              stream.push({
                type: "toolcall_end",
                contentIndex,
                toolCall: { type: "toolCall", id: tc.id, name: tc.name, arguments: tc.input ?? {} },
                partial: { ...initialPartial },
              });
            }
            contentIndex++;
            currentContent = null;
            break;

          case "message_delta":
            // 更新 usage
            initialPartial.usage.output = event.usage.output_tokens;
            break;

          case "message_stop":
            // 收集最终内容
            const finalContent = await sdkStream.finalMessage();
            const finalMsg = await collectAnthropicResult(model, finalContent, initialPartial.usage);
            stream.push({ type: "done", reason: "stop", message: finalMsg });
            break;

          case "error":
            stream.push({
              type: "error",
              reason: "error",
              error: createErrorAssistantMessage(model, `Anthropic 流错误: ${JSON.stringify(event.error)}`),
            });
            break;
        }
      }
    } catch (error: any) {
      stream.push({
        type: "error",
        reason: "error",
        error: createErrorAssistantMessage(model, `Anthropic 请求失败: ${error.message ?? error}`),
      });
    }
  })();

  return stream;
}

/** 收集 Anthropic 最终结果，转换为 AssistantMessage */
async function collectAnthropicResult(
  model: Model<"anthropic-messages">,
  finalMessage: any,
  usage: AssistantMessage["usage"],
): Promise<AssistantMessage> {
  const content: AssistantMessage["content"] = [];

  for (const block of finalMessage.content ?? []) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      content.push({
        type: "toolCall",
        id: block.id,
        name: block.name,
        arguments: block.input ?? {},
      });
    } else if (block.type === "thinking") {
      content.push({ type: "thinking", thinking: block.thinking });
    }
  }

  // 计算成本
  const inputCost = (model.cost.input / 1_000_000) * usage.input;
  const outputCost = (model.cost.output / 1_000_000) * usage.output;
  usage.cost = { input: inputCost, output: outputCost, cacheRead: 0, cacheWrite: 0, total: inputCost + outputCost };

  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: model.id,
    usage,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/** 创建错误 AssistantMessage */
function createErrorAssistantMessage(model: Model<Api>, errorMessage: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  };
}
```

- [ ] **Step 5: 创建 examples/02-anthropic-mock.ts**（原计划 03-anthropic-chat.ts，后调整为 mock 框架演示）

```typescript
/**
 * Example 03: Anthropic 流式对话。
 * 需要设置 ANTHROPIC_API_KEY 环境变量或 .env 文件。
 *
 * 运行：ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/02-anthropic-mock.ts（mock 模式无需 key）
 */

import { createModels } from "../src/provider.js";
import { anthropicProvider } from "../src/api/anthropic.js";

const models = createModels();
models.set(anthropicProvider());

const model = models.getModel("anthropic", "claude-sonnet-4-20250514");
if (!model) {
  console.error("❌ 找不到模型");
  process.exit(1);
}

console.log("=== Example 03: Anthropic 流式对话 ===\n");
console.log(`模型: ${model.name}`);
console.log(`用户: 法国的首都是哪里？\n`);

const stream = models.stream(model, {
  systemPrompt: "用中文简短回答。",
  messages: [{ role: "user", content: "法国的首都是哪里？", timestamp: Date.now() }],
  // debug 回调
  onPayload: (payload) => {
    console.log(`[DEBUG] 请求体 keys: ${Object.keys(payload as any).join(", ")}`);
    return undefined; // 不修改请求
  },
  onResponse: (response) => {
    console.log(`[DEBUG] 响应状态: ${response.status}`);
  },
});

console.log("📡 流式响应:\n");
let fullText = "";

for await (const event of stream) {
  switch (event.type) {
    case "start":
      process.stdout.write("  ");
      break;
    case "text_delta":
      process.stdout.write(event.delta);
      fullText += event.delta;
      break;
    case "thinking_delta":
      process.stdout.write(`[思考: ${event.delta.slice(0, 30)}...]`);
      break;
    case "done":
      console.log(`\n\n✅ 完成 (${event.message.usage.output} output tokens)`);
      console.log(`费用: $${event.message.usage.cost.total.toFixed(6)}`);
      break;
    case "error":
      console.error(`\n❌ 错误: ${event.error.errorMessage}`);
      break;
  }
}
```

- [ ] **Step 6: 更新 index.ts，导出 anthropicProvider**

```typescript
// 在 index.ts 末尾添加：
export { anthropicProvider } from "./api/anthropic.js";
```

- [ ] **Step 7: 运行 vitest**

```bash
cd F:\allProject\githubProject\my-mimipi\packages\ai
npx vitest run
```

预期：全部 PASS（Task 3 和 Task 4 的测试）。

- [ ] **Step 8: 类型检查**

```bash
cd F:\allProject\githubProject\my-mimipi\packages\ai
npx tsc --noEmit
```

预期：零错误。

- [ ] **Step 9: 运行 example（需要真实 API Key；如使用 mock 模式无需 key）**

```bash
cd F:\allProject\githubProject\my-mimipi\packages\ai
$env:ANTHROPIC_API_KEY="sk-ant-..."  # PowerShell 设置环境变量
npx tsx examples/02-anthropic-mock.ts  # mock 模式，或 examples/03-deepseek-chat.ts（需 DEEPSEEK_API_KEY）演示真实流式
```

预期：流式输出 "法国首都巴黎" 相关内容。

- [ ] **Step 10: Commit**

```bash
cd F:\allProject\githubProject\my-mimipi
git add -A
git commit -m "feat: Task 4 — Anthropic Messages API 实现

- api/anthropic.ts: 消息转换 + 流式事件映射 + anthropicProvider()
- utils/transform-messages.ts: 消息规范化（图片降级）
- example 03: Anthropic 真实流式对话验证"
```

（后续 Task 5-7 将在下一步继续编写...）
