/**
 * Model resolution, scoping, and initial selection.
 *
 * 从 pi 项目 core/model-resolver.ts 抄来（V1 最小化）。
 * V1 保留：resolveModel, findExactModelReferenceMatch, findInitialModel.
 * 🔴 暂未实现：glob 匹配、scope 模式、session 模型恢复、thinking level 解析。
 */

import type { KnownProvider, Model } from "@mimi/ai";
import type { ModelRuntime } from "./model-runtime.js";
import { DEFAULT_THINKING_LEVEL } from "../defaults.js";

// ═══════════════════════════════════════════
// 默认模型映射
// ═══════════════════════════════════════════

/** 各已知 provider 的默认模型 ID */
export const defaultModelPerProvider: Record<KnownProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-5.5",
  deepseek: "deepseek-chat",
} as Record<KnownProvider, string>;

// 🔴 Pi: 支持 50+ provider（amazon-bedrock / google / groq / xai 等）—— V1 只支持 3 个

// ═══════════════════════════════════════════
// 模型匹配
// ═══════════════════════════════════════════

/**
 * 查找精确的模型引用匹配。
 * 支持裸 model id 或规范的 provider/modelId 引用。
 */
export function findExactModelReferenceMatch(
  modelReference: string,
  availableModels: Model<any>[],
): Model<any> | undefined {
  const trimmedReference = modelReference.trim();
  if (!trimmedReference) return undefined;

  const normalizedReference = trimmedReference.toLowerCase();

  // 先匹配 "provider/modelId" 格式
  const canonicalMatches = availableModels.filter(
    (model) => `${model.provider}/${model.id}`.toLowerCase() === normalizedReference,
  );
  if (canonicalMatches.length === 1) return canonicalMatches[0];
  if (canonicalMatches.length > 1) return undefined;

  // 再匹配裸 model id
  const idMatches = availableModels.filter(
    (model) => model.id.toLowerCase() === normalizedReference,
  );
  return idMatches.length === 1 ? idMatches[0] : undefined;
}

// 🔴 Pi: isAlias / tryMatchModel / parseModelPattern —— 复杂的模糊匹配。V1 不做
// 🔴 Pi: resolveModelScope / resolveModelScopeWithDiagnostics —— scope 模式。V1 不做
// 🔴 Pi: resolveCliModel —— CLI 专用解析（支持 provider/mode 格式推理）。V1 简化

// ═══════════════════════════════════════════
// 模型解析
// ═══════════════════════════════════════════

/**
 * 按优先级解析模型：
 * 1. input 参数（CLI --model 传入）
 * 2. MIMI_MODEL 环境变量
 * 3. defaultModel
 */
export function resolveModel(
  input: string | undefined,
  runtime: ModelRuntime,
  defaultModel: string,
): Model<any> {
  const id = input ?? process.env.MIMI_MODEL ?? defaultModel;

  // 尝试精确匹配
  const availableModels = [...runtime.getModels()];
  const exactMatch = findExactModelReferenceMatch(id, availableModels);
  if (exactMatch) return exactMatch;

  // 尝试 "provider/modelId" 格式
  const slashIndex = id.indexOf("/");
  if (slashIndex !== -1) {
    const provider = id.substring(0, slashIndex);
    const modelId = id.substring(slashIndex + 1);
    const model = runtime.getModel(provider, modelId);
    if (model) return model;
  }

  // 遍历所有 provider 查找匹配
  for (const model of availableModels) {
    if (model.id === id || model.id.toLowerCase() === id.toLowerCase()) {
      return model;
    }
  }

  throw new Error(
    `Unknown model: "${id}". Check MIMI_MODEL or --model flag.`,
  );
}

// 🔴 Pi: findInitialModel —— 从 CLI args / scoped models / session / settings 中查找初始模型。V1 用 resolveModel
// 🔴 Pi: restoreModelFromSession —— 从 session 恢复模型。V1 不做
// 🔴 Pi: ScopedModel / ModelScopeDiagnostic / ResolveModelScopeResult —— V1 不做（无 scope 模式）
