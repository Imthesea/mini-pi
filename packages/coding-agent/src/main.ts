/**
 * Main entry point for the coding agent CLI.
 *
 * This file handles CLI argument parsing and translates them into
 * createAgentSession() options. The SDK does the heavy lifting.
 *
 * 从 pi 项目 main.ts 完整抄来（V1 最小化）。
 * 🔴 暂未实现: extensions / migrations / TUI theme / projectTrust / firstTimeSetup /
 *            sessionPicker / listModels / fileProcessor / timings / httpProxy / RPC / export。
 */

import { createInterface } from "node:readline";
import { type Args, parseArgs, printHelp } from "./cli/args.js";
import { getAgentDir, VERSION } from "./config.js";
import { type CreateAgentSessionRuntimeFactory, createAgentSessionRuntime } from "./core/agent-session-runtime.js";
import {
  type AgentSessionRuntimeDiagnostic,
  createAgentSessionFromServices,
  createAgentSessionServices,
} from "./core/agent-session-services.js";
import type { ModelRuntime } from "./core/model-runtime.js";
import { SessionManager } from "./core/session-manager.js";
import { SettingsManager } from "./core/settings-manager.js";
import { InteractiveMode, runPrintMode } from "./modes/index.js";
import { color } from "./utils/ansi.js";
import { shouldRunFirstTimeSetup, showFirstTimeSetup } from "./cli/startup-ui.js";
import { resolvePath } from "./utils/paths.js";
// 🔴 Pi: chalk → color()
// 🔴 Pi: processFileArguments / buildInitialMessage —— @file 参数，V1 不做
// 🔴 Pi: listModels —— 模型列出，V1 不做
// 🔴 Pi: selectSession —— 交互式会话选择器，V1 不做
// 🔴 Pi: shouldRunFirstTimeSetup / showFirstTimeSetup / showStartupSelector —— 首次设置，V1 不做
// 🔴 Pi: takeOverStdout / restoreStdout —— TUI 输出抢占，V1 不做
// 🔴 Pi: runMigrations / showDeprecationWarnings —— 迁移，V1 不做
// 🔴 Pi: builtInExtensions / InlineExtension —— 扩展，V1 不做
// 🔴 Pi: initTheme / stopThemeWatcher —— TUI 主题，V1 不做
// 🔴 Pi: handleConfigCommand / handlePackageCommand —— 包管理 CLI，V1 不做
// 🔴 Pi: printTimings / resetTimings / time —— 性能计时，V1 不做
// 🔴 Pi: cleanupWindowsSelfUpdateQuarantine —— Windows 自更新，V1 不做
// 🔴 Pi: exportFromFile —— HTML 导出，V1 不做
// 🔴 Pi: applyHttpProxySettings / configureHttpDispatcher —— HTTP 代理，V1 不做
// 🔴 Pi: formatNoModelsAvailableMessage —— auth guidance，V1 不做
// 🔴 Pi: resolveCliModel / resolveModelScope / modelsAreEqual / ScopedModel —— 复杂模型解析，V1 简化
// 🔴 Pi: runRpcMode —— RPC，V1 不做
// 🔴 Pi: session-cwd.ts (formatMissingSessionCwdPrompt / getMissingSessionCwdIssue / MissingSessionCwdError) —— V1 复制到本文件

// ============================================================================
// Helpers
// ============================================================================

/** 从管道 stdin 读取所有内容 */
async function readPipedStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => { resolve(data.trim() || undefined); });
    process.stdin.resume();
  });
}

/** 收集设置配置中的错误，转换为诊断警告信息 */
function collectSettingsDiagnostics(
  settingsManager: SettingsManager,
  context: string,
): AgentSessionRuntimeDiagnostic[] {
  return settingsManager.drainErrors().map(({ scope, error }) => ({
    type: "warning" as const,
    message: `(${context}, ${scope} settings) ${error.message}`,
  }));
}

/** 将诊断信息输出到终端（stderr） */
function reportDiagnostics(diagnostics: readonly AgentSessionRuntimeDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const prefix = diagnostic.type === "error" ? "Error: " : diagnostic.type === "warning" ? "Warning: " : "";
    if (diagnostic.type === "error") console.error(color(`${prefix}${diagnostic.message}`, "red"));
    else if (diagnostic.type === "warning") console.error(color(`${prefix}${diagnostic.message}`, "yellow"));
    else console.error(`${prefix}${diagnostic.message}`);
  }
}

/** 判断环境变量的值是否为"真" */
function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

/** 根据参数和终端状态决定应用的运行模式 */
function resolveAppMode(parsed: Args, stdinIsTTY: boolean, stdoutIsTTY: boolean): "print" | "interactive" {
  if (parsed.print || !stdinIsTTY || !stdoutIsTTY) return "print";
  return "interactive";
}

function toPrintOutputMode(_appMode: "print" | "interactive"): "text" | "json" {
  // 🔴 Pi: appMode === "json" —— V1 args.ts 没有 "json" mode flag
  return "text";
}

/** 判断是否为纯元数据查询命令（如 --help） */
function isPlainRuntimeMetadataCommand(parsed: Args): boolean {
  return !parsed.print && parsed.mode === undefined && parsed.help === true;
}

// 🔴 Pi: prepareInitialMessage —— V1 不做（@file 参数）

/** 解析 session 参数的结果 */
type ResolvedSession =
  | { type: "path"; path: string }
  | { type: "local"; path: string }
  | { type: "global"; path: string; cwd: string }
  | { type: "not_found"; arg: string };

async function findLocalSessionByExactId(
  sessionId: string,
  cwd: string,
  sessionDir?: string,
): Promise<{ type: "local"; path: string } | undefined> {
  const localSessions = await SessionManager.list(cwd, sessionDir);
  const localMatch = localSessions.find((s) => s.id === sessionId);
  return localMatch ? { type: "local", path: localMatch.path } : undefined;
}

/** 将用户传入的 session 参数解析为实际的会话文件路径 */
async function resolveSessionPath(
  sessionArg: string,
  cwd: string,
  sessionDir?: string,
): Promise<ResolvedSession> {
  if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
    return { type: "path", path: resolvePath(sessionArg, cwd) };
  }
  const localSessions = await SessionManager.list(cwd, sessionDir);
  const localMatch =
    localSessions.find((s) => s.id === sessionArg) ?? localSessions.find((s) => s.id.startsWith(sessionArg));
  if (localMatch) return { type: "local", path: localMatch.path };
  // 🔴 Pi: 跨所有项目全局搜索 —— V1 不做
  return { type: "not_found", arg: sessionArg };
}

/** Prompt user for yes/no confirmation */
async function promptConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

// 🔴 Pi: validateForkFlags / validateSessionIdFlags —— V1 args.ts 没有 fork/sessionId flag

function openSessionOrExit(path: string, sessionDir?: string): SessionManager {
  try { return SessionManager.open(path, sessionDir); } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(color(`Error: ${message}`, "red"));
    process.exit(1);
  }
}

// 🔴 Pi: forkSessionOrExit —— V1 不做 fork

/** 根据命令行参数创建或恢复对应的 SessionManager 实例 */
async function createSessionManager(
  parsed: Args,
  cwd: string,
  sessionDir: string | undefined,
  _settingsManager: SettingsManager,
): Promise<SessionManager> {
  if (parsed.noSession || parsed.help) {
    return SessionManager.inMemory(cwd);
  }

  // 🔴 Pi: --fork —— V1 不做

  if (parsed.session) {
    const resolved = await resolveSessionPath(parsed.session, cwd, sessionDir);
    switch (resolved.type) {
      case "path":
      case "local":
        return openSessionOrExit(resolved.path, sessionDir);
      case "global": {
        console.log(color(`Session found in different project: ${resolved.cwd}`, "yellow"));
        const shouldFork = await promptConfirm("Fork this session into current directory?");
        if (!shouldFork) { console.log("Aborted."); process.exit(0); }
        // 🔴 Pi: forkSessionOrExit —— V1 不做，用 open 代替
        return openSessionOrExit(resolved.path, sessionDir);
      }
      case "not_found":
        console.error(color(`No session found matching '${resolved.arg}'`, "red"));
        process.exit(1);
    }
  }

  // 🔴 Pi: --resume → selectSession UI。V1: --resume 等同于 --continue
  if (parsed.resume || parsed.continue) {
    return SessionManager.continueRecent(cwd, sessionDir);
  }

  return SessionManager.continueRecent(cwd, sessionDir);
}

// ============================================================================
// Session CWD helpers (从 Pi session-cwd.ts 复制)
// ============================================================================

interface SessionCwdIssue { sessionFile?: string; fallbackCwd: string }

function getMissingSessionCwdIssue(sm: SessionManager, cwd: string): SessionCwdIssue | undefined {
  const sessionCwd = sm.getCwd();
  if (!sessionCwd || sessionCwd === cwd) return undefined;
  return { sessionFile: sm.getSessionFile(), fallbackCwd: cwd };
}

class MissingSessionCwdError extends Error {
  constructor(issue: SessionCwdIssue) {
    super(`Session was created in a different directory: ${issue.fallbackCwd}`);
    this.name = "MissingSessionCwdError";
  }
}

/** 🔴 Pi: promptForMissingSessionCwd —— V1 简化为默认选 Continue */
async function promptForMissingSessionCwd(
  issue: SessionCwdIssue,
  _settingsManager: SettingsManager,
): Promise<string | undefined> {
  return issue.fallbackCwd;
}

// ============================================================================
// buildSessionOptions
// ============================================================================

/** 根据 CLI 参数和配置组装创建 agent 会话所需的选项 */
function buildSessionOptions(
  parsed: Args,
  _scopedModels: any[],
  _hasExistingSession: boolean,
  _modelRuntime: ModelRuntime,
  _settingsManager: SettingsManager,
): {
  options: any;
  cliThinkingFromModel: boolean;
  diagnostics: AgentSessionRuntimeDiagnostic[];
} {
  const options: any = {};
  const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
  const cliThinkingFromModel = false;

  // 来自 CLI 的模型
  if (parsed.model) {
    options.model = parsed.model;
  }

  // 来自 CLI 的 thinking level
  if (parsed.thinking) {
    options.thinkingLevel = parsed.thinking;
  }

  // 🔴 Pi: resolveCliModel / scopedModels / modelsAreEqual / noTools / tools / excludeTools —— V1 简化

  return { options, cliThinkingFromModel, diagnostics };
}

// ============================================================================
// Main
// ============================================================================

export async function main(args: string[]): Promise<void> {
  // 🔴 Pi: 1. resetTimings / extensions / offline / cleanupWindowsSelfUpdateQuarantine —— V1 不做
  // 🔴 Pi: 2. HTTP proxy —— V1 不做
  // 🔴 Pi: 3. handlePackageCommand / handleConfigCommand —— V1 不做

  const cwd = process.cwd();
  const agentDir = getAgentDir();

  // ========== 4. 解析 CLI 参数 ==========
  const parsed = parseArgs(args);
  // 🔴 Pi: parsed.diagnostics —— Args 接口没有此字段，V1 直接跳过

  // ========== 5. 快速退出命令 ==========
  if (parsed.help) {
    printHelp(process.stdout);
    process.exit(0);
  }
  if (parsed.version) {
    console.log(VERSION);
    process.exit(0);
  }

  // ========== 6. 确定运行模式和标志校验 ==========
  let appMode = resolveAppMode(parsed, process.stdin.isTTY, process.stdout.isTTY);
  const shouldTakeOverStdout = appMode !== "interactive" && !isPlainRuntimeMetadataCommand(parsed);
  // 🔴 Pi: takeOverStdout() —— V1 不做（无 TUI 输出抢占）
  void shouldTakeOverStdout;

  // 🔴 Pi: validateForkFlags / validateSessionIdFlags —— V1 不做

  // ========== 7. 运行迁移 🔴 V1 不做 ==========

  // ========== 8. 启动设置管理器和首次设置 ==========
  const startupSettingsManager = SettingsManager.create(cwd, agentDir);
  reportDiagnostics(collectSettingsDiagnostics(startupSettingsManager, "startup session lookup"));

  // 首次运行引导：检测 .env 是否有 API Key，没有则弹出 TUI 收集
  if (appMode === "interactive" && shouldRunFirstTimeSetup(cwd)) {
    await showFirstTimeSetup(cwd);
  }

  // ========== 9. 确定运行时 cwd 和创建会话管理器 ==========
  const envSessionDir = process.env.MIMI_SESSION_DIR;
  const sessionDir = parsed.session
    ? undefined
    : (envSessionDir ?? undefined);
  // 🔴 Pi: normalizePath / expandTildePath / getSessionDir —— V1 简化

  let sessionManager = await createSessionManager(parsed, cwd, sessionDir, startupSettingsManager);
  const missingSessionCwdIssue = getMissingSessionCwdIssue(sessionManager, cwd);
  if (missingSessionCwdIssue) {
    if (appMode === "interactive") {
      const selectedCwd = await promptForMissingSessionCwd(missingSessionCwdIssue, startupSettingsManager);
      if (!selectedCwd) process.exit(0);
      sessionManager = SessionManager.open(missingSessionCwdIssue.sessionFile!, sessionDir, selectedCwd);
    } else {
      console.error(color(new MissingSessionCwdError(missingSessionCwdIssue).message, "red"));
      process.exit(1);
    }
  }
  // 🔴 Pi: --name flag —— V1 不做

  // ========== 10. 项目信任和资源路径解析 🔴 V1 简化 ==========
  // 🔴 Pi: trustStore / projectTrust / extensions / skills / themes —— V1 不做

  // ========== 11. 创建运行时工厂（createRuntime） ==========
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd: runtimeCwd,
    agentDir: runtimeAgentDir,
    sessionManager: runtimeSessionManager,
  }) => {
    // 🔴 Pi: projectTrust / cachedProjectTrust —— V1 不做
    const runtimeSettingsManager = SettingsManager.create(runtimeCwd, runtimeAgentDir);
    const services = await createAgentSessionServices({
      cwd: runtimeCwd,
      agentDir: runtimeAgentDir,
      // 🔴 Pi: settingsManager / extensionFlags / resourceLoaderReloadOptions / resourceLoaderOptions —— V1 不做
    });

    const { modelRuntime } = services;
    const diagnostics: AgentSessionRuntimeDiagnostic[] = [
      ...services.diagnostics,
      ...collectSettingsDiagnostics(runtimeSettingsManager, "runtime creation"),
    ];

    // 🔴 Pi: modelPatterns / resolveModelScope / scopedModels —— V1 简化
    const {
      options: sessionOptions,
      diagnostics: sessionOptionDiagnostics,
    } = buildSessionOptions(parsed, [], false, modelRuntime, runtimeSettingsManager);
    diagnostics.push(...sessionOptionDiagnostics);

    // 🔴 Pi: --api-key —— V1 不做

    const created = await createAgentSessionFromServices({
      services,
      sessionManager: runtimeSessionManager,
      model: sessionOptions.model,
      thinkingLevel: sessionOptions.thinkingLevel,
    });

    return {
      ...created,
      services,
      diagnostics,
    };
  };

  // ========== 12. 创建运行时实例 ==========
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: sessionManager.getCwd(),
    agentDir,
    sessionManager,
  });
  const { services, session } = runtime;
  const { modelRuntime } = services;
  // 🔴 Pi: applyHttpProxySettings / configureHttpDispatcher —— V1 不做

  // ========== 13. 元数据命令 ==========
  // 🔴 Pi: --list-models —— V1 不做

  // ========== 14. 读取 stdin、准备初始消息 ==========
  let stdinContent: string | undefined;
  stdinContent = await readPipedStdin();
  if (stdinContent !== undefined && appMode === "interactive") {
    appMode = "print";
  }

  // 🔴 Pi: prepareInitialMessage / initTheme / deprecationWarnings —— V1 不做

  // ========== 15. 诊断报告和前置校验 ==========
  reportDiagnostics(runtime.diagnostics);
  if (runtime.diagnostics.some((diagnostic) => diagnostic.type === "error")) {
    process.exit(1);
  }

  // 🔴 Pi: !session.model 检查 + formatNoModelsAvailableMessage —— V1 不做
  // 🔴 Pi: startupBenchmark —— V1 不做

  // ========== 16. 根据模式运行 ==========
  // 🔴 Pi: RPC mode —— V1 不做

  if (appMode === "interactive") {
    const interactiveMode = new InteractiveMode(runtime, {
      modelFallbackMessage: runtime.modelFallbackMessage,
      initialMessage: parsed.print ?? stdinContent,
    });
    await interactiveMode.init();
    await interactiveMode.run();
  } else {
    // 🔴 Pi: printTimings / stopThemeWatcher / restoreStdout —— V1 不做
    const exitCode = await runPrintMode(runtime, {
      mode: toPrintOutputMode(appMode),
      initialMessage: parsed.print ?? stdinContent,
    });
    if (exitCode !== 0) process.exitCode = exitCode;
    return;
  }
}
