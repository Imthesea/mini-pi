/**
 * 首次设置对话框：收集 API Key。
 *
 * 照抄 Pi first-time-setup.ts 的代码结构，仅去掉主题选择和分析 opt-in（V1 不涉及）。
 */

import { Container, Input, Spacer, Text } from "@mimi/tui";
import { APP_NAME } from "../../../config.ts";

// ═══════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════

/** 首次设置完成后的结果 */
export interface FirstTimeSetupResult {
  /** 用户输入的 API Key */
  apiKey: string;
}

/** 首次设置组件的配置选项 */
export interface FirstTimeSetupOptions {
  /** 用户确认后的回调 */
  onSubmit: (result: FirstTimeSetupResult) => void;
  /** 用户取消的回调 */
  onCancel: () => void;
}

// ═══════════════════════════════════════════
// Logo（照抄 Pi 的 SETUP_LOGO_LINES 格式）
// ═══════════════════════════════════════════

const SETUP_LOGO_LINES = ["███╗   ███╗██╗███╗   ███╗██╗", "████╗ ████║██║████╗ ████║██║", "██╔████╔██║██║██╔████╔██║██║", "██║╚██╔╝██║██║██║╚██╔╝██║██║", "██║ ╚═╝ ██║██║██║ ╚═╝ ██║██║", "╚═╝     ╚═╝╚═╝╚═╝     ╚═╝╚═╝"];

// ═══════════════════════════════════════════
// FirstTimeSetupComponent
// ═══════════════════════════════════════════

/**
 * 首次设置界面组件。
 *
 * 照抄 Pi FirstTimeSetupComponent 的代码结构：
 * - 构造时调用 update() 构建 UI
 * - update() 负责清空并重建所有子组件
 * - handleInput 路由按键到内嵌的 Input 组件
 */
export class FirstTimeSetupComponent extends Container {
  private readonly options: FirstTimeSetupOptions;
  /** 内嵌的单行输入组件 */
  private readonly inputComponent: Input;

  constructor(options: FirstTimeSetupOptions) {
    super();
    this.options = options;

    // 创建 Input 并绑定回调
    this.inputComponent = new Input();
    this.inputComponent.onSubmit = (value: string) => {
      if (value.trim()) {
        options.onSubmit({ apiKey: value.trim() });
      }
    };
    this.inputComponent.onEscape = () => {
      options.onCancel();
    };

    // 构建初始 UI（照抄 Pi：构造后调用 update 重建）
    this.update();
  }

  /**
   * 重建整个对话框。
   * 照抄 Pi FirstTimeSetupComponent.update()。
   */
  private update(): void {
    this.clear();

    // Logo
    this.addChild(new Text(SETUP_LOGO_LINES.join("\n"), 2, 0));
    this.addChild(new Spacer(1));

    // 欢迎语
    this.addChild(new Text(`Welcome to ${APP_NAME}, the minimal coding agent.`, 2, 0));
    this.addChild(new Spacer(1));

    // 提示文字
    this.addChild(new Text("To get started, enter your DeepSeek API key:", 2, 0));
    this.addChild(new Text("(Create one at https://platform.deepseek.com/api_keys)", 2, 0));
    this.addChild(new Spacer(1));

    // 输入框
    this.addChild(this.inputComponent);
    this.addChild(new Spacer(1));

    // 操作提示
    this.addChild(new Text("Enter to confirm  |  Esc to skip setup", 2, 0));
  }

  /**
   * 处理键盘输入，转发给内嵌的 Input 组件。
   * 照抄 Pi FirstTimeSetupComponent.handleInput()。
   */
  handleInput(data: string): void {
    this.inputComponent.handleInput?.(data);
  }
}
