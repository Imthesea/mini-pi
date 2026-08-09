/**
 * SettingsManager — 全局/项目级配置管理。
 *
 * 从 pi 项目 core/settings-manager.ts 完整抄来（V1 最小化）。
 * V1 仅改 3 处：proper-lockfile → 简化锁、parseHttpIdleTimeoutMs → 内联、Transport → string。
 */

import type { ThinkingLevel } from "@mimi/agent";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.js";
import { normalizePath, resolvePath } from "../utils/paths.js";

// 🔴 Pi: lockfile from "proper-lockfile" —— V1 单进程，无需锁
// 🔴 Pi: DEFAULT_HTTP_IDLE_TIMEOUT_MS / parseHttpIdleTimeoutMs from "./http-dispatcher.ts" —— V1 内联

const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000; // 5 min

function parseHttpIdleTimeoutMs(value: unknown): number | undefined {
  if (typeof value === "number") return Math.max(0, Math.floor(value));
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : undefined;
  }
  return undefined;
}

// 🔴 Pi: Transport from "@earendil-works/pi-ai" —— V1 用 string 代替
type TransportSetting = string;

export interface CompactionSettings {
  enabled?: boolean; // 默认: true
  reserveTokens?: number; // 默认: 16384
  keepRecentTokens?: number; // 默认: 20000
}

export interface BranchSummarySettings {
  reserveTokens?: number;
  skipPrompt?: boolean;
}

export interface ProviderRetrySettings {
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
}

export interface RetrySettings {
  enabled?: boolean;
  maxRetries?: number;
  baseDelayMs?: number;
  provider?: ProviderRetrySettings;
}

export interface TerminalSettings {
  showImages?: boolean;
  imageWidthCells?: number;
  clearOnShrink?: boolean;
  showTerminalProgress?: boolean;
}

export interface ImageSettings {
  autoResize?: boolean;
  blockImages?: boolean;
}

export interface ThinkingBudgetsSettings {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
}

export interface MarkdownSettings {
  codeBlockIndent?: string;
}

export interface WarningSettings {
  anthropicExtraUsage?: boolean;
}

export type DefaultProjectTrust = "ask" | "always" | "never";

export type PackageSource =
  | string
  | {
      source: string;
      autoload?: boolean;
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
      themes?: string[];
    };

export interface Settings {
  lastChangelogVersion?: string;
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: ThinkingLevel;
  transport?: TransportSetting;
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  theme?: string;
  compaction?: CompactionSettings;
  branchSummary?: BranchSummarySettings;
  retry?: RetrySettings;
  hideThinkingBlock?: boolean;
  showCacheMissNotices?: boolean;
  externalEditor?: string;
  shellPath?: string;
  quietStartup?: boolean;
  defaultProjectTrust?: DefaultProjectTrust;
  shellCommandPrefix?: string;
  npmCommand?: string[];
  collapseChangelog?: boolean;
  enableInstallTelemetry?: boolean;
  enableAnalytics?: boolean;
  trackingId?: string;
  packages?: PackageSource[];
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
  enableSkillCommands?: boolean;
  terminal?: TerminalSettings;
  images?: ImageSettings;
  enabledModels?: string[];
  doubleEscapeAction?: "fork" | "tree" | "none";
  treeFilterMode?: "default" | "no-tools" | "user-only" | "labeled-only" | "all";
  thinkingBudgets?: ThinkingBudgetsSettings;
  editorPaddingX?: number;
  outputPad?: 0 | 1;
  autocompleteMaxVisible?: number;
  showHardwareCursor?: boolean;
  markdown?: MarkdownSettings;
  warnings?: WarningSettings;
  sessionDir?: string;
  httpProxy?: string;
  httpIdleTimeoutMs?: number;
  websocketConnectTimeoutMs?: number;
}

function deepMergeSettings(base: Settings, overrides: Settings): Settings {
  const result: Settings = { ...base };
  for (const key of Object.keys(overrides) as (keyof Settings)[]) {
    const overrideValue = overrides[key];
    const baseValue = base[key];
    if (overrideValue === undefined) continue;
    if (
      typeof overrideValue === "object" && overrideValue !== null &&
      !Array.isArray(overrideValue) &&
      typeof baseValue === "object" && baseValue !== null &&
      !Array.isArray(baseValue)
    ) {
      (result as Record<string, unknown>)[key] = { ...baseValue, ...overrideValue };
    } else {
      (result as Record<string, unknown>)[key] = overrideValue;
    }
  }
  return result;
}

function parseTimeoutSetting(value: unknown, settingName: string): number | undefined {
  const timeoutMs = parseHttpIdleTimeoutMs(value);
  if (timeoutMs !== undefined) return timeoutMs;
  if (value !== undefined) throw new Error(`Invalid ${settingName} setting: ${String(value)}`);
  return undefined;
}

export type SettingsScope = "global" | "project";

export interface SettingsManagerCreateOptions {
  projectTrusted?: boolean;
}

export interface SettingsStorage {
  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void;
}

export interface SettingsError {
  scope: SettingsScope;
  error: Error;
}

// ============================================================================
// FileSettingsStorage
// ============================================================================

export class FileSettingsStorage implements SettingsStorage {
  private globalSettingsPath: string;
  private projectSettingsPath: string;

  constructor(cwd: string, agentDir: string) {
    const resolvedCwd = resolvePath(cwd);
    const resolvedAgentDir = resolvePath(agentDir);
    this.globalSettingsPath = join(resolvedAgentDir, "settings.json");
    this.projectSettingsPath = join(resolvedCwd, CONFIG_DIR_NAME, "settings.json");
  }

  // 🔴 Pi: lockfile.lockSync —— V1 简化：无并发锁
  private acquireLockSyncWithRetry(_path: string): () => void {
    return () => {}; // noop release
  }

  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
    const path = scope === "global" ? this.globalSettingsPath : this.projectSettingsPath;
    const dir = dirname(path);
    let release: (() => void) | undefined;
    try {
      const fileExists = existsSync(path);
      if (fileExists) release = this.acquireLockSyncWithRetry(path);
      const current = fileExists ? readFileSync(path, "utf-8") : undefined;
      const next = fn(current);
      if (next !== undefined) {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        if (!release) release = this.acquireLockSyncWithRetry(path);
        writeFileSync(path, next, "utf-8");
      }
    } finally {
      if (release) release();
    }
  }
}

// ============================================================================
// InMemorySettingsStorage
// ============================================================================

export class InMemorySettingsStorage implements SettingsStorage {
  private global: string | undefined;
  private project: string | undefined;

  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
    const current = scope === "global" ? this.global : this.project;
    const next = fn(current);
    if (next !== undefined) {
      if (scope === "global") this.global = next;
      else this.project = next;
    }
  }
}

// ============================================================================
// SettingsManager
// ============================================================================

export class SettingsManager {
  private storage: SettingsStorage;
  private globalSettings: Settings;
  private projectSettings: Settings;
  private settings: Settings;
  private projectTrusted: boolean;
  private modifiedFields = new Set<keyof Settings>();
  private modifiedNestedFields = new Map<keyof Settings, Set<string>>();
  private modifiedProjectFields = new Set<keyof Settings>();
  private modifiedProjectNestedFields = new Map<keyof Settings, Set<string>>();
  private globalSettingsLoadError: Error | null = null;
  private projectSettingsLoadError: Error | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private errors: SettingsError[];

  private constructor(
    storage: SettingsStorage,
    initialGlobal: Settings,
    initialProject: Settings,
    globalLoadError: Error | null = null,
    projectLoadError: Error | null = null,
    initialErrors: SettingsError[] = [],
    projectTrusted = true,
  ) {
    this.storage = storage;
    this.globalSettings = initialGlobal;
    this.projectSettings = initialProject;
    this.projectTrusted = projectTrusted;
    this.globalSettingsLoadError = globalLoadError;
    this.projectSettingsLoadError = projectLoadError;
    this.errors = [...initialErrors];
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
  }

  static create(cwd: string, agentDir: string = getAgentDir(), options: SettingsManagerCreateOptions = {}): SettingsManager {
    const storage = new FileSettingsStorage(cwd, agentDir);
    return SettingsManager.fromStorage(storage, options);
  }

  static fromStorage(storage: SettingsStorage, options: SettingsManagerCreateOptions = {}): SettingsManager {
    const projectTrusted = options.projectTrusted ?? true;
    const globalLoad = SettingsManager.tryLoadFromStorage(storage, "global");
    const projectLoad = SettingsManager.tryLoadFromStorage(storage, "project", projectTrusted);
    const initialErrors: SettingsError[] = [];
    if (globalLoad.error) initialErrors.push({ scope: "global", error: globalLoad.error });
    if (projectLoad.error) initialErrors.push({ scope: "project", error: projectLoad.error });
    return new SettingsManager(storage, globalLoad.settings, projectLoad.settings, globalLoad.error, projectLoad.error, initialErrors, projectTrusted);
  }

  static inMemory(settings: Partial<Settings> = {}, options: SettingsManagerCreateOptions = {}): SettingsManager {
    const storage = new InMemorySettingsStorage();
    const initialSettings = SettingsManager.migrateSettings(structuredClone(settings) as Record<string, unknown>);
    storage.withLock("global", () => JSON.stringify(initialSettings, null, 2));
    return SettingsManager.fromStorage(storage, options);
  }

  private static loadFromStorage(storage: SettingsStorage, scope: SettingsScope, projectTrusted = true): Settings {
    if (scope === "project" && !projectTrusted) return {};
    let content: string | undefined;
    storage.withLock(scope, (current) => { content = current; return undefined; });
    if (!content) return {};
    const settings = JSON.parse(content);
    return SettingsManager.migrateSettings(settings);
  }

  private static tryLoadFromStorage(storage: SettingsStorage, scope: SettingsScope, projectTrusted = true): { settings: Settings; error: Error | null } {
    try { return { settings: SettingsManager.loadFromStorage(storage, scope, projectTrusted), error: null }; }
    catch (error) { return { settings: {}, error: error as Error }; }
  }

  private static migrateSettings(settings: Record<string, unknown>): Settings {
    if ("queueMode" in settings && !("steeringMode" in settings)) {
      settings.steeringMode = settings.queueMode;
      delete settings.queueMode;
    }
    if (!("transport" in settings) && typeof settings.websockets === "boolean") {
      settings.transport = settings.websockets ? "websocket" : "sse";
      delete settings.websockets;
    }
    if ("skills" in settings && typeof settings.skills === "object" && settings.skills !== null && !Array.isArray(settings.skills)) {
      const skillsSettings = settings.skills as { enableSkillCommands?: boolean; customDirectories?: unknown };
      if (skillsSettings.enableSkillCommands !== undefined && (settings as any).enableSkillCommands === undefined)
        (settings as any).enableSkillCommands = skillsSettings.enableSkillCommands;
      if (Array.isArray(skillsSettings.customDirectories) && skillsSettings.customDirectories.length > 0)
        settings.skills = skillsSettings.customDirectories;
      else delete settings.skills;
    }
    if ("retry" in settings && typeof settings.retry === "object" && settings.retry !== null && !Array.isArray(settings.retry)) {
      const retrySettings = settings.retry as Record<string, unknown>;
      const providerSettings = typeof retrySettings.provider === "object" && retrySettings.provider !== null ? retrySettings.provider as Record<string, unknown> : undefined;
      if (typeof retrySettings.maxDelayMs === "number" && (providerSettings?.maxRetryDelayMs === undefined || providerSettings?.maxRetryDelayMs === null)) {
        retrySettings.provider = { ...(providerSettings ?? {}), maxRetryDelayMs: retrySettings.maxDelayMs };
      }
      delete retrySettings.maxDelayMs;
    }
    return settings as Settings;
  }

  getGlobalSettings(): Settings { return structuredClone(this.globalSettings); }
  getProjectSettings(): Settings { return structuredClone(this.projectSettings); }
  isProjectTrusted(): boolean { return this.projectTrusted; }

  setProjectTrusted(trusted: boolean): void {
    if (this.projectTrusted === trusted) return;
    this.projectTrusted = trusted;
    this.modifiedProjectFields.clear();
    this.modifiedProjectNestedFields.clear();
    if (!trusted) { this.projectSettings = {}; this.projectSettingsLoadError = null; this.settings = deepMergeSettings(this.globalSettings, this.projectSettings); return; }
    const projectLoad = SettingsManager.tryLoadFromStorage(this.storage, "project", trusted);
    this.projectSettings = projectLoad.settings;
    this.projectSettingsLoadError = projectLoad.error;
    if (projectLoad.error) this.recordError("project", projectLoad.error);
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
  }

  async reload(): Promise<void> {
    await this.writeQueue;
    const globalLoad = SettingsManager.tryLoadFromStorage(this.storage, "global");
    if (!globalLoad.error) { this.globalSettings = globalLoad.settings; this.globalSettingsLoadError = null; }
    else { this.globalSettingsLoadError = globalLoad.error; this.recordError("global", globalLoad.error); }
    this.modifiedFields.clear(); this.modifiedNestedFields.clear();
    this.modifiedProjectFields.clear(); this.modifiedProjectNestedFields.clear();
    const projectLoad = SettingsManager.tryLoadFromStorage(this.storage, "project", this.projectTrusted);
    if (!projectLoad.error) { this.projectSettings = projectLoad.settings; this.projectSettingsLoadError = null; }
    else { this.projectSettingsLoadError = projectLoad.error; this.recordError("project", projectLoad.error); }
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
  }

  applyOverrides(overrides: Partial<Settings>): void { this.settings = deepMergeSettings(this.settings, overrides); }

  private markModified(field: keyof Settings, nestedKey?: string): void {
    this.modifiedFields.add(field);
    if (nestedKey) { if (!this.modifiedNestedFields.has(field)) this.modifiedNestedFields.set(field, new Set()); this.modifiedNestedFields.get(field)!.add(nestedKey); }
  }

  private markProjectModified(field: keyof Settings, nestedKey?: string): void {
    this.modifiedProjectFields.add(field);
    if (nestedKey) { if (!this.modifiedProjectNestedFields.has(field)) this.modifiedProjectNestedFields.set(field, new Set()); this.modifiedProjectNestedFields.get(field)!.add(nestedKey); }
  }

  private assertProjectTrustedForWrite(): void { if (!this.projectTrusted) throw new Error("Project is not trusted; refusing to write project settings"); }
  private recordError(scope: SettingsScope, error: unknown): void { this.errors.push({ scope, error: error instanceof Error ? error : new Error(String(error)) }); }

  private clearModifiedScope(scope: SettingsScope): void {
    if (scope === "global") { this.modifiedFields.clear(); this.modifiedNestedFields.clear(); return; }
    this.modifiedProjectFields.clear(); this.modifiedProjectNestedFields.clear();
  }

  private enqueueWrite(scope: SettingsScope, task: () => void): void {
    this.writeQueue = this.writeQueue.then(() => { if (scope === "project") this.assertProjectTrustedForWrite(); task(); this.clearModifiedScope(scope); }).catch((error) => { this.recordError(scope, error); });
  }

  private cloneModifiedNestedFields(source: Map<keyof Settings, Set<string>>): Map<keyof Settings, Set<string>> {
    const snapshot = new Map<keyof Settings, Set<string>>();
    for (const [key, value] of source.entries()) snapshot.set(key, new Set(value));
    return snapshot;
  }

  private persistScopedSettings(scope: SettingsScope, snapshotSettings: Settings, modifiedFields: Set<keyof Settings>, modifiedNestedFields: Map<keyof Settings, Set<string>>): void {
    this.storage.withLock(scope, (current) => {
      const currentFileSettings = current ? SettingsManager.migrateSettings(JSON.parse(current) as Record<string, unknown>) : {};
      const mergedSettings: Settings = { ...currentFileSettings };
      for (const field of modifiedFields) {
        const value = snapshotSettings[field];
        if (modifiedNestedFields.has(field) && typeof value === "object" && value !== null) {
          const nestedModified = modifiedNestedFields.get(field)!;
          const baseNested = (currentFileSettings[field] as Record<string, unknown>) ?? {};
          const inMemoryNested = value as Record<string, unknown>;
          const mergedNested = { ...baseNested };
          for (const nestedKey of nestedModified) mergedNested[nestedKey] = inMemoryNested[nestedKey];
          (mergedSettings as Record<string, unknown>)[field] = mergedNested;
        } else {
          (mergedSettings as Record<string, unknown>)[field] = value;
        }
      }
      return JSON.stringify(mergedSettings, null, 2);
    });
  }

  private save(): void {
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
    if (this.globalSettingsLoadError) return;
    const snapshotGlobalSettings = structuredClone(this.globalSettings);
    const modifiedFields = new Set(this.modifiedFields);
    const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedNestedFields);
    this.enqueueWrite("global", () => { this.persistScopedSettings("global", snapshotGlobalSettings, modifiedFields, modifiedNestedFields); });
  }

  private saveProjectSettings(settings: Settings): void {
    this.assertProjectTrustedForWrite();
    this.projectSettings = structuredClone(settings);
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
    if (this.projectSettingsLoadError) return;
    const snapshotProjectSettings = structuredClone(this.projectSettings);
    const modifiedFields = new Set(this.modifiedProjectFields);
    const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedProjectNestedFields);
    this.enqueueWrite("project", () => { this.persistScopedSettings("project", snapshotProjectSettings, modifiedFields, modifiedNestedFields); });
  }

  private updateProjectSettings(field: keyof Settings, update: (settings: Settings) => void): void {
    this.assertProjectTrustedForWrite();
    const projectSettings = structuredClone(this.projectSettings);
    update(projectSettings);
    this.markProjectModified(field);
    this.saveProjectSettings(projectSettings);
  }

  async flush(): Promise<void> { await this.writeQueue; }
  drainErrors(): SettingsError[] { const drained = [...this.errors]; this.errors = []; return drained; }

  // ── Getter/Setter ──

  getLastChangelogVersion(): string | undefined { return this.settings.lastChangelogVersion; }
  setLastChangelogVersion(version: string): void { this.globalSettings.lastChangelogVersion = version; this.markModified("lastChangelogVersion"); this.save(); }

  getSessionDir(): string | undefined { const d = this.settings.sessionDir; return d ? normalizePath(d) : d; }

  getDefaultProvider(): string | undefined { return this.settings.defaultProvider; }
  getDefaultModel(): string | undefined { return this.settings.defaultModel; }

  setDefaultProvider(provider: string): void { this.globalSettings.defaultProvider = provider; this.markModified("defaultProvider"); this.save(); }
  setDefaultModel(modelId: string): void { this.globalSettings.defaultModel = modelId; this.markModified("defaultModel"); this.save(); }
  setDefaultModelAndProvider(provider: string, modelId: string): void { this.globalSettings.defaultProvider = provider; this.globalSettings.defaultModel = modelId; this.markModified("defaultProvider"); this.markModified("defaultModel"); this.save(); }

  getSteeringMode(): "all" | "one-at-a-time" { return this.settings.steeringMode || "one-at-a-time"; }
  setSteeringMode(mode: "all" | "one-at-a-time"): void { this.globalSettings.steeringMode = mode; this.markModified("steeringMode"); this.save(); }

  getFollowUpMode(): "all" | "one-at-a-time" { return this.settings.followUpMode || "one-at-a-time"; }
  setFollowUpMode(mode: "all" | "one-at-a-time"): void { this.globalSettings.followUpMode = mode; this.markModified("followUpMode"); this.save(); }

  getThemeSetting(): string | undefined { const v = this.settings.theme; return typeof v === "string" ? v : undefined; }
  getTheme(): string | undefined { const t = this.getThemeSetting(); return t?.includes("/") ? undefined : t; }
  setTheme(theme: string): void { this.globalSettings.theme = theme; this.markModified("theme"); this.save(); }

  getDefaultThinkingLevel(): ThinkingLevel | undefined { return this.settings.defaultThinkingLevel; }
  setDefaultThinkingLevel(level: ThinkingLevel): void { this.globalSettings.defaultThinkingLevel = level; this.markModified("defaultThinkingLevel"); this.save(); }

  getTransport(): TransportSetting { return this.settings.transport ?? "auto"; }
  setTransport(transport: TransportSetting): void { this.globalSettings.transport = transport; this.markModified("transport"); this.save(); }

  getCompactionEnabled(): boolean { return this.settings.compaction?.enabled ?? true; }
  setCompactionEnabled(enabled: boolean): void { if (!this.globalSettings.compaction) this.globalSettings.compaction = {}; this.globalSettings.compaction.enabled = enabled; this.markModified("compaction", "enabled"); this.save(); }
  getCompactionReserveTokens(): number { return this.settings.compaction?.reserveTokens ?? 16384; }
  getCompactionKeepRecentTokens(): number { return this.settings.compaction?.keepRecentTokens ?? 20000; }
  getCompactionSettings(): { enabled: boolean; reserveTokens: number; keepRecentTokens: number } { return { enabled: this.getCompactionEnabled(), reserveTokens: this.getCompactionReserveTokens(), keepRecentTokens: this.getCompactionKeepRecentTokens() }; }

  getBranchSummarySettings(): { reserveTokens: number; skipPrompt: boolean } { return { reserveTokens: this.settings.branchSummary?.reserveTokens ?? 16384, skipPrompt: this.settings.branchSummary?.skipPrompt ?? false }; }
  getBranchSummarySkipPrompt(): boolean { return this.settings.branchSummary?.skipPrompt ?? false; }

  getRetryEnabled(): boolean { return this.settings.retry?.enabled ?? true; }
  setRetryEnabled(enabled: boolean): void { if (!this.globalSettings.retry) this.globalSettings.retry = {}; this.globalSettings.retry.enabled = enabled; this.markModified("retry", "enabled"); this.save(); }
  getRetrySettings(): { enabled: boolean; maxRetries: number; baseDelayMs: number } { return { enabled: this.getRetryEnabled(), maxRetries: this.settings.retry?.maxRetries ?? 3, baseDelayMs: this.settings.retry?.baseDelayMs ?? 2000 }; }

  getHttpIdleTimeoutMs(): number { return parseTimeoutSetting(this.settings.httpIdleTimeoutMs, "httpIdleTimeoutMs") ?? DEFAULT_HTTP_IDLE_TIMEOUT_MS; }
  setHttpIdleTimeoutMs(timeoutMs: number): void { if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error(`Invalid httpIdleTimeoutMs setting: ${String(timeoutMs)}`); this.globalSettings.httpIdleTimeoutMs = Math.floor(timeoutMs); this.markModified("httpIdleTimeoutMs"); this.save(); }
  getProviderRetrySettings(): { timeoutMs?: number; maxRetries?: number; maxRetryDelayMs: number } { return { timeoutMs: this.settings.retry?.provider?.timeoutMs, maxRetries: this.settings.retry?.provider?.maxRetries, maxRetryDelayMs: this.settings.retry?.provider?.maxRetryDelayMs ?? 60000 }; }
  getWebSocketConnectTimeoutMs(): number | undefined { return parseTimeoutSetting(this.settings.websocketConnectTimeoutMs, "websocketConnectTimeoutMs"); }

  getHideThinkingBlock(): boolean { return this.settings.hideThinkingBlock ?? false; }
  getShowCacheMissNotices(): boolean { return this.settings.showCacheMissNotices ?? false; }

  getExternalEditorCommand(): string | undefined { const e = this.settings.externalEditor; if (typeof e === "string" && e.trim() !== "") return e; const env = process.env.VISUAL || process.env.EDITOR; return env || (process.platform === "win32" ? "notepad" : "nano"); }

  setHideThinkingBlock(hide: boolean): void { this.globalSettings.hideThinkingBlock = hide; this.markModified("hideThinkingBlock"); this.save(); }
  setShowCacheMissNotices(show: boolean): void { this.globalSettings.showCacheMissNotices = show; this.markModified("showCacheMissNotices"); this.save(); }

  getShellPath(): string | undefined { const s = this.settings.shellPath; return s ? normalizePath(s) : s; }
  setShellPath(path: string | undefined): void { this.globalSettings.shellPath = path; this.markModified("shellPath"); this.save(); }

  getQuietStartup(): boolean { return this.settings.quietStartup ?? false; }
  setQuietStartup(quiet: boolean): void { this.globalSettings.quietStartup = quiet; this.markModified("quietStartup"); this.save(); }

  getDefaultProjectTrust(): DefaultProjectTrust { const v = this.globalSettings.defaultProjectTrust; return v === "always" || v === "never" ? v : "ask"; }
  setDefaultProjectTrust(t: DefaultProjectTrust): void { this.globalSettings.defaultProjectTrust = t; this.markModified("defaultProjectTrust"); this.save(); }

  getShellCommandPrefix(): string | undefined { return this.settings.shellCommandPrefix; }
  setShellCommandPrefix(prefix: string | undefined): void { this.globalSettings.shellCommandPrefix = prefix; this.markModified("shellCommandPrefix"); this.save(); }

  getNpmCommand(): string[] | undefined { return this.settings.npmCommand ? [...this.settings.npmCommand] : undefined; }
  setNpmCommand(command: string[] | undefined): void { this.globalSettings.npmCommand = command ? [...command] : undefined; this.markModified("npmCommand"); this.save(); }

  getCollapseChangelog(): boolean { return this.settings.collapseChangelog ?? false; }
  setCollapseChangelog(collapse: boolean): void { this.globalSettings.collapseChangelog = collapse; this.markModified("collapseChangelog"); this.save(); }

  getEnableInstallTelemetry(): boolean { return this.settings.enableInstallTelemetry ?? true; }
  setEnableInstallTelemetry(enabled: boolean): void { this.globalSettings.enableInstallTelemetry = enabled; this.markModified("enableInstallTelemetry"); this.save(); }

  getEnableAnalytics(): boolean { return this.settings.enableAnalytics ?? false; }
  getTrackingId(): string | undefined { return this.settings.trackingId; }
  setEnableAnalytics(enabled: boolean): void { this.globalSettings.enableAnalytics = enabled; this.markModified("enableAnalytics"); if (enabled && !this.globalSettings.trackingId) { this.globalSettings.trackingId = randomUUID(); this.markModified("trackingId"); } this.save(); }

  getPackages(): PackageSource[] { return [...(this.settings.packages ?? [])]; }
  setPackages(packages: PackageSource[]): void { this.globalSettings.packages = packages; this.markModified("packages"); this.save(); }
  setProjectPackages(packages: PackageSource[]): void { this.updateProjectSettings("packages", (s) => { s.packages = packages; }); }

  getExtensionPaths(): string[] { return [...(this.settings.extensions ?? [])]; }
  setExtensionPaths(paths: string[]): void { this.globalSettings.extensions = paths; this.markModified("extensions"); this.save(); }
  setProjectExtensionPaths(paths: string[]): void { this.updateProjectSettings("extensions", (s) => { s.extensions = paths; }); }

  getSkillPaths(): string[] { return [...(this.settings.skills ?? [])]; }
  setSkillPaths(paths: string[]): void { this.globalSettings.skills = paths; this.markModified("skills"); this.save(); }
  setProjectSkillPaths(paths: string[]): void { this.updateProjectSettings("skills", (s) => { s.skills = paths; }); }

  getPromptTemplatePaths(): string[] { return [...(this.settings.prompts ?? [])]; }
  setPromptTemplatePaths(paths: string[]): void { this.globalSettings.prompts = paths; this.markModified("prompts"); this.save(); }
  setProjectPromptTemplatePaths(paths: string[]): void { this.updateProjectSettings("prompts", (s) => { s.prompts = paths; }); }

  getThemePaths(): string[] { return [...(this.settings.themes ?? [])]; }
  setThemePaths(paths: string[]): void { this.globalSettings.themes = paths; this.markModified("themes"); this.save(); }
  setProjectThemePaths(paths: string[]): void { this.updateProjectSettings("themes", (s) => { s.themes = paths; }); }

  getEnableSkillCommands(): boolean { return this.settings.enableSkillCommands ?? true; }
  setEnableSkillCommands(enabled: boolean): void { this.globalSettings.enableSkillCommands = enabled; this.markModified("enableSkillCommands"); this.save(); }

  getThinkingBudgets(): ThinkingBudgetsSettings | undefined { return this.settings.thinkingBudgets; }

  getShowImages(): boolean { return this.settings.terminal?.showImages ?? true; }
  setShowImages(show: boolean): void { if (!this.globalSettings.terminal) this.globalSettings.terminal = {}; this.globalSettings.terminal.showImages = show; this.markModified("terminal", "showImages"); this.save(); }
  getImageWidthCells(): number { const w = this.settings.terminal?.imageWidthCells; if (typeof w !== "number" || !Number.isFinite(w)) return 60; return Math.max(1, Math.floor(w)); }
  setImageWidthCells(width: number): void { if (!this.globalSettings.terminal) this.globalSettings.terminal = {}; this.globalSettings.terminal.imageWidthCells = Math.max(1, Math.floor(width)); this.markModified("terminal", "imageWidthCells"); this.save(); }
  getClearOnShrink(): boolean { if (this.settings.terminal?.clearOnShrink !== undefined) return this.settings.terminal.clearOnShrink; return process.env.PI_CLEAR_ON_SHRINK === "1"; }
  setClearOnShrink(enabled: boolean): void { if (!this.globalSettings.terminal) this.globalSettings.terminal = {}; this.globalSettings.terminal.clearOnShrink = enabled; this.markModified("terminal", "clearOnShrink"); this.save(); }
  getShowTerminalProgress(): boolean { return this.settings.terminal?.showTerminalProgress ?? false; }
  setShowTerminalProgress(enabled: boolean): void { if (!this.globalSettings.terminal) this.globalSettings.terminal = {}; this.globalSettings.terminal.showTerminalProgress = enabled; this.markModified("terminal", "showTerminalProgress"); this.save(); }

  getImageAutoResize(): boolean { return this.settings.images?.autoResize ?? true; }
  setImageAutoResize(enabled: boolean): void { if (!this.globalSettings.images) this.globalSettings.images = {}; this.globalSettings.images.autoResize = enabled; this.markModified("images", "autoResize"); this.save(); }
  getBlockImages(): boolean { return this.settings.images?.blockImages ?? false; }
  setBlockImages(blocked: boolean): void { if (!this.globalSettings.images) this.globalSettings.images = {}; this.globalSettings.images.blockImages = blocked; this.markModified("images", "blockImages"); this.save(); }

  getEnabledModels(): string[] | undefined { return this.settings.enabledModels; }
  setEnabledModels(patterns: string[] | undefined): void { this.globalSettings.enabledModels = patterns; this.markModified("enabledModels"); this.save(); }

  getDoubleEscapeAction(): "fork" | "tree" | "none" { return this.settings.doubleEscapeAction ?? "tree"; }
  setDoubleEscapeAction(action: "fork" | "tree" | "none"): void { this.globalSettings.doubleEscapeAction = action; this.markModified("doubleEscapeAction"); this.save(); }

  getTreeFilterMode(): "default" | "no-tools" | "user-only" | "labeled-only" | "all" { const m = this.settings.treeFilterMode; const v = ["default", "no-tools", "user-only", "labeled-only", "all"]; return m && v.includes(m) ? m : "default"; }
  setTreeFilterMode(mode: "default" | "no-tools" | "user-only" | "labeled-only" | "all"): void { this.globalSettings.treeFilterMode = mode; this.markModified("treeFilterMode"); this.save(); }

  getShowHardwareCursor(): boolean { return this.settings.showHardwareCursor ?? process.env.PI_HARDWARE_CURSOR === "1"; }
  setShowHardwareCursor(enabled: boolean): void { this.globalSettings.showHardwareCursor = enabled; this.markModified("showHardwareCursor"); this.save(); }

  getEditorPaddingX(): number { return this.settings.editorPaddingX ?? 0; }
  setEditorPaddingX(padding: number): void { this.globalSettings.editorPaddingX = Math.max(0, Math.min(3, Math.floor(padding))); this.markModified("editorPaddingX"); this.save(); }

  getOutputPad(): 0 | 1 { return this.settings.outputPad === 0 ? 0 : 1; }
  setOutputPad(padding: 0 | 1): void { this.globalSettings.outputPad = padding; this.markModified("outputPad"); this.save(); }

  getAutocompleteMaxVisible(): number { return this.settings.autocompleteMaxVisible ?? 5; }
  setAutocompleteMaxVisible(maxVisible: number): void { this.globalSettings.autocompleteMaxVisible = Math.max(3, Math.min(20, Math.floor(maxVisible))); this.markModified("autocompleteMaxVisible"); this.save(); }

  getCodeBlockIndent(): string { return this.settings.markdown?.codeBlockIndent ?? "  "; }
  getWarnings(): WarningSettings { return { ...(this.settings.warnings ?? {}) }; }
  setWarnings(warnings: WarningSettings): void { this.globalSettings.warnings = { ...warnings }; this.markModified("warnings"); this.save(); }
}
