/**
 * harness 核心类型：Skill / PromptTemplate / HookEvent 等。
 *
 * 本文件是 harness 层的"公用词汇表",被 agent-harness 主体
 * 和后续的 hooks / skills / templates 子模块共同消费。
 *
 * 设计取舍:
 * - Skill / PromptTemplate 是数据形态,纯 type + interface
 * - HookEvent 是带"幻影结果"的泛型 type,模仿 pi 的钩子协议
 * - HookHandler / HookObserver 描述钩子订阅者签名
 *
 * 这些类型在 Task 3 阶段先落位,Task 4 的钩子系统会
 * 在此基础上扩展 8 个核心事件 + 9 个预声明事件。
 */

// ── Skill / PromptTemplate ──

/**
 * Skill:agent 可以按需加载的"能力包"。
 *
 * 来源:SKILL.md(YAML frontmatter + Markdown body,Task 7 引入加载器)。
 * 用法:resources.skills 注入,harness.systemPrompt 会按规则拼入 system prompt。
 */
export interface Skill {
  /** 唯一名,小写字母+短横线,如 "git-commit" / "code-review" */
  name: string;
  /** 一句话描述,用于 system prompt 中的 XML 块 */
  description: string;
  /** 完整的 skill 内容(通常来自 SKILL.md 的 Markdown body) */
  content: string;
}

/**
 * PromptTemplate:带 {{占位符}} 的提示词模板。
 *
 * 简单字符串替换,不做表达式求值(Task 7 引入)。
 */
export interface PromptTemplate {
  /** 唯一名,小写字母+短横线 */
  name: string;
  /** 含 {{name}} 占位符的模板 body */
  content: string;
}

// ── HookEvent 泛型(幻影结果) ──

/**
 * 钩子事件通用形态。
 *
 * 幻影结果(phantom result):
 * - TResult 只用于类型推导,不在 runtime 存在
 * - 允许在调用 hooks.emit(event) 时根据 event.type 自动推导出
 *   handlers 返回值的类型
 *
 * 例子:
 * ```ts
 * type ContextEvent = HookEvent<"context", { messages?: AgentMessage[] }>;
 * //    ^? { type: "context" } & { __result?: { messages?: AgentMessage[] } }
 * ```
 *
 * TResult 默认 void,大多数事件(handler 只观察)用默认。
 */
export interface HookEvent<TType extends string, TResult = void> {
  /** 事件类型,字符串字面量类型 */
  type: TType;
  /**
   * 幻影字段:runtime 不存在,仅用于类型系统关联 TResult。
   * 用 `__result?` 加下划线前缀避免和真实字段冲突。
   */
  readonly __result?: TResult;
}

// ── HookHandler / HookObserver 签名 ──

/**
 * 钩子 handler:可以"修改"事件语义(返回结果)。
 *
 * 不同的 event type 期待不同的返回类型(由 HookEvent 的 TResult 决定):
 * - "context": 返回 { messages? },链式转换
 * - "tool_call": 返回 { block? },遇 true 提前退出
 * - "tool_result": 返回 { content? / details? / isError? / terminate? },累积补丁
 * - "session_before_*": 返回 { cancel? } / 注入已有结果
 * - 其他:返回 void
 */
export type HookHandler<E extends HookEvent<string, any>, Ctx> = (
  event: E,
  ctx: Ctx,
  signal?: AbortSignal,
) => Promise<ReturnType<any> | undefined> | ReturnType<any> | undefined;

/**
 * 钩子 observer:只读观察,不参与语义修改。
 *
 * 收到事件后可以做日志/埋点/统计,但返回值会被忽略。
 */
export type HookObserver<E extends HookEvent<string, any>, Ctx> = (
  event: E,
  ctx: Ctx,
  signal?: AbortSignal,
) => void | Promise<void>;
