/**
 * 事件流模块 —— 当前只有一个文件，后续可扩展（如缓冲流、合并流、过滤流等）。
 *
 * 泛型事件流：支持推送事件、异步迭代、最终结果 Promise。
 * T = 事件类型，R = 最终结果类型。
 *
 * 从 pi 项目的 utils/event-stream.ts 原样保留。
 *
 * ════════════════ 设计原理 ════════════════
 * EventStream 是一个"生产者-消费者"桥梁：
 *
 *   生产者（LLM 响应流）──push()──→ EventStream ──for await──→ 消费者（调用方）
 *
 * 内部用两条通道连接两端：
 *   1. queue[] : 生产者比消费者先到达时，事件暂存在队列里
 *   2. waiting[]: 消费者先到达（没事件可消费），把 Promise 的 resolve 存入等待队列，
 *                 等生产者 push 时直接 resolve，事件不经过 queue
 *
 * 状态机：
 *   done=false  → 终端事件或 end() →  done=true （流关闭，后续 push 无效）
 *
 * 使用方式（以 AssistantMessageEventStream 为例）：
 *   const stream = new AssistantMessageEventStream();
 *   llmStream.on("data",  chunk => stream.push(parseChunk(chunk)));
 *   llmStream.on("end",   ()    => stream.push({ type: "done", ... }));
 *   for await (const event of stream) { handle(event); }
 *   const finalMsg = await stream.result();
 */
export class EventStream<T, R = T> implements AsyncIterable<T> {
  // ── 内部状态 ──

  /** 事件缓冲队列：消费者还没开始迭代时，生产者 push 的事件暂存于此 */
  private queue: T[] = [];

  /**
   * 等待队列：消费者已经开始迭代但 queue 为空时，
   * 会把 Promise 的 resolve 函数存入此队列。
   * 等生产者 push 时，从队首取出 resolve 并直接调用，
   * 这样消费者立即拿到事件，事件不经过 queue。
   */
  private waiting: ((value: IteratorResult<T>) => void)[] = [];

  /** 流是否已关闭。关闭后 push() 直接 return，不会再有新事件。 */
  private done = false;

  /** 最终结果的 Promise。在终端事件或 end() 调用时 resolve。 */
  private finalResultPromise: Promise<R>;

  /** resolveFinalResult 是 finalResultPromise 的 resolve 函数，
   *  在构造函数中赋值，终端事件到来时调用。 */
  private resolveFinalResult!: (result: R) => void;

  /** 判断事件是否为终端事件（如 LLM 的 "done" / "error"） */
  private isComplete: (event: T) => boolean;

  /** 从终端事件中提取最终结果（如从 done 事件取 message 字段） */
  private extractResult: (event: T) => R;

  // ── 构造函数 ──

  /**
   * @param isComplete   判断一个事件是否为终端事件
   * @param extractResult 从终端事件中提取最终结果 R
   */
  constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
    this.isComplete = isComplete;
    this.extractResult = extractResult;

    // 创建 finalResultPromise 并立即保存它的 resolve 函数，
    // 后续终端事件或 end() 调用时用 resolveFinalResult 来 resolve 它
    this.finalResultPromise = new Promise((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }

  // ── 生产者接口 ──

  /**
   * 推送一个事件到流中。
   *
   * 内部逻辑（按顺序）：
   *   1. done=true → 直接 return，忽略事件
   *   2. 如果是终端事件 → 设置 done=true 并 resolve 最终结果 Promise
   *   3. 检查 waiting 队列：有人在等 → 直接 resolve 给他（事件不经过 queue）
   *   4. 没人在等 → 事件 push 到 queue 里等待消费者
   *
   * 注意：终端事件本身也会被传递给消费者（步骤 3/4 在步骤 2 之后执行）。
   */
  push(event: T): void {
    // 流已关闭，忽略后续事件
    if (this.done) return;

    // 检测是否为终端事件（如 "done" 或 "error"）
    if (this.isComplete(event)) {
      this.done = true;                                          // 标记流关闭
      this.resolveFinalResult(this.extractResult(event));        // resolve 最终结果 Promise
    }

    // 传递事件给消费者：优先走 waiting 直通通道，否则进 queue
    const waiter = this.waiting.shift();   // 尝试从等待队列取一个 resolve
    if (waiter) {
      // 有消费者在等 → 直接 resolve，事件不经过 queue
      waiter({ value: event, done: false });
    } else {
      // 没有消费者在等 → 事件进缓冲队列
      this.queue.push(event);
    }
  }

  /**
   * 手动结束流（不依赖终端事件）。
   *
   * 做了三件事：
   *   1. 设置 done=true（阻止后续 push）
   *   2. 如果传入了 result，resolve 最终结果 Promise
   *   3. 清空 waiting 队列：给每个等待者发送 { done: true } 信号，
   *      让他们的 for await 循环正常退出
   *
   * @param result 可选的最终结果（未提供时 result() 的 Promise 不会 resolve）
   */
  end(result?: R): void {
    this.done = true;

    // 如果调用方传了最终结果，直接 resolve
    if (result !== undefined) {
      this.resolveFinalResult(result);
    }

    // 清空所有等待中的消费者，通知他们迭代结束
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter({ value: undefined as any, done: true });  // done:true 让消费者退出循环
    }
  }

  // ── 消费者接口 ──

  /**
   * 异步迭代器 —— 支持 `for await (const event of stream)` 消费事件。
   *
   * 循环逻辑：
   *   1. queue 有数据 → 直接从队列取（不阻塞，立即 yield）
   *   2. queue 为空 且 done=true → return 退出（流已结束，无更多事件）
   *   3. queue 为空 且 done=false → 创建一个 Promise 并将 resolve 存入 waiting，
   *      阻塞等待生产者 push（push 时会取出 resolve 并调用，解除阻塞）
   *
   * 每条路径的具体行为：
   *   - 第 1 条：yield 后回到 while(true) 顶部，继续检查 queue
   *   - 第 2 条：return 结束生成器，for await 循环退出
   *   - 第 3 条：await 阻塞直到被 push() 唤醒，
   *     → 如果 result.done=true（由 end() 发送）→ return 退出
   *     → 如果 result.done=false → yield 事件值，回到循环顶部
   */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length > 0) {
        // 情况 1：queue 里有缓存的事件，直接取出 yield（不阻塞）
        yield this.queue.shift()!;
      } else if (this.done) {
        // 情况 2：流已结束且 queue 为空 → 正常退出
        return;
      } else {
        // 情况 3：queue 为空但流还在运行 → 阻塞等待生产者 push
        const result = await new Promise<IteratorResult<T>>(
          (resolve) => this.waiting.push(resolve)   // 把 resolve 存入 waiting，等 push() 调用
        );
        if (result.done) return;    // end() 发来的关闭信号 → 退出
        yield result.value;         // 正常事件 → yield 给消费者
      }
    }
  }

  /**
   * 获取最终结果的 Promise。
   *
   * 这个 Promise 在以下情况下 resolve：
   *   - push() 检测到终端事件时
   *   - end(result) 手动传入结果时
   *
   * 用途：消费者在 for await 结束后，通过 await stream.result() 拿到最终产物。
   */
  result(): Promise<R> {
    return this.finalResultPromise;
  }
}

// ══════════════════════════════════════════════════════════════════════
// LLM 专用子类
// ══════════════════════════════════════════════════════════════════════

import type { AssistantMessage, AssistantMessageEvent } from "../types.js";

/**
 * LLM 专用事件流。
 *
 * 继承 EventStream<AssistantMessageEvent, AssistantMessage>，
 * 只指定了两个构造参数：
 *
 *   isComplete: event.type === "done" 或 "error" 时视为终端
 *   extractResult:
 *     - done  → 取 event.message（成功时返回完整的 AssistantMessage）
 *     - error → 取 event.error（失败/中止时也返回 AssistantMessage）
 *     - 其他 → 抛错（理论不会走到，类型系统保证了终端事件只有 done/error）
 *
 * 事件类型（AssistantMessageEvent 的完整定义见 types.ts）：
 *   start / text_start / text_delta / text_end
 *   thinking_start / thinking_delta / thinking_end
 *   toolcall_start / toolcall_delta / toolcall_end
 *   done（终端） / error（终端）
 */
export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor() {
    super(
      // isComplete: "done" 或 "error" 类型视为终端事件
      (event) => event.type === "done" || event.type === "error",
      // extractResult: 从终端事件中提取 AssistantMessage
      (event) => {
        if (event.type === "done") return event.message;    // 成功终结 → 返回完整消息
        if (event.type === "error") return event.error;      // 失败/中止 → 返回含错误信息的消息
        throw new Error("非法的终端事件类型");               // 防御性代码，正常不应到达
      },
    );
  }
}
