/**
 * ModelResolver —— 模型解析（名称 → Model 对象）。
 * 对齐 pi 项目。
 */

import type { Model } from "@mimi/ai";
import type { ModelRuntime } from "./model-runtime.js";

export function resolveModel(
  input: string | undefined,
  runtime: ModelRuntime,
  defaultModel: string,
): Model<any> {
  const id = input ?? process.env.MIMI_MODEL ?? defaultModel;
  const model = runtime.getModel(id);
  if (!model) {
    throw new Error(
      `Unknown model: "${id}". Check MIMI_MODEL or --model flag.`,
    );
  }
  return model;
}
