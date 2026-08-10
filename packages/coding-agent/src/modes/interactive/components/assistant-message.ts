/**
 * 助手消息组件：渲染 AI 助手的回复消息。
 *
 * 照抄 Pi assistant-message.ts 的结构（constructor + updateContent + render），
 * 去掉 Markdown/theme/OSC133（V1 不涉及）。
 */

import type { AssistantMessage } from "@mimi/ai";
import { Container, Spacer, Text } from "@mimi/tui";

/**
 * 渲染助手（AI）发送的消息。
 *
 * 支持流式更新：外部调用 updateContent() 更新消息内容后 requestRender()。
 *
 * 照抄 Pi AssistantMessageComponent 的类结构。
 */
export class AssistantMessageComponent extends Container {
  /** 纯文本/thinking 内容的容器 */
  private contentContainer: Container;
  /** 最近一次 updateContent 传入的消息（用于 invalidate 重建） */
  private lastMessage?: AssistantMessage;

  constructor(message?: AssistantMessage) {
    super();

    // 内容容器（照抄 Pi）
    this.contentContainer = new Container();
    this.addChild(this.contentContainer);

    if (message) {
      this.updateContent(message);
    }
  }

  /**
   * 使缓存失效并重建内容。
   * 照抄 Pi AssistantMessageComponent.invalidate()。
   */
  override invalidate(): void {
    super.invalidate();
    if (this.lastMessage) {
      this.updateContent(this.lastMessage);
    }
  }

  /**
   * 更新消息内容并重建渲染。
   *
   * 照抄 Pi AssistantMessageComponent.updateContent()，简化：
   * - 去掉 Markdown 渲染 → 用 Text 纯文本
   * - 去掉 theme 颜色 → 纯文本
   * - 保留 thinking 块的处理逻辑（灰色缩进显示）
   * - 保留 stopReason 错误/中断处理
   *
   * @param message - 助手消息（可能还在流式更新中）
   */
  updateContent(message: AssistantMessage): void {
    this.lastMessage = message;

    // 清空内容容器
    this.contentContainer.clear();

    // 遍历消息内容，按顺序渲染
    for (let i = 0; i < message.content.length; i++) {
      const content = message.content[i];

      // 文本块
      if (content.type === "text" && content.text.trim()) {
        this.contentContainer.addChild(new Text(content.text.trim(), 0, 0));
      }
      // thinking 块：合并连续的 thinking 为一个区块，灰色缩进显示
      else if (content.type === "thinking") {
        const thinkingLines: string[] = [];
        for (; i < message.content.length; i++) {
          const thinkingContent = message.content[i];
          if (thinkingContent.type !== "thinking") {
            i--; // 回退，让外层循环处理下一个非 thinking 块
            break;
          }
          const thinking = thinkingContent.thinking.trim();
          if (thinking) {
            thinkingLines.push(thinking);
          }
        }

        if (thinkingLines.length > 0) {
          // 每个 thinking 行以灰色缩进 2 格显示
          this.contentContainer.addChild(new Spacer(1));
          for (const line of thinkingLines) {
            this.contentContainer.addChild(new Text(line, 2, 0));
          }
        }
      }
    }

    // 处理停止原因（照抄 Pi 的错误/中断/超长显示）
    if (message.stopReason === "length") {
      this.contentContainer.addChild(new Spacer(1));
      this.contentContainer.addChild(
        new Text("Error: Model stopped because it reached the maximum output token limit. The response may be incomplete.", 0, 0),
      );
    } else if (message.stopReason === "aborted") {
      const abortMessage =
        message.errorMessage && message.errorMessage !== "Request was aborted"
          ? message.errorMessage
          : "Operation aborted";
      this.contentContainer.addChild(new Spacer(1));
      this.contentContainer.addChild(new Text(abortMessage, 0, 0));
    } else if (message.stopReason === "error") {
      const errorMsg = message.errorMessage || "Unknown error";
      this.contentContainer.addChild(new Spacer(1));
      this.contentContainer.addChild(new Text(`Error: ${errorMsg}`, 0, 0));
    }
  }

  /**
   * 渲染组件。
   * 照抄 Pi AssistantMessageComponent.render()。
   */
  override render(width: number): string[] {
    return super.render(width);
  }
}
