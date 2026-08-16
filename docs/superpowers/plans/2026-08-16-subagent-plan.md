# Subagent 工具实现计划（示例扩展版 · 照抄 pi）

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 完全照抄 pi 的 subagent 实现。pi 里 subagent 是 `examples/extensions/subagent/` 下的**示例扩展（外部扩展）**，通过 `export default function (pi: ExtensionAPI)` 导出工厂函数，从 `@earendil-works/pi-coding-agent` 包导入公共 API（`CONFIG_DIR_NAME` / `getAgentDir` / `parseFrontmatter` / `type ExtensionAPI`）。本项目改为从 `@mimi/coding-agent` 包导入，命令名 `pi` → `mimi`。

---

## 核心定位变更（本次最重要的修正）

| 维度 | ❌ 旧方案（错误） | ✅ 新方案（照抄 pi） |
|------|------------------|---------------------|
| subagent 位置 | `src/extensions/subagent/`（内置扩展） | `examples/extensions/subagent/`（示例扩展） |
| 是否内置 | `builtInExtensions` 填 subagent | **不进内置**（pi 的 `builtInExtensions` 只有 llama.cpp） |
| 加载方式 | 随 CLI 自动加载 | 用户手动符号链接到 `~/.mimi/extensions/subagent/`，由 `discoverAndLoadExtensions` 扫描加载 |
| 文件结构 | 拆成 `types.ts` + `discover.ts` + `helpers.ts` + `runner.ts` + `tool.ts` | **照抄 pi：仅 `index.ts` + `agents.ts` 两个 TS 文件** |
| import 方式 | 相对路径 `../../config.js` | 从 `@mimi/coding-agent` 包导入 |
| 工厂导出 | `export const subagentExtension: ExtensionFactory` | `export default function (pi: ExtensionAPI)` |

---

## 目标目录结构（与 pi 完全一致）

```
packages/coding-agent/
├── src/
│   ├── index.ts                     # 🔧 补导出公共 API（供示例扩展从包导入）
│   ├── config.ts                    # 🔧 补 getExamplesPath()
│   ├── utils/frontmatter.ts         # ✅ 已建（照抄 pi src/utils/frontmatter.ts）
│   └── core/extensions/             # ✅ 已建（迷你扩展系统：types/loader/wrapper/index）
│       ├── types.ts
│       ├── loader.ts
│       ├── wrapper.ts
│       └── index.ts
└── examples/extensions/subagent/    # 🆕 照抄 pi，仅两个 TS 文件
    ├── README.md                    # 安装与用法说明（pi 命令名改 mimi，路径改 ~/.mimi）
    ├── index.ts                     # 扩展入口：export default function (pi)
    ├── agents.ts                    # 代理发现：AgentScope/AgentConfig/AgentDiscoveryResult 类型 + discoverAgents/formatAgentList
    ├── agents/                      # 示例代理定义
    │   ├── scout.md
    │   ├── planner.md
    │   ├── reviewer.md
    │   └── worker.md
    └── prompts/                     # 工作流预设（提示模板）
        ├── implement.md
        ├── scout-and-plan.md
        └── implement-and-review.md
```

> **关键**：pi 的 subagent 目录里**没有** `types.ts` / `discover.ts` / `helpers.ts` / `runner.ts` / `tool.ts` / `frontmatter.ts`。所有 helper、类型、runner、schema、`execute` 逻辑都在 `index.ts`（约 1069 行），代理发现逻辑在 `agents.ts`（约 145 行）。`frontmatter` 解析是**包的公共 API**（`src/utils/frontmatter.ts`），不在 subagent 目录内。

---

## 与 pi 的差异（均为必要删减，逐条列明理由）

| # | pi 原实现 | 本项目 | 理由（是否为必要删减） |
|---|-----------|--------|------------------------|
| 1 | 包名 `@earendil-works/pi-coding-agent` / `pi-ai` / `pi-agent-core` / `pi-tui` | `@mimi/coding-agent` / `@mimi/ai` / `@mimi/agent` / `@mimi/tui` | 项目名不同，机械替换 |
| 2 | 命令名 `pi` | `mimi` | 项目名不同（`getPiInvocation` → `getMimiInvocation`） |
| 3 | `getAgentDir()` = `~/.pi/agent` | `~/.mimi`（已决定保持现状） | 用户已确认，扩展目录为 `~/.mimi/extensions/`、代理目录为 `~/.mimi/agents/` |
| 4 | `renderCall` / `renderResult`（TUI 自定义渲染，依赖 `pi-tui` 的 Container/Markdown/Spacer/Text + `getMarkdownTheme`） | **删减** | 用户已定「UI 先不做」；本项目 `ToolDefinition` 无 `renderCall`/`renderResult` 字段，走 TUI 通用 fallback |
| 5 | `withFileMutationQueue`（写临时文件用） | 直接 `fs.promises.writeFile` | 本项目无此 API，临时文件无需队列 |
| 6 | `getMarkdownTheme` | 删减 | 仅 renderResult 用到，随 #4 一并删 |
| 7 | `confirmProjectAgents` 参数 + `ctx.hasUI` + `ctx.ui.confirm` | **删减** | 本项目 `ExtensionContext` 只有 `cwd` + `signal`，无 `hasUI`/`ui` |
| 8 | `getPiInvocation` 里 Bun 二进制判断（`isBunVirtualScript` / `isGenericRuntime`） | 照抄 pi 完整逻辑，仅改函数名 `getPiInvocation`→`getMimiInvocation`、回退命令 `pi`→`mimi` | 按「最大程度照抄」指令，Bun 判断在 Node 下无害（`isBunVirtualScript` 恒 false），保留 |
| 9 | subagent `execute` 失败时返回 `isError: true` | 两边 `AgentToolResult` **都无**顶层 `isError` | 见下方「错误约定」 |
| 10 | `StringEnum` 从 `pi-ai` 导入 | 从 `@mimi/ai` 导入（任务 0 已建） | 已照搬 |
| 11 | 扩展工具名 `read`/`write` | `read_file`/`write_file`/`edit`/`edit_diff` | 本项目核心工具名不同；`formatToolCall` 已随 #4 删除，仅影响示例代理 `tools` 字段（任务 5） |
| 12 | `discoverAndLoadExtensions(configuredPaths, cwd, agentDir, eventBus?)` 有第 4 参数 `eventBus?` | 本项目无第 4 参数 | 迷你扩展系统删减（无 EventBus） |
| 13 | `Extension.tools: Map<string, RegisteredTool>`（含 sourceInfo） | `Map<string, ToolDefinition>` | 迷你扩展系统删减（无 sourceInfo 模块） |
| 14 | 示例代理 `model` 字段用 pi 别名 `claude-haiku-4-5` / `claude-sonnet-4-5` | **删除** `model` 字段，子进程继承默认模型 `deepseek-v4-flash` | 本项目模型注册表只有 `claude-sonnet-4-20250514` / `gpt-5.5` / `deepseek-v4-flash`，且 `model-resolver` 无 pi 的别名匹配（`isAlias`/`tryMatchModel` V1 不做），`claude-haiku-4-5` 会抛 `Unknown model`（2026-08-16 冒烟前发现） |
| 15 | V1 核心 CLI `-p` 为带值参数、`--mode json` 未实现（`toPrintOutputMode` 写死 `"text"`） | `-p`/`--print` 改为布尔标志（照抄 pi），prompt 走 `messages`；`main.ts` 的 `resolveAppMode`/`toPrintOutputMode` 支持 `"json"` mode | subagent 子进程协议固定为 `["--mode","json","-p","--no-session"]`；原实现下 `-p` 会吞掉后续 `--no-session`、`--mode json` 被忽略导致子进程不输出 JSON 事件流，父进程解析不到结果（2026-08-16 冒烟前发现） |

> **错误约定（差异 #9）**：已查证两边 `AgentToolResult` 定义——pi [types.ts L350-362](file:///F:/allProject/githubProject/pi/packages/agent/src/types.ts#L350-L362) 与本项目 [types.ts L72-84](file:///f:/allProject/githubProject/my-mimipi/packages/agent/src/types.ts#L72-L84) 都只有 `content` / `details` / `addedToolNames?` / `terminate?` 四个字段，**都没有顶层 `isError`**。pi 的 subagent 在失败时 `return { content, details, isError: true }`（不 throw），其中 `isError: true` 是**类型外字段**——pi 的 `examples/` 不参与 tsc 主构建，所以不报 excess property 错误。照抄 pi 时：`isError: true` 照抄保留（jiti 转译不做类型检查，运行时不报错），并确保本项目 `examples/` 也不纳入 tsc 主构建（与 pi 一致）。父 agent 识别失败靠 `content` 里的错误文本，而非 `isError`。

---

## 公共 API 导出要求（src/index.ts + config.ts）

示例扩展从 `@mimi/coding-agent` 导入，因此 `src/index.ts` 必须导出（照抄 pi 的导出面）：

**config（照抄 pi `src/index.ts` L6-14）**
- `CONFIG_DIR_NAME`（`config.ts` 已有，未导出）
- `getAgentDir`（已导出）
- `getPackageDir`（已导出）
- `getDocsPath`（`config.ts` 已有，未导出）
- `getExamplesPath`（`config.ts` **需新增**，照抄 pi `resolve(join(getPackageDir(), "examples"))`）

**frontmatter（照抄 pi `src/index.ts` L396）**
- `parseFrontmatter` / `stripFrontmatter`（`src/utils/frontmatter.ts` 已建，未导出）

**扩展系统（照抄 pi `src/index.ts` L51-164）**
- 类型：`ExtensionAPI` / `ToolDefinition` / `ExtensionContext` / `ExtensionFactory` / `Extension` / `LoadExtensionsResult`
- 函数：`discoverAndLoadExtensions` / `loadExtensionFromFactory` / `wrapExtensionTool` / `wrapExtensionTools`
- `defineTool`（pi 有，本项目 `core/extensions/types.ts` **需新增**，照抄 pi 保留参数推断的 helper）

> **命名差异**：pi 的 wrapper 函数叫 `wrapRegisteredTool`/`wrapRegisteredTools`（依赖 `ExtensionRunner`）；本项目迷你版无 `ExtensionRunner`，函数名是 `wrapExtensionTool`/`wrapExtensionTools`（签名 `(tool, cwd)`）。这是迷你扩展系统的既有差异（任务 1 已定），示例扩展本身**不调用** wrapper，因此不影响 subagent 的照抄。

---

## 任务清单

### 任务 0：typebox 对齐 + StringEnum + webui 测试
> ✅ 已完成（2026-08-16）。不受本次定位变更影响，无需返工。

### 任务 1：迷你扩展系统核心（types + loader + wrapper）
> ✅ 已完成（代码本体保留）。文件名 `types.ts`/`loader.ts`/`wrapper.ts`/`index.ts` 与 pi 一致。
> ✅ **缺口已补齐**：这 4 个文件已从 `src/index.ts` 导出（`defineTool`/`discoverAndLoadExtensions`/`loadExtensionFromFactory`/`wrapExtensionTool`/`wrapExtensionTools` + 6 个类型），示例扩展可从 `@mimi/coding-agent` 包导入。
> 与 pi 的签名级差异见差异表 #12（`discoverAndLoadExtensions` 缺 `eventBus?` 参数）、#13（`Extension.tools` 结构不同）。这两处是迷你扩展系统的既有删减，不影响 subagent 照抄。

### 任务 2：AgentSession 注入 + main.ts 集成
> ✅ 已完成。扩展加载链路（`discoverAndLoadExtensions` + `wrapExtensionTools` 注入 `extensionTools`）本身照抄 pi，**不用改**。`main.ts` 中 `const builtInExtensions: ExtensionFactory[] = [];` 的错误注释已改为「本项目无内置扩展（pi 仅 llama.cpp，本项目无对应物）；subagent 是 examples 下的示例扩展」。

### 任务 3（返工）：删除旧文件，改为 examples/extensions/subagent/agents.ts
> ✅ 已完成（2026-08-16）。

- [x] **步骤 1**：删除 `packages/coding-agent/src/extensions/subagent/types.ts`
- [x] **步骤 2**：删除 `packages/coding-agent/src/extensions/subagent/discover.ts`
- [x] **步骤 3**：删除 `packages/coding-agent/src/__tests__/extensions/subagent/discover.test.ts`（pi 的示例扩展无测试文件，照抄 pi 不为其写测试；`frontmatter.test.ts` 保留，因为测的是公共 API）
- [x] **步骤 4**：新建 `packages/coding-agent/examples/extensions/subagent/agents.ts`，照抄 pi `examples/extensions/subagent/agents.ts`（145 行），仅改 import `@earendil-works/pi-coding-agent` → `@mimi/coding-agent`，缩进改 2 空格以匹配本项目风格。
- [x] **步骤 5**：`pnpm --filter @mimi/coding-agent test` 66/66 通过（删除 discover.test.ts 的 7 个用例后正确）。

### 任务 4：写 examples/extensions/subagent/index.ts（照抄 pi）
> ✅ 已完成（2026-08-16）。

- [x] **步骤 1**：新建 `packages/coding-agent/examples/extensions/subagent/index.ts`，照抄 pi `examples/extensions/subagent/index.ts`（1069 行）的核心能力，做以下必要删减与替换：

  **import 替换：**
  - `@earendil-works/pi-agent-core` → `@mimi/agent`
  - `@earendil-works/pi-ai` → `@mimi/ai`
  - `@earendil-works/pi-coding-agent` → `@mimi/coding-agent`，并去掉 `getMarkdownTheme`、`withFileMutationQueue`（本项目无）
  - 删除 `import ... from "@earendil-works/pi-tui";`（UI 删减）

  **常量**：`MAX_PARALLEL_TASKS=8`、`MAX_CONCURRENCY=4`、`PER_TASK_OUTPUT_CAP=50*1024` 照抄。

  **helper 函数**：`getFinalOutput` / `isFailedResult` / `getResultOutput` / `truncateParallelOutput` / `mapWithConcurrencyLimit` / `writePromptToTempFile`（`withFileMutationQueue` 改为直接 `writeFile`）照抄。UI 删减后成死代码的 `formatTokens` / `formatUsageStats` / `formatToolCall` / `getDisplayItems` / `COLLAPSED_ITEM_COUNT` 已按用户决定删除（差异 #4）。

  **runner**：`getPiInvocation` → `getMimiInvocation`（Bun 判断照抄保留，回退命令 `pi` → `mimi`，差异 #8）；`runSingleAgent` 照抄（含 `message_end` + `tool_result_end` 事件解析、用量累计、中止传播、临时文件清理）。

  **类型**：`UsageStats` / `SingleResult` / `SubagentDetails` 内联在 index.ts（照抄 pi，不单独拆文件）。

  **schema**：`TaskItem` / `ChainItem` / `AgentScopeSchema`（`StringEnum`）/ `SubagentParams` 照抄，删除 `confirmProjectAgents` 字段（差异 #7）。

  **工厂**：`export default function (pi: ExtensionAPI) { pi.registerTool({ ... }) }`，`execute` 照抄（删除 `confirmProjectAgents` + `ctx.ui.confirm` 分支，差异 #7）；**删除 `renderCall` / `renderResult`**（差异 #4）。`isError: true` 照抄保留（类型外字段，差异 #9）。

- [x] **步骤 2**：编译验证（`pnpm --filter @mimi/coding-agent build`）通过。示例扩展不在 `src/` 下，不参与 `tsc` 主构建。

- [x] **步骤 3**：修复 jiti 加载 `@mimi/coding-agent` 自引用失败。`src/core/extensions/loader.ts` 补回 `getAliases()`（照抄 pi 的 Node/dev alias 分支），在 `createJiti` 中传 `alias`，映射 `@mimi/coding-agent` → 自身 `dist/index.js`、`@mimi/agent` / `@mimi/ai` / `@mimi/tui` → 对应 workspace dist，以及 typebox 别名（`typebox` / `typebox/compile` / `typebox/value` / `@sinclair/typebox*`）。验证：jiti 加载 `examples/extensions/subagent/index.ts` 成功（`errors: []`、`extensions: 1`、`tools: ["subagent"]`）；`pnpm --filter @mimi/coding-agent test` 66/66 通过。

### 任务 5：示例代理 + 工作流提示 + README（照抄 pi）
> ✅ 已完成（2026-08-16）。

- [x] **步骤 1**：照抄 pi `examples/extensions/subagent/agents/*.md` 四个文件（scout/planner/reviewer/worker），`tools` 字段工具名 `read` → `read_file`（差异 #11；其余 `grep`/`find`/`ls`/`bash` 两边一致，`write`/`edit`/`edit_diff` 这些代理未用到）；`model` 字段**删除**（差异 #14，删除后继承默认 `deepseek-v4-flash`）。
- [x] **步骤 2**：照抄 pi `examples/extensions/subagent/prompts/*.md` 三个文件（implement/scout-and-plan/implement-and-review），无工具名/路径引用，逐字照抄。
- [x] **步骤 3**：照抄 pi `examples/extensions/subagent/README.md`，替换：
  - `pi` → `mimi`；`~/.pi/agent` → `~/.mimi`（差异 #3）
  - 安装命令中的符号链接路径改为 `~/.mimi/extensions/subagent/`、`~/.mimi/agents/`、`~/.mimi/prompts/`
  - 项目级代理路径 `.pi/agents` → `.mimi/agents`
  - 代理定义示例与「示例代理」表中的 `tools` 字段 `read` → `read_file`（差异 #11）
  - **按用户决定删除**描述已删减功能的段落：`Markdown 渲染`/`用量追踪` 功能项、「输出显示」整节（折叠/展开视图 + 工具调用格式化，差异 #4）、安全模型的 `confirmProjectAgents` 段（差异 #7）、限制中的「折叠视图截断 10 项」（差异 #4）。

### 任务 6：main.ts 清理 + 公共 API 导出（src/index.ts + config.ts）
> ✅ 已完成（2026-08-16，与任务 1/2 缺口一并补齐）。
> - [x] **步骤 1**：`main.ts` 删除 `builtInExtensions` 的错误注释。
> - [x] **步骤 2**：`config.ts` 新增 `getExamplesPath()`。
> - [x] **步骤 3**：`core/extensions/types.ts` 新增 `defineTool`。
> - [x] **步骤 4**：`src/index.ts` 补导出：`CONFIG_DIR_NAME` / `getDocsPath` / `getExamplesPath` / `parseFrontmatter` / `stripFrontmatter` / 扩展系统类型与函数 / `defineTool`。

### 任务 7：构建与测试验证
- [x] **步骤 1**：`pnpm build`（全仓 tsc 全绿）。用户已自行运行通过。
- [x] **步骤 2**：`pnpm test`（全仓 vitest 全绿；discover.test.ts 已删，其余不受影响）。用户已自行运行通过。
- [x] **步骤 3**：端到端手工冒烟（2026-08-16 通过，用户逐步陪跑）：
  1. 项目级铺文件（用户手动复制，不碰 `~/.mimi`）：扩展 → `<repo>/.mimi/extensions/subagent/{index.ts,agents.ts}`；代理 → `<repo>/.mimi/agents/{scout,planner,reviewer,worker}.md`；提示跳过（V1 无 slash 命令，subagent 工具不用）。
  2. 冒烟命令：`node packages/coding-agent/dist/cli.js -p "Use the scout subagent with agentScope project to list files in packages/coding-agent/src/core."`（`agentScope: "project"` 让 `discoverAgents` 读项目级 `.mimi/agents`）。
  3. 验证（`--mode json` 事件流）：父 agent 调用 `subagent` 工具且 `arguments.agentScope="project"`；工具结果 `details.projectAgentsDir` 指向 `<repo>/.mimi/agents`、`results[0].agentSource="project"`、`exitCode: 0`；子进程以 `deepseek-v4-flash` 跑通 `ls`→`bash dir /s /b` 并回传结果。链路（扩展加载 → 工具注册 → 父 agent 调用 → 项目级代理发现 → 子进程 spawn `--mode json -p` → JSON 解析 → 结果返回）全部打通。

---

## 自检

**1. 规格覆盖度**：pi subagent 核心能力（隔离上下文 / single / parallel / chain / 代理发现 / frontmatter / 用量追踪 / 中止传播 / `{previous}` 占位符 / 并行并发限制 / `message_end`+`tool_result_end` 事件解析）全部照抄。明确删减项（已在「与 pi 的差异」表逐条列明理由）：TUI `renderCall`/`renderResult`、`ctx.ui` 交互、`withFileMutationQueue`、Bun 二进制判断、`ExtensionRunner`/`RegisteredTool`/`eventBus`（迷你扩展系统既有删减）。`isError: true` **照抄保留**（类型外字段，jiti 转译不报错）。

**2. 目录结构一致性**：subagent 目录 = `examples/extensions/subagent/`，仅 `index.ts` + `agents.ts` 两个 TS 文件 + `agents/*.md` + `prompts/*.md` + `README.md`，与 pi 完全一致。`frontmatter` 在 `src/utils/frontmatter.ts`（包公共 API），与 pi 一致。

**3. 文件名一致性**：`index.ts` / `agents.ts` / `README.md` / `agents/` / `prompts/` 全部与 pi 同名。无自创的 `types.ts`/`discover.ts`/`helpers.ts`/`runner.ts`/`tool.ts`。

**4. 与既有约定冲突检查**：
- `index.ts` 582 行（pi 原文件 1069 行，删 renderCall/renderResult + 4 个 UI 死代码函数后），**超过 500 行代码阈值**。用户已明确豁免：照抄 pi 的单文件结构（pi 原文件即单文件 1069 行），超 500 行属必要代价。
- 无 `Object.assign(prototype, ...)` mixin、无 `declare module`。
- subagent 不进 `builtInExtensions`，避免子进程 `--tools` 过滤时误引入 subagent 造成递归。
