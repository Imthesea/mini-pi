# coding-agent 最小化设计 Spec（Phase 03）

> 本文档是 my-mimipi 项目 `packages/coding-agent` 的**最小化**设计。
> 严格对齐 [pi](https://github.com/earendil-works/pi) 项目的架构（文件结构、类关系、调用链），
> 只做最小化实现，后续渐进式补全。
>
> 上游设计:
> - AI 层: [phase01-ai-core-design.md](./2026-07-29-phase01-ai-core-design.md)
> - Agent 层: [phase02-agent-design.md](./2026-07-30-phase02-agent-design.md)
> - 工程原则: [phase02-engineering-principles.md](./2026-07-30-phase02-engineering-principles.md)

## 概述

### 目标

搭建 `packages/coding-agent` 包，提供 `mimi` CLI 命令。严格对齐 Pi 的三层架构和文件结构，V1 只实现核心功能。

### 三层关系

```
┌──────────────────────────────────────────┐
│  packages/coding-agent/    (产品层)       │
│  AgentSession → Agent → runAgentLoop     │
│  + SessionManager / Compaction / Tools   │
│  + Modes (Print / Interactive)           │
├──────────────────────────────────────────┤
│  packages/agent/           (Agent 层)    │
│  Agent (agent.ts)                        │  ← V1 第一步补上
│  + agent-loop / types / harness/         │
├──────────────────────────────────────────┤
│  packages/ai/              (AI 层)       │
│  Model / Provider / Stream              │  ← 已完成
└──────────────────────────────────────────┘
```

**关键：** `AgentSession` 包装 `Agent`（不是 `AgentHarness`）。`AgentHarness` 是独立类，不在 coding-agent 调用链上。

### 与 Pi 的对比

| 维度 | Pi `packages/coding-agent` | 本项目 V1 |
|------|---------------------------|-----------|
| 文件结构 | 完全一致 | **完全一致**（空壳文件保留） |
| AgentSession | 完整（~2000 行） | 最小化（~400 行），去 extensions/TUI/slash 命令/fork |
| Interactive Mode | Ink TUI（~3000 行） | 极简 readline（~150 行） |
| Print Mode | 完整 | 完整（text + json 输出） |
| 工具 | 8+（read/write/edit/bash/find/grep/ls） | 8+（read/write/edit/bash/find/grep/ls） |
| 扩展系统 | 完整 | 空壳（只有类型导出） |
| Slash 命令 | 30+ | 空壳 |
| RPC Mode | 完整 | 不做（文件不存在） |
| Fork 分支 | 完整 | 不做（抛 "not implemented"） |
| OAuth | 完整 | 不做（只走环境变量） |
| MCP | 支持 | 不做 |

### 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| Agent 类 | 照抄 Pi `agent.ts` | 对 `runAgentLoop` 的有状态包装，`AgentSession` 必须依赖它 |
| 包名 | `@mimi/coding-agent` | 与 Pi 命名一致 |
| CLI 命令名 | `mimi` | 短、好打 |
| 入口文件 | `bin/mimi.mjs`（shebang）+ `cli.ts` | 与 Pi 一致 |
| 渲染 | `console.log` 纯文本 + 原生 ANSI | 0 依赖 |
| REPL | `node:readline/promises` | 0 依赖 |
| Session 存储 | 复用 agent 层 `JsonlSessionStorage` | 不重复造轮子 |
| 工具集合 | 跟pi一致 | 跟pi一致 |
| 环境变量 | `MIMI_API_KEY_*` | 不污染公共命名空间 |

### 后续实现（显式标注，防止遗忘）

| 功能 | 状态 | 说明 |
|------|------|------|
| TUI / Ink / 任何 UI 库 | 🔴 后续 | V1 用 readline，后续替换为 Ink TUI |
| Slash 命令（`/model` `/compact` `/clear` 等） | 🔴 后续 | `slash-commands.ts` 空壳，后续实现 |
| 扩展系统 | 🔴 后续 | `extensions/` 目录只有空壳类型导出 |
| OAuth / 交互式登录 | 🔴 后续 | V1 只走环境变量 |
| MCP server / client | 🔴 后续 | |
| Fork / Branch 分支 | 🔴 后续 | `fork()` 抛 "not implemented" |
| RPC Mode | 🔴 后续 | `modes/rpc/` 目录不存在 |
| 多会话切换 / 会话列表 UI | 🔴 后续 | |
| Token 计数显示 / 进度条 | 🔴 后续 | |
| 持久化设置（`~/.mimi/config.json`） | 🔴 后续 | V1 无 SettingsManager |
| 自动压缩触发 | 🔴 后续 | V1 只手动 `compact()` |
| Keybindings | 🔴 后续 | |
| Skills / Prompt Templates（loading 侧） | 🔴 后续 | |
| Model Cycling（Ctrl+P） | 🔴 后续 | |
| 文件参数（`@file`） | 🔴 后续 | |
| `--fork` / `--session-id` / `--list-models` / `--provider` / `--tools` / `--no-tools` flags | 🔴 后续 | V1 只支持基础 flags |
| AgentSession 重试逻辑（auto-retry） | 🔴 后续 | V1 不做 context overflow 自动重试 + compact |
| 🟢 仅 Fork 不做，`newSession` 本期实现 | 🟢 V1 | AgentSessionRuntime.newSession() 完整实现 |

---

## 1. 包结构

```
packages/coding-agent/
  package.json
  tsconfig.json
  vitest.config.ts
  .env.example

  src/
    cli.ts                      # shebang 入口
    main.ts                     # arg 解析 + session 创建 + mode 路由
    config.ts                   # 常量（APP_NAME, VERSION, dirs）
    index.ts                    # 公共 API 导出

    core/
      agent-session.ts          # 核心：包装 Agent，编排 prompt/compact/retry
      agent-session-runtime.ts  # 运行时：持有 AgentSession + services 生命周期
      agent-session-services.ts # 依赖工厂：创建 AgentSession 所需的服务
      sdk.ts                    # 顶层创建入口：createAgentSession()
      session-manager.ts        # Session 文件 CRUD（create/open/continueRecent/list）
      model-runtime.ts          # 模型运行时：getModel() / getAuth() / isUsingOAuth()
      model-registry.ts         # 模型注册表
      model-resolver.ts         # 模型解析（名称 → Model 对象）
      system-prompt.ts          # System prompt 构建
      messages.ts               # 消息工具（convertToLlm 等）
      bash-executor.ts          # Bash 执行封装
      defaults.ts               # 默认值常量
      event-bus.ts              # 事件总线（桩，V1 基本不用）
      index.ts                  # core 模块导出

      compaction/
        index.ts                # 导出
        compaction.ts           # 压缩编排

      tools/
        index.ts                # BUILTIN_TOOLS 数组导出
        read.ts                 # read_file 工具
        write.ts                # write_file 工具
        edit.ts                 # edit 工具（替换文件内容）
        edit-diff.ts            # edit-diff 工具（diff 补丁）
        bash.ts                 # bash 工具
        find.ts                 # find 工具（搜索文件名）
        grep.ts                 # grep 工具（搜索文件内容）
        ls.ts                   # ls 工具（列出目录）

      extensions/               # 扩展系统（全部空壳）
        index.ts                # 只导出类型
        types.ts                # 类型定义

    modes/
      index.ts                  # 导出
      print-mode.ts             # 单次模式（--print / -p）
      interactive/
        interactive-mode.ts     # REPL 模式（readline）
        components/             # 空目录（后续 TUI 组件）

    utils/
      ansi.ts                   # ANSI 颜色
      paths.ts                  # 路径工具
      shell.ts                  # Shell 工具

    bin/
      mimi.mjs                  # shebang 引导

  src/__tests__/
    # 随各 step 增量添加

  examples/
    # 随各 step 增量添加
```

---

## 2. Agent 类（packages/agent/src/agent.ts）

### 2.1 定位

照抄 Pi 的 `Agent` 类。对已有的 `runAgentLoop` 做有状态包装：
- 持有 `AgentState`（messages / tools / systemPrompt / model / thinkingLevel）
- 暴露 `prompt(text)` / `continue()` / `abort()`
- 事件订阅 `subscribe(listener)`
- steer / followUp 队列管理
- beforeToolCall / afterToolCall 钩子（公开属性）

### 2.2 核心 API

```ts
export class Agent {
  constructor(options?: AgentOptions);

  // 状态
  get state(): AgentState;

  // 入口
  prompt(text: string, options?: { images?: ImageContent[] }): Promise<AgentMessage[]>;
  continue(options?: { signal?: AbortSignal }): Promise<AgentMessage[]>;

  // 订阅
  subscribe(listener: (event: AgentEvent, signal: AbortSignal) => void): () => void;

  // 队列
  steer(message: AgentMessage): void;
  followUp(message: AgentMessage): void;
  clearSteeringQueue(): void;
  clearFollowUpQueue(): void;
  steeringMode: QueueMode;
  followUpMode: QueueMode;

  // 中止
  abort(): void;

  // 钩子（公开属性，外部可赋值）
  beforeToolCall?: (ctx, signal?) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (ctx, signal?) => Promise<AfterToolCallResult | undefined>;
  prepareNextTurn?: (...) => ...;
  prepareNextTurnWithContext?: (...) => ...;

  // 流函数
  streamFn: StreamFn;
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

  // 其他
  getApiKey?: (provider: string) => Promise<string | undefined>;
  sessionId?: string;
  toolExecution: ToolExecutionMode;
  maxRetryDelayMs?: number;
}
```

### 2.3 AgentState

```ts
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  messages: AgentMessage[];
  tools: AgentTool<any>[];
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
}
```

### 2.4 prompt() 流程

```
agent.prompt("你好")
  │
  ▼
[1] 构造 user message
  │
  ▼
[2] 调用 runAgentLoop(prompts, context, config, emit, signal, streamFn)
  │   config.getSteeringMessages → drain steerQueue
  │   config.getFollowUpMessages → drain followUpQueue
  │   config.beforeToolCall → this.beforeToolCall
  │   config.afterToolCall → this.afterToolCall
  │
  ▼
[3] 返回 newMessages
```

### 2.5 与已有代码的关系

- 内部调用已有 `runAgentLoop`（`agent-loop.ts`）— **不重写**
- 使用已有类型 `AgentContext` / `AgentLoopConfig` / `AgentTool` / `AgentMessage`
- `AgentHarness` **不受影响**，两者独立存在（与 Pi 一致）
- 不需要 hooks 系统（Agent 只用简单的 beforeToolCall/afterToolCall 属性）

---

## 3. AgentSession（core/agent-session.ts）

### 3.1 定位

对应 Pi 的 `AgentSession`。包装 `Agent`，提供 coding-agent 专属能力：
- Session 持久化（订阅 Agent 事件 → 自动写 JSONL）
- Compaction 编排
- Model 管理
- 🔴 **重试逻辑（auto-retry）后续实现**

### 3.2 核心 API（V1 完整实现）

```ts
export class AgentSession {
  readonly agent: Agent;
  readonly sessionManager: SessionManager;
  readonly modelRuntime: ModelRuntime;

  constructor(config: AgentSessionConfig);

  // 入口
  prompt(text: string, options?: PromptOptions): Promise<AgentMessage[]>;
  compact(): Promise<CompactionResult | undefined>;
  abort(): void;

  // 事件
  subscribe(listener: AgentSessionEventListener): () => void;

  // 配置
  setModel(model: Model<any>): void;
  setThinkingLevel(level: ThinkingLevel): void;

  // 状态查询
  getStats(): SessionStats;
  waitForIdle(): Promise<void>;
}
```

### 3.3 AgentSessionConfig（V1 最小化）

```ts
interface AgentSessionConfig {
  agent: Agent;
  sessionManager: SessionManager;
  modelRuntime: ModelRuntime;
  cwd: string;
  // 以下 V1 可选/未实现
  scopedModels?: ...;            // 后续实现
  initialActiveToolNames?: ...;  // V1 默认全部激活
  settingsManager?: ...;         // 桩
  resourceLoader?: ...;          // 桩
}
```

### 3.4 prompt() 流程

```
session.prompt("你好")
  │
  ▼
[1] agent.state.tools ← BUILTIN_TOOLS（若未设置）
  │
  ▼
[2] agent.state.systemPrompt ← buildSystemPrompt(...)（若未设置）
  │
  ▼
[3] agent.state.model ← modelRuntime.getModel(preferredModel)
  │
  ▼
[4] 获取 API key ← modelRuntime.getAuth(model)
  │
  ▼
[5] agent.prompt(text)
  │   └→ 内部订阅：自动写 session（每个 message_end 事件）
  │
  ▼
[6] 返回 messages
```

### 3.5 自动持久化

AgentSession 构造时订阅 `Agent` 的所有事件，在关键事件自动写 session：

```
agent event → AgentSession._handleAgentEvent()
  ├─ message_end → sessionManager.appendEntry(message)
  ├─ tool_execution_end → sessionManager.appendEntry(toolResult)
  └─ agent_end → 记录 stop reason
```

写 session 是 **fire-and-forget**，失败只 `console.error`，不阻塞主流程。

### 3.6 V1 不做（后续实现）

- 🔴 `extensionRunner` → `undefined`（extension 事件 handler no-op）
- 🔴 `navigateTree()` → 抛 `"not implemented"`
- 🔴 `fork()` → 抛 `"not implemented"`
- 🔴 `scopedModels` → 空数组
- 🔴 `keybindings` → 空
- 🔴 `slashCommands` → 空 Map
- 🔴 `setModel` / `setThinkingLevel` → 🟢 V1 完整实现

---

## 4. SessionManager（core/session-manager.ts）

### 4.1 定位

对应 Pi 的 `SessionManager`。Session 文件的 CRUD 操作。

### 4.2 核心 API

```ts
export class SessionManager {
  // 静态工厂
  static create(cwd: string, sessionDir?: string, options?: { id?: string }): SessionManager;
  static open(path: string, sessionDir?: string): SessionManager;
  static continueRecent(cwd: string, sessionDir?: string): SessionManager;
  static inMemory(cwd: string, options?: { id?: string }): SessionManager;
  static list(cwd: string, sessionDir?: string): Promise<SessionInfo[]>;
  static listAll(sessionDir?: string): Promise<SessionInfo[]>;

  // 实例
  get id(): string;
  get path(): string | undefined;  // undefined for in-memory
  appendEntry(entry: SessionEntry): Promise<void>;
  close(): Promise<void>;
}
```

### 4.3 默认路径

```
<cwd>/.mimi/sessions/<id>.jsonl
```

可通过 `MIMI_SESSION_DIR` 环境变量覆盖。

### 4.4 continueRecent 逻辑

```
SessionManager.continueRecent(cwd):
  1. 列出 <cwd>/.mimi/sessions/*.jsonl
  2. 按 mtime 降序
  3. 若最近文件在 24h 内 → 打开（续接）
  4. 否则 → 新建
```

### 4.5 底层存储

复用 agent 层已有：
- `JsonlSessionStorage` — JSONL 文件读写
- `JsonlSessionRepo` — 仓储接口

---

## 5. Compaction（core/compaction/compaction.ts）

### 5.1 定位

对齐 Pi 的 compaction 模块。从 agent 层已有的函数封装。

### 5.2 核心 API

```ts
export async function compact(
  session: Session,
  model: Model<any>,
  streamFn: StreamFn,
  options?: CompactOptions,
): Promise<CompactionResult>;
```

### 5.3 流程

```
compact(session, model, streamFn):
  1. shouldCompact(session) → 判断是否需要
  2. prepareCompaction(session) → 准备（找 cut point）
  3. 调 LLM（small model）生成摘要
  4. session.appendCompaction(summary) → 写入 session
  5. 返回 CompactionResult
```

### 5.4 触发时机

在 `AgentSession` 中：
- 🟢 **手动**：用户调 `session.compact()` — V1 实现
- 🔴 **自动**：context overflow → auto-retry → compact → retry — 后续实现

---

## 6. Model Runtime（core/model-runtime.ts + model-registry.ts + model-resolver.ts）

### 6.1 定位

模型查找 + API key 解析。对齐 Pi 的 `ModelRuntime` / `ModelRegistry` / `ModelResolver`。

### 6.2 ModelRegistry

```ts
export class ModelRegistry {
  constructor(models: Model<any>[]);
  getModel(provider: string, id: string): Model<any> | undefined;
  findByProvider(provider: string): Model<any>[];
  list(): Model<any>[];
}
```

注册 AI 层的三个 provider 的全部模型。

### 6.3 ModelRuntime

```ts
export class ModelRuntime {
  constructor(registry: ModelRegistry);
  getModel(id: string): Model<any> | undefined;
  resolveModel(input: string): Model<any> | undefined;
  getAuth(model: Model<any>): Promise<{ apiKey: string }>;
  isUsingOAuth(provider: string): boolean;  // V1 永远返回 false
}
```

### 6.4 API Key 解析

按 provider 查环境变量：
- `anthropic` → `MIMI_API_KEY_ANTHROPIC`
- `openai` → `MIMI_API_KEY_OPENAI`
- `deepseek` → `MIMI_API_KEY_DEEPSEEK`

---

## 7. Tools（core/tools/）

### 7.1 内置工具（V1 全部实现）

对齐 Pi 的完整工具集：

| 文件 | 工具名 | Schema | 实现 |
|------|--------|--------|------|
| `read.ts` | read_file | `{ path: string, offset?: number, limit?: number }` | `fs.readFile` + 路径安全检查 |
| `write.ts` | write_file | `{ path: string, content: string }` | `fs.writeFile` + 路径安全检查 + 自动创建父目录 |
| `edit.ts` | edit | `{ path: string, old_string: string, new_string: string, replace_all?: boolean }` | 读文件 → 精确替换 → 写回 |
| `edit-diff.ts` | edit_diff | `{ path: string, diff: string }` | 读文件 → apply diff → 写回 |
| `bash.ts` | bash | `{ command: string, timeoutMs?: number, maxOutputBytes?: number }` | `child_process.exec` + 超时 30s + 输出截断 50KB |
| `find.ts` | find | `{ pattern: string, path?: string }` | `fs.readdir` 递归 + glob 匹配 |
| `grep.ts` | grep | `{ pattern: string, path?: string, glob?: string }` | ripgrep 风格内容搜索 |
| `ls.ts` | ls | `{ path?: string }` | `fs.readdir` 列出目录内容 |

### 7.2 路径安全检查

所有文件工具必须拒绝逃出 cwd：

```ts
const resolved = path.resolve(cwd, inputPath);
if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
  return { content: [{ type: "text", text: "Error: path escapes cwd" }], isError: true };
}
```

`bash` 工具设置 `cwd` 选项限制执行目录。

### 7.3 类型

使用 agent 层的 `AgentTool<TParams, TDetails>` 接口，TypeBox schema 定义参数。

---

## 8. Modes

### 8.1 Print Mode（modes/print-mode.ts）

对齐 Pi 的 `runPrintMode`：

```
runPrintMode(runtime, { mode, initialMessage, images }):
  1. session = runtime.session
  2. 订阅 session 事件 → 渲染
     - mode === "text": 只输出最终 text 响应
     - mode === "json": 输出所有事件的 JSON 流
  3. await session.prompt(initialMessage)
  4. runtime.dispose()
  5. 返回退出码 0
```

**触发：** `mimi -p "prompt"` 或 stdin 非 TTY。

### 8.2 Interactive Mode（modes/interactive/interactive-mode.ts）

对齐 Pi 的 `InteractiveMode`，V1 用 readline 替代 Ink TUI：

```
InteractiveMode.start(runtime):
  1. session = runtime.session
  2. 订阅 session 事件 → display 渲染
  3. 显示欢迎信息（model / session id）
  4. readline 循环:
     rl.question("mimi> ")
     - SIGINT → session.abort()
     - "exit" / "quit" / EOF → break
     - 空行 → continue
     - 其他 → session.prompt(line)
  5. rl.close() + runtime.dispose()
  6. 返回退出码 0
```

**事件渲染（display）：**

| 事件 | 输出 |
|------|------|
| `text_delta` | 追加到当前行（无换行） |
| `text_end` | 换行 |
| `thinking_delta` | 灰色追加，前缀 `🤔 ` |
| `thinking_end` | 重置颜色 + 换行 |
| `toolcall_start` | 蓝色 `🔧 <name>(` |
| `toolcall_end` | `)` + 换行 |
| `tool_execution_end` | 绿色 `✓` 或 红色 `✗` + 耗时 |
| `turn_end` | 空行 |
| `error` | 红色 `Error: <msg>` |

**颜色方案：** 原生 ANSI 转义码（`\x1b[36m` 蓝, `\x1b[33m` 黄, `\x1b[32m` 绿, `\x1b[31m` 红, `\x1b[90m` 灰, `\x1b[0m` 重置）。非 TTY 时关闭所有颜色。

---

## 9. CLI 入口（cli.ts + main.ts）

### 9.1 cli.ts

```ts
#!/usr/bin/env node
import { main } from "./main.ts";
process.title = "mimi";
main(process.argv.slice(2));
```

### 9.2 main.ts 流程

对齐 Pi 的 `main.ts`：

```
main(argv):
  1. parseArgs(argv) → Args
  2. --help → printHelp() + exit 0
  3. --version → printVersion() + exit 0
  4. resolveAppMode(parsed, stdin, stdout) → "print" | "interactive"
  5. createSessionManager(parsed, cwd, sessionDir) → SessionManager
  6. modelRuntime = new ModelRuntime(new ModelRegistry(allModels))
  7. createAgentSessionRuntime({ cwd, sessionManager, modelRuntime, ... })
     → { session, services, diagnostics }
  8. 路由:
     - "print" → runPrintMode(runtime, options)
     - "interactive" → InteractiveMode.start(runtime)
```

### 9.3 Flag 支持（V1）

| Flag | 说明 |
|------|------|
| `-p "prompt"` / `--print` | 单次模式 |
| `--model <id>` | 指定模型 |
| `--thinking <level>` | 思考等级（off/minimal/low/medium/high） |
| `--resume` | 选择 session 续接 |
| `--continue` | 续接最近 session |
| `--session <id>` | 指定 session |
| `--cwd <path>` | 工作目录 |
| `--no-session` | 不持久化 |
| `--help` | 帮助 |
| `--version` | 版本 |

### 9.4 环境变量

| 变量 | 用途 |
|------|------|
| `MIMI_MODEL` | 默认模型（默认 `deepseek-chat`） |
| `MIMI_API_KEY_ANTHROPIC` | Anthropic Key |
| `MIMI_API_KEY_OPENAI` | OpenAI Key |
| `MIMI_API_KEY_DEEPSEEK` | DeepSeek Key |
| `MIMI_THINKING` | 默认 thinking level |
| `MIMI_SESSION_DIR` | Session 存储目录 |

### 9.5 退出码

| 码 | 含义 |
|----|------|
| 0 | 正常完成 |
| 1 | 通用错误 |
| 2 | 参数错误 |
| 130 | SIGINT |

---

## 10. AgentSessionRuntime + Services + SDK

### 10.1 AgentSessionRuntime（agent-session-runtime.ts）

对齐 Pi 的 `AgentSessionRuntime`：

```ts
export class AgentSessionRuntime {
  get session(): AgentSession;
  get services(): AgentSessionServices;
  get diagnostics(): AgentSessionRuntimeDiagnostic[];

  constructor(createRuntime, options);

  dispose(): Promise<void>;
  newSession(options?): Promise<void>;  // 🟢 V1 完整实现
  fork(entryId, options?): Promise<...>;  // 🔴 后续实现
}
```

### 10.2 AgentSessionServices（agent-session-services.ts）

对齐 Pi 的 `AgentSessionServices`：

```ts
interface AgentSessionServices {
  cwd: string;
  agentDir: string;
  sessionDir: string;
  modelRuntime: ModelRuntime;
  sessionManager: SessionManager;
}
```

### 10.3 SDK（sdk.ts）

对齐 Pi 的 `createAgentSession`：

```ts
export async function createAgentSession(options: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>;
```

---

## 11. 实施路线

分 **8 个 Step**，每个 step 尽量 ≤ 500 行。完整 plan 另见 `docs/superpowers/plans/2026-08-09-phase03-coding-agent-plan.md`。

| Step | 内容 | 产出 | 预估行数 |
|------|------|------|---------|
| **Step 1** | Agent 类（照抄 Pi） | `packages/agent/src/agent.ts` | ~400 |
| **Step 2** | coding-agent 包骨架 | `package.json` + `tsconfig` + `config.ts` + `bin/mimi.mjs` + 所有空壳文件 | ~300 |
| **Step 3** | SessionManager | `core/session-manager.ts` | ~200 |
| **Step 4** | ModelRuntime + ModelRegistry + ModelResolver | `core/model-runtime.ts` + `core/model-registry.ts` + `core/model-resolver.ts` | ~300 |
| **Step 5** | 所有内置工具（8 个） | `core/tools/read.ts` `write.ts` `edit.ts` `edit-diff.ts` `bash.ts` `find.ts` `grep.ts` `ls.ts` `index.ts` | ~500 |
| **Step 6** | AgentSession + Runtime + Services + SDK | `core/agent-session.ts` + `agent-session-runtime.ts` + `agent-session-services.ts` + `sdk.ts` | ~500 |
| **Step 7** | Compaction + Messages + SystemPrompt | `core/compaction/` + `core/messages.ts` + `core/system-prompt.ts` | ~300 |
| **Step 8** | Print Mode + Interactive Mode + main.ts + cli.ts | `modes/print-mode.ts` + `modes/interactive/` + `main.ts` + `cli.ts` | ~400 |

**总预估：~2900 行**

---

## 12. 风险与待办

| 风险 | 应对 |
|------|------|
| Agent 类照抄后与现有 runAgentLoop 的适配 | 现有 agent-loop.ts 已从 Pi 翻译，接口应一致；若有差异在 Step 1 解决 |
| AgentHarness 与 Agent 共存可能造成混淆 | 明确文档：Agent 用于 coding-agent 调用链，AgentHarness 独立使用 |
| JSONL session 链路未端到端验证过 | Step 3 加集成测试，确保读写+续接跑通 |
| Readline 在非 TTY 环境行为不同 | 检测 `!process.stdin.isTTY` 走 print mode |
| Windows cmd.exe ANSI 乱码 | 检测 `process.platform === "win32"` 默认关闭颜色 |
| 大量输出时单行刷新闪烁 | 本期可接受；后续 TUI 化解决 |
