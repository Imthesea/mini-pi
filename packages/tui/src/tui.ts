/**
 * 最小化 TUI 框架：Component + Container + TUI，带差分渲染。
 * 照抄 Pi tui/src/tui.ts 的核心架构，不抄 overlay 系统、Kitty 图片、终端颜色检测。
 */

import type { Terminal } from "./terminal.ts";

// ═══════════════════════════════════════════
// Component 接口
// ═══════════════════════════════════════════

/**
 * Component 接口 —— 所有 UI 组件必须实现。
 *
 * TUI 框架的核心抽象。每个组件必须能将自己渲染为 ANSI 字符串数组，
 * 可选地处理键盘输入和缓存失效。
 *
 * 照抄 Pi tui/src/tui.ts Component
 */
export interface Component {
  /**
   * 将组件渲染为 ANSI 字符串数组，每个元素代表终端上的一行。
   *
   * render() 应该是纯函数：给定相同的 width，始终返回相同的输出。
   * 有状态的组件可以在内部缓存渲染结果。
   *
   * @param width - 当前终端视口宽度（列数）
   * @returns 字符串数组，每个字符串代表终端上的一行（可包含 ANSI 转义序列）
   */
  render(width: number): string[];

  /**
   * 处理键盘输入（可选实现）。
   *
   * 仅当组件拥有焦点时被 TUI 调用。接收的是 StdinBuffer 处理后的
   * 单个按键序列（如 "enter"、"backspace"、"a" 等）。
   *
   * @param data - 原始按键序列字符串
   */
  handleInput?(data: string): void;

  /**
   * 使组件缓存的所有渲染状态失效。
   *
   * 当主题改变或组件需要从头重新渲染时调用。
   * 下一次 render() 调用应该重新计算所有内容。
   */
  invalidate(): void;
}

// ═══════════════════════════════════════════
// Container 容器
// ═══════════════════════════════════════════

/**
 * Container —— 包含其他组件的容器组件。
 *
 * Container 本身不渲染任何内容，只按顺序拼接所有子组件的渲染输出。
 * 子组件按添加顺序从上到下排列。
 *
 * 照抄 Pi tui/src/tui.ts Container
 */
export class Container implements Component {
  /** 子组件列表 */
  children: Component[] = [];

  /**
   * 添加一个子组件到末尾。
   *
   * @param component - 要添加的组件
   */
  addChild(component: Component): void {
    this.children.push(component);
  }

  /**
   * 移除一个子组件。
   *
   * @param component - 要移除的组件引用
   */
  removeChild(component: Component): void {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  /**
   * 清空所有子组件。
   */
  clear(): void {
    this.children = [];
  }

  /**
   * 递归使所有子组件的缓存渲染状态失效。
   */
  invalidate(): void {
    for (const child of this.children) {
      child.invalidate();
    }
  }

  /**
   * 渲染容器：按顺序拼接所有子组件的渲染输出。
   *
   * @param width - 终端视口宽度，传递给每个子组件
   * @returns 拼接后的行数组
   */
  render(width: number): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      const childLines = child.render(width);
      for (const line of childLines) {
        lines.push(line);
      }
    }
    return lines;
  }
}

// ═══════════════════════════════════════════
// TUI 根节点
// ═══════════════════════════════════════════

/**
 * TUI —— 根组件，管理整个终端 UI。
 *
 * TUI 是组件树的根节点，负责：
 * 1. 启动/停止终端 raw mode
 * 2. 焦点管理（输入路由到当前焦点组件）
 * 3. 差分渲染（只更新变化的行，避免闪烁）
 * 4. 渲染防抖（最多 60fps）
 *
 * 照抄 Pi tui/src/tui.ts TUI，差分渲染简化版。
 */
export class TUI extends Container {
  /** 底层终端实例 */
  public terminal: Terminal;
  /** 上一帧的渲染结果（用于差分对比） */
  private previousLines: string[] = [];
  /** 上一帧的终端宽度 */
  private previousWidth = 0;
  /** 当前拥有焦点的组件 */
  private focusedComponent: Component | null = null;
  /** 是否已请求渲染（防抖标记） */
  private renderRequested = false;
  /** 渲染防抖定时器 */
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  /** 上一次渲染的时间戳（毫秒） */
  private lastRenderAt = 0;
  /** 最小渲染间隔（毫秒），约 60fps */
  private static readonly MIN_RENDER_INTERVAL_MS = 16;
  /** 是否已停止 */
  private stopped = false;

  /**
   * @param terminal - 底层终端实例（通常为 ProcessTerminal）
   */
  constructor(terminal: Terminal) {
    super();
    this.terminal = terminal;
  }

  /**
   * 设置焦点组件。
   *
   * 焦点组件会接收所有键盘输入（通过 handleInput）。
   * 设为 null 表示没有组件接收输入。
   *
   * @param component - 要获得焦点的组件，或 null
   */
  setFocus(component: Component | null): void {
    this.focusedComponent = component;
  }

  /**
   * 获取当前拥有焦点的组件。
   *
   * @returns 焦点组件或 null
   */
  getFocusedComponent(): Component | null {
    return this.focusedComponent;
  }

  /**
   * 启动 TUI：接管终端，开始渲染循环。
   *
   * 1. 调用 terminal.start() 开启 raw mode 并注册输入/resize 回调
   * 2. 隐藏光标
   * 3. 请求首次渲染
   */
  start(): void {
    this.stopped = false;
    this.terminal.start(
      (data: string) => this.handleInput(data),
      () => this.requestRender(),
    );
    this.terminal.hideCursor();
    this.requestRender();
  }

  /**
   * 停止 TUI：恢复终端，退出渲染循环。
   *
   * 1. 标记为已停止
   * 2. 清除渲染定时器
   * 3. 将光标移到内容末尾
   * 4. 调用 terminal.stop() 恢复终端设置
   */
  stop(): void {
    this.stopped = true;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }
    // 将光标移到内容末尾，避免退出后残留内容被 shell 提示符覆盖
    if (this.previousLines.length > 0) {
      this.terminal.write(" ");
      this.terminal.write("\r\n");
    }
    this.terminal.stop();
  }

  /**
   * 请求下一帧渲染（带防抖）。
   *
   * 多次连续调用会被合并为一次渲染，最短间隔 16ms（约 60fps）。
   * 如果组件状态变化频繁（如流式文本），此方法确保不会过度渲染。
   *
   * 照抄 Pi requestRender
   */
  requestRender(): void {
    if (this.renderRequested || this.stopped) return;
    this.renderRequested = true;

    const now = Date.now();
    const elapsed = now - this.lastRenderAt;
    const delay = Math.max(0, TUI.MIN_RENDER_INTERVAL_MS - elapsed);

    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      this.renderRequested = false;
      this.performRender();
    }, delay);
  }

  /**
   * 执行一次渲染。
   *
   * V1 简化：不做差分，每次都全量清屏重绘。
   * 差分渲染需要精确的光标位置追踪，V1 的简化版做不到，
   * 全量重绘对文本聊天应用性能完全足够。
   */
  private performRender(): void {
    if (this.stopped) return;
    this.lastRenderAt = Date.now();

    const width = this.terminal.columns;
    const newLines = this.render(width);

    this.fullRender(newLines, true);
    this.previousLines = newLines;
    this.previousWidth = width;
  }

  /**
   * 全量渲染：清屏后输出所有行。
   *
   * 使用 ANSI 转义序列：
   * - \x1b[2J：清屏
   * - \x1b[H：光标归位
   * - \x1b[3J：清除滚动缓冲区
   *
   * @param lines - 要渲染的所有行
   * @param clear - 是否先清屏
   */
  private fullRender(lines: string[], clear: boolean): void {
    let buffer = "";
    if (clear) {
      buffer += "\x1b[2J\x1b[H\x1b[3J"; // 清屏 + 光标归位 + 清滚动缓冲
    }
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) buffer += "\r\n";
      buffer += lines[i];
    }
    this.terminal.write(buffer);
  }

  /**
   * 将键盘输入转发给当前焦点组件。
   *
   * 从 terminal.start() 的 onInput 回调中调用。
   * 输入数据已经是 StdinBuffer 处理后的单个完整按键序列。
   *
   * @param data - 按键序列字符串
   */
  private handleInput(data: string): void {
    // 照抄 Pi：转发输入给焦点组件后立即请求重绘
    if (this.focusedComponent?.handleInput) {
      this.focusedComponent.handleInput(data);
      this.requestRender();
    }
  }
}
