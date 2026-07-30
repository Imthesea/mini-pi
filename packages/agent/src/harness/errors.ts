/**
 * AgentHarness 自定义错误。
 *
 * 集中放 harness 抛出的业务错误,便于调用方用 instanceof 区分:
 *   try {
 *     await harness.prompt("hi");
 *   } catch (e) {
 *     if (e instanceof AgentHarnessError) {
 *       // 处理 harness 内部错误(phase 错误、配置错误等)
 *     } else {
 *       throw e;
 *     }
 *   }
 *
 * 不 throw LLM 错误:LLM 错误由 agent-loop 编码到 AssistantMessage.stopReason,
 * 不通过 throw 表达。
 */

/** Harness 抛出的所有错误的基类 */
export class AgentHarnessError extends Error {
  /** 错误码(便于程序化判断) */
  readonly code: string;

  constructor(message: string, code = "AGENT_HARNESS_ERROR") {
    super(message);
    this.name = "AgentHarnessError";
    this.code = code;
    // 保持正确的 prototype chain(ES5 target 需要)
    Object.setPrototypeOf(this, AgentHarnessError.prototype);
  }
}

/** 阶段状态错误(busy / 非法转换) */
export class PhaseError extends AgentHarnessError {
  constructor(message: string) {
    super(message, "PHASE_ERROR");
    this.name = "PhaseError";
    Object.setPrototypeOf(this, PhaseError.prototype);
  }
}

/** 配置错误(选项非法 / 必填字段缺失) */
export class HarnessConfigError extends AgentHarnessError {
  constructor(message: string) {
    super(message, "HARNESS_CONFIG_ERROR");
    this.name = "HarnessConfigError";
    Object.setPrototypeOf(this, HarnessConfigError.prototype);
  }
}
