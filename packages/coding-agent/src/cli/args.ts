/**
 * CLI argument parsing and help display.
 * 从 pi 项目 cli/args.ts 完整抄来（V1 最小化）。
 */

import type { ThinkingLevel } from "@mimi/agent";
import { color } from "../utils/ansi.js";
import { APP_NAME, CONFIG_DIR_NAME } from "../config.js";

export type Mode = "text" | "json";
// 🔴 Pi: "rpc" mode —— V1 不做

export interface Args {
  /** 模型提供方名称 🔴 V1 桩 */
  provider?: string;
  /** 模型名称或匹配模式 */
  model?: string;
  /** API 密钥 🔴 V1 桩 */
  apiKey?: string;
  /** 系统提示词 🔴 V1 桩 */
  systemPrompt?: string;
  /** 追加的系统提示词 🔴 V1 桩 */
  appendSystemPrompt?: string[];
  /** 思考级别 */
  thinking?: ThinkingLevel;
  /** 继续最近的会话 */
  continue?: boolean;
  /** 恢复指定会话 🔴 V1: 等同于 --continue */
  resume?: boolean;
  /** 显示帮助信息 */
  help?: boolean;
  /** 显示版本号 */
  version?: boolean;
  /** 运行模式 */
  mode?: Mode;
  /** 会话名称 🔴 V1 桩 */
  name?: string;
  /** 禁用会话持久化 */
  noSession?: boolean;
  /** 指定会话路径或 ID */
  session?: string;
  /** 指定会话 ID 🔴 V1 桩 */
  sessionId?: string;
  /** 从已有会话分叉出新会话 🔴 V1 桩 */
  fork?: string;
  /** 会话存储目录 🔴 V1 桩 */
  sessionDir?: string;
  /** 模型列表 🔴 V1 桩 */
  models?: string[];
  /** 启用的工具列表 🔴 V1 桩 */
  tools?: string[];
  /** 排除的工具列表 🔴 V1 桩 */
  excludeTools?: string[];
  /** 禁用所有工具 🔴 V1 桩 */
  noTools?: boolean;
  /** 仅禁用内置工具 🔴 V1 桩 */
  noBuiltinTools?: boolean;
  /** 启用的扩展列表 🔴 V1 桩 */
  extensions?: string[];
  /** 禁用所有扩展 🔴 V1 桩 */
  noExtensions?: boolean;
  /** 非交互式打印模式 */
  print?: string;
  /** 导出会话到指定路径 🔴 V1 桩 */
  export?: string;
  /** 禁用技能 🔴 V1 桩 */
  noSkills?: boolean;
  /** 启用的技能列表 🔴 V1 桩 */
  skills?: string[];
  /** 提示词模板列表 🔴 V1 桩 */
  promptTemplates?: string[];
  /** 禁用提示词模板 🔴 V1 桩 */
  noPromptTemplates?: boolean;
  /** 主题列表 🔴 V1 桩 */
  themes?: string[];
  /** 禁用主题 🔴 V1 桩 */
  noThemes?: boolean;
  /** 禁用上下文文件加载 🔴 V1 桩 */
  noContextFiles?: boolean;
  /** 列出模型（可指定 provider 过滤）🔴 V1 桩 */
  listModels?: string | true;
  /** 离线模式 🔴 V1 桩 */
  offline?: boolean;
  /** 详细输出模式 🔴 V1 桩 */
  verbose?: boolean;
  /** 项目信任覆盖（跳过信任检查）🔴 V1 桩 */
  projectTrustOverride?: boolean;
  /** 用户输入的消息列表 🔴 V1 桩 */
  messages: string[];
  /** 文件参数列表 🔴 V1 桩 */
  fileArgs: string[];
  /** 启动 Web 服务模式 */
  serve?: boolean;
  /** Web 服务端口 */
  port?: number;
  /** 未知标志（可能是扩展标志）- 标志名到值的映射 🔴 V1 桩 */
  unknownFlags: Map<string, boolean | string>;
  /** 解析过程中的诊断信息 */
  diagnostics: Array<{ type: "warning" | "error"; message: string }>;
}

const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function isValidThinkingLevel(level: string): level is ThinkingLevel {
  return VALID_THINKING_LEVELS.includes(level as ThinkingLevel);
}

/** 解析命令行参数 */
export function parseArgs(args: string[]): Args {
  const result: Args = {
    messages: [],
    fileArgs: [],
    unknownFlags: new Map(),
    diagnostics: [],
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      // V1 实际使用的 flag
      case "-p":
      case "--print":
        result.print = args[++i] ?? "";
        break;
      case "--model":
        result.model = args[++i];
        break;
      case "--thinking": {
        const level = args[++i];
        if (level && isValidThinkingLevel(level)) result.thinking = level;
        else result.diagnostics.push({ type: "error", message: `Invalid thinking level: ${level}` });
        break;
      }
      case "--continue":
        result.continue = true;
        break;
      case "--resume":
        result.resume = true;
        break;
      case "--help":
        result.help = true;
        break;
      case "--version":
        result.version = true;
        break;
      case "--mode":
        result.mode = args[++i] as Mode;
        break;
      case "--no-session":
        result.noSession = true;
        break;
      case "--session":
        result.session = args[++i];
        break;
      case "--cwd":
        process.env.MIMI_CWD = args[++i];
        break;
      case "--serve":
        result.serve = true;
        break;
      case "--port":
        result.port = parseInt(args[++i], 10);
        break;

      // 🔴 V1 桩：接受但不实际使用
      case "--provider":
        result.provider = args[++i];
        break;
      case "--api-key":
        result.apiKey = args[++i];
        break;
      case "--system-prompt":
        result.systemPrompt = args[++i];
        break;
      case "--append-system-prompt":
        if (!result.appendSystemPrompt) result.appendSystemPrompt = [];
        result.appendSystemPrompt!.push(args[++i]);
        break;
      case "--name":
        result.name = args[++i];
        break;
      case "--session-id":
        result.sessionId = args[++i];
        break;
      case "--fork":
        result.fork = args[++i];
        break;
      case "--session-dir":
        result.sessionDir = args[++i];
        break;
      case "--models":
        result.models = args[++i]?.split(",").map((s: string) => s.trim()) ?? [];
        break;
      case "--tools":
        result.tools = args[++i]?.split(",").map((s: string) => s.trim()) ?? [];
        break;
      case "--exclude-tools":
        result.excludeTools = args[++i]?.split(",").map((s: string) => s.trim()) ?? [];
        break;
      case "--no-tools":
        result.noTools = true;
        break;
      case "--no-builtin-tools":
        result.noBuiltinTools = true;
        break;
      case "--extensions":
        result.extensions = [args[++i]];
        break;
      case "--no-extensions":
        result.noExtensions = true;
        break;
      case "--export":
        result.export = args[++i];
        break;
      case "--no-skills":
        result.noSkills = true;
        break;
      case "--skills":
        result.skills = [args[++i]];
        break;
      case "--prompt-templates":
        result.promptTemplates = [args[++i]];
        break;
      case "--no-prompt-templates":
        result.noPromptTemplates = true;
        break;
      case "--themes":
        result.themes = [args[++i]];
        break;
      case "--no-themes":
        result.noThemes = true;
        break;
      case "--no-context-files":
        result.noContextFiles = true;
        break;
      case "--list-models":
        result.listModels = true;
        break;
      case "--offline":
        result.offline = true;
        break;
      case "--verbose":
        result.verbose = true;
        break;
      case "--project-trust-override":
        result.projectTrustOverride = true;
        break;

      default:
        // 非 flag 参数 → prompt 或 file arg
        if (a.startsWith("-")) {
          // 未知 flag → 可能是扩展标志
          const eqIndex = a.indexOf("=");
          if (eqIndex !== -1) {
            const name = a.slice(2, eqIndex);
            const value = a.slice(eqIndex + 1);
            result.unknownFlags.set(name, value);
          } else {
            const name = a.slice(2);
            const next = args[i + 1];
            if (next && !next.startsWith("-")) {
              result.unknownFlags.set(name, next);
              i++;
            } else {
              result.unknownFlags.set(name, true);
            }
          }
        } else if (a.startsWith("@")) {
          result.fileArgs.push(a);
        } else {
          result.print = a;
        }
    }
  }

  return result;
}

/** 输出帮助文本 */
export function printHelp(out: NodeJS.WritableStream = process.stdout): void {
  out.write([
    `${APP_NAME} - AI Coding Assistant`,
    ``,
    `Usage:`,
    `  mimi "your prompt"            Single-shot mode`,
    `  mimi                          REPL mode`,
    ``,
    `Options:`,
    `  -p, --print <prompt>   Single-shot mode`,
    `  --model <id>           Model to use`,
    `  --thinking <level>     Thinking level (off/minimal/low/medium/high)`,
    `  --resume               Continue most recent session`,
    `  --continue             Continue most recent session`,
    `  --session <id>         Open a specific session`,
    `  --cwd <path>           Working directory`,
    `  --serve                 Start Web UI server`,
    `  --port <number>         Web UI server port (default: 32123)`,
    `  --no-session           Don't persist session`,
    `  --help                 Show help`,
    `  --version              Show version`,
    ``,
    `Environment:`,
    `  MIMI_MODEL             Default model`,
    `  MIMI_API_KEY_DEEPSEEK  DeepSeek API key`,
    `  MIMI_API_KEY_ANTHROPIC Anthropic API key`,
    `  MIMI_API_KEY_OPENAI    OpenAI API key`,
    `  MIMI_THINKING          Default thinking level`,
    `  MIMI_SESSION_DIR       Session storage directory`,
    `  MIMI_CWD               Working directory`,
    ``,
  ].join("\n") + "\n");
}
