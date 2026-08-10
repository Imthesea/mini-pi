/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 *
 * 从 pi 项目 modes/interactive/interactive-mode.ts 抄来，V1 最小化。
 *
 * 照抄 Pi 的类结构和代码组织方式。
 * 不抄（V1 不做）：扩展系统、footer、快捷键、自动补全、主题、changelog、
 *   bash 组件、compaction UI、剪贴板、图片、slash 命令、session 选择器。
 */

import type { ImageContent } from "@mimi/ai";
import { Container, Input, ProcessTerminal, Spacer, Text, TUI } from "@mimi/tui";
import { APP_NAME, VERSION } from "../../config.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.ts";
import { AssistantMessageComponent } from "./components/assistant-message.ts";
import { ToolExecutionComponent } from "./components/tool-execution.ts";
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

  // ── 工具执行跟踪：toolCallId -> 组件（照抄 Pi）──
  private pendingTools = new Map<string, ToolExecutionComponent>();

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

    // ── 按键回调（照抄 Pi setupKeyHandlers 对应部分，V1 简化）──
    // ESC：流式回复中 → 中断（照抄 Pi onEscape）
    this.inputComponent.onEscape = () => {
      if (this.streamingComponent) {
        this.session.abort?.();
      }
    };
    // Ctrl+C：双击(<500ms)退出，单次清空输入（照抄 Pi handleCtrlC）
    this.inputComponent.onCtrlC = () => {
      const now = Date.now();
      if (now - this.lastSigintTime < 500) {
        this.stop();
      } else {
        this.inputComponent.setValue("");
        this.lastSigintTime = now;
        this.ui.requestRender();
      }
    };
    // Ctrl+D：退出（照抄 Pi handleCtrlD）
    this.inputComponent.onCtrlD = () => {
      this.stop();
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
   * 注册信号处理器。
   *
   * 照抄 Pi InteractiveMode.registerSignalHandlers()，V1 简化。
   *
   * 🔴 关键差异（V1 曾偏离 pi）：不监听 SIGINT —— raw mode 下 Ctrl+C 作为
   * `\x03` 字节进入 stdin（由 Input.onCtrlC 处理），不会产生 SIGINT 信号，
   * 原 V1 的 SIGINT 处理器永远不会触发，导致无法退出。
   * 照抄 pi 只处理 SIGTERM（优雅关闭）。
   */
  private registerSignalHandlers(): void {
    const onSigterm = () => {
      this.stop();
    };
    process.on("SIGTERM", onSigterm);
    this.signalCleanupHandlers.push(() => process.off("SIGTERM", onSigterm));
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
        // ── 消息开始（照抄 Pi）──
        case "message_start": {
          const msg = (event as any).message;
          if (msg?.role === "assistant") {
            // 照抄 Pi：创建 AssistantMessageComponent 并用完整 message 初始化
            this.streamingComponent = new AssistantMessageComponent();
            this.streamingMessage = msg;
            this.chatContainer.addChild(this.streamingComponent);
            this.streamingComponent.updateContent(msg);
            this.ui.requestRender();
          }
          break;
        }

        // ── 消息更新：用完整 message 更新组件（照抄 Pi，不用 assistantMessageEvent）──
        case "message_update": {
          const msg = (event as any).message;
          if (this.streamingComponent && msg?.role === "assistant") {
            this.streamingMessage = msg;
            this.streamingComponent.updateContent(this.streamingMessage);

            // 工具调用块 → 创建/更新工具执行组件（照抄 Pi）
            for (const content of this.streamingMessage.content) {
              if (content.type === "toolCall") {
                if (!this.pendingTools.has(content.id)) {
                  const component = new ToolExecutionComponent(
                    content.name,
                    content.id,
                    content.arguments,
                  );
                  this.chatContainer.addChild(component);
                  this.pendingTools.set(content.id, component);
                } else {
                  const component = this.pendingTools.get(content.id);
                  if (component) {
                    component.updateArgs(content.arguments);
                  }
                }
              }
            }
            this.ui.requestRender();
          }
          break;
        }

        // ── 消息结束：最终完整内容渲染（照抄 Pi）──
        // 🔴 V1 曾漏掉此分支：pi 在这里用 message_end 的最终消息做一次完整渲染。
        // 若缺失，message_update 只携带流式 partial，最终消息永远不显示。
        case "message_end": {
          const msg = (event as any).message;
          if (msg?.role === "assistant" && this.streamingComponent) {
            this.streamingMessage = msg;
            let errorMessage: string | undefined;
            if (this.streamingMessage.stopReason === "aborted") {
              // 🔴 V1 简化：无 retryAttempt，固定文案（pi 会区分重试次数）
              errorMessage = "Operation aborted";
              this.streamingMessage.errorMessage = errorMessage;
            }
            this.streamingComponent.updateContent(this.streamingMessage);

            // 工具组件收尾（照抄 Pi）：
            // - 中断/错误 → 所有 pending 工具标记错误并清空
            // - 正常结束 → 参数定稿（工具结果已在 tool_execution_end 时更新）
            if (this.streamingMessage.stopReason === "aborted" || this.streamingMessage.stopReason === "error") {
              if (!errorMessage) {
                errorMessage = this.streamingMessage.errorMessage || "Error";
              }
              for (const [, component] of this.pendingTools.entries()) {
                component.updateResult({
                  content: [{ type: "text", text: errorMessage }],
                  isError: true,
                });
              }
              this.pendingTools.clear();
            } else {
              // Args are now complete（照抄 Pi）
              for (const [, component] of this.pendingTools.entries()) {
                component.setArgsComplete();
              }
            }

            this.streamingComponent = undefined;
            this.streamingMessage = undefined;
          }
          this.ui.requestRender();
          break;
        }

        // ── 工具执行开始：标记组件为运行中（照抄 Pi）──
        case "tool_execution_start": {
          let component = this.pendingTools.get(event.toolCallId);
          if (!component) {
            // 组件可能尚未由 message_update 创建（工具结果先到），照抄 Pi 兜底创建
            component = new ToolExecutionComponent(event.toolName, event.toolCallId, event.args);
            this.chatContainer.addChild(component);
            this.pendingTools.set(event.toolCallId, component);
          }
          component.markExecutionStarted();
          this.ui.requestRender();
          break;
        }

        // ── 工具执行更新：部分结果（照抄 Pi）──
        case "tool_execution_update": {
          const component = this.pendingTools.get(event.toolCallId);
          if (component) {
            component.updateResult({ ...event.partialResult, isError: false }, true);
            this.ui.requestRender();
          }
          break;
        }

        // ── 工具执行结束：最终结果（照抄 Pi）──
        case "tool_execution_end": {
          const component = this.pendingTools.get(event.toolCallId);
          if (component) {
            component.updateResult({ ...event.result, isError: event.isError });
            this.pendingTools.delete(event.toolCallId);
            this.ui.requestRender();
          }
          break;
        }

        // ── Turn 结束：结束流式（照抄 Pi）──
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

    // 清空输入框
    this.inputComponent.setValue("");

    // 显示等待状态
    const workingMsg = new Text("...", 0, 0);
    this.chatContainer.addChild(workingMsg);
    this.ui.requestRender();

    // 发送给 Agent
    try {
      await this.session.prompt(text);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      this.showError(errorMessage);
    } finally {
      // 移除等待状态
      this.chatContainer.removeChild(workingMsg);
      this.ui.requestRender();
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
