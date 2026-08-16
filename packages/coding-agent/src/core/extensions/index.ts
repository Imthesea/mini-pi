/**
 * Extensions -- 扩展系统（V1 最小：仅 registerTool）。
 */

export { discoverAndLoadExtensions, loadExtensionFromFactory } from "./loader.js";
export { wrapExtensionTool, wrapExtensionTools } from "./wrapper.js";
export type {
  Extension,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  LoadExtensionsResult,
  ToolDefinition,
} from "./types.js";
