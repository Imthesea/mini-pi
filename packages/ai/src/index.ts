/**
 * @mimi/ai —— 最小化多 Provider LLM API 层。
 *
 * 使用方式：
 *   import { createModels, anthropicProvider } from "@mimi/ai";
 *   const models = createModels();
 *   models.set(anthropicProvider());
 *   const result = await models.complete(model, context);
 */

// 核心框架
export { createModels } from "./provider/index.js";
export type { Provider, Models } from "./provider/index.js";
export { ModelsError } from "./provider/index.js";

// 错误分类（agent 层重试依赖）
export { isRetryableAssistantError } from "./utils/retry.js";

// 事件流
export { EventStream, AssistantMessageEventStream } from "./stream/index.js";

// 文本工具
export { contentText } from "./utils/text.js";

// TypeBox 辅助
export { StringEnum } from "./utils/typebox-helpers.js";

// 认证
export { envApiKey } from "./auth/index.js";

// Provider 实现
export { openaiProvider } from "./api/openai.js";
export { deepseekProvider } from "./api/deepseek.js";
export { anthropicProvider } from "./api/anthropic.js";

// 类型（全部 re-export）
export type * from "./types.js";
export { hasApi } from "./types.js";
