/**
 * 泛型事件流：支持推送事件、异步迭代、最终结果 Promise。
 * T = 事件类型，R = 最终结果类型。
 *
 * 从 pi 项目的 utils/event-stream.ts 原样保留。
 */
export class EventStream<T, R = T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiting: ((value: IteratorResult<T>) => void)[] = [];
  private done = false;
  private finalResultPromise: Promise<R>;
  private resolveFinalResult!: (result: R) => void;
  private isComplete: (event: T) => boolean;
  private extractResult: (event: T) => R;

  constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
    this.isComplete = isComplete;
    this.extractResult = extractResult;
    this.finalResultPromise = new Promise((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }

  /** 推送一个事件到流中。如果是终端事件，标记流为完成。 */
  push(event: T): void {
    if (this.done) return;

    if (this.isComplete(event)) {
      this.done = true;
      this.resolveFinalResult(this.extractResult(event));
    }

    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  /** 手动结束流。 */
  end(result?: R): void {
    this.done = true;
    if (result !== undefined) {
      this.resolveFinalResult(result);
    }
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter({ value: undefined as any, done: true });
    }
  }

  /** 异步迭代器：支持 for await...of 消费事件。 */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise<IteratorResult<T>>((resolve) => this.waiting.push(resolve));
        if (result.done) return;
        yield result.value;
      }
    }
  }

  /** 获取最终结果的 Promise。 */
  result(): Promise<R> {
    return this.finalResultPromise;
  }
}

import type { AssistantMessage, AssistantMessageEvent } from "./types.js";

/**
 * LLM 专用事件流。
 * 终端事件为 "done"（成功）或 "error"（失败/中止）。
 * 最终结果为 AssistantMessage。
 */
export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("非法的终端事件类型");
      },
    );
  }
}
