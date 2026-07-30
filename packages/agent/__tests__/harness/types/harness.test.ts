/**
 * harness/types/harness.ts 的类型测试。
 *
 * 主要校验 Skill / PromptTemplate / HookEvent 等 harness 核心类型
 * 的结构正确性。TypeScript 编译通过即视为类型正确,
 * 这里用 `expectTypeOf` + 显式构造样例对象双重保险。
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  HookEvent,
  HookHandler,
  HookObserver,
  PromptTemplate,
  Skill,
} from "../../../src/harness/types/harness.js";

describe("harness/types/harness", () => {
  describe("Skill", () => {
    it("接受 name + description + content 三件套", () => {
      // 构造一个样例,TypeScript 编译通过即视为类型正确
      const skill: Skill = {
        name: "git-commit",
        description: "提交代码到 git",
        content: "请帮我提交代码。\n\n步骤:\n1. git status\n2. ...",
      };
      expect(skill.name).toBe("git-commit");
      expect(skill.description).toBe("提交代码到 git");
      expect(skill.content).toContain("git status");
    });

    it("name 是 string,description 是 string,content 是 string", () => {
      expectTypeOf<Skill["name"]>().toEqualTypeOf<string>();
      expectTypeOf<Skill["description"]>().toEqualTypeOf<string>();
      expectTypeOf<Skill["content"]>().toEqualTypeOf<string>();
    });
  });

  describe("PromptTemplate", () => {
    it("接受 name + content 字段(模板 body 含 {{placeholders}})", () => {
      const tmpl: PromptTemplate = {
        name: "code-review",
        content: "请审查 PR: {{prUrl}}，关注 {{focus}}",
      };
      expect(tmpl.name).toBe("code-review");
      expect(tmpl.content).toContain("{{prUrl}}");
    });

    it("字段类型严格为 string", () => {
      expectTypeOf<PromptTemplate["name"]>().toEqualTypeOf<string>();
      expectTypeOf<PromptTemplate["content"]>().toEqualTypeOf<string>();
    });
  });

  describe("HookEvent 泛型", () => {
    it("HookEvent<TType, TResult> 同时带 type + 幻影 result", () => {
      // type 是字符串字面量类型,result 是幻影的(不参与 runtime)
      type Evt = HookEvent<"context", { messages?: string[] }>;
      const evt: Evt = { type: "context" };
      expect(evt.type).toBe("context");
      // 编译期校验:result 字段是可选(幻影)
      expectTypeOf<Evt["type"]>().toEqualTypeOf<"context">();
    });

    it("默认 TResult = void 时,result 字段是 void", () => {
      type Evt = HookEvent<"message_end">;
      const evt: Evt = { type: "message_end" };
      expect(evt.type).toBe("message_end");
      expectTypeOf<Evt["type"]>().toEqualTypeOf<"message_end">();
    });
  });

  describe("HookHandler / HookObserver", () => {
    it("HookHandler 是接受 event + ctx 的函数类型", () => {
      type Evt = HookEvent<"context", { messages?: string[] }>;
      type Ctx = { harness: unknown };

      // 编译期:handler 接受 event + ctx,返回 Promise<result> | result
      const handler: HookHandler<Evt, Ctx> = (event, ctx) => {
        expect(event.type).toBe("context");
        return { messages: ["modified"] };
      };
      expect(typeof handler).toBe("function");
    });

    it("HookObserver 是接受 event + ctx 的只读函数类型(返回 void)", () => {
      type Evt = HookEvent<"message_end">;
      type Ctx = { harness: unknown };

      const observer: HookObserver<Evt, Ctx> = (event) => {
        // 只读观察,不能改 event
        expect(event.type).toBe("message_end");
      };
      expect(typeof observer).toBe("function");
    });
  });
});
