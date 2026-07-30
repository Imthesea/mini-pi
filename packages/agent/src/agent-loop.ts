/**
 * agent-loop 公共 API —— 这是 agent 层的"核心引擎"。
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 模块定位
 * ════════════════════════════════════════════════════════════════════════════
 *
 * agent-loop 实现了"LLM → tool → repeat"的循环控制逻辑(状态机),
 * 是整个 agent 运行时的心脏。它不直接和 LLM provider 通信,
 * 而是通过注入的 `streamFn`(来自 @mimi/ai)发起请求。
 *
 * 本文件**只关心编排**(orchestration),不关心:
 * - LLM 流协议如何解析   → 委托给 stream-assistant.ts
 * - 工具如何执行/校验     → 委托给 tool-execution/ 目录
 * - 上下文如何转换       → 由 config.convertToLlm 处理
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 两个公共入口
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   agentLoop(prompts = [], context, config, ...)
 *       │
 *       └──→ EventStream    (订阅式,适合需要中间事件的 UI)
 *
 *   runAgentLoop(prompts = [], context, config, ...)
 *       │
 *       └──→ Promise<Messages>   (命令式,适合脚本/批处理)
 *
 * **统一入口设计**:
 * `prompts` 默认 `[]`。传非空数组 = "新会话模式",传空数组 = "继续模式":
 * - 新会话模式:派发 prompt 相关的 `message_start` / `message_end`,
 *   `newMessages` 包含 prompts
 * - 继续模式:不派发 prompt 事件,`newMessages` 只包含**续接后产生的新消息**,
 *   入口静态校验"context 最后一条不能是 assistant"
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 关键不变量 (Invariants)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 1. **agent_start ↔ agent_end 严格成对**:
 *    无论中途发生什么(错误/abort),`agent_end` 一定会被 emit,
 *    任何想监听完整生命周期的下游代码都可以依赖这一点。
 *
 * 2. **turn_start ↔ turn_end 严格成对**:每个 turn 都有边界事件。
 *
 * 3. **message_start ↔ message_end 严格成对**:每条消息都成对出现。
 *
 * 4. **context.messages 始终反映"到目前为止的对话"**:
 *    包括 partial assistant message(流式期间也会被推入),
 *    stream-assistant.ts 负责维护这个不变量。
 *
 * 5. **函数从不 throw**(除入口的"调用前可静态判定"的错误):
 *    LLM 错误被编码到 `AssistantMessage.stopReason === "error"` 里,
 *    状态机看到 error 会自行退出并 emit `agent_end`。
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 状态机总览
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 外层 while: agent 整体是否要继续(steer/follow-up 队列可能续命)    │
 * │   ┌──────────────────────────────────────────────────────────────┐  │
 * │   │ 内层 while: 当前 session 是否还有 tool call/注入消息要处理  │  │
 * │   │   1. emit turn_start                                         │  │
 * │   │   2. 处理 pendingMessages(steer 队列)                       │  │
 * │   │   3. streamAssistantResponse → AssistantMessage              │  │
 * │   │   4. 若 error/aborted → turn_end + agent_end → return        │  │
 * │   │   5. 若有 tool calls → routeToolExecution → toolResults     │  │
 * │   │   6. emit turn_end                                           │  │
 * │   │   7. config.prepareNextTurn? (可改 next context/model)       │  │
 * │   │   8. config.shouldStopAfterTurn? (true → 退出)               │  │
 * │   │   9. config.getSteeringMessages? (poll 是否有新 steer)       │  │
 * │   └──────────────────────────────────────────────────────────────┘  │
 * │ 外层: config.getFollowUpMessages? (没有就 break)                   │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import { EventStream, type ToolResultMessage } from "@mimi/ai";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
} from "./types.js";
import { streamAssistantResponse } from "./loop/stream-assistant.js";
import { routeToolExecution } from "./loop/tool-execution.js";
import { failToolCallsFromTruncatedMessage } from "./loop/tool-execution/truncate.js";
import type { AgentEventSink } from "./loop/helpers.js";

// ── 公共类型 ──

/** 透传 AgentEventSink 类型,让上层不必直接 import helpers.ts */
export type { AgentEventSink };

// ─────────────────────────────────────────────────────────────────────────
// 入口校验:继续模式的静态约束
// ─────────────────────────────────────────────────────────────────────────

/**
 * "继续模式" 必须在 API 入口校验,而不是塞到 runLoop 内部。
 *
 * 原因:
 * - 调用方传 `prompts = []` 时,是**显式声明**"我要续接"
 * - 此时如果 context 状态不合法(空/最后一条是 assistant),
 *   错误应该是**调用前**就 throw,而不是跑到 LLM 调用时才报
 * - 这是一个**可在静态层面判定**的错误,和 LLM 错误不同
 */
function assertContinueable(context: AgentContext): void {
  if (context.messages.length === 0) {
    throw new Error("Cannot continue: no messages in context");
  }
  if (context.messages[context.messages.length - 1].role === "assistant") {
    throw new Error("Cannot continue from message role: assistant");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// EventStream API (订阅式)
// ─────────────────────────────────────────────────────────────────────────

/**
 * 启动 agent loop,返回可订阅的事件流。
 *
 * **典型场景**:UI 客户端需要实时显示 LLM 输出、工具执行进度等。
 *
 * @param prompts   本轮新加入的 user 消息(可空,空 = 继续模式)
 * @param context   历史上下文(已有的 messages)
 * @param config    agent 配置(model, streamFn, 钩子等)
 * @param signal    可选 abort signal
 * @param streamFn  可选 stream 函数(覆盖 config.streamFn,通常用 config 注入)
 *
 * @returns EventStream —— 可用 `for await` 订阅事件,
 *          用 `await stream.result()` 拿到最终 messages 数组
 *
 * @example 新会话
 *   const stream = agentLoop(prompts, context, config);
 *   for await (const event of stream) console.log(event);
 *   const finalMessages = await stream.result();
 *
 * @example 续接
 *   const stream = agentLoop([], existingContext, config);
 *   // ...后续同上
 *
 * @throws prompts 为空时,如果 context 不可继续(空/最后一条是 assistant)
 */
export function agentLoop(
  prompts: AgentMessage[] = [],
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
  streamFn?: AgentLoopConfig["streamFn"],
): EventStream<AgentEvent, AgentMessage[]> {
  // 继续模式:入口静态校验
  if (prompts.length === 0) {
    assertContinueable(context);
  }

  const stream = createAgentStream();

  // 注意:这里用 `void` 启动一个 fire-and-forget 的 Promise,
  // 而不是 await —— 因为 EventStream 必须**同步**返回(stream consumer 后才执行),
  // 实际工作在后台跑。Promise 完成后调 stream.end(messages) 标记流终止。
  void runAgentLoop(prompts, context, config, async (event) => {
    stream.push(event);
  }, signal, streamFn).then((messages) => {
    stream.end(messages);
  });

  return stream;
}

// ─────────────────────────────────────────────────────────────────────────
// 直接 Promise API (命令式)
// ─────────────────────────────────────────────────────────────────────────

/**
 * 启动 agent loop,返回最终的 messages 列表。
 *
 * 与 `agentLoop` 的区别:
 * - `agentLoop` 返回 EventStream(实时订阅)
 * - `runAgentLoop` 返回 Promise(只关心最终结果)
 *
 * **行为分支**(根据 `prompts.length`):
 *
 * | 模式 | prompts | 派发 prompt 事件 | newMessages 包含 prompts | 入口校验 |
 * |---|---|---|---|---|
 * | 新会话 | `[]` 之外的数组 | ✅ | ✅ | ❌ |
 * | 续接 | `[]` | ❌ | ❌(只含后续产生) | ✅ 静态校验 |
 *
 * @param emit 事件回调,默认 no-op。agent-loop 的所有生命周期事件都从这里发出。
 *             传入 `(e) => console.log(e.type)` 即可 trace 全过程。
 */
export async function runAgentLoop(
  prompts: AgentMessage[] = [],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink = () => {},
  signal?: AbortSignal,
  streamFn?: AgentLoopConfig["streamFn"],
): Promise<AgentMessage[]> {
  // 继续模式:入口静态校验
  if (prompts.length === 0) {
    assertContinueable(context);
  }

  // newMessages: 本次 agent 产生的新消息
  // - 新会话模式:从 prompts 开始(返回值完整)
  // - 续接模式:从空开始(只含后续产生的)
  const newMessages: AgentMessage[] = [...prompts];

  // currentContext: 完整上下文,会被状态机 mutate(追加消息)
  // 注意:这里是新对象,避免污染调用方传入的 context
  const currentContext: AgentContext = {
    ...context,
    messages: [...context.messages, ...prompts],
  };

  // 阶段 1: 派发启动事件
  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });

  // 阶段 1.5: 新会话模式才派发 prompt 事件
  // 续接模式没有 prompt,跳过此循环
  for (const prompt of prompts) {
    await emit({ type: "message_start", message: prompt });
    await emit({ type: "message_end", message: prompt });
  }

  // 阶段 2: 进入核心循环(下面会详细注释)
  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);

  // 返回本次新增的所有消息
  return newMessages;
}

// ─────────────────────────────────────────────────────────────────────────
// 内部:EventStream 工厂 + runLoop 编排
// ─────────────────────────────────────────────────────────────────────────

/**
 * 把 AgentEvent 流包装成通用 EventStream。
 *
 * EventStream<T, R> 的两个泛型:
 * - T = 事件类型(这里是 AgentEvent)
 * - R = result(流终止时返回的值,这里是 AgentMessage[])
 *
 * 两个构造参数:
 * - isEndPredicate: 判定哪个事件是"终止事件"
 *   → 我们选 `agent_end` 作为终止边界(因为它一定在最后)
 * - extractResult: 从终止事件中提取 result
 *   → `agent_end` 携带了 `messages` 字段,直接返回
 */
function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
  return new EventStream<AgentEvent, AgentMessage[]>(
    // 终止判定:agent_end 是生命周期终点
    (event: AgentEvent) => event.type === "agent_end",
    // result 提取:从 agent_end 中拿 messages
    (event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
  );
}

/**
 * ════════════════════════════════════════════════════════════════════════
 * 核心循环 —— agentLoop / runAgentLoop 共享的状态机。
 * ════════════════════════════════════════════════════════════════════════
 *
 * ## 双层 while 的设计动机
 *
 * 为什么需要**两个** while 循环?
 *
 * - **内层 while** 处理"当前 session 的自然延续":
 *   - LLM 调工具 → 调完继续问 LLM(同一次 session)
 *   - 用户中途注入消息(steer)→ 处理完继续
 *   - 工具说"terminate=true" → 退出内层
 *
 * - **外层 while** 处理"跨 session 的续命":
 *   - 用户可以"排队"follow-up 任务,在 LLM 自然结束后注入
 *   - 比如:[user: "先做 A"] → LLM 完成 → 系统注入 [user: "再做 B"] → 继续
 *   - 这种"跨轮次"的注入需要外层循环来支持
 *
 * ## 状态变量说明
 *
 * - `currentContext`: 持续增长的对话上下文(包含 partial assistant message)
 * - `config`: 可能被 `prepareNextTurn` 改写(换 model、换 context slice)
 * - `firstTurn`: 标记首轮,因为首轮的 turn_start 已经在外层 emit 过了
 * - `pendingMessages`: steer 队列,等待下次 LLM 调用前注入
 *
 * ## 关键不变量(再次强调)
 *
 * - `agent_end` 必定被 emit(每个 return 路径都有)
 * - 任何时候 signal.aborted,下次 await 时会 throw,我们让 stream-assistant 自行处理
 * - `currentContext.messages` 永远是"到目前为止的真实对话状态"
 */
async function runLoop(
  initialContext: AgentContext,
  newMessages: AgentMessage[],
  initialConfig: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: AgentLoopConfig["streamFn"],
): Promise<void> {
  let currentContext = initialContext;
  let config = initialConfig;
  let firstTurn = true;

  // 启动时先 poll 一次 steering 队列 —— 用户可能在外层调用前就塞了消息
  // 例如:[runAgentLoop 调用] [用户: 注入"等等,先做 X"]
  // 如果不先 poll,这些消息会被忽略
  let pendingMessages: AgentMessage[] =
    (await config.getSteeringMessages?.()) ?? [];

  // ────────────────────────────────────────────────────────────
  // 外层 while: 整个 agent 生命周期(支持 follow-up 续命)
  // ────────────────────────────────────────────────────────────
  while (true) {
    // hasMoreToolCalls 标记本轮是否因为工具调用而延续
    // (默认 true,进入内层至少跑一次;若无 tool call 则会被置 false)
    let hasMoreToolCalls = true;

    // ────────────────────────────────────────────────────────
    // 内层 while: 处理当前 session 的工具循环 + steer 注入
    // ────────────────────────────────────────────────────────
    while (hasMoreToolCalls || pendingMessages.length > 0) {
      // ─── 阶段 A: turn_start ───
      // 首轮的 turn_start 已经在外层 emit 了(runAgentLoop 里),
      // 这里只对后续轮次 emit,避免重复。
      if (!firstTurn) {
        await emit({ type: "turn_start" });
      } else {
        firstTurn = false;
      }

      // ─── 阶段 B: 注入 pending messages (steer 队列) ───
      // steer 队列是"用户中途插入的消息",比如:
      //   1. LLM 正在调工具,用户说"等下,改用 B 方案"
      //   2. getSteeringMessages 在 LLM 调工具期间被 poll 触发
      //   3. 这里把这些消息在下次 LLM 调用前注入
      //
      // 注入时也要派发 message_start / message_end,让事件流完整。
      if (pendingMessages.length > 0) {
        for (const message of pendingMessages) {
          await emit({ type: "message_start", message });
          await emit({ type: "message_end", message });
          currentContext.messages.push(message);
          newMessages.push(message);
        }
        pendingMessages = [];
      }

      // ─── 阶段 C: 调 LLM,等最终 assistant message ───
      // streamAssistantResponse 内部处理:
      //   - convertToLlm 转换 context
      //   - 调 streamFn 拿到流
      //   - 转发事件为 AgentEvent
      //   - 遇可重试错误 → 指数退避重试
      //   - 遇不可重试错误 → 返回 stopReason="error" 的 message
      //   - 不 throw,所有失败编码到 message 里
      const message = await streamAssistantResponse({
        context: currentContext,
        config,
        signal,
        emit,
        streamFn,
      });
      newMessages.push(message);

      // ─── 阶段 D: 错误/中止处理 ───
      // 终止类的 stopReason(LLM 不可恢复错误 / 用户取消)直接退出整个 agent。
      // 我们仍 emit turn_end + agent_end,保证生命周期事件成对。
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        await emit({ type: "turn_end", message, toolResults: [] });
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }

      // ─── 阶段 E: 提取 tool calls 并执行 ───
      // 从 assistant message 的 content 里 filter 出所有 toolCall 块。
      const toolCalls = message.content.filter((c) => c.type === "toolCall");

      const toolResults: ToolResultMessage[] = [];
      hasMoreToolCalls = false;

      if (toolCalls.length > 0) {
        // 特殊场景: stopReason="length" 意味着 LLM 输出被截断
        // 此时 tool call 的参数可能不完整(语法上有效但语义被截断),
        // 不能执行,要把所有 tool call 标记为错误 toolResult,
        // 让模型在下轮看到错误并重发。
        //
        // 非截断场景:走正常工具执行流程
        const executedToolBatch =
          message.stopReason === "length"
            ? await failToolCallsFromTruncatedMessage(toolCalls, emit)
            : await routeToolExecution({
                context: currentContext,
                assistantMessage: message,
                toolCalls,
                config,
                signal,
                emit,
              });

        // toolResults 是这一轮的工具输出,要推入 context 让下轮 LLM 看到
        toolResults.push(...executedToolBatch.messages);

        // terminate=true(由工具通过 toolResult.terminate 字段请求)
        // 表示"工具希望 agent 立即结束",不再继续内层循环。
        // 例如:权限拒绝、用户明确取消等。
        hasMoreToolCalls = !executedToolBatch.terminate;

        // 把 toolResults 推入 context + newMessages
        for (const result of toolResults) {
          currentContext.messages.push(result);
          newMessages.push(result);
        }
      }

      // ─── 阶段 F: turn_end ───
      // 每个 turn 都有边界事件,即使该 turn 调了工具。
      await emit({ type: "turn_end", message, toolResults });

      // ─── 阶段 G: prepareNextTurn 钩子 ───
      // 给上层一个机会修改下一轮的 context / model / thinkingLevel。
      // 典型场景:
      //   - 上下文窗口快满时,做压缩
      //   - 检测到工具失败,切换到更便宜的 model 重试
      //   - 用户切换"深度思考"开关
      const nextTurnContext = {
        message,
        toolResults,
        context: currentContext,
        newMessages,
      };
      const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext);
      if (nextTurnSnapshot) {
        // context 整体替换(model 也可以换)
        currentContext = nextTurnSnapshot.context ?? currentContext;
        config = {
          ...config,
          model: nextTurnSnapshot.model ?? config.model,
          // thinkingLevel 留给 harness 层(未来 Task)处理,这里不做转换
        };
      }

      // ─── 阶段 H: shouldStopAfterTurn 钩子 ───
      // 给上层一个"在自然结束后是否停止"的决定权。
      // 默认行为:有 tool call 就继续,没有就停。
      // 上层可覆盖:比如"强制让 LLM 反思一次"或"达到 token 上限就停"。
      if (
        await config.shouldStopAfterTurn?.({
          message,
          toolResults,
          context: currentContext,
          newMessages,
        })
      ) {
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }

      // ─── 阶段 I: 下一轮前 poll steering 队列 ───
      // 工具执行期间,用户可能又输入了新消息。
      // 如果有,内层 while 会再跑一轮(把消息注入 + 调 LLM)。
      pendingMessages = (await config.getSteeringMessages?.()) ?? [];
    }

    // ────────────────────────────────────────────────────────
    // 外层续命:follow-up 队列
    // ────────────────────────────────────────────────────────
    // 内层 while 退出了(没有 tool call + 没有 steer 消息)
    // 但 agent 整体不一定结束 —— follow-up 队列可能排了更多任务。
    //
    // 例如:用户说"先做 A,做完再做 B" → 系统把 B 排入 follow-up
    // A 完成后(A 的工具循环走完),这里把 B 注入,继续内层循环。
    const followUpMessages = (await config.getFollowUpMessages?.()) ?? [];
    if (followUpMessages.length > 0) {
      pendingMessages = followUpMessages;
      continue; // 回到外层 while 顶部,继续内层 while
    }

    break; // 真的没任务了,退出整个 agent
  }

  // 唯一一处"非错误路径的 agent_end"
  // 注意:上面所有 early return 都已经在 return 前 emit 过 agent_end,
  // 这里只覆盖"正常走完"的情况。
  await emit({ type: "agent_end", messages: newMessages });
}
