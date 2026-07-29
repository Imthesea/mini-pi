# openai.ts 拆分设计 Spec

> 日期: 2026-07-29
> 状态: ✅ 已完成（commits `3722301` / `97590e8` / `4c3519b`）
> 范围: `packages/ai/src/api/openai.ts` 重构 —— 把 OpenAI 和 DeepSeek 各自拆为独立实现,共用部分提到抽象基类

## 1. 背景与目标

### 1.1 现状（已实施）

`packages/ai/src/api/openai.ts`（拆分前 496 行 → 拆分后 48 行）原本同时承载两个 Provider:
- `openaiProvider()` —— OpenAI
- `deepseekProvider()` —— DeepSeek

两者原本通过 `createOpenAICompatibleProvider(config)` 工厂函数复用同一套流式核心,差异点通过 `config.reasoningFormat: "openai" | "deepseek"` 字段区分。

本次重构后，工厂函数被替换为抽象类 `BaseOpenAICompatProvider`，OpenAI 与 DeepSeek 各自成为独立子类。

### 1.2 问题

- **单文件承担两个 Provider 的语义边界**:改动 OpenAI 时难以单独 review,容易误伤 DeepSeek
- **共用与差异的边界隐藏在工厂函数的 config 字段里**:新人需要通读 496 行才能理解"哪些是 OpenAI 特有、哪些是 DeepSeek 特有、哪些是共用"
- **类层级缺位**:Provider 接口是仓库核心抽象,但 OpenAI 兼容家族没有类层级来表达"两个变体共享同一套协议"
- **测试指向混用**:`__tests__/openai-messages.test.ts` 从 `api/openai.js` 导入 `_convertMessages` 和 `mapOpenAIFinishReason`,这两个函数实际是"OpenAI 兼容家族"的共用工具,与"OpenAI 这个 Provider"的概念不一致

### 1.3 目标

1. OpenAI 和 DeepSeek 各自有独立的实现文件,语义边界清晰
2. 共用代码明确归属"OpenAI 兼容家族",而非任一 Provider 私有
3. 用 TypeScript 抽象类表达"两个 Provider 共享同一套协议"的层级关系
4. 公共 API 导出 (`openaiProvider` / `deepseekProvider`) 签名零变化,外部使用方无感知
5. 所有现有测试通过,所有 examples 可跑通

## 2. 目标结构

```
packages/ai/src/api/
  openai-compat-base.ts   # 抽象基类 + 共用工具函数 (~280 行,新)
  openai.ts               # OpenAIProvider 实现 (~30 行,从 496 行缩减)
  deepseek.ts             # DeepSeekProvider 实现 (~30 行,新)
  anthropic.ts            # 不动(不属于 OpenAI 兼容家族)
```

文件数量从 2 → 3,`openai.ts` 行数从 496 → 30。

## 3. 详细设计

### 3.1 抽象基类 `BaseOpenAICompatProvider`

**位置**: `packages/ai/src/api/openai-compat-base.ts`

**职责**:
- 承载 OpenAI 兼容家族的所有共用逻辑
- 定义 `OpenAICompatConfig` interface,子类通过 `super(config)` 注入差异点
- 实现 `Provider<"openai-completions">` 接口的公共方法

**核心代码骨架**:

```typescript
export interface OpenAICompatConfig {
  id: string;
  name: string;
  baseUrl: string;
  envVar: string;
  /** reasoning 参数格式:"openai" 用 reasoning_effort,"deepseek" 用 thinking.type */
  reasoningFormat: "openai" | "deepseek";
  models: Record<string, Model<"openai-completions">>;
}

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

**同时在该文件导出供测试和子类复用的工具函数**:
- `mapOpenAIFinishReason(raw)` —— finish_reason → StopReason 映射
- `_convertMessages(messages)` —— 统一消息 → OpenAI Chat Completions 消息
- `convertTools(tools)` —— TypeBox → OpenAI function tool
- `openAICompatibleStream(config, model, context, options)` —— 流式核心实现
- `buildAssistantMessage(...)` —— 构建最终 AssistantMessage
- `ExtendedChatParams` / `StreamDelta` —— 类型扩展(原 `openai.ts` 里的 type 声明)

**关于命名 `BaseOpenAICompatProvider`**:
- 用 `Base` 前缀,而不是 `AbstractXxx` —— TypeScript 的 `abstract` 关键字已表达抽象语义,`Base` 前缀符合 OOP 习惯且简短
- 不带 `Abstract` 修饰的子类命名更自然(`OpenAIProvider extends Base...` 比 `OpenAIProvider extends Abstract...` 干净)

### 3.2 OpenAI 子类

**位置**: `packages/ai/src/api/openai.ts`

**职责**: 仅承载 OpenAI 特有的配置(模型列表、baseUrl、envVar、reasoning 格式)

**代码骨架**:

```typescript
import { BaseOpenAICompatProvider, type OpenAICompatConfig } from "./openai-compat-base.js";

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

/** 创建 OpenAI Provider 实例。 */
export function openaiProvider(): Provider<"openai-completions"> {
  return new OpenAIProvider();
}
```

### 3.3 DeepSeek 子类

**位置**: `packages/ai/src/api/deepseek.ts` (新文件)

**职责**: 与 OpenAI 子类对称,承载 DeepSeek 特有配置

**代码骨架**:

```typescript
import { BaseOpenAICompatProvider, type OpenAICompatConfig } from "./openai-compat-base.js";

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

/** 创建 DeepSeek Provider 实例(OpenAI 兼容接口)。 */
export function deepseekProvider(): Provider<"openai-completions"> {
  return new DeepSeekProvider();
}
```

## 4. 关键设计决策

### 4.1 为什么用 `super(config)` 而不是 abstract getter

抽象基类需要在构造函数里把 `config` 派生到 `id` / `name` / `baseUrl`。若使用:

```typescript
protected abstract readonly config: OpenAICompatConfig;
```

则在 `super()` 体内访问 `this.config` 时,子类构造体尚未执行,`config` 仍是 `undefined`,会运行时抛错或拿到错误值。

用 `super(config)` 把 config 作为构造参数传入,可避免这个问题,且子类代码更简洁:

```typescript
class OpenAIProvider extends BaseOpenAICompatProvider {
  constructor() {
    super({ id: "openai", /* ... */ });
  }
}
```

### 4.2 `Provider` 接口的类实现方式

TypeScript 类可以结构化地满足接口。`new OpenAIProvider()` 在类型系统里就是 `Provider<"openai-completions">`,所以:

```typescript
models.set(openaiProvider());  // 仍然可用
```

外部使用方零感知。基类声明 `implements Provider<"openai-completions">` 是为了编译期校验完整性。

### 4.3 reasoning 差异的承载方式

保留 `reasoningFormat: "openai" | "deepseek"` 字段在 `OpenAICompatConfig` 里,由 `openAICompatibleStream` 内部根据它选择参数格式:

```typescript
if (options?.reasoning) {
  if (config.reasoningFormat === "openai") {
    params.reasoning_effort = typeof options.reasoning === "string" ? options.reasoning : "medium";
  } else if (config.reasoningFormat === "deepseek") {
    params.thinking = { type: "enabled" };
  }
}
```

两家只在**字段名/字段结构**上不同,逻辑分支只有这一处。抽成 strategy 类(单独一个 `ReasoningMapper` 类)在该规模下不划算,保留联合类型字段更轻。

### 4.4 `_convertMessages` 里 `reasoning_content` 的归属

DeepSeek 多轮对话要求回传 `reasoning_content` 字段。OpenAI 当前不识别该字段,会忽略。

**决策**: 保留 `_convertMessages` 共用,不按 Provider 拆分。理由:
- OpenAI 忽略多余字段无副作用,无需特判
- 拆分会让消息转换函数重复 ~50 行
- 若未来 OpenAI 推出自己的 thinking 字段,再做"thinking → 字段映射"的抽象,现在做是 YAGNI

### 4.5 向后兼容

| 维度 | 变化 |
|------|------|
| `openaiProvider()` / `deepseekProvider()` 函数签名 | 无变化 |
| `Provider<"openai-completions">` 接口契约 | 无变化 |
| `src/index.ts` 公共导出 | 无变化(只是 import 来源从 1 个文件变成 2 个) |
| `__tests__/openai-messages.test.ts` 内部导入路径 | 从 `../api/openai.js` → `../api/openai-compat-base.js` |
| `models.set(openaiProvider())` 用法 | 不变 |
| examples 目录 | 不变 |

## 5. 改动清单

| 文件 | 改动类型 | 改动内容 |
|------|---------|---------|
| `src/api/openai-compat-base.ts` | 新增 | 抽出共用工具函数,定义 `OpenAICompatConfig` interface 和 `BaseOpenAICompatProvider` 抽象类 |
| `src/api/openai.ts` | 大幅精简 | 删掉所有共用途径,只保留 `OPENAI_MODELS` + `OpenAIProvider` 类 + `openaiProvider()` 工厂 |
| `src/api/deepseek.ts` | 新增 | 拆出 `DEEPSEEK_MODELS` + `DeepSeekProvider` 类 + `deepseekProvider()` 工厂 |
| `src/index.ts` | 微调 | 一行 `from "./api/openai.js"` 拆成两行,分别从 `openai.ts` / `deepseek.ts` 取 |
| `src/__tests__/openai-messages.test.ts` | 微调 | 导入路径 `../api/openai.js` → `../api/openai-compat-base.js` |
| `src/api/anthropic.ts` | 不动 | 不属于 OpenAI 兼容家族 |
| `src/provider/index.ts` | 不动 | 继续用 `defaultComplete` |

## 6. 不做的事 (YAGNI)

- **不引入 Provider 工厂注册表或自动发现机制** —— 当前 3 个 Provider 足够,加了反而是过度设计
- **不改 `Provider` 接口本身** —— 接口契约稳定,本次只调整实现组织
- **不动 `anthropic.ts`** —— 它不属于 OpenAI 兼容家族,跟基类无关
- **不写 `BaseOpenAICompatProvider` 的独立单元测试** —— 它是组织代码的容器,行为由其内函数 (`_convertMessages` / `mapOpenAIFinishReason`) 的测试覆盖
- **不抽 `ReasoningMapper` 策略类** —— 联合类型字段已足够,见 4.3
- **不重构 `models.set()` 注册流程** —— 与本次范围无关

## 7. 验证步骤

实施后按以下顺序验证:

```bash
cd packages/ai

# 1. 类型检查
pnpm tsc --noEmit
# 期望: 零错误

# 2. 单元测试
pnpm vitest run
# 期望: 51/51 通过(测试只改 import 路径,逻辑不变;后续移除重试循环测试后由 55 → 51)

# 3. 集成验证 (examples)
npx tsx examples/04-openai-mock.ts     # OpenAI 框架走通(mock)
npx tsx examples/03-deepseek-chat.ts   # DeepSeek 真实流式
npx tsx examples/06-tool-use.ts        # 工具调用
npx tsx examples/07-multi-turn.ts      # 多轮对话
```

## 8. 风险与回退

**风险**:
- 抽象基类引入 class 复杂度,违反仓库"函数式优先"的既有风格 —— 但 `Provider` 接口本身就是结构化契约,class 是它的合法实现形式
- 子类实例化时 `super(config)` 的对象字面量每次创建都重新分配 —— 微小性能开销,可忽略

**回退**:
- 本次纯重构,逻辑无变化。如发现严重问题,`git revert` 即可回到拆分前状态
- `BaseOpenAICompatProvider` 若团队不接受 class 风格,后续可平滑改回工厂函数(子类从 `extends` 改为 `return createXxxProvider(config)`),不影响公共 API
