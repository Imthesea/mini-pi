/**
 * 工具执行组件：渲染一次工具调用的状态。
 *
 * 从 pi 项目 modes/interactive/components/tool-execution.ts 抄来，V1 最小化。
 *
 * 照抄 Pi ToolExecutionComponent 的类结构和生命周期方法：
 *   updateArgs / markExecutionStarted / setArgsComplete / updateResult / invalidate / render。
 *
 * 🔴 V1 删减（后续可能做）：
 *   - theme/Box 背景色区分状态 → 用文字状态前缀 `[calling]/[running]/[done]/[error]` 替代
 *   - tool definitions 的 renderCall/renderResult 自定义渲染器 → 只用通用 fallback 显示
 *   - 图片显示（Image 组件）→ V1 无 Image 组件
 *   - expanded 展开/收起切换 → V1 无该交互
 *   - 工具输出缓存、kitty 图片转换 → 依赖上述删减项
 */

import { Container, Spacer, Text } from "@mimi/tui";

/** 工具执行结果（兼容 AgentToolResult 的简化形状，只取文本） */
export interface ToolExecutionResult {
  content: Array<{ type: string; text?: string; data?: string }>;
  isError: boolean;
}

/**
 * 渲染一次工具调用：状态 + 工具名 + 参数 + 结果文本。
 *
 * 照抄 Pi ToolExecutionComponent 的类结构。
 */
export class ToolExecutionComponent extends Container {
  private toolName: string;
  private toolCallId: string;
  private args: any;
  /** 参数是否仍在流式中（未定稿） */
  private isPartial = true;
  /** 工具是否已开始执行 */
  private executionStarted = false;
  /** 参数是否已定稿（消息正常结束后） */
  private argsComplete = false;
  /** 工具执行结果 */
  private result?: ToolExecutionResult;

  constructor(toolName: string, toolCallId: string, args: any) {
    super();
    this.toolName = toolName;
    this.toolCallId = toolCallId;
    this.args = args;
    this.addChild(new Spacer(1));
    this.updateDisplay();
  }

  /**
   * 更新流式参数。
   * 照抄 Pi ToolExecutionComponent.updateArgs()。
   */
  updateArgs(args: any): void {
    this.args = args;
    this.updateDisplay();
  }

  /**
   * 标记工具开始执行。
   * 照抄 Pi ToolExecutionComponent.markExecutionStarted()。
   */
  markExecutionStarted(): void {
    this.executionStarted = true;
    this.updateDisplay();
  }

  /**
   * 标记参数已定稿。
   * 照抄 Pi ToolExecutionComponent.setArgsComplete()。
   */
  setArgsComplete(): void {
    this.argsComplete = true;
    this.updateDisplay();
  }

  /**
   * 更新工具执行结果。
   * 照抄 Pi ToolExecutionComponent.updateResult()。
   *
   * @param result - 执行结果（content + isError）
   * @param isPartial - 是否为部分结果（流式更新）
   */
  updateResult(result: ToolExecutionResult, isPartial = false): void {
    this.result = result;
    this.isPartial = isPartial;
    this.updateDisplay();
  }

  /**
   * 使缓存失效并重建。
   * 照抄 Pi ToolExecutionComponent.invalidate()。
   */
  override invalidate(): void {
    super.invalidate();
    this.updateDisplay();
  }

  /**
   * 渲染组件。
   * 照抄 Pi ToolExecutionComponent.render()。
   */
  override render(width: number): string[] {
    return super.render(width);
  }

  /**
   * 重建显示内容。
   *
   * 照抄 Pi updateDisplay 的通用 fallback 分支（formatToolExecution），
   * 🔴 V1 删减：Box 背景色状态区分 → 文字状态前缀替代。
   */
  private updateDisplay(): void {
    this.clear();

    // 状态 + 工具名
    const status = this.result
      ? this.result.isError
        ? "[error]"
        : "[done]"
      : this.executionStarted
        ? "[running]"
        : "[calling]";
    this.addChild(new Text(`${status} ${this.toolName}`, 0, 0));

    // 参数（照抄 pi：JSON.stringify(args, null, 2)，缩进 2 格）
    const argsText = JSON.stringify(this.args, null, 2);
    if (argsText && argsText !== "{}") {
      for (const line of argsText.split("\n")) {
        this.addChild(new Text(line, 2, 0));
      }
    }

    // 结果文本（照抄 pi getTextOutput）
    const output = this.getTextOutput();
    if (output) {
      for (const line of output.split("\n")) {
        this.addChild(new Text(line, 2, 0));
      }
    }
  }

  /** 提取结果的纯文本（照抄 Pi getTextOutput 简化） */
  private getTextOutput(): string {
    if (!this.result) return "";
    return this.result.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");
  }
}
