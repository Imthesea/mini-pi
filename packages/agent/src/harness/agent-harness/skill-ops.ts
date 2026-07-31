/**
 * Skill + PromptTemplate 调起逻辑。
 *
 * 职责:
 * - runSkillOp:从 resources.skills 找 skill,formatSkillInvocation 拼文本,调 prompt
 * - runPromptFromTemplateOp:同上,模板版本
 *
 * 为什么从 agent-harness.ts 拆出来:
 * - agent-harness.ts 在 Task 7 增量后达 556 行(> 500 软上限)
 * - 抽出后 agent-harness.ts 瘦身,业务方法逻辑可独立测
 * - 与 compaction-ops.ts 的"委托模式"保持一致
 */

import { AgentHarnessError } from "../errors.js";
import { formatSkillInvocation } from "../skills/format.js";
import { formatPromptTemplateInvocation } from "../prompt-templates/format.js";
import type { AgentMessage } from "../../types.js";
import type {
  AgentHarnessOptions,
  AgentHarnessResources,
} from "../types/options.js";
import type { Skill, SkillArgs } from "../skills/types.js";
import type { PromptTemplate, PromptTemplateArgs } from "../prompt-templates/types.js";

// ── RunSkillArgs(注入依赖,保持主类 # 字段封装) ──

/**
 * runSkillOp 需要的依赖。
 */
export interface RunSkillArgs {
  /** 运行时 resources(包含 skills) */
  resources: AgentHarnessResources | undefined;
  /**
   * 调起 prompt 的回调(由 AgentHarness.prompt 提供)。
   * 返回 AgentMessage[] 是为了保持主类 prompt() 的语义。
   */
  prompt: (text: string) => Promise<AgentMessage[]>;
}

// ── runSkillOp ──

/**
 * 调起一个 skill:从 resources.skills 找 → formatSkillInvocation → 调 prompt。
 *
 * 抛错:
 * - skill 不存在 → AgentHarnessError
 *
 * @param name  skill 名
 * @param args  可选占位符参数
 * @returns     prompt() 的返回值
 */
export async function runSkillOp(
  args: RunSkillArgs,
  name: string,
  argsOpt?: SkillArgs,
): Promise<AgentMessage[]> {
  const skills = args.resources?.skills ?? [];
  const skill = skills.find((s) => s.name === name);
  if (!skill) {
    throw new AgentHarnessError(
      `skill "${name}" 不存在(可用: ${skills.map((s) => s.name).join(", ") || "<none>"})`,
    );
  }
  const text = formatSkillInvocation(skill, argsOpt);
  return args.prompt(text);
}

// ── runPromptFromTemplateOp ──

/**
 * 调起一个 prompt template:从 resources.promptTemplates 找 → 替换占位符 → 调 prompt。
 *
 * @param name  模板名
 * @param args  占位符参数
 * @returns     prompt() 的返回值
 */
export async function runPromptFromTemplateOp(
  args: RunSkillArgs,
  name: string,
  argsOpt: PromptTemplateArgs,
): Promise<AgentMessage[]> {
  const templates = args.resources?.promptTemplates ?? [];
  const template = templates.find((t) => t.name === name);
  if (!template) {
    throw new AgentHarnessError(
      `prompt template "${name}" 不存在(可用: ${templates.map((t) => t.name).join(", ") || "<none>"})`,
    );
  }
  const text = formatPromptTemplateInvocation(template, argsOpt);
  return args.prompt(text);
}
