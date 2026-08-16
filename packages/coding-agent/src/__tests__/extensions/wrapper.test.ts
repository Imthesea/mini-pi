/**
 * wrapExtensionTool / wrapExtensionTools 的单元测试。
 */
import { describe, it, expect } from "vitest";
import { Type } from "typebox";
import { wrapExtensionTool, wrapExtensionTools } from "../../core/extensions/wrapper.js";
import type { ToolDefinition } from "../../core/extensions/types.js";

function makeTool(name: string): ToolDefinition {
  return {
    name,
    label: `Label ${name}`,
    description: `Description ${name}`,
    parameters: Type.Object({ x: Type.String() }),
    execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => ({
      content: [{ type: "text", text: `cwd=${ctx.cwd}` }],
      details: { tool: name },
    }),
  };
}

describe("wrapExtensionTool", () => {
  it("保留 name / label / description / parameters / executionMode", () => {
    const def: ToolDefinition = {
      ...makeTool("demo"),
      executionMode: "sequential",
    };
    const tool = wrapExtensionTool(def, "/tmp/project");

    expect(tool.name).toBe("demo");
    expect(tool.label).toBe("Label demo");
    expect(tool.description).toBe("Description demo");
    expect(tool.executionMode).toBe("sequential");
    expect(tool.parameters).toBe(def.parameters);
  });

  it("execute 注入 ctx.cwd 并透传返回值", async () => {
    const tool = wrapExtensionTool(makeTool("demo"), "/tmp/project");

    const result = await tool.execute("call-1", { x: "1" }, undefined, undefined);

    expect(result.content).toEqual([{ type: "text", text: "cwd=/tmp/project" }]);
    expect(result.details).toEqual({ tool: "demo" });
  });
});

describe("wrapExtensionTools", () => {
  it("批量包装", async () => {
    const tools = wrapExtensionTools([makeTool("a"), makeTool("b")], "/tmp/project");

    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(["a", "b"]);
    const result = await tools[0].execute("call-1", { x: "1" });
    expect(result.content).toEqual([{ type: "text", text: "cwd=/tmp/project" }]);
  });
});
