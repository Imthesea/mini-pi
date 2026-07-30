/**
 * harness/types/options.ts 的类型测试。
 *
 * 校验 AgentHarnessOptions / AgentHarnessResources /
 * AgentHarnessStreamOptions / SystemPromptContext 的结构。
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import type { Model } from "@mimi/ai";
import type { AgentTool, ThinkingLevel } from "../../../src/types.js";
import type { ThinkingLevel as TL2 } from "../../../src/types.js";
import type {
  AgentHarnessOptions,
  AgentHarnessResources,
  AgentHarnessStreamOptions,
  SystemPromptContext,
  HarnessStreamFn,
} from "../../../src/harness/types/options.js";
import type {
  PromptTemplate,
  Skill,
} from "../../../src/harness/types/harness.js";

void (undefined as unknown as TL2 satisfies ThinkingLevel);

describe("AgentHarnessStreamOptions", () => {
  it("包含 temperature / maxTokens / apiKey / headers / metadata", () => {
    const opts: AgentHarnessStreamOptions = {
      temperature: 0.7,
      maxTokens: 4096,
      apiKey: "sk-xxx",
      headers: { "X-Custom": "v" },
      metadata: { requestId: "abc" },
    };
    expect(opts.temperature).toBe(0.7);
    expect(opts.maxTokens).toBe(4096);
    expect(opts.apiKey).toBe("sk-xxx");
  });

  it("所有字段可选", () => {
    const opts: AgentHarnessStreamOptions = {};
    expect(opts).toEqual({});
  });
});

describe("SystemPromptContext", () => {
  it("包含 model / tools / sessionId / resources", () => {
    const model: Model<any> = {
      id: "m1",
      name: "M1",
      api: "anthropic-messages",
      provider: "mock",
      baseUrl: "x",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0 },
      contextWindow: 100000,
      maxTokens: 8192,
    };
    const tools: AgentTool<any>[] = [];
    const ctx: SystemPromptContext = {
      model,
      tools,
      sessionId: "sess-1",
    };
    expect(ctx.model.id).toBe("m1");
    expect(ctx.sessionId).toBe("sess-1");
    expect(ctx.tools).toBe(tools);
  });

  it("resources 可选", () => {
    const ctx: SystemPromptContext = {
      model: {} as Model<any>,
      tools: [],
      sessionId: "x",
      resources: { skills: [] },
    };
    expect(ctx.resources?.skills).toEqual([]);
  });
});

describe("AgentHarnessResources", () => {
  it("skills 和 promptTemplates 都可选", () => {
    const r1: AgentHarnessResources = {};
    expect(r1).toEqual({});
  });

  it("可以只传 skills", () => {
    const skills: Skill[] = [
      { name: "s1", description: "d1", content: "c1" },
    ];
    const r: AgentHarnessResources = { skills };
    expect(r.skills).toBe(skills);
  });

  it("可以只传 promptTemplates", () => {
    const templates: PromptTemplate[] = [
      { name: "t1", content: "hello {{name}}" },
    ];
    const r: AgentHarnessResources = { promptTemplates: templates };
    expect(r.promptTemplates).toBe(templates);
  });

  it("泛型可以收窄 Skill 子类型", () => {
    interface MySkill extends Skill {
      extra: string;
    }
    const skills: MySkill[] = [
      { name: "s", description: "d", content: "c", extra: "e" },
    ];
    const r: AgentHarnessResources<MySkill> = { skills };
    expect(r.skills?.[0].extra).toBe("e");
  });
});

describe("AgentHarnessOptions", () => {
  function makeModel(): Model<any> {
    return {
      id: "m",
      name: "M",
      api: "anthropic-messages",
      provider: "mock",
      baseUrl: "x",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0 },
      contextWindow: 100000,
      maxTokens: 8192,
    };
  }

  it("必填字段:model / tools / env / session", () => {
    const model = makeModel();
    const tools: AgentTool<any>[] = [];
    const options: AgentHarnessOptions = {
      model,
      tools,
      env: { readFile: () => Promise.resolve({ ok: true, value: "" }) } as any,
      session: {} as any,
    };
    expect(options.model).toBe(model);
    expect(options.tools).toBe(tools);
  });

  it("可选字段:thinkingLevel / systemPrompt / streamOptions / resources", () => {
    const options: AgentHarnessOptions = {
      model: makeModel(),
      tools: [],
      env: {} as any,
      session: {} as any,
      thinkingLevel: "high",
      systemPrompt: "你是助手",
      streamOptions: { temperature: 0.5 },
      resources: { skills: [] },
    };
    expect(options.thinkingLevel).toBe("high");
    expect(options.systemPrompt).toBe("你是助手");
  });

  it("systemPrompt 可以是动态 provider 函数", () => {
    const options: AgentHarnessOptions = {
      model: makeModel(),
      tools: [],
      env: {} as any,
      session: {} as any,
      systemPrompt: (ctx) => `model=${ctx.model.id}`,
    };
    expect(typeof options.systemPrompt).toBe("function");
  });

  it("streamFn 可选(透传给 agent-loop)", () => {
    const fn: HarnessStreamFn = () => ({} as any);
    const options: AgentHarnessOptions = {
      model: makeModel(),
      tools: [],
      env: {} as any,
      session: {} as any,
      streamFn: fn,
    };
    expect(options.streamFn).toBe(fn);
  });

  it("steeringMode / followUpMode 可选", () => {
    const options: AgentHarnessOptions = {
      model: makeModel(),
      tools: [],
      env: {} as any,
      session: {} as any,
      steeringMode: "all",
      followUpMode: "one-at-a-time",
    };
    expect(options.steeringMode).toBe("all");
    expect(options.followUpMode).toBe("one-at-a-time");
  });
});
