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

// 事件流
export { EventStream, AssistantMessageEventStream } from "./stream/index.js";

// 认证
export { envApiKey } from "./auth/index.js";

// Provider 实现
export { openaiProvider, deepseekProvider } from "./api/openai.js";

// 类型（全部 re-export）
export type * from "./types.js";
export { hasApi } from "./types.js";
