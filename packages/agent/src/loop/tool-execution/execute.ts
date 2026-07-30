/**
 * 工具调用的"执行"阶段。
 *
 * 职责：
 * 1. 调 `tool.execute(id, args, signal, onUpdate)`
 * 2. 收集执行过程中的 `tool_execution_update` 事件
 * 3. execute 抛错时,转为 isError=true 的 result（**不** throw 到 loop 顶层）
 * 4. execute 完成后,丢弃所有迟到的 update 回调
 *
 * 不做：before/after 钩子、emit 终态事件
 */

import type { AgentEventSink } from "../helpers.js";
import type { ExecutedToolCallOutcome, PreparedToolCall } from "./types.js";
import { createErrorToolResult } from "../helpers.js";

/** 执行一个已 prepared 的工具调用 */
export async function executePreparedToolCall(
  prepared: PreparedToolCall,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ExecutedToolCallOutcome> {
  // 待派发的 update 事件 Promise 数组 —— execute 期间累计,完成时统一 await
  const updateEvents: Promise<void>[] = [];

  // update 窗口开关:execute 完成/失败后置 false,迟到的 onUpdate 会被丢弃
  // 防止工具实现不规范(await 之后还调 onUpdate)导致事件流污染
  let acceptingUpdates = true;

  // try-catch-finally 三件套:
  // - try:  正常路径 —— await execute,等所有 update 完成,返回成功 outcome
  // - catch:异常路径 —— execute 抛错时,转为 isError=true 的 outcome(不 throw 到外层)
  // - finally:防御性双保险,确保 update 窗口关闭
  //
  // 关键不变量:**execute 抛错绝不冒泡到 loop 顶层**。
  // 理由:loop 顶层依赖"事件驱动"状态机,如果 execute throw,
  //       整个 agent 会异常中断,违反"agent_end 必发"的不变量。
  try {
    // 阻塞等工具完成
    const result = await prepared.tool.execute(
      prepared.toolCall.id,    // 工具调用 id —— 工具内部用于日志/审计/去重
      prepared.args as never,  // 已校验的 args;`as never` 绕过 TS 类型检查(prepare 阶段已验证 schema)
      signal,                  // 透传 abort signal —— 工具内做超时/取消
      (partialResult) => {     // onUpdate 回调:工具执行期间可多次调,报告进度
        // 容错第一关:execute 完成/失败后再调的 onUpdate 必须丢弃
        // (防工具实现不规范:await 之后还调 onUpdate)
        if (!acceptingUpdates) return;
        // 包装 emit 调用为 Promise,push 到数组
        // 不直接 await emit,因为 execute 还在跑,不能阻塞它
        updateEvents.push(
          // Promise.resolve 标准化:emit 可能返回 Promise<void> 或 void
          Promise.resolve(
            // 调上层注入的 emit —— 事件最终去哪由 agent-loop 调用方决定
            // (agentLoop → EventStream.push;runAgentLoop → 用户 callback)
            emit({
              type: "tool_execution_update",         // 高频低语义事件,UI 用它做实时进度条
              toolCallId: prepared.toolCall.id,      // 关联到具体 tool call
              toolName: prepared.toolCall.name,      // 工具名(UI 可直接展示)
              args: prepared.toolCall.arguments,     // **原始** args(未校验前的形态)
              partialResult,                         // 工具的"部分结果",类型不固定
            }),
          ),
        );
      },
    );

    // 关键时序:execute 刚完成,立即关闭 update 窗口
    // **必须**在 `await Promise.all(updateEvents)` 之前设置,
    // 否则有竞态 —— "execute 完成 → onUpdate(仍被接受)→ 还没等到 Promise.all" 不一致
    acceptingUpdates = false;

    // 等所有 pending update 完成,保证事件因果顺序:
    // 后续的 tool_execution_end 一定在所有 update 之后派发
    await Promise.all(updateEvents);

    // 成功路径:返回 outcome,由上层(finish)包装成 FinalizedToolCallOutcome
    return { result, isError: false };
  } catch (error) {
    // execute 抛错(工具 bug / 内部异常 / signal 触发 abort)
    // 不 throw,转为 isError=true 的 outcome
    //
    // 同样关闭 update 窗口 —— 工具的 try-finally 可能还在调 onUpdate
    acceptingUpdates = false;

    // 等 pending update 完成再返回,否则错误 toolResult 可能先于 update 派发
    // (事件顺序错乱会让 UI 看到"先失败后有进度"的诡异现象)
    await Promise.all(updateEvents);

    // 返回错误 outcome
    return {
      // 把 Error 对象转成文本 content(供模型下轮看到)
      result: createErrorToolResult(
        // 兼容非 Error 抛错(throw "string" / throw object / throw null 等)
        error instanceof Error ? error.message : String(error),
      ),
      isError: true,  // 标记错误,工具失败信息会进 toolResult 喂给模型
    };
  } finally {
    // 无论 try 成功还是 catch 捕获,这里都执行
    // 防御性双保险:确保 update 窗口已关闭
    // 代价:一个赋值,几乎零成本,但能防止未来新增分支时漏关
    acceptingUpdates = false;
  }
}
