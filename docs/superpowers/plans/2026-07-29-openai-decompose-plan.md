# openai.ts 拆分实现计划

> **本文档状态（2026-07-29）：历史计划，4 个 Task 全部已完成。** Commits: `3722301` (Task 1) / `97590e8` (Task 2) / `4c3519b` (Task 3+4)。所有 checkbox 已勾选，验证清单已通过。
>
> 以下代码块保留"计划稿"原样，便于追溯思路；如需看最终实现，以仓库代码为准。

> **对于 agentic workers:** 使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 来逐任务实施此计划。步骤使用 `- [ ]` 复选框跟踪。

**目标：** 把 `packages/ai/src/api/openai.ts` (496 行) 拆为抽象基类 + OpenAI/DeepSeek 两个独立子类文件,公共 API 签名零变化。

**架构：** 新增 `openai-compat-base.ts` 承载 `BaseOpenAICompatProvider` 抽象类与所有 OpenAI 兼容家族共用工具函数;`openai.ts` 缩为 `OpenAIProvider`(~48 行);新增 `deepseek.ts` 为 `DeepSeekProvider`(~30 行)。子 Provider 通过 `super(config)` 注入差异点(模型列表、baseUrl、envVar、reasoning 格式)。

**技术栈：** TypeScript 5.9+ / vitest / pnpm / OpenAI SDK 6.26 / TypeBox 1.1.38

**参考规格：** [2026-07-29-openai-decompose-design.md](file:///f:/allProject/githubProject/my-mimipi/docs/superpowers/specs/2026-07-29-openai-decompose-design.md)

---

## 全局约束

- **每个 Task 完成后必须**:`pnpm tsc --noEmit` 零错误 + `pnpm vitest run` 全绿
- **每 Task 一次 commit**,commit 信息遵循仓库现有风格(`feat:` / `refactor:` / `docs:` 前缀)
- **本次纯重构,不改任何行为** —— 所有测试与 examples 在每 Task 之后必须仍能通过
- **注释中文优先**,新文件顶部用中文说明模块职责
- **公共 API 零变化**:`openaiProvider()` / `deepseekProvider()` 函数签名和 `Provider<"openai-completions">` 接口契约不变

---

## 文件改动总览

| 文件 | 任务 | 性质 |
|------|------|------|
| `packages/ai/src/api/openai-compat-base.ts` | Task 1 | 新增 |
| `packages/ai/src/api/openai.ts` | Task 1, 3, 4 | 增量修改 → 最终精简 |
| `packages/ai/src/api/deepseek.ts` | Task 2 | 新增 |
| `packages/ai/src/index.ts` | Task 2 | 微调(改 1 行) |
| `packages/ai/src/__tests__/openai-messages.test.ts` | Task 4 | 微调(改 1 行) |

---

### Task 1: 抽离 `openai-compat-base.ts`

**目标:** 把 `openai.ts` 里所有 OpenAI 兼容家族共用的代码搬到新文件,加上 `BaseOpenAICompatProvider` 抽象类。`openai.ts` 改为 re-export 自新文件,保持向后兼容。

**文件:**
- 新增:`packages/ai/src/api/openai-compat-base.ts`
- 修改:`packages/ai/src/api/openai.ts`

- [ ] **Step 1: 创建 `openai-compat-base.ts`,搬入共用类型与函数**

文件顶部加中文模块说明:
```typescript
/**
 * OpenAI Chat Completions 兼容家族的共用基类与工具。
 *
 * 抽离自 `api/openai.ts`：原文件同时承载 OpenAI 和 DeepSeek 两个 Provider,
 * 共用代码隐藏在一个工厂函数 config 字段里,语义边界不清。
 * 本模块把这些共用部分(类型扩展、消息转换、流式核心、buildAssistantMessage)
 * 集中到抽象基类 `BaseOpenAICompatProvider`,子类通过 super(config) 注入差异点。
 *
 * 后续扩展:任何 OpenAI 兼容 Provider (如 moonshot / qwen) 都可继承本基类。
 */
```

复制以下内容到新文件:
1. `ExtendedChatParams` 类型
2. `StreamDelta` 类型
3. `mapOpenAIFinishReason` 函数(export 保留)
4. `_convertMessages` 函数(export 保留)
5. `convertTools` 函数(export 保留)
6. `openAICompatibleStream` 函数(export 保留)
7. `buildAssistantMessage` 函数(export 保留)
8. 新增 `OpenAICompatConfig` interface

`OpenAICompatConfig` 定义(取代原 `OpenAICompatibleConfig`):
```typescript
/** OpenAI 兼容 Provider 的配置。子类通过 super() 传入。 */
export interface OpenAICompatConfig {
  id: string;
  name: string;
  baseUrl: string;
  envVar: string;
  /** reasoning 参数格式:"openai" 用 reasoning_effort,"deepseek" 用 thinking.type */
  reasoningFormat: "openai" | "deepseek";
  models: Record<string, Model<"openai-completions">>;
}
```

所有 import 从 `../types.js` 等相对路径改为相对 `openai-compat-base.ts` 的路径(导入路径不变,仍为 `../types.js` 等)。

- [ ] **Step 2: 在 `openai-compat-base.ts` 末尾添加 `BaseOpenAICompatProvider` 抽象类**

```typescript
/**
 * OpenAI Chat Completions 兼容 Provider 的抽象基类。
 *
 * 子类需在 super() 中传入 OpenAICompatConfig,基类负责:
 * - id / name / baseUrl 字段派生
 * - getApiKey / getModels / getModel 实现
 * - stream() 委托给 openAICompatibleStream
 * - complete() 委托给 defaultComplete
 *
 * 子类不需 override 任何方法,只需提供 config。
 */
export abstract class BaseOpenAICompatProvider implements Provider<"openai-completions"> {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;

  constructor(protected readonly config: OpenAICompatConfig) {
    this.id = config.id;
    this.name = config.name;
    this.baseUrl = config.baseUrl;
  }

  getApiKey = (): string | undefined => envApiKey(this.config.envVar);

  getModels = (): readonly Model<"openai-completions">[] =>
    Object.values(this.config.models) as Model<"openai-completions">[];

  getModel = (id: string): Model<"openai-completions"> | undefined =>
    this.config.models[id];

  stream(model: Model<"openai-completions">, context: Context, options?: StreamOptions) {
    return openAICompatibleStream(this.config, model, context, options);
  }

  async complete(model: Model<"openai-completions">, context: Context, options?: StreamOptions) {
    return defaultComplete(this, model, context, options);
  }
}
```

确保 import 语句顶部包含:
```typescript
import type { Provider } from "../provider/index.js";
import { defaultComplete } from "../provider/index.js";
```

- [ ] **Step 3: 改造 `openai.ts` 为 re-export 转发层**

删除 `openai.ts` 里搬走的代码(类型扩展、所有函数、原始 factory),改为:

```typescript
/**
 * OpenAI Provider 实现。
 * 共用代码见 `./openai-compat-base.js`,本文件仅承载 OpenAI 特有配置。
 * 后续扩展:DeepSeek 已拆为独立文件 `./deepseek.js`。
 */

export {
  mapOpenAIFinishReason,
  _convertMessages,
  openAICompatibleStream,
  BaseOpenAICompatProvider,
  type OpenAICompatConfig,
} from "./openai-compat-base.js";

import OpenAI from "openai";
import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions/completions.js";
import type { Model } from "../types.js";
import { BaseOpenAICompatProvider, type OpenAICompatConfig } from "./openai-compat-base.js";

/** OpenAI 模型列表 */
const OPENAI_MODELS: Record<string, Model<"openai-completions">> = {
  "gpt-5.5": {
    id: "gpt-5.5",
    name: "GPT-5.5",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 2.5, output: 10.0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
};

class OpenAIProvider extends BaseOpenAICompatProvider {
  constructor() {
    const config: OpenAICompatConfig = {
      id: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      envVar: "OPENAI_API_KEY",
      reasoningFormat: "openai",
      models: OPENAI_MODELS,
    };
    super(config);
  }
}

/**
 * 创建 OpenAI Provider 实例。
 */
export function openaiProvider(): Provider<"openai-completions"> {
  return new OpenAIProvider();
}
```

> **注意:** `openai.ts` 仍保留 `DEEPSEEK_MODELS` 和 `deepseekProvider()` —— Task 2 才删。本次只搬共用部分。

- [ ] **Step 4: 运行 tsc 检查**

```bash
cd f:\allProject\githubProject\my-mimipi\packages\ai
pnpm tsc --noEmit
```

预期: 零错误(可能因重复导出有警告,关注 error)。

- [ ] **Step 5: 运行 vitest 验证现有测试仍通过**

```bash
pnpm vitest run
```

预期: 55/55 通过(测试仍指向 `api/openai.js`,re-export 保持兼容)。

- [ ] **Step 6: Commit**

```bash
cd f:\allProject\githubProject\my-mimipi
git add packages/ai/src/api/openai-compat-base.ts packages/ai/src/api/openai.ts
git commit -m 'refactor(ai): 抽离 openai-compat-base — 抽象基类承载共用逻辑'
```

---

### Task 2: 新建 `deepseek.ts`

**目标:** 把 `openai.ts` 里的 DeepSeek 相关代码拆出到独立 `deepseek.ts` 文件。

**文件:**
- 新增:`packages/ai/src/api/deepseek.ts`
- 修改:`packages/ai/src/api/openai.ts`(删除 `DEEPSEEK_MODELS` 和 `deepseekProvider`)
- 修改:`packages/ai/src/index.ts`(改 `deepseekProvider` 导入来源)

- [ ] **Step 1: 创建 `deepseek.ts`**

```typescript
/**
 * DeepSeek Provider 实现(OpenAI 兼容接口)。
 * 共用代码见 `./openai-compat-base.js`,本文件仅承载 DeepSeek 特有配置。
 *
 * 与 OpenAI 的差异:
 * - baseUrl: https://api.deepseek.com
 * - envVar: DEEPSEEK_API_KEY
 * - reasoning 格式: thinking.type = "enabled" (非 reasoning_effort)
 */

import type { Provider } from "../provider/index.js";
import type { Model } from "../types.js";
import { BaseOpenAICompatProvider, type OpenAICompatConfig } from "./openai-compat-base.js";

/** DeepSeek 模型列表 */
const DEEPSEEK_MODELS: Record<string, Model<"openai-completions">> = {
  "deepseek-v4-flash": {
    id: "deepseek-v4-flash",
    name: "DeepSeek-V4-Flash",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0.14, output: 0.28 },
    contextWindow: 128000,
    maxTokens: 8192,
  },
};

class DeepSeekProvider extends BaseOpenAICompatProvider {
  constructor() {
    const config: OpenAICompatConfig = {
      id: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      envVar: "DEEPSEEK_API_KEY",
      reasoningFormat: "deepseek",
      models: DEEPSEEK_MODELS,
    };
    super(config);
  }
}

/**
 * 创建 DeepSeek Provider 实例(OpenAI 兼容接口)。
 */
export function deepseekProvider(): Provider<"openai-completions"> {
  return new DeepSeekProvider();
}
```

- [ ] **Step 2: 从 `openai.ts` 删除 `DEEPSEEK_MODELS` 和 `deepseekProvider`**

删除:
- `DEEPSEEK_MODELS` 常量(整块)
- `deepseekProvider()` 工厂函数
- 文件顶部中文注释中"DeepSeek Provider 也在这个文件中"那句(因为不再如此)

- [ ] **Step 3: 更新 `src/index.ts` 的导入来源**

把:
```typescript
export { openaiProvider, deepseekProvider } from "./api/openai.js";
```

改为:
```typescript
export { openaiProvider } from "./api/openai.js";
export { deepseekProvider } from "./api/deepseek.js";
```

- [ ] **Step 4: 运行 tsc + vitest 验证**

```bash
cd f:\allProject\githubProject\my-mimipi\packages\ai
pnpm tsc --noEmit
pnpm vitest run
```

预期: 零错误 + 55/55 通过。

- [ ] **Step 5: 跑 DeepSeek example 确认端到端**

```bash
npx tsx examples/03-deepseek-chat.ts
```

预期: 流式输出正常,无 import 错误(DEEPSEEK_API_KEY 未配置时输出 auth 错误也算正常,关键是代码能跑)。

- [ ] **Step 6: Commit**

```bash
cd f:\allProject\githubProject\my-mimipi
git add packages/ai/src/api/deepseek.ts packages/ai/src/api/openai.ts packages/ai/src/index.ts
git commit -m 'refactor(ai): 拆出 deepseek.ts — DeepSeek Provider 独立文件'
```

---

### Task 3: 精简 `openai.ts` 为纯子类实现

**目标:** `openai.ts` 不再 re-export 共用符号(已没人引用),只保留 `OPENAI_MODELS` + `OpenAIProvider` + `openaiProvider()`。

**文件:**
- 修改:`packages/ai/src/api/openai.ts`

- [ ] **Step 1: 清理 `openai.ts` 的 re-export 块**

删除:
```typescript
export {
  mapOpenAIFinishReason,
  _convertMessages,
  openAICompatibleStream,
  BaseOpenAICompatProvider,
  type OpenAICompatConfig,
} from "./openai-compat-base.js";
```

清理无用 import:`OpenAI` (sdk)、`ChatCompletionFunctionTool`、`ChatCompletionMessageParam`、`ChatCompletionTool` 等 SDK 类型都不再需要。

最终 `openai.ts` 应只剩:
- 文件顶部中文模块说明
- `OPENAI_MODELS` 常量
- `OpenAIProvider` 类
- `openaiProvider()` 工厂函数

预期行数 ~30 行。

- [ ] **Step 2: 运行 tsc + vitest 验证**

```bash
cd f:\allProject\githubProject\my-mimipi\packages\ai
pnpm tsc --noEmit
pnpm vitest run
```

预期: 零错误 + 55/55 通过。

- [ ] **Step 3: Commit**

```bash
cd f:\allProject\githubProject\my-mimipi
git add packages/ai/src/api/openai.ts
git commit -m 'refactor(ai): 精简 openai.ts — 移除 re-export,只保留 OpenAI 特有代码'
```

---

### Task 4: 更新测试 import 路径 + 全量验证

**目标:** 把 `__tests__/openai-messages.test.ts` 的导入路径从 `../api/openai.js` 改为 `../api/openai-compat-base.js`(因为测的是共用工具,搬到哪就指哪)。

**文件:**
- 修改:`packages/ai/src/__tests__/openai-messages.test.ts`

- [ ] **Step 1: 更新 import 路径**

把:
```typescript
import { _convertMessages, mapOpenAIFinishReason } from "../api/openai.js";
```

改为:
```typescript
import { _convertMessages, mapOpenAIFinishReason } from "../api/openai-compat-base.js";
```

- [ ] **Step 2: 运行 vitest 验证**

```bash
cd f:\allProject\githubProject\my-mimipi\packages\ai
pnpm vitest run
```

预期: 51/51 通过。

- [ ] **Step 3: 跑所有 examples 做最终集成验证**

```bash
cd f:\allProject\githubProject\my-mimipi\packages\ai
npx tsx examples/01-core-types.ts
npx tsx examples/04-openai-mock.ts
npx tsx examples/03-deepseek-chat.ts
npx tsx examples/06-tool-use.ts
npx tsx examples/07-multi-turn.ts
```

预期: 全部能跑通(具体输出视 API Key 配置情况而定,关键是代码无 import / 类型错误)。

- [ ] **Step 4: 检查 `openai.ts` 最终行数**

```bash
cd f:\allProject\githubProject\my-mimipi
Get-Content packages/ai/src/api/openai.ts | Measure-Object -Line
```

预期: ~30 行(原 496 行)。

- [ ] **Step 5: Commit**

```bash
cd f:\allProject\githubProject\my-mimipi
git add packages/ai/src/__tests__/openai-messages.test.ts
git commit -m 'test(ai): openai-messages 测试改指 openai-compat-base 模块'
```

---

## 验证清单(全部 Task 完成后)

| 检查项 | 命令 | 期望 |
|--------|------|------|
| TypeScript | `cd packages/ai && pnpm tsc --noEmit` | 零错误 |
| 单元测试 | `cd packages/ai && pnpm vitest run` | 51/51 通过 |
| Example 01 (类型) | `cd packages/ai && npx tsx examples/01-core-types.ts` | 跑通 |
| Example 02 (Anthropic mock) | `cd packages/ai && npx tsx examples/02-anthropic-mock.ts` | 跑通 |
| Example 03 (DeepSeek 真实) | `cd packages/ai && npx tsx examples/03-deepseek-chat.ts` | 跑通 |
| Example 04 (OpenAI mock) | `cd packages/ai && npx tsx examples/04-openai-mock.ts` | 跑通 |
| Example 06 (工具调用) | `cd packages/ai && npx tsx examples/06-tool-use.ts` | 跑通 |
| Example 07 (多轮) | `cd packages/ai && npx tsx examples/07-multi-turn.ts` | 跑通 |
| 文件行数 | `Get-Content packages/ai/src/api/openai.ts \| Measure-Object -Line` | 48 (原 496) |

## 不做的事 (YAGNI)

- 不引入 Provider 工厂注册表或自动发现机制
- 不改 `Provider` 接口本身
- 不动 `anthropic.ts`
- 不写 `BaseOpenAICompatProvider` 的独立单元测试
- 不抽 `ReasoningMapper` 策略类
- 不重构 `models.set()` 注册流程
- 不改 `tests/` 下其他文件(只有 `openai-messages.test.ts` 需要改导入路径)

## 风险与回退

- 风险:抽象基类引入 class 复杂度,违反仓库"函数式优先"既有风格
- 回退:如发现问题,`git revert <last-4-commits>` 回到拆分前状态。`BaseOpenAICompatProvider` 若团队不接受 class 风格,后续可平滑改回工厂函数,不影响公共 API
