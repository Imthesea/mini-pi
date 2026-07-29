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
export { createModels } from "./provider.js";
export type { Provider, Models } from "./provider.js";
export { ModelsError } from "./provider.js";

// 事件流
export { EventStream, AssistantMessageEventStream } from "./stream.js";

// 认证
export { envApiKey } from "./auth.js";

// 类型（全部 re-export）
export type * from "./types.js";
export { hasApi } from "./types.js";
