# Subagent 工具实现计划（扩展系统版）

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 先实现一个**迷你扩展系统**（加载扩展 → `registerTool` → 注入 AgentSession），再基于它实现 `subagent` 扩展：将任务委托给具有隔离上下文窗口的专用子代理（单个 / 并行 / 链式三种模式）。

**架构：** 子代理通过 `spawn` 独立 `mimi` 子进程（`--mode json -p --no-session --model … --tools … --append-system-prompt …`）运行，解析 stdout 的 JSON 事件流（`message_end` / `tool_execution_end`）收集结果与用量。代理定义从 `~/.mimi/agent/agents/*.md`（用户级）与 `.mimi/agents/*.md`（项目级）加载。

**技术栈：** TypeScript、`@mimi/agent`（`AgentTool` / `AgentToolResult` / `AgentToolUpdateCallback`）、`typebox`（v2）、`jiti`（运行时加载 TS 扩展）、`node:child_process`（spawn）、vitest。

---

## 关键决策（本次已确认）

| 决策点 | 结论 |
|--------|------|
| 注册方式 | **扩展系统**（非内置工具）。先实现迷你扩展系统，subagent 作为第一个扩展 |
| 扩展加载 | **用 jiti** 运行时加载 TS 扩展模块 |
| UI 交互（`ctx.ui.confirm`/`select`） | **不做**。`ExtensionContext` 最小化为 `cwd` + `signal` |
| 事件系统（`api.on`）、命令/快捷键/flag/provider 注册 | **不做**（subagent 不需要） |

## 与 pi 原实现的差异

| 维度 | pi 原实现 | 本项目 |
|------|-----------|--------|
| 注册方式 | 完整扩展系统（事件/命令/快捷键/flag/provider/ui 全量） | **迷你扩展系统**（仅 `registerTool`） |
| 扩展加载 | jiti（Bun 二进制下用 virtualModules） | jiti（Node 环境，标准 resolve） |
| 工具 `execute` 签名 | 5 参（多 `ctx: ExtensionContext`） | 5 参（对齐 pi），经 wrapper 转成 `AgentTool` 的 4 参 |
| `ExtensionContext` | 含 `ui`/`hasUI`/`sessionManager`/`modelRegistry` 等 | 仅 `cwd` + `signal` |
| 工具名 | `read` / `write` / `edit` | `read_file` / `write_file` / `edit` / `edit_diff` |
| 事件流 | `message_end` + `tool_result_end` | 仅 `message_end`（`role: "assistant" | "toolResult"`） |
| 项目级代理确认 | `ctx.ui.confirm` | 省略（无 ui） |
| 渲染 | `renderCall` / `renderResult` | 省略（`AgentTool` 无此字段，走 TUI 通用 fallback） |
| 用量 `cost` | `usage.cost.total` | 相同（本项目 `Usage.cost.total` 同为数字） |
| 参数校验 | typebox `StringEnum`（pi 自写 helper） | typebox `StringEnum`（照搬 pi 到 @mimi/ai） |

> **错误约定**：本项目 `AgentToolResult` 无顶层 `isError`，且工具失败约定为「execute 抛错 → isError=true」。但 subagent 失败时需保留 `details`（usage / 工具调用列表）供 UI 渲染，故**失败不 throw，而是把错误文本写入 `content`**（与现有 `read.ts` 返回 `Error: ...` 文本风格一致），`details` 保留完整结果。

---

## 文件结构

**新增（@mimi/ai 基础设施）**

| 文件 | 职责 | 预估行 |
|------|------|--------|
| `packages/ai/src/utils/typebox-helpers.ts` | `StringEnum` helper（照搬 pi，生成原生 `enum` 数组 schema） | ~20 |

**新增（迷你扩展系统）**

| 文件 | 职责 | 预估行 |
|------|------|--------|
| `packages/coding-agent/src/core/extensions/types.ts` | `ExtensionContext` / `ToolDefinition` / `ExtensionAPI` / `ExtensionFactory` / `Extension` / `LoadExtensionsResult` | ~60 |
| `packages/coding-agent/src/core/extensions/loader.ts` | jiti 加载扩展模块、目录发现、`discoverAndLoadExtensions` / `loadExtensionFromFactory` | ~140 |
| `packages/coding-agent/src/core/extensions/wrapper.ts` | `wrapExtensionTool`（`ToolDefinition` → `AgentTool`，补 ctx） | ~30 |
| `packages/coding-agent/src/core/extensions/index.ts` | 导出 | ~10 |

**新增（subagent 扩展，放在 `extensions/` 而非 `core/tools/`）**

| 文件 | 职责 | 预估行 |
|------|------|--------|
| `packages/coding-agent/src/extensions/subagent/types.ts` | `AgentScope` / `AgentConfig` / `SingleResult` / `SubagentDetails` / `UsageStats` / `DisplayItem` | ~80 |
| `packages/coding-agent/src/extensions/subagent/frontmatter.ts` | `parseAgentFrontmatter` 纯函数 | ~40 |
| `packages/coding-agent/src/extensions/subagent/discover.ts` | 代理发现 | ~110 |
| `packages/coding-agent/src/extensions/subagent/helpers.ts` | 格式化/并发/截断纯函数 | ~230 |
| `packages/coding-agent/src/extensions/subagent/runner.ts` | `getMimiInvocation` + `runSingleAgent` | ~180 |
| `packages/coding-agent/src/extensions/subagent/tool.ts` | `subagentTool: ToolDefinition`（execute 5 参，三种模式分发） | ~280 |
| `packages/coding-agent/src/extensions/subagent/index.ts` | `subagentExtension: ExtensionFactory` | ~15 |

**修改**

| 文件 | 改动 |
|------|------|
| `packages/coding-agent/package.json` | 移除 `@sinclair/typebox`、加 `typebox` v2 与 `jiti` 依赖 |
| `packages/coding-agent/src/core/agent-session.ts` | `AgentSessionConfig` 增 `toolNames` / `appendSystemPrompt` / `extraTools`；`prompt()` 用其选工具、拼 prompt、附加扩展工具 |
| `packages/coding-agent/src/core/agent-session-services.ts` | `CreateAgentSessionFromServicesOptions` 增 `tools` / `appendSystemPrompt` / `extensionTools`，透传 AgentSession |
| `packages/coding-agent/src/main.ts` | 加载扩展（内置 subagent + 外部发现）→ wrap → 注入；透传 `--tools` / `--append-system-prompt` |

**新增示例（对齐 pi）**

| 文件 | 用途 |
|------|------|
| `packages/coding-agent/examples/subagent/agents/{scout,planner,reviewer,worker}.md` | 示例代理定义 |
| `packages/coding-agent/examples/subagent/prompts/{implement,scout-and-plan,implement-and-review}.md` | 工作流提示模板 |
| `packages/coding-agent/examples/subagent/README.md` | 安装与用法说明 |

---

## 任务 0：typebox 对齐（统一 coding-agent 到 v2 + StringEnum helper）

> ✅ 已完成（2026-08-16）：typebox 统一到 v2 + StringEnum helper + webui 测试补齐与自动重连修复。

**文件：**
- 修改：`packages/coding-agent/src/core/tools/{read,write,edit,edit-diff,bash,find,grep,ls}.ts`（import 换包）
- 修改：`packages/coding-agent/package.json`（换依赖）
- 创建：`packages/ai/src/utils/typebox-helpers.ts`
- 修改：`packages/ai/src/index.ts`（导出 `StringEnum`）
- 测试：`packages/ai/src/__tests__/typebox-helpers.test.ts`

> 背景：本项目 `@mimi/ai` / `@mimi/agent` 已用 `typebox@1.1.38`（v2，与 pi 一致），但 coding-agent 的 `core/tools/*.ts` 用的是旧包 `@sinclair/typebox@0.34`。TypeBox v2 发布时把包名从 `@sinclair/typebox` 改为 `typebox`（同一库的新旧版本）。旧版 schema 虽「侥幸」能赋给 `AgentTool` 的 `TSchema`（结构兼容而编译通过），但两个包运行时各自独立（`Kind` symbol 不同），将来做参数校验（typebox `Value` 模块）会互不认，且依赖重复安装。**优先统一到 v2**。同时照搬 pi 的 `StringEnum` helper（用 `Type.Unsafe` 手工构造 `{ type: "string", enum: [...] }`，兼容不支持 `anyOf`/`const` 的 provider 如 Google）。

### 第一部分：统一 coding-agent 到 typebox v2

- [ ] **步骤 1：8 个 tools 文件 import 换包**

把 `packages/coding-agent/src/core/tools/` 下 8 个文件（`read.ts` / `write.ts` / `edit.ts` / `edit-diff.ts` / `bash.ts` / `find.ts` / `grep.ts` / `ls.ts`）中的：

```typescript
import { Type, type Static } from "@sinclair/typebox";
```

改为：

```typescript
import { Type, type Static } from "typebox";
```

> 这 8 个文件只用了 `Type.Object` / `Type.String` / `Type.Number` / `Type.Optional` / `Type.Boolean`，typebox v2 全部兼容，无其他 API 变更。

- [ ] **步骤 2：package.json 换依赖**

```bash
pnpm --filter @mimi/coding-agent remove @sinclair/typebox
pnpm --filter @mimi/coding-agent add typebox@1.1.38
```

- [ ] **步骤 3：构建 + 测试验证**

运行：`pnpm --filter @mimi/coding-agent build && pnpm --filter @mimi/coding-agent test`
预期：全绿（此时 coding-agent 已全 v2）。

### 第二部分：StringEnum helper（@mimi/ai）

- [ ] **步骤 4：写 `typebox-helpers.ts`**

```typescript
import { type TUnsafe, Type } from "typebox";

/**
 * 创建字符串枚举 schema，兼容不支持 anyOf/const 的 provider（如 Google）。
 * 生成 JSON Schema 原生 enum 数组形式：{ type: "string", enum: [...] }
 */
export function StringEnum<T extends readonly string[]>(
  values: T,
  options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: values as any,
    ...(options?.description && { description: options.description }),
    ...(options?.default && { default: options.default }),
  });
}
```

- [ ] **步骤 5：在 `index.ts` 导出**

修改 [index.ts](file:///f:/allProject/githubProject/my-mimipi/packages/ai/src/index.ts)，加一行：

```typescript
export { StringEnum } from "./utils/typebox-helpers.js";
```

- [ ] **步骤 6：写测试**

`typebox-helpers.test.ts`：断言 `StringEnum(["user","project","both"])` 的 `type` 为 `"string"`、`enum` 为 `["user","project","both"]`（不含 `anyOf`/`const`），`Static` 类型收窄为字面量联合。

- [ ] **步骤 7：全仓构建 + 测试**

运行：`pnpm build && pnpm test`
预期：全绿。

- [ ] **步骤 8：Commit（两个 commit）**

```bash
git add packages/coding-agent/src/core/tools/ packages/coding-agent/package.json pnpm-lock.yaml
git commit -m "chore(coding-agent): unify typebox to v2 (drop @sinclair/typebox)"

git add packages/ai/src/utils/typebox-helpers.ts packages/ai/src/index.ts packages/ai/src/__tests__/typebox-helpers.test.ts
git commit -m "feat(ai): add StringEnum helper for provider-compatible enum schemas"
```

---

## 任务 1：迷你扩展系统核心（types + loader + wrapper）

**文件：**
- 修改：`packages/coding-agent/package.json`（加 jiti）
- 创建：`packages/coding-agent/src/core/extensions/types.ts`
- 创建：`packages/coding-agent/src/core/extensions/loader.ts`
- 创建：`packages/coding-agent/src/core/extensions/wrapper.ts`
- 创建：`packages/coding-agent/src/core/extensions/index.ts`
- 测试：`packages/coding-agent/src/__tests__/extensions/wrapper.test.ts`
- 测试：`packages/coding-agent/src/__tests__/extensions/loader.test.ts`

- [ ] **步骤 1：加 jiti 依赖**

在 [package.json](file:///f:/allProject/githubProject/my-mimipi/packages/coding-agent/package.json) 的 `dependencies` 增加 `jiti`（用 `pnpm --filter @mimi/coding-agent add jiti` 安装到最新稳定版 v2）。执行：

```bash
pnpm --filter @mimi/coding-agent add jiti
```

- [ ] **步骤 2：写 `types.ts`**

```typescript
import type { AgentToolResult, AgentToolUpdateCallback } from "@mimi/agent";
import type { Static, TSchema } from "typebox";

/** 扩展上下文（V1 最小：cwd + signal；ui 留待后续） */
export interface ExtensionContext {
  cwd: string;
  signal?: AbortSignal;
}

/** 扩展工具定义。execute 比 AgentTool 多一个 ctx 参数 */
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  executionMode?: "sequential" | "parallel";
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<TDetails>>;
}

/** 扩展 API（V1 最小：仅 registerTool） */
export interface ExtensionAPI {
  registerTool<TParams extends TSchema = TSchema, TDetails = unknown>(
    tool: ToolDefinition<TParams, TDetails>,
  ): void;
}

/** 扩展工厂函数 */
export type ExtensionFactory = (api: ExtensionAPI) => void | Promise<void>;

/** 已加载扩展 */
export interface Extension {
  path: string;
  resolvedPath: string;
  tools: Map<string, ToolDefinition>;
}

export interface LoadExtensionsResult {
  extensions: Extension[];
  errors: Array<{ path: string; error: string }>;
}
```

- [ ] **步骤 3：写 `loader.ts`**

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { createJiti } from "jiti";
import { CONFIG_DIR_NAME, getAgentDir } from "../../config.js";
import { resolvePath } from "../../utils/paths.js";
import type {
  Extension,
  ExtensionAPI,
  ExtensionFactory,
  LoadExtensionsResult,
  ToolDefinition,
} from "./types.js";

function createExtensionAPI(extension: Extension): ExtensionAPI {
  return {
    registerTool(tool) {
      extension.tools.set(tool.name, tool);
    },
  };
}

async function loadExtensionModule(extensionPath: string): Promise<ExtensionFactory | undefined> {
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  const mod = await jiti.import(extensionPath, { default: true });
  return typeof mod === "function" ? (mod as ExtensionFactory) : undefined;
}

async function loadExtension(
  extensionPath: string,
  cwd: string,
): Promise<{ extension: Extension | null; error: string | null }> {
  const resolvedPath = resolvePath(extensionPath, cwd);
  try {
    const factory = await loadExtensionModule(resolvedPath);
    if (!factory) {
      return { extension: null, error: `Extension does not export a factory function: ${extensionPath}` };
    }
    const extension: Extension = { path: extensionPath, resolvedPath, tools: new Map() };
    await factory(createExtensionAPI(extension));
    return { extension, error: null };
  } catch (err) {
    return { extension: null, error: `Failed to load extension: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 从内联工厂函数创建扩展（内置扩展用） */
export async function loadExtensionFromFactory(
  factory: ExtensionFactory,
  cwd: string,
  extensionPath = "<inline>",
): Promise<Extension> {
  const extension: Extension = { path: extensionPath, resolvedPath: extensionPath, tools: new Map() };
  await factory(createExtensionAPI(extension));
  return extension;
}

function isExtensionFile(name: string): boolean {
  return name.endsWith(".ts") || name.endsWith(".js");
}

function resolveExtensionEntries(dir: string): string[] | null {
  const indexTs = path.join(dir, "index.ts");
  const indexJs = path.join(dir, "index.js");
  if (fs.existsSync(indexTs)) return [indexTs];
  if (fs.existsSync(indexJs)) return [indexJs];
  return null;
}

function discoverExtensionsInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const discovered: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if ((entry.isFile() || entry.isSymbolicLink()) && isExtensionFile(entry.name)) {
        discovered.push(p);
      } else if (entry.isDirectory()) {
        const entries = resolveExtensionEntries(p);
        if (entries) discovered.push(...entries);
      }
    }
  } catch {
    return [];
  }
  return discovered;
}

/** 从标准位置 + 配置路径发现并加载扩展 */
export async function discoverAndLoadExtensions(
  configuredPaths: string[],
  cwd: string,
  agentDir: string = getAgentDir(),
): Promise<LoadExtensionsResult> {
  const resolvedCwd = resolvePath(cwd);
  const allPaths: string[] = [];
  const seen = new Set<string>();
  const addPaths = (paths: string[]) => {
    for (const p of paths) {
      const resolved = path.resolve(p);
      if (!seen.has(resolved)) { seen.add(resolved); allPaths.push(p); }
    }
  };

  // 1. 项目级：cwd/.mimi/extensions/
  addPaths(discoverExtensionsInDir(path.join(resolvedCwd, CONFIG_DIR_NAME, "extensions")));
  // 2. 全局：agentDir/extensions/
  addPaths(discoverExtensionsInDir(path.join(resolvePath(agentDir), "extensions")));
  // 3. 显式配置路径（--extensions / settingsManager.getExtensionPaths()）
  for (const p of configuredPaths) {
    const resolved = resolvePath(p, resolvedCwd);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      addPaths(resolveExtensionEntries(resolved) ?? discoverExtensionsInDir(resolved));
    } else {
      addPaths([resolved]);
    }
  }

  const extensions: Extension[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  for (const extPath of allPaths) {
    const { extension, error } = await loadExtension(extPath, resolvedCwd);
    if (error) errors.push({ path: extPath, error });
    else if (extension) extensions.push(extension);
  }
  return { extensions, errors };
}
```

- [ ] **步骤 4：写 `wrapper.ts`**

```typescript
import type { AgentTool } from "@mimi/agent";
import type { ExtensionContext, ToolDefinition } from "./types.js";

/** 把扩展工具定义包装为 AgentTool（桥接 5 参 execute → 4 参 execute，注入 ctx） */
export function wrapExtensionTool(tool: ToolDefinition, cwd: string): AgentTool {
  const ctx: ExtensionContext = { cwd };
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    executionMode: tool.executionMode,
    execute: (toolCallId, params, signal, onUpdate) =>
      tool.execute(toolCallId, params, signal, onUpdate, ctx),
  };
}

export function wrapExtensionTools(tools: ToolDefinition[], cwd: string): AgentTool[] {
  return tools.map((t) => wrapExtensionTool(t, cwd));
}
```

- [ ] **步骤 5：写 `index.ts`**

```typescript
export { discoverAndLoadExtensions, loadExtensionFromFactory } from "./loader.js";
export { wrapExtensionTool, wrapExtensionTools } from "./wrapper.js";
export type {
  Extension,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  LoadExtensionsResult,
  ToolDefinition,
} from "./types.js";
```

- [ ] **步骤 6：写测试**

`wrapper.test.ts`：给定一个 5 参 execute 的 `ToolDefinition`，`wrapExtensionTool` 后调用其 `execute`，断言 ctx 注入了 `cwd` 且返回值透传。`loader.test.ts`：用 `vi.mock("jiti")` 注入 fake jiti，覆盖「加载 factory 成功注册工具」「非函数导出报错」「目录发现」。

- [ ] **步骤 7：运行测试**

运行：`pnpm --filter @mimi/coding-agent test`
预期：通过。

- [ ] **步骤 8：Commit**

```bash
git add packages/coding-agent/package.json pnpm-lock.yaml packages/coding-agent/src/core/extensions/ packages/coding-agent/src/__tests__/extensions/
git commit -m "feat(extensions): minimal extension system (types + jiti loader + wrapper)"
```

---

## 任务 2：AgentSession 注入 + main.ts 集成（含 CLI 参数生效）

**文件：**
- 修改：`packages/coding-agent/src/core/agent-session.ts`
- 修改：`packages/coding-agent/src/core/agent-session-services.ts`
- 修改：`packages/coding-agent/src/main.ts`
- 测试：`packages/coding-agent/src/__tests__/agent-session.test.ts`

> 本任务同时补齐子进程调用依赖的 `--tools` / `--append-system-prompt` 生效，并把扩展工具注入 AgentSession。内置扩展列表先留空，任务 6 再填入 `subagentExtension`。

- [ ] **步骤 1：扩展 `AgentSessionConfig` 与 `prompt()`**

修改 [agent-session.ts](file:///f:/allProject/githubProject/my-mimipi/packages/coding-agent/src/core/agent-session.ts)：

```typescript
import type {
  Agent,
  AgentEvent,
  AgentMessage,
  AgentTool,
  ThinkingLevel,
} from "@mimi/agent";
```

`AgentSessionConfig` 追加字段：

```typescript
export interface AgentSessionConfig {
  agent: Agent;
  sessionManager: SessionManager;
  cwd: string;
  modelRuntime: ModelRuntime;
  scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
  /** 可选：限制可用内置工具名子集；空 = 全部内置工具 */
  toolNames?: string[];
  /** 可选：追加到 system prompt 末尾的文本 */
  appendSystemPrompt?: string;
  /** 可选：扩展系统注入的额外工具 */
  extraTools?: AgentTool<any>[];
}
```

类新增字段与 `_selectTools`，构造函数保存：

```typescript
private _toolNames: string[];
private _appendSystemPrompt: string;
private _extraTools: AgentTool<any>[];

constructor(config: AgentSessionConfig) {
  this.agent = config.agent;
  this.sessionManager = config.sessionManager;
  this._scopedModels = config.scopedModels ?? [];
  this._cwd = config.cwd;
  this._modelRuntime = config.modelRuntime;
  this._toolNames = config.toolNames ?? [];
  this._appendSystemPrompt = config.appendSystemPrompt ?? "";
  this._extraTools = config.extraTools ?? [];

  this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
}

/** 按 toolNames 过滤内置工具 */
private _selectTools(): AgentTool<any>[] {
  const all = createBuiltinTools(this._cwd);
  if (this._toolNames.length === 0) return all;
  return all.filter((t) => this._toolNames.includes(t.name));
}
```

`prompt()` 内两处改为：

```typescript
if (this.agent.state.tools.length === 0) {
  this.agent.state.tools = [...this._selectTools(), ...this._extraTools];
}

if (!this._baseSystemPrompt) {
  const append = this._appendSystemPrompt ? `\n\n${this._appendSystemPrompt}` : "";
  this._baseSystemPrompt = [
    `You are mimi, an AI coding assistant.`,
    ``,
    `Working directory: ${this._cwd}`,
    ``,
    `You have access to tools for reading, writing, editing files,`,
    `executing shell commands, searching file names (find),`,
    `searching file contents (grep), and listing directories (ls).`,
    append,
  ].join("\n");
  this.agent.state.systemPrompt = this._baseSystemPrompt;
}
```

- [ ] **步骤 2：透传 `createAgentSessionFromServices` 选项**

修改 [agent-session-services.ts](file:///f:/allProject/githubProject/my-mimipi/packages/coding-agent/src/core/agent-session-services.ts)。`import { Agent } from "@mimi/agent";` 改为 `import { Agent, type AgentTool } from "@mimi/agent";`，`CreateAgentSessionFromServicesOptions` 追加：

```typescript
export interface CreateAgentSessionFromServicesOptions {
  services: AgentSessionServices;
  sessionManager: SessionManager;
  model?: any;
  thinkingLevel?: string;
  /** 可选：工具名子集 */
  tools?: string[];
  /** 可选：追加 system prompt 文本 */
  appendSystemPrompt?: string;
  /** 可选：扩展系统注入的工具 */
  extensionTools?: AgentTool<any>[];
}
```

创建 AgentSession 处改为：

```typescript
const session = new AgentSession({
  agent,
  sessionManager,
  modelRuntime: services.modelRuntime,
  cwd: services.cwd,
  toolNames: options.tools,
  appendSystemPrompt: options.appendSystemPrompt,
  extraTools: options.extensionTools,
});
```

- [ ] **步骤 3：`buildSessionOptions` 透传 `--tools` / `--append-system-prompt`**

修改 [main.ts](file:///f:/allProject/githubProject/my-mimipi/packages/coding-agent/src/main.ts)。顶部加 `import * as fs from "node:fs";`。`buildSessionOptions` 增加 `cwd` 参数并透传：

```typescript
function buildSessionOptions(
  parsed: Args,
  _scopedModels: any[],
  _hasExistingSession: boolean,
  _modelRuntime: ModelRuntime,
  _settingsManager: SettingsManager,
  cwd: string,
): { options: any; cliThinkingFromModel: boolean; diagnostics: AgentSessionRuntimeDiagnostic[] } {
  const options: any = {};
  const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
  const cliThinkingFromModel = false;

  if (parsed.model) options.model = parsed.model;
  if (parsed.thinking) options.thinkingLevel = parsed.thinking;

  // --tools：逗号分隔的工具名子集
  if (parsed.tools) options.tools = parsed.tools;

  // --append-system-prompt <file>：读取文件内容追加
  if (parsed.appendSystemPrompt && parsed.appendSystemPrompt.length > 0) {
    const parts: string[] = [];
    for (const p of parsed.appendSystemPrompt) {
      try {
        parts.push(fs.readFileSync(resolvePath(p, cwd), "utf-8"));
      } catch {
        diagnostics.push({ type: "warning", message: `Cannot read append-system-prompt file: ${p}` });
      }
    }
    if (parts.length > 0) options.appendSystemPrompt = parts.join("\n\n");
  }

  return { options, cliThinkingFromModel, diagnostics };
}
```

调用处（原 `buildSessionOptions(parsed, [], false, modelRuntime, runtimeSettingsManager)`）改为传入 `runtimeCwd`。

- [ ] **步骤 4：main.ts 加载扩展并注入**

在 [main.ts](file:///f:/allProject/githubProject/my-mimipi/packages/coding-agent/src/main.ts) 顶部补充导入：

```typescript
import {
  discoverAndLoadExtensions,
  loadExtensionFromFactory,
  wrapExtensionTools,
  type ExtensionFactory,
} from "./core/extensions/index.js";
import type { AgentTool } from "@mimi/agent";
```

在 `createRuntime` 工厂内，`buildSessionOptions` 之后、`createAgentSessionFromServices` 之前插入：

```typescript
// 加载扩展工具
const builtInExtensions: ExtensionFactory[] = []; // 🔴 任务 6 填入 subagentExtension
const extensionTools: AgentTool<any>[] = [];

for (const factory of builtInExtensions) {
  const ext = await loadExtensionFromFactory(factory, runtimeCwd, "<inline>");
  extensionTools.push(...wrapExtensionTools(Array.from(ext.tools.values()), runtimeCwd));
}

if (!parsed.noExtensions) {
  const extensionPaths = [
    ...(parsed.extensions ?? []),
    ...runtimeSettingsManager.getExtensionPaths(),
  ];
  const extResult = await discoverAndLoadExtensions(extensionPaths, runtimeCwd, runtimeAgentDir);
  extensionTools.push(
    ...wrapExtensionTools(
      extResult.extensions.flatMap((e) => Array.from(e.tools.values())),
      runtimeCwd,
    ),
  );
  for (const e of extResult.errors) {
    diagnostics.push({ type: "warning", message: `Extension error: ${e.path}: ${e.error}` });
  }
}
```

`createAgentSessionFromServices` 调用处追加：

```typescript
const created = await createAgentSessionFromServices({
  services,
  sessionManager: runtimeSessionManager,
  model: sessionOptions.model,
  thinkingLevel: sessionOptions.thinkingLevel,
  tools: sessionOptions.tools,
  appendSystemPrompt: sessionOptions.appendSystemPrompt,
  extensionTools,
});
```

- [ ] **步骤 5：写测试**

`agent-session.test.ts` 覆盖：构造带 `toolNames` / `appendSystemPrompt` / `extraTools` 的 AgentSession，断言 `_selectTools` 过滤逻辑（若私有不便测试，抽纯函数 `selectTools(all, toolNames)` 导出并单测），及 `prompt()` 前 `state.tools` 合并与 `state.systemPrompt` 末尾含追加文本。

- [ ] **步骤 6：运行测试**

运行：`pnpm --filter @mimi/coding-agent test`
预期：通过。

- [ ] **步骤 7：Commit**

```bash
git add packages/coding-agent/src/core/agent-session.ts packages/coding-agent/src/core/agent-session-services.ts packages/coding-agent/src/main.ts packages/coding-agent/src/__tests__/agent-session.test.ts
git commit -m "feat(coding-agent): inject extension tools and wire --tools/--append-system-prompt"
```

---

## 任务 3：subagent 类型 + frontmatter 解析 + 代理发现

**文件：**
- 创建：`packages/coding-agent/src/extensions/subagent/types.ts`
- 创建：`packages/coding-agent/src/extensions/subagent/frontmatter.ts`
- 创建：`packages/coding-agent/src/extensions/subagent/discover.ts`
- 测试：`packages/coding-agent/src/__tests__/extensions/subagent/frontmatter.test.ts`
- 测试：`packages/coding-agent/src/__tests__/extensions/subagent/discover.test.ts`

- [ ] **步骤 1：写 `types.ts`**

```typescript
import type { Message } from "@mimi/ai";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
}

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export interface SingleResult {
  agent: string;
  agentSource: "user" | "project" | "unknown";
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  step?: number;
}

export interface SubagentDetails {
  mode: "single" | "parallel" | "chain";
  agentScope: AgentScope;
  projectAgentsDir: string | null;
  results: SingleResult[];
}

export type DisplayItem =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, any> };
```

- [ ] **步骤 2：写 `frontmatter.ts`**

```typescript
export interface ParsedAgentFrontmatter {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseAgentFrontmatter(content: string): ParsedAgentFrontmatter {
  if (!content.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }
  const lines = content.split("\n");
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { closeIndex = i; break; }
  }
  if (closeIndex === -1) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string> = {};
  for (const line of lines.slice(1, closeIndex)) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (m) frontmatter[m[1]!] = m[2]!.trim();
  }
  const bodyLines = lines.slice(closeIndex + 1);
  while (bodyLines.length > 0 && bodyLines[0] === "") bodyLines.shift();
  return { frontmatter, body: bodyLines.join("\n") };
}
```

- [ ] **步骤 3：写 `discover.ts`**

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "../../config.js";
import { parseAgentFrontmatter } from "./frontmatter.js";
import type { AgentConfig, AgentDiscoveryResult, AgentScope } from "./types.js";

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
  const agents: AgentConfig[] = [];
  if (!fs.existsSync(dir)) return agents;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return agents; }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const filePath = path.join(dir, entry.name);
    let content: string;
    try { content = fs.readFileSync(filePath, "utf-8"); } catch { continue; }
    const { frontmatter, body } = parseAgentFrontmatter(content);
    if (!frontmatter.name || !frontmatter.description) continue;
    const tools = frontmatter.tools?.split(",").map((t) => t.trim()).filter(Boolean);
    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model,
      systemPrompt: body,
      source,
      filePath,
    });
  }
  return agents;
}

function isDirectory(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
    if (isDirectory(candidate)) return candidate;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
  const userDir = path.join(getAgentDir(), "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);
  const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
  const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

  const agentMap = new Map<string, AgentConfig>();
  if (scope === "both") {
    for (const a of userAgents) agentMap.set(a.name, a);
    for (const a of projectAgents) agentMap.set(a.name, a);
  } else if (scope === "user") {
    for (const a of userAgents) agentMap.set(a.name, a);
  } else {
    for (const a of projectAgents) agentMap.set(a.name, a);
  }
  return { agents: Array.from(agentMap.values()), projectAgentsDir };
}
```

- [ ] **步骤 4：写测试**

`frontmatter.test.ts`：正常解析 / 无 frontmatter / 未闭合 / `tools` 逗号分隔。`discover.test.ts`：`vi.mock` 隔离 `getAgentDir` 与 `fs`，覆盖 user/project/both 作用域及「project 覆盖同名 user」。

- [ ] **步骤 5：运行测试**

运行：`pnpm --filter @mimi/coding-agent test`
预期：通过。

- [ ] **步骤 6：Commit**

```bash
git add packages/coding-agent/src/extensions/subagent/types.ts packages/coding-agent/src/extensions/subagent/frontmatter.ts packages/coding-agent/src/extensions/subagent/discover.ts packages/coding-agent/src/__tests__/extensions/subagent/
git commit -m "feat(subagent): add types, frontmatter parsing, and agent discovery"
```

---

## 任务 4：helpers 纯函数

**文件：**
- 创建：`packages/coding-agent/src/extensions/subagent/helpers.ts`
- 测试：`packages/coding-agent/src/__tests__/extensions/subagent/helpers.test.ts`

- [ ] **步骤 1：写 `helpers.ts`**

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@mimi/ai";
import type { DisplayItem, SingleResult, UsageStats } from "./types.js";

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const PER_TASK_OUTPUT_CAP = 50 * 1024;

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

export function formatUsageStats(usage: Partial<UsageStats>, model?: string): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens && usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

function shortenPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

export function formatToolCall(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "bash": {
      const command = (args.command as string) || "...";
      return `$ ${command.length > 60 ? `${command.slice(0, 60)}...` : command}`;
    }
    case "read":
    case "read_file": {
      const rawPath = (args.file_path || args.path || "...") as string;
      const filePath = shortenPath(rawPath);
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;
      let text = filePath;
      if (offset !== undefined || limit !== undefined) {
        const startLine = offset ?? 1;
        const endLine = limit !== undefined ? startLine + limit - 1 : "";
        text += `:${startLine}${endLine ? `-${endLine}` : ""}`;
      }
      return `read ${text}`;
    }
    case "write":
    case "write_file": {
      const rawPath = (args.file_path || args.path || "...") as string;
      const content = (args.content || "") as string;
      const lines = content.split("\n").length;
      let text = `write ${shortenPath(rawPath)}`;
      if (lines > 1) text += ` (${lines} lines)`;
      return text;
    }
    case "edit": {
      const rawPath = (args.file_path || args.path || "...") as string;
      return `edit ${shortenPath(rawPath)}`;
    }
    case "ls": {
      return `ls ${shortenPath((args.path as string) || ".")}`;
    }
    case "find": {
      const pattern = (args.pattern || "*") as string;
      return `find ${pattern} in ${shortenPath((args.path as string) || ".")}`;
    }
    case "grep": {
      const pattern = (args.pattern || "") as string;
      return `grep /${pattern}/ in ${shortenPath((args.path as string) || ".")}`;
    }
    default: {
      const argsStr = JSON.stringify(args);
      return `${toolName} ${argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr}`;
    }
  }
}

export function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") return part.text;
      }
    }
  }
  return "";
}

export function getDisplayItems(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") items.push({ type: "text", text: part.text });
        else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
      }
    }
  }
  return items;
}

export function isFailedResult(result: SingleResult): boolean {
  return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

export function getResultOutput(result: SingleResult): string {
  if (isFailedResult(result)) {
    return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
  }
  return getFinalOutput(result.messages) || "(no output)";
}

export function truncateParallelOutput(output: string): string {
  const byteLength = Buffer.byteLength(output, "utf8");
  if (byteLength <= PER_TASK_OUTPUT_CAP) return output;
  let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
  while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) truncated = truncated.slice(0, -1);
  return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted.]`;
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mimi-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}
```

- [ ] **步骤 2：写测试**

`helpers.test.ts`：`formatTokens`（<1000 / <10000 / >=1000000）、`formatUsageStats`、`formatToolCall`（bash/read_file/write_file/grep/default）、`getFinalOutput`、`isFailedResult`、`truncateParallelOutput`、`mapWithConcurrencyLimit`（保持顺序）。

- [ ] **步骤 3：运行测试**

运行：`pnpm --filter @mimi/coding-agent test`
预期：通过。

- [ ] **步骤 4：Commit**

```bash
git add packages/coding-agent/src/extensions/subagent/helpers.ts packages/coding-agent/src/__tests__/extensions/subagent/helpers.test.ts
git commit -m "feat(subagent): add formatting and concurrency helpers"
```

---

## 任务 5：runner（spawn 子进程 + JSON 流解析）

**文件：**
- 创建：`packages/coding-agent/src/extensions/subagent/runner.ts`
- 测试：`packages/coding-agent/src/__tests__/extensions/subagent/runner.test.ts`

- [ ] **步骤 1：写 `runner.ts`**

```typescript
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import type { AgentToolUpdateCallback } from "@mimi/agent";
import type { Message } from "@mimi/ai";
import type { AgentConfig, SingleResult, SubagentDetails } from "./types.js";
import { getFinalOutput, writePromptToTempFile } from "./helpers.js";

function getMimiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  if (currentScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  return { command: "mimi", args };
}

export async function runSingleAgent(
  defaultCwd: string,
  agents: AgentConfig[],
  agentName: string,
  task: string,
  cwd: string | undefined,
  step: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<SubagentDetails> | undefined,
  makeDetails: (results: SingleResult[]) => SubagentDetails,
): Promise<SingleResult> {
  const agent = agents.find((a) => a.name === agentName);
  if (!agent) {
    const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
    return {
      agent: agentName, agentSource: "unknown", task, exitCode: 1, messages: [],
      stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      step,
    };
  }

  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  if (agent.model) args.push("--model", agent.model);
  if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | null = null;

  const currentResult: SingleResult = {
    agent: agentName, agentSource: agent.source, task, exitCode: 0, messages: [], stderr: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    model: agent.model, step,
  };

  const emitUpdate = () => {
    if (onUpdate) {
      onUpdate({
        content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
        details: makeDetails([currentResult]),
      });
    }
  };

  try {
    if (agent.systemPrompt.trim()) {
      const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
      args.push("--append-system-prompt", tmpPromptPath);
    }
    args.push(`Task: ${task}`);
    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const invocation = getMimiInvocation(args);
      const proc = spawn(invocation.command, invocation.args, {
        cwd: cwd ?? defaultCwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let buffer = "";

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: any;
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === "message_end" && event.message) {
          const msg = event.message as Message;
          currentResult.messages.push(msg);
          if (msg.role === "assistant") {
            currentResult.usage.turns++;
            const usage = (msg as any).usage;
            if (usage) {
              currentResult.usage.input += usage.input || 0;
              currentResult.usage.output += usage.output || 0;
              currentResult.usage.cacheRead += usage.cacheRead || 0;
              currentResult.usage.cacheWrite += usage.cacheWrite || 0;
              currentResult.usage.cost += usage.cost?.total || 0;
              currentResult.usage.contextTokens = usage.totalTokens || 0;
            }
            if (!currentResult.model && (msg as any).model) currentResult.model = (msg as any).model;
            if ((msg as any).stopReason) currentResult.stopReason = (msg as any).stopReason;
            if ((msg as any).errorMessage) currentResult.errorMessage = (msg as any).errorMessage;
          }
          emitUpdate();
        }
      };

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });
      proc.stderr.on("data", (data) => { currentResult.stderr += data.toString(); });
      proc.on("close", (code) => { if (buffer.trim()) processLine(buffer); resolve(code ?? 0); });
      proc.on("error", () => { resolve(1); });

      if (signal) {
        const killProc = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
        };
        if (signal.aborted) killProc();
        else signal.addEventListener("abort", killProc, { once: true });
      }
    });

    currentResult.exitCode = exitCode;
    if (wasAborted) throw new Error("Subagent was aborted");
    return currentResult;
  } finally {
    if (tmpPromptPath) try { fs.unlinkSync(tmpPromptPath); } catch { /* ignore */ }
    if (tmpPromptDir) try { fs.rmdirSync(tmpPromptDir); } catch { /* ignore */ }
  }
}
```

- [ ] **步骤 2：写测试**

`runner.test.ts`：`vi.mock("node:child_process")` 注入 fake `spawn`（EventEmitter 风格 stdout/stderr），覆盖：未知代理返回错误、成功解析 `message_end` 累计 usage、`--tools` 与 `--append-system-prompt` 参数拼装、中止信号 kill。

- [ ] **步骤 3：运行测试**

运行：`pnpm --filter @mimi/coding-agent test`
预期：通过。

- [ ] **步骤 4：Commit**

```bash
git add packages/coding-agent/src/extensions/subagent/runner.ts packages/coding-agent/src/__tests__/extensions/subagent/runner.test.ts
git commit -m "feat(subagent): add subprocess runner with JSON stream parsing"
```

---

## 任务 6：subagent 扩展本体（ToolDefinition + ExtensionFactory）

**文件：**
- 创建：`packages/coding-agent/src/extensions/subagent/tool.ts`
- 创建：`packages/coding-agent/src/extensions/subagent/index.ts`
- 修改：`packages/coding-agent/src/main.ts`（把 `subagentExtension` 填入内置扩展列表）
- 测试：`packages/coding-agent/src/__tests__/extensions/subagent/tool.test.ts`

> 关键变化：`execute` 为 **5 参**（多 `ctx: ExtensionContext`），用 `ctx.cwd` 而非闭包捕获的 cwd。工具通过 `api.registerTool` 注册，不再加入 `createBuiltinTools`。

- [ ] **步骤 1：写 `tool.ts`**

```typescript
import { Type, type Static } from "typebox";
import { StringEnum } from "@mimi/ai";
import { discoverAgents } from "./discover.js";
import { runSingleAgent } from "./runner.js";
import {
  getFinalOutput, getResultOutput, isFailedResult, truncateParallelOutput,
  mapWithConcurrencyLimit, MAX_PARALLEL_TASKS, MAX_CONCURRENCY,
} from "./helpers.js";
import type { ExtensionContext, ToolDefinition } from "../../core/extensions/index.js";
import type { AgentScope, SingleResult, SubagentDetails } from "./types.js";

const TaskItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task with optional {previous} placeholder" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
  description: "Agent scope: user (global), project (project-local), or both",
});

const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (single mode)" })),
  task: Type.Optional(Type.String({ description: "Task to delegate (single mode)" })),
  tasks: Type.Optional(Type.Array(TaskItem)),
  chain: Type.Optional(Type.Array(ChainItem)),
  agentScope: Type.Optional(AgentScopeSchema),
  cwd: Type.Optional(Type.String({ description: "Working directory (single mode)" })),
});

type SubagentParams = Static<typeof SubagentParams>;

export const subagentTool: ToolDefinition<typeof SubagentParams, SubagentDetails> = {
  name: "subagent",
  label: "Subagent",
  description: [
    "Delegate tasks to specialized subagents with isolated context.",
    "Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
    'Default agent scope is "user" (from ~/.mimi/agent/agents).',
    'To enable project-local agents in .mimi/agents, set agentScope: "both" (or "project").',
  ].join(" "),
  parameters: SubagentParams,
  executionMode: "sequential",

  async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
    const agentScope: AgentScope = params.agentScope ?? "user";
    const discovery = discoverAgents(ctx.cwd, agentScope);
    const agents = discovery.agents;

    const hasChain = (params.chain?.length ?? 0) > 0;
    const hasTasks = (params.tasks?.length ?? 0) > 0;
    const hasSingle = Boolean(params.agent && params.task);
    const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

    const makeDetails =
      (mode: "single" | "parallel" | "chain") =>
      (results: SingleResult[]): SubagentDetails => ({
        mode, agentScope, projectAgentsDir: discovery.projectAgentsDir, results,
      });

    if (modeCount !== 1) {
      const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
      return {
        content: [{ type: "text", text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}` }],
        details: makeDetails("single")([]),
      };
    }

    // ── chain ──
    if (hasChain) {
      const results: SingleResult[] = [];
      let previousOutput = "";
      for (let i = 0; i < params.chain!.length; i++) {
        const step = params.chain![i];
        const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);
        const result = await runSingleAgent(
          ctx.cwd, agents, step.agent, taskWithContext, step.cwd, i + 1, signal, onUpdate, makeDetails("chain"),
        );
        results.push(result);
        if (isFailedResult(result)) {
          return {
            content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${getResultOutput(result)}` }],
            details: makeDetails("chain")(results),
          };
        }
        previousOutput = getFinalOutput(result.messages);
      }
      return {
        content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || "(no output)" }],
        details: makeDetails("chain")(results),
      };
    }

    // ── parallel ──
    if (hasTasks) {
      const tasks = params.tasks!;
      if (tasks.length > MAX_PARALLEL_TASKS) {
        return {
          content: [{ type: "text", text: `Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.` }],
          details: makeDetails("parallel")([]),
        };
      }

      const allResults: SingleResult[] = tasks.map((t) => ({
        agent: t.agent, agentSource: "unknown", task: t.task, exitCode: -1, messages: [], stderr: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      }));

      const emitParallelUpdate = () => {
        if (onUpdate) {
          const running = allResults.filter((r) => r.exitCode === -1).length;
          const done = allResults.filter((r) => r.exitCode !== -1).length;
          onUpdate({
            content: [{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` }],
            details: makeDetails("parallel")([...allResults]),
          });
        }
      };

      const results = await mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, async (t, index) => {
        const result = await runSingleAgent(
          ctx.cwd, agents, t.agent, t.task, t.cwd, undefined, signal,
          (partial) => {
            if (partial.details?.results[0]) {
              allResults[index] = partial.details.results[0];
              emitParallelUpdate();
            }
          },
          makeDetails("parallel"),
        );
        allResults[index] = result;
        emitParallelUpdate();
        return result;
      });

      const successCount = results.filter((r) => !isFailedResult(r)).length;
      const summaries = results.map((r) => {
        const output = truncateParallelOutput(getResultOutput(r));
        const status = isFailedResult(r)
          ? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
          : "completed";
        return `### [${r.agent}] ${status}\n\n${output}`;
      });
      return {
        content: [{ type: "text", text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}` }],
        details: makeDetails("parallel")(results),
      };
    }

    // ── single ──
    const result = await runSingleAgent(
      ctx.cwd, agents, params.agent!, params.task!, params.cwd, undefined, signal, onUpdate, makeDetails("single"),
    );
    if (isFailedResult(result)) {
      return {
        content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${getResultOutput(result)}` }],
        details: makeDetails("single")([result]),
      };
    }
    return {
      content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
      details: makeDetails("single")([result]),
    };
  },
};
```

- [ ] **步骤 2：写 `index.ts`（ExtensionFactory）**

```typescript
import type { ExtensionFactory } from "../../core/extensions/index.js";
import { subagentTool } from "./tool.js";

export const subagentExtension: ExtensionFactory = (api) => {
  api.registerTool(subagentTool);
};
```

- [ ] **步骤 3：把 subagent 填入内置扩展列表**

修改 [main.ts](file:///f:/allProject/githubProject/my-mimipi/packages/coding-agent/src/main.ts)：顶部加 `import { subagentExtension } from "./extensions/subagent/index.js";`，把 `builtInExtensions` 从空数组改为：

```typescript
const builtInExtensions: ExtensionFactory[] = [subagentExtension];
```

- [ ] **步骤 4：写测试**

`tool.test.ts`：`vi.mock("./runner.js")` 注入 fake `runSingleAgent`，覆盖：单模式（成功/失败）、并行（超限报错/部分失败汇总）、链式（`{previous}` 替换/首步失败即停）、参数无效。用 `ExtensionContext`（含 `cwd`）调用 `execute`，断言 `runSingleAgent` 收到的 `defaultCwd` 等于 `ctx.cwd`。

- [ ] **步骤 5：运行测试**

运行：`pnpm --filter @mimi/coding-agent test`
预期：通过。

- [ ] **步骤 6：Commit**

```bash
git add packages/coding-agent/src/extensions/subagent/tool.ts packages/coding-agent/src/extensions/subagent/index.ts packages/coding-agent/src/main.ts packages/coding-agent/src/__tests__/extensions/subagent/tool.test.ts
git commit -m "feat(subagent): add subagent extension with single/parallel/chain modes"
```

---

## 任务 7：示例代理定义 + 工作流提示 + README

**文件：**
- 创建：`packages/coding-agent/examples/subagent/agents/scout.md`
- 创建：`packages/coding-agent/examples/subagent/agents/planner.md`
- 创建：`packages/coding-agent/examples/subagent/agents/reviewer.md`
- 创建：`packages/coding-agent/examples/subagent/agents/worker.md`
- 创建：`packages/coding-agent/examples/subagent/prompts/implement.md`
- 创建：`packages/coding-agent/examples/subagent/prompts/scout-and-plan.md`
- 创建：`packages/coding-agent/examples/subagent/prompts/implement-and-review.md`
- 创建：`packages/coding-agent/examples/subagent/README.md`

> **工具名映射**：pi 用 `read`/`write`，本项目为 `read_file`/`write_file`/`edit_diff`。示例代理的 `tools` 字段统一改用本项目工具名。`model` 字段留空（回退默认模型 `deepseek-v4-flash`），避免引用未注册模型 id。

- [ ] **步骤 1：写示例代理定义**

`agents/scout.md`：

```markdown
---
name: scout
description: 快速代码侦察，返回压缩后的上下文以便移交给其他代理
tools: read_file, grep, find, ls, bash
---

你是一名侦察员（scout）。快速调查代码库，返回结构化的调查结果，让其他代理无需重新阅读所有文件即可直接使用。

你的输出将被传递给一个没有看过你所探索文件的代理。

策略：
1. 用 grep/find 定位相关代码
2. 阅读关键代码段（而非整个文件）
3. 识别类型、接口、关键函数
4. 记录文件之间的依赖关系

输出格式：

## 已检索的文件
列表需包含精确的行范围：
1. `path/to/file.ts`（第 10-50 行）- 这里包含什么的描述

## 关键代码
关键的类型、接口或函数（附实际代码）

## 架构
简要说明各部分如何衔接。

## 从这里开始
先看哪个文件以及原因。
```

`agents/planner.md`：

```markdown
---
name: planner
description: 根据上下文和需求创建实现计划
tools: read_file, grep, find, ls
---

你是一名规划专家。你接收上下文（来自 scout）和需求，然后产出一份清晰的实现计划。你不得做任何修改，只能阅读、分析和规划。

输出格式：

## 目标
用一句话总结需要做什么。

## 计划
带编号的步骤，每步小而可执行。

## 待修改文件
- `path/to/file.ts` - 修改什么

## 新建文件（如有）
- `path/to/new.ts` - 用途

## 风险
任何需要注意的事项。
```

`agents/reviewer.md`：

```markdown
---
name: reviewer
description: 代码审查专家，负责质量和安全分析
tools: read_file, grep, find, ls, bash
---

你是一名资深代码审查者。分析代码的质量、安全性和可维护性。

Bash 仅限只读命令：`git diff`、`git log`、`git show`。不要修改文件或运行构建。

输出格式：

## 已审查文件
- `path/to/file.ts`（第 X-Y 行）

## 严重（必须修复）
- `file.ts:42` - 问题描述

## 警告（应该修复）
- `file.ts:100` - 问题描述

## 建议（可以考虑）
- `file.ts:150` - 改进想法

## 总结
用 2-3 句话给出总体评估。
```

`agents/worker.md`：

```markdown
---
name: worker
description: 通用型子代理，具备完整能力和隔离上下文
---

你是一名具备完整能力的 worker 代理。你在隔离的上下文窗口中工作，处理被委托的任务，避免污染主对话。

自主工作以完成分配的任务。按需使用所有可用工具。

完成时的输出格式：

## 已完成
做了什么。

## 已更改文件
- `path/to/file.ts` - 更改了什么

## 备注（如有）
主代理需要了解的任何信息。
```

- [ ] **步骤 2：写工作流提示**

`prompts/implement.md`：

```markdown
---
description: 完整实现工作流 - scout 收集上下文，planner 创建计划，worker 执行实现
---
使用 subagent 工具的 chain 参数执行此工作流：

1. 首先，使用 "scout" 代理查找与以下内容相关的所有代码：$@
2. 然后，使用 "planner" 代理结合上一步的上下文（使用 {previous} 占位符）为 "$@" 创建实现计划
3. 最后，使用 "worker" 代理实现上一步产出的计划（使用 {previous} 占位符）

以链式方式执行，通过 {previous} 在步骤之间传递输出。
```

`prompts/scout-and-plan.md`：

```markdown
---
description: scout 收集上下文，planner 创建实现计划（不执行实现）
---
使用 subagent 工具的 chain 参数执行此工作流：

1. 首先，使用 "scout" 代理查找与以下内容相关的所有代码：$@
2. 然后，使用 "planner" 代理结合上一步的上下文（使用 {previous} 占位符）为 "$@" 创建实现计划

以链式方式执行，通过 {previous} 在步骤之间传递输出。不要实现 - 只返回计划。
```

`prompts/implement-and-review.md`：

```markdown
---
description: worker 执行实现，reviewer 进行审查，worker 应用反馈
---
使用 subagent 工具的 chain 参数执行此工作流：

1. 首先，使用 "worker" 代理实现：$@
2. 然后，使用 "reviewer" 代理审查上一步的实现（使用 {previous} 占位符）
3. 最后，使用 "worker" 代理应用审查反馈（使用 {previous} 占位符）

以链式方式执行，通过 {previous} 在步骤之间传递输出。
```

- [ ] **步骤 3：写 README**

`README.md` 说明：subagent 是**内置扩展**（随 CLI 自动加载，无需手动安装）；代理定义需把 `agents/*.md` 复制/链接到 `~/.mimi/agent/agents/`，工作流提示复制到 `~/.mimi/agent/prompts/`；三种用法（单个/并行/链式）；以及与 pi 的差异（工具名 `read_file`、无渲染、无项目级确认、`--no-extensions` 不影响内置 subagent）。

- [ ] **步骤 4：Commit**

```bash
git add packages/coding-agent/examples/subagent/
git commit -m "docs(subagent): add example agent definitions and workflow prompts"
```

---

## 任务 8：全仓构建与测试验证

**文件：** 无（验证阶段）

- [ ] **步骤 1：全仓构建**

运行：`pnpm build`
预期：`tsc` 全绿，无类型错误（`@mimi/ai` / `@mimi/agent` / `@mimi/coding-agent` 等全部编译通过）。

- [ ] **步骤 2：全仓测试**

运行：`pnpm test`
预期：vitest 全绿，`pnpm -r test` 各包通过，无 TS 类型错误。

- [ ] **步骤 3：端到端手工冒烟（可选）**

1. 把 `examples/subagent/agents/*.md` 复制到 `~/.mimi/agent/agents/`。
2. 构建后运行：`node packages/coding-agent/dist/cli.js -p "Use scout to find all authentication code"`。
3. 预期：父 agent 调用 `subagent` 工具 → spawn 子进程 → 返回 scout 的侦察结果。

> 冒烟需要真实 API key（`MIMI_API_KEY_*`）与网络，作为可选项；未配置时跳过，不阻塞交付。

- [ ] **步骤 4：Commit（如有冒烟产生的临时文件，不提交）**

无需提交；如冒烟暴露问题，按常规修复流程另开 commit。

---

## 自检

**1. 规格覆盖度**：pi subagent 核心能力（隔离上下文 / single / parallel / chain / 代理发现 / frontmatter / 用量追踪 / 中止传播 / `{previous}` 占位符 / 并行并发限制）均已覆盖；迷你扩展系统能力（jiti 加载 / `registerTool` / wrapper / AgentSession 注入）已覆盖。明确省略项（已在「关键决策」与「差异」表标注）：事件系统、命令/快捷键/flag/provider 注册、`ctx.ui` 交互、TUI `renderCall`/`renderResult`。

**2. 占位符扫描**：无「待定 / TODO / 后续实现」占位符；任务 2 中 `builtInExtensions` 空列表是**显式的任务间依赖**（任务 6 填入 `subagentExtension`），非占位符，且已在任务 6 步骤 3 明确收口。

**3. 类型一致性**：
- `ExtensionContext` / `ToolDefinition` / `ExtensionFactory` / `ExtensionAPI` 在 `core/extensions/types.ts` 定义，loader/wrapper/tool/index 复用同一份。
- `ToolDefinition.execute` 5 参（`toolCallId, params, signal, onUpdate, ctx`）在 types.ts 与 tool.ts 一致；`wrapper.ts` 桥接为 `AgentTool` 的 4 参。
- `AgentScope` / `SingleResult` / `SubagentDetails` / `UsageStats` 在 `extensions/subagent/types.ts` 定义，discover/helpers/runner/tool 复用。
- `runSingleAgent` 签名（任务 5 定义）与 tool.ts 调用处（任务 6）参数顺序一致。
- 工具名 `read_file` / `write_file` / `edit` / `edit_diff` / `bash` / `find` / `grep` / `ls` 与 `core/tools/*.ts` 一致。
- `createAgentSessionFromServices` 新参数 `tools` / `appendSystemPrompt` / `extensionTools` 与 `AgentSessionConfig` 的 `toolNames` / `appendSystemPrompt` / `extraTools` 一一对应。

**4. 与既有约定冲突检查**：
- 文件拆分符合「按独立概念拆分」方法论（扩展系统 4 文件 + subagent 7 文件，均 < 500 行）。
- 工具错误处理遵循「execute 抛错 → isError」与「返回 `Error:` 文本」双轨约定（subagent 采用后者保留 `details`，已在「差异」表说明）。
- 无 `Object.assign(prototype, ...)` mixin、无死代码、无 `declare module`。
- subagent 不再加入 `createBuiltinTools`，避免子进程 `--tools` 过滤时误引入 subagent 造成递归。
