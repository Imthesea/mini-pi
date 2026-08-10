/**
 * TUI 的终端抽象层。
 *
 * 提供终端 I/O 的抽象接口和基于 Node.js process.stdin/stdout 的实现。
 * 负责 raw mode 管理、stdin 事件缓冲、resize 监听和光标控制。
 *
 * 照抄 Pi tui/src/terminal.ts 的核心 ProcessTerminal，不抄 Kitty 协议协商。
 */

import { StdinBuffer } from "./stdin-buffer.ts";

/**
 * TUI 的终端抽象接口。
 *
 * 定义了 TUI 框架与底层终端交互所需的最小 API：
 * 启动/停止、输入/输出、尺寸获取、光标控制。
 */
export interface Terminal {
  /** 启动终端：设置 raw mode，注册输入和 resize 回调 */
  start(onInput: (data: string) => void, onResize: () => void): void;

  /** 停止终端：恢复终端设置，移除所有监听器 */
  stop(): void;

  /**
   * 在退出前排空 stdin 中残留的数据。
   *
   * 防止 Kitty 按键释放事件等通过慢速 SSH 连接泄漏到父 shell。
   *
   * @param maxMs - 最大等待时间（毫秒），默认 1000
   * @param idleMs - 空闲超时（毫秒）：此时间内无新数据则提前退出，默认 50
   */
  drainInput(maxMs?: number, idleMs?: number): Promise<void>;

  /** 向终端写入数据（ANSI 转义序列或文本） */
  write(data: string): void;

  /** 终端列数 */
  get columns(): number;

  /** 终端行数 */
  get rows(): number;

  /**
   * 相对移动光标。
   *
   * @param lines - 正数向下移动，负数向上移动
   */
  moveBy(lines: number): void;

  /** 隐藏光标（ANSI DECTCEM） */
  hideCursor(): void;

  /** 显示光标 */
  showCursor(): void;
}

/**
 * ProcessTerminal：基于 Node.js process.stdin/stdout 的终端实现。
 *
 * 启动时：
 * 1. 开启 raw mode（逐字符读取，不缓冲行）
 * 2. 设置 stdin 编码为 utf8
 * 3. 注册 resize 事件监听
 * 4. 创建 StdinBuffer 将批量输入拆分为单个按键序列
 *
 * 照抄 Pi tui/src/terminal.ts
 */
export class ProcessTerminal implements Terminal {
  /** 启动前的 raw mode 状态（用于恢复） */
  private wasRaw = false;
  /** 当前注册的输入回调 */
  private inputHandler?: (data: string) => void;
  /** 当前注册的 resize 回调 */
  private resizeHandler?: () => void;
  /** stdin 输入缓冲器：将批量数据拆分为单个按键序列 */
  private stdinBuffer?: StdinBuffer;

  /**
   * 启动终端：接管 stdin/stdout。
   *
   * - 保存并启用 raw mode
   * - 设置 utf8 编码
   * - 注册 resize 监听
   * - 设置 StdinBuffer 管道：stdin → StdinBuffer → inputHandler
   *
   * @param onInput - 收到单个按键序列时的回调
   * @param onResize - 终端尺寸变化时的回调
   */
  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput;
    this.resizeHandler = onResize;

    // 保存原有状态并启用 raw mode
    this.wasRaw = process.stdin.isRaw || false;
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding("utf8");
    process.stdin.resume();

    // 注册 resize 事件监听
    process.stdout.on("resize", this.resizeHandler);

    // 设置 StdinBuffer 管道
    this.setupStdinBuffer();
  }

  /**
   * 设置 StdinBuffer 管道。
   *
   * 创建 StdinBuffer 实例，监听其 data 事件转发给 TUI 的 inputHandler。
   * 同时将 process.stdin 的 data 事件接入 StdinBuffer.process()。
   */
  private setupStdinBuffer(): void {
    this.stdinBuffer = new StdinBuffer({ timeout: 10 });
    this.stdinBuffer.on("data", (data: string) => {
      if (this.inputHandler) {
        this.inputHandler(data);
      }
    });
    process.stdin.on("data", (data: string) => {
      this.stdinBuffer?.process(data);
    });
  }

  /**
   * 停止终端：恢复设置，移除所有监听器。
   *
   * - 恢复 raw mode 到启动前状态
   * - 暂停 stdin
   * - 移除所有 data/resize 监听器
   * - 销毁 StdinBuffer
   * - 显示光标
   */
  stop(): void {
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(this.wasRaw);
    }
    process.stdin.pause();
    process.stdin.removeAllListeners("data");
    process.stdout.removeAllListeners("resize");
    this.stdinBuffer?.destroy();
    this.showCursor();
  }

  /**
   * 在退出前排空 stdin 中残留的数据。
   *
   * 持续读取 stdin 直到满足以下条件之一：
   * - 总时间超过 maxMs
   * - 连续 idleMs 毫秒无新数据
   *
   * @param maxMs - 最大等待时间（毫秒），默认 1000
   * @param idleMs - 空闲超时（毫秒），默认 50
   */
  async drainInput(maxMs: number = 1000, idleMs: number = 50): Promise<void> {
    const start = Date.now();
    let lastData = start;
    const buf = this.stdinBuffer;
    return new Promise<void>((resolve) => {
      const check = () => {
        const now = Date.now();
        if (now - start >= maxMs || now - lastData >= idleMs) {
          resolve();
          return;
        }
        setTimeout(check, 10);
      };
      const handler = () => {
        lastData = Date.now();
      };
      buf?.on("data", handler);
      check();
    });
  }

  /**
   * 向 stdout 写入数据。
   *
   * @param data - 要写入的字符串（通常是 ANSI 转义序列）
   */
  write(data: string): void {
    process.stdout.write(data);
  }

  /**
   * 获取终端列数。如果无法获取则返回默认值 80。
   */
  get columns(): number {
    return process.stdout.columns || 80;
  }

  /**
   * 获取终端行数。如果无法获取则返回默认值 24。
   */
  get rows(): number {
    return process.stdout.rows || 24;
  }

  /**
   * 相对移动光标。
   *
   * 使用 ANSI CSI 序列：\x1b[NB 向下 N 行，\x1b[NA 向上 N 行。
   *
   * @param lines - 正数向下，负数向上
   */
  moveBy(lines: number): void {
    if (lines > 0) {
      process.stdout.write(`\x1b[${lines}B`);
    } else if (lines < 0) {
      process.stdout.write(`\x1b[${-lines}A`);
    }
  }

  /**
   * 隐藏光标（ANSI DECTCEM：\x1b[?25l）。
   */
  hideCursor(): void {
    process.stdout.write("\x1b[?25l");
  }

  /**
   * 显示光标（ANSI DECTCEM：\x1b[?25h）。
   */
  showCursor(): void {
    process.stdout.write("\x1b[?25h");
  }
}
