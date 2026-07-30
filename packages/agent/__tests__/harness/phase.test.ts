/**
 * harness/phase.ts 的单元测试。
 *
 * Phase 状态机是 harness 的"并发安全锁":
 * - 任意时刻只能处于一种 phase
 * - "idle" 是唯一接受 prompt / compact / navigateTree 的状态
 * - "turn" / "compaction" / "branch_summary" / "retry" 期间
 *   拒绝所有结构性操作(抛 AgentHarnessError)
 *
 * phase 转换规则(从 pi 沿用,见 design §4.1):
 *   idle           → turn           (prompt / skill / promptFromTemplate)
 *   idle           → compaction     (compact)
 *   idle           → branch_summary (navigateTree)
 *   turn           → retry          (stream-assistant 内部触发,不外露)
 *   turn / retry   → idle           (turn 自然结束 / abort / 异常)
 *   compaction     → idle           (压缩完成 / 取消)
 *   branch_summary → idle           (摘要完成 / 取消)
 */

import { describe, expect, it } from "vitest";
import {
  AgentHarnessPhase,
  assertPhase,
  canTransition,
  PHASE_TRANSITIONS,
} from "../../src/harness/phase.js";
import { AgentHarnessError } from "../../src/harness/errors.js";

describe("harness/phase", () => {
  describe("AgentHarnessPhase 联合", () => {
    it("包含全部 5 个状态", () => {
      const all: AgentHarnessPhase[] = [
        "idle",
        "turn",
        "compaction",
        "branch_summary",
        "retry",
      ];
      expect(new Set(all).size).toBe(5);
    });
  });

  describe("canTransition", () => {
    it("idle → turn 允许", () => {
      expect(canTransition("idle", "turn")).toBe(true);
    });

    it("idle → compaction 允许", () => {
      expect(canTransition("idle", "compaction")).toBe(true);
    });

    it("idle → branch_summary 允许", () => {
      expect(canTransition("idle", "branch_summary")).toBe(true);
    });

    it("turn → idle 允许(turn 自然结束)", () => {
      expect(canTransition("turn", "idle")).toBe(true);
    });

    it("turn → retry 允许(stream 内部重试)", () => {
      expect(canTransition("turn", "retry")).toBe(true);
    });

    it("retry → idle 允许(重试结束)", () => {
      expect(canTransition("retry", "idle")).toBe(true);
    });

    it("compaction → idle 允许", () => {
      expect(canTransition("compaction", "idle")).toBe(true);
    });

    it("branch_summary → idle 允许", () => {
      expect(canTransition("branch_summary", "idle")).toBe(true);
    });

    it("turn → turn 拒绝(同状态不算合法转换)", () => {
      expect(canTransition("turn", "turn")).toBe(false);
    });

    it("turn → compaction 拒绝(compaction 必须从 idle 起)", () => {
      expect(canTransition("turn", "compaction")).toBe(false);
    });

    it("compaction → turn 拒绝", () => {
      expect(canTransition("compaction", "turn")).toBe(false);
    });
  });

  describe("assertPhase", () => {
    it("当前 phase 在允许列表中 → 不抛", () => {
      expect(() => assertPhase("idle", "idle", "prompt")).not.toThrow();
      // 任意非空 allowed 列表
      expect(() => assertPhase("idle", ["idle", "turn"], "op")).not.toThrow();
    });

    it("当前 phase 不在允许列表中 → 抛 AgentHarnessError", () => {
      expect(() => assertPhase("turn", "idle", "prompt")).toThrow(
        AgentHarnessError,
      );
    });

    it("错误信息包含 phase + 操作名", () => {
      try {
        assertPhase("compaction", "idle", "compact");
      } catch (e) {
        expect((e as Error).message).toContain("compaction");
        expect((e as Error).message).toContain("compact");
      }
    });
  });

  describe("PHASE_TRANSITIONS 表", () => {
    it("包含全部合法的转换边", () => {
      expect(PHASE_TRANSITIONS.get("idle")).toEqual(
        expect.arrayContaining(["turn", "compaction", "branch_summary"]),
      );
      expect(PHASE_TRANSITIONS.get("turn")).toEqual(
        expect.arrayContaining(["idle", "retry"]),
      );
      expect(PHASE_TRANSITIONS.get("retry")).toEqual(
        expect.arrayContaining(["idle"]),
      );
      expect(PHASE_TRANSITIONS.get("compaction")).toEqual(
        expect.arrayContaining(["idle"]),
      );
      expect(PHASE_TRANSITIONS.get("branch_summary")).toEqual(
        expect.arrayContaining(["idle"]),
      );
    });
  });
});
