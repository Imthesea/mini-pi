/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 *
 * 从 pi 项目 modes/interactive/interactive-mode.ts 抄来，V1 最小化。
 *
 * 照抄 Pi 的类结构和代码组织方式。
 * 不抄（V1 不做）：扩展系统、footer、快捷键、自动补全、主题、changelog、
 *   tool execution 组件、bash 组件、compaction UI、剪贴板、图片、slash 命令、session 选择器。
 */

import type { ImageContent } from "@mimi/ai";
import { Container, Input, ProcessTerminal, Spacer, Text, TUI } from "@mimi/tui";
import { APP_NAME, VERSION } from "../../config.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.ts";
import { AssistantMessageComponent } from "./components/assistant-message.ts";
import { UserMessageComponent } from "./components/user-message.ts";

// ═══════════════════════════════════════════
// InteractiveModeOptions（照抄 Pi）
// ═══════════════════════════════════════════

export interface InteractiveModeOptions {
  /** Providers that were migrated to auth.json (shows warning). 🔴 V1 桩 */
  migratedProviders?: string[];
  /** Warning message if session model couldn't be restored. 🔴 V1 桩 */
  modelFallbackMessage?: string;
  /** Cwd to trust after reload. 🔴 V1 桩 */
  autoTrustOnReloadCwd?: string;
  /** Initial message to send on startup */
  initialMessage?: string;
  /** Images to attach to the initial message */
  initialImages?: ImageContent[];
  /** Additional messages to send after the initial message */
  initialMessages?: string[];
  /** Force verbose startup. 🔴 V1 桩 */
  verbose?: boolean;
}

// ═══════════════════════════════════════════
// InteractiveMode（照抄 Pi）
// ═══════════════════════════════════════════

export class InteractiveMode {
  // ── 核心依赖（照抄 Pi 属性声明顺序）──
  private runtimeHost: AgentSessionRuntime;
  private ui: TUI;
  private chatContainer: Container;
  private statusContainer: Container;

  // ── 输入（Pi 用 Editor，V1 用 Input）──
  private inputComponent: Input;

  // ── 状态（照抄 Pi）──
  private version: string;
  private isInitialized = false;
  private pendingUserInputs: string[] = [];
  private shutdownRequested = false;

  // ── 流式消息跟踪（照抄 Pi）──
  private streamingComponent: AssistantMessageComponent | undefined = undefined;
  private streamingMessage: any | undefined = undefined; // AssistantMessage

  // ── Thinking block 可见性（照抄 Pi）──
  private hideThinkingBlock = false;

  // ── 事件订阅（照抄 Pi）──
  private unsubscribe?: () => void;
  private signalCleanupHandlers: Array<() => void> = [];

  // ── 其他（照抄 Pi）──
  private lastSigintTime = 0;
  private options: InteractiveModeOptions;

  // ═══════════════════════════════════════════
  // 便捷访问器（照抄 Pi）
  // ═══════════════════════════════════════════

  private get session(): AgentSession {
    return this.runtimeHost.session;
  }

  // ═══════════════════════════════════════════
  // constructor（照抄 Pi 结构）
  // ═══════════════════════════════════════════

  constructor(runtimeHost: AgentSessionRuntime, options: InteractiveModeOptions = {}) {
    this.runtimeHost = runtimeHost;
    this.options = options;
    this.version = VERSION;

    // 创建 TUI 和容器（照抄 Pi）
    this.ui = new TUI(new ProcessTerminal());
    this.chatContainer = new Container();
    this.statusContainer = new Container();

    // 创建输入组件（照抄 Pi：editor 的创建位置）
    this.inputComponent = new Input();
  }

  // ═══════════════════════════════════════════
  // init / run / stop（照抄 Pi）
  // ═══════════════════════════════════════════

  /**
   * 初始化交互模式。在 run() 之前调用一次。
   * 照抄 Pi InteractiveMode.init()。
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.registerSignalHandlers();

    // 组装 UI 树：消息区在上，状态栏在中，输入框在下（照抄 Pi 的 addChild 顺序）
    this.ui.addChild(this.chatContainer);
    this.ui.addChild(this.statusContainer);
    this.ui.addChild(new Spacer(1));
    this.ui.addChild(this.inputComponent);
    this.ui.setFocus(this.inputComponent);

    // 订阅 Agent 事件 → UI 更新
    this.setupSessionSubscription();

    // 设置输入提交回调
    this.inputComponent.onSubmit = (text: string) => {
      if (text.trim()) {
        void this.handleUserInput(text);
      }
    };

    // 启动 TUI（接管终端）
    this.ui.start();
    this.isInitialized = true;
  }

  /**
   * 主入口：init + run。等价于 Pi 的 start 模式。
   * 照抄 Pi InteractiveMode.start()。
   */
  static async start(runtime: AgentSessionRuntime, options?: InteractiveModeOptions): Promise<number> {
    const mode = new InteractiveMode(runtime, options);
    await mode.init();
    return mode.run();
  }

  /**
   * 运行主事件循环。
   * 照抄 Pi InteractiveMode.run()。
   */
  async run(): Promise<number> {
    let exitCode = 0;

    await this.init();

    // ── 显示启动信息（照抄 Pi）──
    const { migratedProviders, modelFallbackMessage, initialMessage, initialMessages } = this.options;

    if (migratedProviders && migratedProviders.length > 0) {
      this.showWarning(`Migrated credentials to auth.json: ${migratedProviders.join(", ")}`);
    }

    if (modelFallbackMessage) {
      this.showWarning(modelFallbackMessage);
    }

    // ── Welcome（照抄 Pi 的 logo + 说明）──
    this.showWelcome();

    // ── 处理初始消息（照抄 Pi）──
    if (initialMessage) {
      try {
        await this.session.prompt(initialMessage, { images: this.options.initialImages });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        this.showError(errorMessage);
      }
    }

    if (initialMessages) {
      for (const message of initialMessages) {
        try {
          await this.session.prompt(message);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
          this.showError(errorMessage);
        }
      }
    }

    // ── 主事件循环（照抄 Pi）──
    // TUI 接管后一切由事件驱动：
    //   input.onSubmit → session.prompt → message_update → 组件更新 → requestRender
    // run() 等待 shutdown 信号
    while (!this.shutdownRequested) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await this.cleanup();
    return exitCode;
  }

  /**
   * 停止交互模式。
   * 照抄 Pi InteractiveMode.stop()。
   */
  stop(): void {
    this.shutdownRequested = true;
  }

  /**
   * 清理资源。
   * 照抄 Pi InteractiveMode.cleanup()。
   */
  private async cleanup(): Promise<void> {
    this.unsubscribe?.();
    for (const cleanup of this.signalCleanupHandlers) {
      cleanup();
    }
    this.signalCleanupHandlers = [];
    this.ui.stop();
  }

  // ═══════════════════════════════════════════
  // 信号处理（照抄 Pi registerSignalHandlers）
  // ═══════════════════════════════════════════

  /**
   * 注册 SIGINT / SIGTERM 信号处理器。
   * 照抄 Pi InteractiveMode.registerSignalHandlers()。
   */
  private registerSignalHandlers(): void {
    const onSigint = () => {
      const now = Date.now();
      if (now - this.lastSigintTime < 500) {
        // 双击 Ctrl+C → 退出
        this.shutdownRequested = true;
      } else {
        this.lastSigintTime = now;
        // 单次 Ctrl+C → 中断当前操作
        this.session.abort?.();
      }
    };
    process.on("SIGINT", onSigint);
    this.signalCleanupHandlers.push(() => process.off("SIGINT", onSigint));
  }

  // ═══════════════════════════════════════════
  // Agent 事件订阅（照抄 Pi）
  // ═══════════════════════════════════════════

  /**
   * 订阅 AgentSession 事件，驱动 UI 更新。
   * 照抄 Pi 的 subscribe 回调逻辑。
   */
  private setupSessionSubscription(): void {
    this.unsubscribe = this.session.subscribe((event: AgentSessionEvent) => {
      switch (event.type) {
        // ── 消息更新：流式文本/thinking（照抄 Pi）──
        case "message_update": {
          const msgEvent = event as any;
          if (msgEvent.assistantMessageEvent) {
            const ame = msgEvent.assistantMessageEvent;

            switch (ame.type) {
              case "start":
              case "text_start":
              case "thinking_start":
                // 首次收到消息时创建 streamingComponent
                if (!this.streamingComponent) {
                  this.streamingComponent = new AssistantMessageComponent();
                  this.chatContainer.addChild(this.streamingComponent);
                }
                break;

              case "text_delta":
              case "thinking_delta":
              case "text_end":
              case "thinking_end":
                // 使用 partial 消息更新组件内容
                if (this.streamingComponent && ame.partial) {
                  this.streamingComponent.updateContent(ame.partial);
                  this.ui.requestRender();
                }
                break;

              case "toolcall_start":
              case "toolcall_delta":
              case "toolcall_end":
                // V1：工具调用不渲染（后续添加 tool execution 组件）
                break;

              case "done":
              case "error":
                // 流结束
                break;
            }
          }
          break;
        }

        // ── Turn 结束：结束流式，保留消息（照抄 Pi）──
        case "turn_end": {
          this.streamingComponent = undefined;
          this.streamingMessage = undefined;
          break;
        }

        // ── Agent 结束（照抄 Pi）──
        case "agent_end": {
          break;
        }
      }
    });
  }

  // ═══════════════════════════════════════════
  // 用户输入处理（照抄 Pi）
  // ═══════════════════════════════════════════

  /**
   * 处理用户输入。
   * 照抄 Pi：创建 UserMessageComponent → 加入 chatContainer → 调 session.prompt()。
   */
  private async handleUserInput(text: string): Promise<void> {
    // 创建用户消息组件
    const userMsg = new UserMessageComponent(text);
    this.chatContainer.addChild(userMsg);
    this.ui.requestRender();

    // 清空输入框
    this.inputComponent.setValue("");

    // 发送给 Agent
    try {
      await this.session.prompt(text);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      this.showError(errorMessage);
    }
  }

  // ═══════════════════════════════════════════
  // UI 辅助方法（照抄 Pi）
  // ═══════════════════════════════════════════

  /**
   * 显示欢迎信息。
   * 照抄 Pi init 中的 logo + 使用说明。
   */
  private showWelcome(): void {
    const logo = `${APP_NAME} v${this.version}`;
    const welcomeContainer = new Container();
    welcomeContainer.addChild(new Text(logo, 0, 1));
    welcomeContainer.addChild(new Text("Type a message and press Enter to chat. Press Ctrl+C to exit.", 0, 0));
    welcomeContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(welcomeContainer);
    this.ui.requestRender();
  }

  /**
   * 显示警告消息。
   * 照抄 Pi InteractiveMode.showWarning()。
   */
  private showWarning(message: string): void {
    this.chatContainer.addChild(new Text(`Warning: ${message}`, 0, 0));
    this.ui.requestRender();
  }

  /**
   * 显示错误消息。
   * 照抄 Pi InteractiveMode.showError()。
   */
  private showError(message: string): void {
    this.chatContainer.addChild(new Text(`Error: ${message}`, 0, 0));
    this.ui.requestRender();
  }
}
