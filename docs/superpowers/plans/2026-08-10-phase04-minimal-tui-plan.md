# Phase 04：最小化 TUI 实现计划

> **面向 AI 代理的工作者：** 使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 从 Pi 照抄 TUI 框架核心 + 聊天界面最小子集，替换当前简陋的 `node:readline` REPL，实现：首次引导（API key 配置）→ 全屏 TUI 聊天 → 流式消息渲染。

**原则：照抄 Pi，只做减法（去掉非必要功能），不做加法（不自行设计）。遇到兼容性问题才询问。**

**技术栈：** TypeScript 5.9+ / Node.js 22+ / pnpm workspace / 零第三方 TUI 依赖

---

## 背景：Pi 的 TUI 架构回顾

```
┌──────────────────────────────────────────────────┐
│ packages/coding-agent/src/modes/interactive/     │  ← 消费层：聊天 UI
│ ~18,500 行，38 个组件                             │
├──────────────────────────────────────────────────┤
│ packages/tui/src/                                │  ← 框架层：通用 TUI 框架
│ ~12,200 行，28 个文件，零第三方依赖                │
└──────────────────────────────────────────────────┘
```

核心渲染模型：
- `Component` 接口：`render(width) → string[]` + `handleInput(data)` + `invalidate()`
- `Container`：子组件树，`render` 递归拼接
- `TUI extends Container`：根节点，差分渲染引擎（逐行对比上一帧，只写变化行）
- `ProcessTerminal`：raw mode、stdin 接管、resize 事件

启动流程（Pi）：
```
cli.ts → main.ts
  → resolveAppMode(TTY → "interactive")
  → shouldRunFirstTimeSetup()  ← settings.json 不存在？
  → showFirstTimeSetup()       ← 弹出 TUI 选主题
  → createAgentSessionRuntime()
  → new InteractiveMode(runtime)
    → new TUI(new ProcessTerminal())
    → ui.start()               ← 接管终端
    → run()                    ← 事件循环
```

---

## 范围界定

### 本次必须实现（最小化跑通）

| 功能 | Pi 来源 | 说明 |
|------|---------|------|
| TUI 框架核心 | `packages/tui/src/` | Component / Container / TUI / ProcessTerminal / 差分渲染 |
| 单行输入组件 | `tui/src/components/input.ts` | 接收用户输入，回车提交 |
| 首次引导（API key） | `startup-ui.ts` + `first-time-setup.ts` | 检测 `.env` 无 key → TUI 输入框收集 key → 写入 `.env` |
| 聊天界面 | `interactive-mode.ts` | 订阅 Agent 事件，流式渲染消息 |
| 助手消息渲染 | `assistant-message.ts` | 流式文本 + thinking 折叠 |
| 用户消息渲染 | `user-message.ts` | 显示用户输入 |

### 本次不做（后续按需加）

| 功能 | 原因 |
|------|------|
| 主题选择 / 主题系统 | V1 只需要一种配色 |
| 选择器（session/model/theme/config...） | 非必要，无选择器不影响使用 |
| 快捷键系统（KeybindingsManager） | V1 只需 Enter / Esc / 基本打字 |
| Markdown 渲染 | V1 只渲染纯文本 |
| 图片支持（Kitty/iTerm2） | V1 不需要 |
| 自动补全 / fuzzy 匹配 | V1 不需要 |
| 扩展系统 / slash commands / skills UI | 太大，后续再说 |
| Footer / 状态栏 | 非必要 |
| Editor 多行编辑器 | V1 用单行 Input 即可 |
| Kill ring / undo stack / word navigation | V1 不需要 |
| Overlay 弹窗系统 | 首次引导用独立 TUI 实例，不需要 overlay |
| 版本检查 / 包更新检查 | 非必要 |

---

## 文件结构

### 新建包：`packages/tui/`

| 文件 | 行数（估） | Pi 来源 | 简化说明 |
|------|-----------|---------|----------|
| `package.json` | 20 | 新写 | 包配置 |
| `tsconfig.json` | 10 | 新写 | 编译配置 |
| `src/index.ts` | 30 | `tui/src/index.ts` | 精简导出列表 |
| `src/utils.ts` | 80 | `tui/src/utils.ts`（1209行） | **只抄**：`visibleWidth`、`sliceByColumn`、`stripAnsi`、`getGraphemeSegmenter` |
| `src/keys.ts` | 200 | `tui/src/keys.ts`（1401行） | **只抄**：`parseKey` 基础实现（字母、Enter、Esc、Backspace、方向键），不抄 Kitty 协议 |
| `src/tui.ts` | 500 | `tui/src/tui.ts`（1716行） | **只抄**：`Component` 接口、`Container` 类、`TUI` 类（start/stop/差分渲染/setFocus/requestRender），不抄 overlay 系统、Kitty 图片、终端颜色检测、IME 光标 |
| `src/terminal.ts` | 300 | `tui/src/terminal.ts`（531行） | **只抄**：`ProcessTerminal` 核心（raw mode、stdin、stdout、resize），不抄 Kitty 键盘协议协商、Apple Terminal 兼容、进度序列、写日志 |
| `src/stdin-buffer.ts` | 200 | `tui/src/stdin-buffer.ts`（434行） | **照抄**（输入缓冲拆分是基础能力，不能省） |
| `src/components/text.ts` | 50 | `tui/src/components/text.ts`（106行） | **照抄** |
| `src/components/spacer.ts` | 25 | `tui/src/components/spacer.ts` | **照抄** |
| `src/components/input.ts` | 200 | `tui/src/components/input.ts`（447行） | **只抄**：基础输入（value/cursor/handleInput/onSubmit/onEscape/render），不抄 kill-ring、undo-stack、word-navigation、bracketed paste |

**TUI 框架总计：约 1,600 行（Pi 原作 12,200 行）**

### 修改/新建：`packages/coding-agent/`

| 文件 | 行数（估） | Pi 来源 | 动作 |
|------|-----------|---------|------|
| `src/modes/interactive/interactive-mode.ts` | 400 | `interactive-mode.ts`（6008行） | **重写**，思路照抄 Pi：constructor 创建 TUI + Container 树 → init() 组装组件 + ui.start() → run() 事件循环 + 订阅 Agent 事件 |
| `src/modes/interactive/components/first-time-setup.ts` | 80 | `first-time-setup.ts`（145行） | **简化抄**：去掉主题选择、analytics，只保留 "Welcome + 输入 API key + Enter 确认" |
| `src/modes/interactive/components/assistant-message.ts` | 100 | `assistant-message.ts`（180行） | **照抄核心**：render 流式文本 + thinking 块（用缩进/颜色区分，无 Markdown） |
| `src/modes/interactive/components/user-message.ts` | 30 | `user-message.ts` | **照抄** |
| `src/cli/startup-ui.ts` | 120 | `startup-ui.ts`（240行） | **简化抄**：`shouldRunFirstTimeSetup`（检查 `.env` 无 API key）+ `showFirstTimeSetup`（创建独立 TUI，渲染 first-time-setup 组件），不抄主题加载、package manager、扩展选择器 |
| `src/main.ts` | 5 | `main.ts` | **微调**：在 `appMode === "interactive"` 后插入 `shouldRunFirstTimeSetup()` + `showFirstTimeSetup()` 调用，其余不动 |

**Coding-agent 改动总计：约 700 行**

---

## 目标状态（本计划完成后）

```
packages/tui/                          ← 新包：最小化 TUI 框架
  src/
    index.ts                           ← 导出 Component/Container/TUI/ProcessTerminal/Input/Text/Spacer
    tui.ts                             ← Component + Container + TUI
    terminal.ts                        ← ProcessTerminal
    keys.ts                            ← 基础按键解析
    utils.ts                           ← 文本宽度/截断
    stdin-buffer.ts                    ← 输入缓冲
    components/
      text.ts                          ← 文本组件
      spacer.ts                        ← 间距组件  
      input.ts                         ← 单行输入

packages/coding-agent/
  src/
    cli/startup-ui.ts                  ← 首次引导（新建）
    modes/interactive/
      interactive-mode.ts              ← TUI 聊天界面（重写）
      components/
        first-time-setup.ts            ← API key 输入组件（新建）
        assistant-message.ts           ← 流式消息渲染（新建）
        user-message.ts                ← 用户消息（新建）
    main.ts                            ← 插入 firstTimeSetup 调用（微调）
```

效果：
- `node dist/cli.js` → 全屏 TUI 接管终端
- 首次运行无 API key → 引导输入 key → 写入 `.env` → 进入聊天
- 已有 API key → 直接进入聊天界面
- 流式显示助手回复（thinking 灰色缩进、正文直接输出）
- `Ctrl+C` 退出，终端恢复正常

---

## 任务分解

### Task 1：创建 `packages/tui` 最小 TUI 框架

**Pi 参考目录：** `pi/packages/tui/src/`

- [ ] **Step 1：创建包骨架**

  文件：`packages/tui/package.json`、`packages/tui/tsconfig.json`

  `package.json`（对齐 Pi 但简化）：
  ```json
  {
    "name": "@mimi/tui",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": {
      ".": {
        "types": "./dist/index.d.ts",
        "import": "./dist/index.js"
      }
    },
    "scripts": {
      "build": "tsc"
    },
    "devDependencies": {
      "@types/node": "^22.0.0",
      "typescript": "^5.9.0"
    }
  }
  ```

  `tsconfig.json`（对齐 Pi 的 tsconfig.build.json 风格，无 composite）：
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "outDir": "./dist",
      "rootDir": "./src"
    },
    "include": ["src"],
    "exclude": ["node_modules", "dist"]
  }
  ```

- [ ] **Step 2：`src/utils.ts` — 文本工具**

  从 Pi `tui/src/utils.ts` **只抄**以下函数（其余不抄）：
  - `visibleWidth(str)` — 计算字符串的显示宽度（考虑 CJK 全角、ANSI 转义序列）
  - `sliceByColumn(str, start, end)` — 按显示列切片
  - `stripAnsi(str)` — 去掉 ANSI 转义序列（如果用得到的话）
  - `getGraphemeSegmenter()` — 返回 `Intl.Segmenter` 实例

  不抄：`truncateToWidth`、`wrapText`、`extractSegments`、`normalizeTerminalOutput`、`sliceWithWidth`

- [ ] **Step 3：`src/keys.ts` — 基础按键解析**

  从 Pi `tui/src/keys.ts` **只抄**以下（不抄 Kitty 键盘协议）：
  - `parseKey(raw: string): string` — 把 stdin 原始字节转成统一 key 字符串
    - 可见字符（含中文）→ 原样返回
    - `\r` / `\n` → `"enter"`
    - `\x1b` → `"escape"`
    - `\x7f` / `\b` → `"backspace"`
    - `\x1b[A`~`\x1b[D` → `"up"`/`"down"`/`"right"`/`"left"`
    - `\t` → `"tab"`
    - `\x03`（Ctrl+C）→ `"ctrl+c"`
    - 其余未知序列 → 空字符串（忽略）

  不抄：`matchesKey`、`isKeyRelease`、`isKeyRepeat`、`KeyId` 类型、Kitty 协议相关、`decodeKittyPrintable`、`setKittyProtocolActive`

- [ ] **Step 4：`src/stdin-buffer.ts` — 输入缓冲**

  从 Pi `tui/src/stdin-buffer.ts` **照抄**（这是基础设施，不能省）。它的职责：stdin 可能一次收到多个按键的字节，需要拆成单个按键事件再分发给组件。

- [ ] **Step 5：`src/terminal.ts` — 终端抽象**

  从 Pi `tui/src/terminal.ts` 抄 `ProcessTerminal` 类，**只保留**：
  - `start(onInput, onResize)` — 开启 raw mode、注册 stdin/resize 监听、设置 StdinBuffer
  - `stop()` — 恢复终端设置
  - `write(data)` — 写 stdout
  - `get columns()` / `get rows()` — 终端尺寸
  - `moveBy(lines)` — 光标相对移动
  - `hideCursor()` / `showCursor()` — 光标显隐
  - `drainInput()` — 退出前排空 stdin（防止残留按键泄漏到 shell）

  不抄：Kitty 键盘协议协商、Apple Terminal 兼容、进度序列（`TERMINAL_PROGRESS_*`）、写日志（`writeLogPath`）、`enableWindowsVTInput`（Windows 需要但可以后加）

- [ ] **Step 6：`src/tui.ts` — TUI 核心**

  从 Pi `tui/src/tui.ts` 抄核心类，**只保留**：

  ```ts
  // Component 接口
  interface Component {
    render(width: number): string[];
    handleInput?(data: string): void;
    invalidate(): void;
  }

  // Container 类
  class Container implements Component {
    children: Component[];
    addChild(c: Component): void;
    removeChild(c: Component): void;
    clear(): void;
    invalidate(): void;
    render(width: number): string[];
  }

  // TUI 类
  class TUI extends Container {
    terminal: Terminal;
    constructor(terminal: Terminal);
    start(): void;        // 开 raw mode，注册 resize/input，首次渲染
    stop(): void;         // 恢复终端
    setFocus(c: Component | null): void;
    requestRender(): void; // 请求下一帧渲染
  }
  ```

  **差分渲染逻辑（照抄 Pi 的核心算法）**：
  - 每帧调用 `this.render(width)` 得到 `newLines: string[]`
  - 和 `this.previousLines` 逐行对比
  - 只对变化行：ANSI 光标移动到目标行 → 写新内容 → 光标移回
  - 行数变化时触发全量重绘（`\x1b[2J\x1b[H` 清屏）

  不抄：overlay 系统（`showOverlay`/`hideOverlay`/`compositeOverlays`）、Kitty 图片管理、终端颜色检测（OSC 11）、硬件光标 IME 定位、`inputListeners`、`onDebug`、`addInputListener`

- [ ] **Step 7：`src/components/text.ts` — 文本组件**

  从 Pi `tui/src/components/text.ts` **照抄**。功能：显示一段文本，可选左边距（indent）、上边距（marginTop）。

- [ ] **Step 8：`src/components/spacer.ts` — 间距组件**

  从 Pi `tui/src/components/spacer.ts` **照抄**。功能：垂直空白行。

- [ ] **Step 9：`src/components/input.ts` — 单行输入组件**

  从 Pi `tui/src/components/input.ts` **简化抄**，只保留：
  - `value` + `cursor` 状态
  - `onSubmit` / `onEscape` 回调
  - `handleInput(data)` — 处理字符输入、Backspace 删除、Enter 提交、Esc 取消、左右方向键移动光标
  - `render(width)` — 渲染输入行 + 光标标记

  不抄：kill-ring、undo-stack、word-navigation（`findWordBackward`/`findWordForward`）、bracketed paste、Home/End 键、Ctrl+A/Ctrl+E/Ctrl+K/Ctrl+W 等 Emacs 快捷键

- [ ] **Step 10：`src/index.ts` — 包导出**

  导出：`Component`、`Container`、`TUI`、`ProcessTerminal`、`Input`、`Text`、`Spacer`、`visibleWidth`、`parseKey`

- [ ] **Step 11：构建验证**

  ```bash
  pnpm --filter @mimi/tui build
  ```

  预期：tsc 成功退出，`packages/tui/dist/index.js` 存在。

- [ ] **Step 12：Commit**

  ```bash
  git add packages/tui/
  git commit -m "feat(tui): minimal TUI framework copied from pi (Component/Container/TUI/Input/Text)"
  ```

---

### Task 2：首次引导 —— API key 输入

**Pi 参考文件：** `pi/packages/coding-agent/src/cli/startup-ui.ts` + `pi/.../components/first-time-setup.ts`

- [ ] **Step 1：`src/cli/startup-ui.ts` — 引导入口**

  从 Pi `startup-ui.ts` **简化抄**：

  ```ts
  // shouldRunFirstTimeSetup()
  // 逻辑：检查 .env 文件是否存在且包含任一 MIMI_API_KEY_*
  // 如果都没有 → 返回 true（需要引导）

  // showFirstTimeSetup()
  // 1. 创建独立 TUI：new TUI(new ProcessTerminal())
  // 2. 创建 FirstTimeSetupComponent
  // 3. ui.addChild(component) + ui.setFocus(component) + ui.start()
  // 4. 等待用户完成（Promise）
  // 5. 把 API key 写入 .env 文件
  // 6. ui.stop()
  ```

  不抄：主题加载（`loadStartupThemes` / `loadThemes`）、package manager、扩展选择器、analytics、`showStartupSelector` / `showStartupInput`

- [ ] **Step 2：`src/modes/interactive/components/first-time-setup.ts` — 引导组件**

  从 Pi `first-time-setup.ts` **简化抄**，去掉主题选择 + analytics，只留一个 API key 输入步骤：

  ```
  ┌──────────────────────────────────┐
  │ Welcome to mimi, the minimal     │
  │ coding agent.                    │
  │                                  │
  │ To get started, enter your       │
  │ DeepSeek API key:                │
  │                                  │
  │ > sk-xxxxxxxxxxxxxxxxx           │  ← Input 组件
  │                                  │
  │ Enter confirm  Esc skip          │
  └──────────────────────────────────┘
  ```

  组件内部：
  - 放一个 `Text` 显示欢迎语
  - 放一个 `Text` 显示提示文字
  - 放一个 `Input` 组件收集 key
  - `onSubmit` → 回调传出 key
  - `onEscape` → 回调传出 undefined（跳过）

  不抄：`DynamicBorder`（暂时不用）、主题 logo、analytics 步骤、`update()` 重建机制（V1 只有一页不需要）

- [ ] **Step 3：修改 `src/main.ts` 插入引导调用**

  在 `appMode === "interactive"` 判断后、创建 session manager 前，插入：
  ```ts
  if (appMode === "interactive" && shouldRunFirstTimeSetup()) {
    await showFirstTimeSetup();
  }
  ```

  Pi 代码位置参考：`pi/.../main.ts` 第 593 行。

- [ ] **Step 4：coding-agent 添加 `@mimi/tui` 依赖**

  在 `packages/coding-agent/package.json` 的 `dependencies` 中加入：
  ```json
  "@mimi/tui": "workspace:*"
  ```

- [ ] **Step 5：构建 + 验证首次引导流程**

  ```bash
  pnpm build
  # 临时删掉 .env 模拟首次运行
  mv packages/coding-agent/.env packages/coding-agent/.env.bak
  node packages/coding-agent/dist/cli.js
  # 预期：进入 TUI 引导界面，输入 key 后写入 .env，进入聊天
  ```

- [ ] **Step 6：Commit**

  ```bash
  git add packages/coding-agent/src/cli/startup-ui.ts
  git add packages/coding-agent/src/modes/interactive/components/first-time-setup.ts
  git add packages/coding-agent/src/main.ts
  git add packages/coding-agent/package.json
  git commit -m "feat(coding-agent): first-time setup for API key (TUI)"
  ```

---

### Task 3：TUI 聊天界面

**Pi 参考文件：** `pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts`（6008行），`assistant-message.ts`（180行），`user-message.ts`

- [ ] **Step 1：`src/modes/interactive/components/user-message.ts` — 用户消息组件**

  从 Pi **照抄**（这个组件很简单，就是显示 "> 用户输入内容"）。

- [ ] **Step 2：`src/modes/interactive/components/assistant-message.ts` — 助手消息组件**

  从 Pi **照抄核心逻辑**：
  - 持有 `message: AssistantMessage`（流式更新）
  - `render(width)` → 渲染文本内容
    - 正文直接显示
    - thinking 块灰色显示，左侧缩进 2 格
  - 不需要 Markdown 渲染，纯文本即可

- [ ] **Step 3：重写 `src/modes/interactive/interactive-mode.ts`**

  思路照抄 Pi 的构造函数和 init/run 流程，但大幅简化：

  **构造函数**：
  ```ts
  constructor(runtimeHost: AgentSessionRuntime, options: InteractiveModeOptions) {
    this.runtimeHost = runtimeHost;
    this.ui = new TUI(new ProcessTerminal());
    this.chatContainer = new Container();     // 聊天消息区
    this.inputComponent = new Input();         // 底部输入框
    this.statusContainer = new Container();    // 状态栏（可选）
  }
  ```

  **init()**：
  ```ts
  async init() {
    this.registerSignalHandlers();
    // 组装 UI 树（从上到下）
    this.ui.addChild(this.chatContainer);       // 消息在上面
    this.ui.addChild(new Spacer(1));            // 分隔
    this.ui.addChild(this.inputComponent);      // 输入框在底部
    this.ui.setFocus(this.inputComponent);      // 焦点放输入框
    // 订阅 Agent 事件
    this.unsubscribe = this.session.subscribe((event) => {
      // message_update → 更新 streamingComponent → requestRender()
      // turn_end → 结束流式，创建新的 assistant-message 组件
    });
    // 设置 input 提交回调
    this.inputComponent.onSubmit = (text) => {
      // 创建 user-message 组件
      // 调 this.session.prompt(text)
      // 清空 input
    };
    // 接管终端
    this.ui.start();
    // 显示欢迎信息
    this.showWelcome();
  }
  ```

  **run()**：
  ```ts
  async run() {
    await this.init();
    // TUI 接管后，一切由事件驱动（input.onSubmit → session.prompt → subscribe 回调 → render）
    // run() 只需等待 shutdown 信号
    while (!this.shutdownRequested) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await this.cleanup();
  }
  ```

  **不抄（Pi 有但 V1 不做）**：
  - 扩展系统（extension selector/input/editor/widgets）
  - Footer 状态栏
  - 快捷键系统（只保留 Input 组件内置的 Enter/Esc）
  - 自动补全
  - 版本检查 / 包更新检查
  - Changelog 显示
  - 项目信任系统
  - 剪贴板
  - 图片支持
  - `/slash` 命令
  - 会话选择器
  - OAuth 登录
  - tmux 键盘检查
  - 模型选择器
  - Header / logo 显示
  - Bash execution 组件（工具调用结果暂时纯文本显示）

- [ ] **Step 4：构建 + 验证聊天界面**

  ```bash
  pnpm build
  node packages/coding-agent/dist/cli.js
  # 预期：全屏 TUI 接管终端，显示欢迎信息，输入框可用
  # 输入问题 → 回车 → 流式显示助手回复（thinking 灰色缩进显示）
  # Ctrl+C → 退出，终端恢复正常
  ```

- [ ] **Step 5：Commit**

  ```bash
  git add packages/coding-agent/src/modes/interactive/
  git commit -m "feat(coding-agent): TUI chat interface (assistant/user message components + event-driven rendering)"
  ```

---

### Task 4：全量验证

- [ ] **Step 1：清空 + 全量构建**

  ```bash
  rm -rf packages/tui/dist packages/ai/dist packages/agent/dist packages/coding-agent/dist
  rm -f packages/*/tsconfig.tsbuildinfo
  pnpm build
  ```

- [ ] **Step 2：全量类型检查**

  ```bash
  cd packages/tui && npx tsc --noEmit
  cd ../ai && npx tsc --noEmit
  cd ../agent && npx tsc --noEmit && npx tsc -p tsconfig.test.json
  cd ../coding-agent && npx tsc --noEmit
  ```

- [ ] **Step 3：全量单元测试**

  ```bash
  pnpm test
  ```

  预期：ai / agent / coding-agent 已有测试全部通过（TUI 包暂无测试）。

- [ ] **Step 4：端到端 smoke**

  ```bash
  # 无 API key → 首次引导
  mv packages/coding-agent/.env packages/coding-agent/.env.bak
  node packages/coding-agent/dist/cli.js
  # → 进入 TUI API key 引导页

  # 有 API key → 直接聊天
  mv packages/coding-agent/.env.bak packages/coding-agent/.env
  node packages/coding-agent/dist/cli.js --version
  node packages/coding-agent/dist/cli.js --help
  ```

---

## 任务依赖图

```
Task 1 (tui framework)
  └─→ Task 2 (first-time setup) ──→ Task 3 (chat UI)
                                      └─→ Task 4 (validation)
```

Task 2 和 Task 3 都可以在 Task 1 完成后开始。但 Task 3 的 interactive-mode 改写会引用 startup-ui 的模式，建议按顺序做。

---

## 已知遗留（本次不做）

1. **Windows raw mode 兼容性**：`ProcessTerminal` 在 Windows 上可能有 raw mode 行为差异。Pi 有 `enableWindowsVTInput` 处理，V1 如果遇到 Windows 问题再加。
2. **Kitty 键盘协议**：没有协商 Kitty 协议，修饰键（Ctrl/Alt/Shift 组合）可能在某些终端丢失。V1 基础输入不需要修饰键。
3. **IME 支持**：没有 IME 组合窗口光标定位，中文输入法可能显示位置不对。等遇到再修。
4. **终端 resize 时组件缓存失效**：未做 `invalidate()` 的 resize 触发，窗口大小改变时可能显示错乱。
5. **Ctrl+C / Ctrl+Z 信号处理**：`registerSignalHandlers` 目前只在 readline 版本实现，TUI 版本需要适配。
6. **`npx mimi` 全局可用**：TUI 需要在 `package.json` 的 `bin` 正确指向 `dist/cli.js`（Task 3 之前已修好）。
