/**
 * harness/system-prompt/build.ts 的单元测试。
 *
 * buildSystemPrompt 是 harness 拼装"系统提示词"的入口:
 * - 接受静态字符串 或 动态 provider 回调
 * - 每次 turn 调用(动态)或取常量(静态)
 * - 拼入 skills / tools 等部分(parts.ts 提供)
 *
 * Task 3 阶段:支持静态字符串 + 动态 provider + skills 注入;
 * tools 描述注入留到后续 Task(Task 4 hook emit 顺序可能影响)。
 */

import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../../src/harness/system-prompt/build.js";
import type {
  SystemPromptContext,
} from "../../../src/harness/types/options.js";
import type { Skill } from "../../../src/harness/types/harness.js";
import type { Model, Tool } from "@mimi/ai";

function makeContext(overrides: Partial<SystemPromptContext> = {}): SystemPromptContext {
  const model: Model<any> = {
    id: "m",
    name: "M",
    api: "anthropic-messages",
    provider: "p",
    baseUrl: "https://x",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
  return {
    model,
    tools: [],
    sessionId: "sess-1",
    ...overrides,
  };
}

describe("harness/system-prompt/build", () => {
  it("undefined → 返回空字符串(允许无 system prompt 启动)", () => {
    expect(buildSystemPrompt(undefined, makeContext())).toBe("");
  });

  it("静态字符串 → 原样返回", () => {
    const prompt = "你是一个有帮助的助手。";
    expect(buildSystemPrompt(prompt, makeContext())).toBe(prompt);
  });

  it("动态 provider 每次 turn 调用一次", () => {
    const ctx1 = makeContext();
    const ctx2 = makeContext();
    let callCount = 0;
    const provider = (ctx: SystemPromptContext) => {
      callCount += 1;
      return `model=${ctx.model.id} session=${ctx.sessionId}`;
    };
    const r1 = buildSystemPrompt(provider, ctx1);
    expect(r1).toBe("model=m session=sess-1");
    expect(callCount).toBe(1);

    const r2 = buildSystemPrompt(provider, ctx2);
    expect(r2).toBe("model=m session=sess-1");
    expect(callCount).toBe(2);
  });

  it("异步 provider 用 await 处理", async () => {
    const provider = async (ctx: SystemPromptContext) =>
      `async:${ctx.sessionId}`;
    const r = await buildSystemPrompt(provider, makeContext());
    expect(r).toBe("async:sess-1");
  });

  it("provider 返回空字符串 → 视为无 prompt", () => {
    const provider = () => "";
    expect(buildSystemPrompt(provider, makeContext())).toBe("");
  });

  it("拼入 skills 块:resources.skills 非空时附加 XML 块", () => {
    const skills: Skill[] = [
      { name: "git-commit", description: "提交代码", content: "..." },
      { name: "lint", description: "运行 lint", content: "..." },
    ];
    const r = buildSystemPrompt(
      "你是一个 agent。",
      makeContext({ resources: { skills } }),
    );
    expect(r).toContain("你是一个 agent。");
    expect(r).toContain("git-commit");
    expect(r).toContain("lint");
  });

  it("无 resources 或 skills 空时:不附加 skills 块", () => {
    const r = buildSystemPrompt("x", makeContext());
    expect(r).toBe("x");

    const r2 = buildSystemPrompt("x", makeContext({ resources: { skills: [] } }));
    expect(r2).toBe("x");
  });
});
