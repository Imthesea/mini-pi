/**
 * 用户消息组件：渲染用户输入的消息。
 *
 * 照抄 Pi user-message.ts 的结构（constructor + rebuild + render），
 * 去掉 Box/Markdown/theme/OSC133（V1 不涉及）。
 */

import { Container, Text } from "@mimi/tui";

/**
 * 渲染用户发送的消息。
 *
 * 照抄 Pi UserMessageComponent 的类结构。
 */
export class UserMessageComponent extends Container {
  private text: string;

  constructor(text: string) {
    super();
    this.text = text;
    this.rebuild();
  }

  /**
   * 重建子组件。
   * 照抄 Pi UserMessageComponent.rebuild()。
   */
  private rebuild(): void {
    this.clear();
    // V1：纯文本显示，">" 前缀标记用户消息
    this.addChild(new Text("> " + this.text, 0, 0));
  }

  /**
   * 渲染组件。
   * 照抄 Pi UserMessageComponent.render()。
   */
  override render(width: number): string[] {
    return super.render(width);
  }
}
