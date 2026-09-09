# WebUI 视觉重设计方案

> 日期：2026-09-09 | 状态：实现中（阶段 1-5 已完成，见 §7 实现进度）
> 上游方案：[`docs/webui-style-alignment.md`](../../webui-style-alignment.md)（已确认：技术路线 A、视觉骨架优先、暗色跟随系统）
> 单元测试设计：[`2026-09-09-webui-ut-design.md`](./2026-09-09-webui-ut-design.md)

本文件是"设计层"，回答**每个组件长什么样、接口是什么、数据怎么流**。策略与路线见上游方案，本文只做落地细节。

---

## 1. 目标与范围

把 `@mimi/webui` 从"左右气泡聊天 + 简单侧边栏"重构为 deepseek-harness 风格的**三栏文档流**界面。

v1 范围（已确认）：

- ✅ 主题 token + 暗色（跟随系统）
- ✅ 胶囊按钮 + 统一圆角
- ✅ 三栏布局（侧边栏可折叠，跳过拖拽）
- ✅ 单列消息流（工具内嵌 + 详情列）
- ✅ composer：Commands / 访问模式（只读）/ 模型选择器（只读）
- ✅ 空态 hero
- ❌ 统计行（后端字段暂缺，先留位置）
- ❌ Good/Bad/Branch 操作（先裁剪）

---

## 2. 设计原则

从 deepseek-harness 提炼，作为所有组件决策的判断依据：

1. **黑白主按钮，蓝色只做点缀。** 主操作（发送、新建）是近黑/近白胶囊；`#4176e6` 只用于链接、激活态、info。
2. **单列文档流。** 消息不左右分栏，是自上而下的连续流，工具调用是流中的"行"，不是悬浮卡片。
3. **分层 token。** 组件永远消费语义别名（`--dsw-alias-*`），不写死色值；明暗差异只存在于 token 层。
4. **胶囊几何。** 按钮 36/28px 胶囊；卡片/输入框 8px 圆角；间距 4px 步进。
5. **中文友好的字体与滚动条。** 字体栈带 PingFang SC / Microsoft YaHei；滚动条 8px token 化。

---

## 3. 主题系统设计

### 3.1 token 分层

沿用 deepseek 的两层结构，落到 [`globals.css`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/globals.css)：

```
--dsw-static-*   静态色阶（色值，不直接消费）
      ↓
--dsw-alias-*    语义别名（组件只消费这层）
```

明暗主题通过 CSS 变量覆盖实现，暗色用 `@media (prefers-color-scheme: dark)`，并预留 `body[data-ds-dark-theme]` 手动覆盖。

### 3.2 变量存储约定

为了兼容 Tailwind 的 alpha 修饰符（`bg-foreground/90`），分两类存：

- **纯色 token**（背景、文字、品牌、状态）：存 `R G B` 三通道，Tailwind 用 `rgb(var(--x) / <alpha-value>)` 消费。
- **半透明 token**（边框层级、hover 半透明）：直接存完整 `rgba(...)`，用 `var(--x)` 消费，不使用 alpha 修饰符。

### 3.3 `globals.css` 目标结构

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* —— 静态色阶（RGB 三通道，供语义别名引用）—— */
  --neutral-00: 255 255 255;        /* #ffffff */
  --neutral-50: 249 250 251;        /* #f9fafb */
  --neutral-60: 245 246 247;        /* #f5f6f7 */
  --neutral-75: 241 243 245;        /* #f1f3f5 */
  --neutral-100: 235 238 242;       /* #ebeff2 */
  --neutral-200: 225 229 238;       /* #e1e5ee */
  --neutral-300: 207 211 214;       /* #cfd3d6 */
  --neutral-400: 173 178 184;       /* #adb2b8 */
  --neutral-500: 151 157 166;       /* #979da6 */
  --neutral-600: 129 133 140;       /* #81858c */
  --neutral-700: 97 102 107;        /* #61666b */
  --neutral-800: 53 54 56;          /* #353638 */
  --neutral-900: 27 27 28;          /* #1b1b1c */
  --neutral-1000: 15 17 21;         /* #0f1115 */

  --blue-100: 228 237 253;          /* #e4edfd */
  --blue-200: 211 226 255;          /* #d3e2ff */
  --blue-400: 103 158 254;          /* #679efe */
  --blue-500: 65 118 230;           /* #4176e6 */
  --blue-600: 72 104 178;           /* #4868b2 */

  --green-100: 230 250 237;
  --green-500: 34 197 94;           /* #22c55e */
  --red-100: 254 226 226;
  --red-400: 242 90 90;
  --red-500: 239 68 68;             /* #ef4444 */
  --amber-100: 254 245 231;
  --amber-500: 245 158 11;          /* #f59e0b */

  /* —— 语义别名（浅色）—— */
  --background: var(--neutral-00);
  --foreground: var(--neutral-1000);
  --muted: var(--neutral-60);
  --muted-foreground: var(--neutral-600);
  --border: var(--neutral-200);
  --ring: var(--blue-500);
  --primary: var(--neutral-1000);          /* 主按钮：近黑 */
  --primary-foreground: var(--neutral-00);  /* 主按钮文字：白 */
  --sidebar: var(--neutral-50);             /* 侧边栏略深 */
  --accent: var(--blue-100);                /* 选中高亮 */
  --success: var(--green-500);
  --danger: var(--red-500);
  --info: var(--blue-500);

  /* 半透明 token（直接 rgba）*/
  --border-l1: rgba(0, 0, 0, 0.04);
  --border-l2: rgba(0, 0, 0, 0.10);
  --interactive-hover: rgba(38, 49, 72, 0.06);
  --interactive-active: rgba(38, 49, 72, 0.10);

  /* 字体与动效 */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --font-mono: 'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas,
    'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei';
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: 21 21 23;          /* #151517 */
    --foreground: 249 250 251;       /* #f9fafb */
    --muted: 44 44 46;               /* #2c2c2e */
    --muted-foreground: 173 178 184; /* #adb2b8 */
    --border: 53 54 56;              /* #353638 */
    --ring: 103 158 254;
    --primary: 249 250 251;
    --primary-foreground: 15 17 21;
    --sidebar: 27 27 28;             /* #1b1b1c */
    --accent: 44 44 46;
    --info: 103 158 254;

    --border-l1: rgba(255, 255, 255, 0.06);
    --border-l2: rgba(255, 255, 255, 0.12);
    --interactive-hover: rgba(255, 255, 255, 0.08);
    --interactive-active: rgba(255, 255, 255, 0.14);
  }
}

/* 预留手动主题覆盖 */
body[data-ds-dark-theme] { /* 与 @media dark 同组变量 */ }

body {
  font-family: var(--font-sans);
  background: rgb(var(--background));
  color: rgb(var(--foreground));
}

/* 8px token 化滚动条 */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }
```

> 完整色值见上游方案附录；此处只定义 v1 用到的子集，后续按需增补。

### 3.4 `tailwind.config.ts` 映射

```ts
theme.extend.colors = {
  background: "rgb(var(--background) / <alpha-value>)",
  foreground: "rgb(var(--foreground) / <alpha-value>)",
  muted: {
    DEFAULT: "rgb(var(--muted) / <alpha-value>)",
    foreground: "rgb(var(--muted-foreground) / <alpha-value>)",
  },
  border: "rgb(var(--border) / <alpha-value>)",
  ring: "rgb(var(--ring) / <alpha-value>)",
  primary: {
    DEFAULT: "rgb(var(--primary) / <alpha-value>)",
    foreground: "rgb(var(--primary-foreground) / <alpha-value>)",
  },
  sidebar: "rgb(var(--sidebar) / <alpha-value>)",
  accent: "rgb(var(--accent) / <alpha-value>)",
  success: "rgb(var(--success) / <alpha-value>)",
  danger: "rgb(var(--danger) / <alpha-value>)",
  info: "rgb(var(--info) / <alpha-value>)",
}
```

同时把 `fontFamily.sans` / `fontFamily.mono` 指向 CSS 变量。这样既有语义类名，又保留 alpha 能力。

---

## 4. 组件设计

按改造类型分三组：**基础组件（改）**、**布局（新/改）**、**业务组件（新/改）**。

### 4.1 基础组件（`components/ui/`）

| 文件 | 动作 | 变更 |
|------|------|------|
| [`button.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/ui/button.tsx) | 改 | 变体对齐 deepseek：`primary`(黑白胶囊)/`ghost`/`outline`/`toolbar`；尺寸 `md`(h-9 圆角 full)/`sm`(h-7 圆角 full)；`rounded-md` → `rounded-full` |
| [`textarea.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/ui/textarea.tsx) | 改 | 圆角 `rounded-md` → `rounded-lg`；focus ring 用 `ring-info` |
| [`input.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/ui/input.tsx) | 改 | 同上 |
| [`separator.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/ui/separator.tsx) | 不动 | 已用 `bg-border`，随 token 自动生效 |

**Button 变体对照：**

| 变体 | deepseek | Tailwind 落地 |
|------|----------|---------------|
| `primary` | 黑/白胶囊 | `bg-primary text-primary-foreground hover:opacity-90` |
| `ghost` | 透明 + hover | `hover:bg-muted` |
| `outline` | 描边胶囊 | `border border-border bg-transparent hover:bg-muted` |
| `toolbar` | 半透明工具条 | `bg-black/50 text-white`（图片工具条场景，v1 可能不用） |

### 4.2 三栏布局

**新增 `components/AppFrame.tsx`**（替代 [`App.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/App.tsx) 里的手写 flex 布局）：

```ts
interface AppFrameProps {
  sidebar: ReactNode;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  conversation: ReactNode;
  details?: ReactNode;          // undefined = 收起
}
```

- 三栏 grid：`grid-cols-[auto_minmax(0,1fr)_auto]`，侧边栏收起时第一列变窄 rail，详情列宽度 0 但保持挂载。
- v1 不做拖拽，只做折叠（`onToggleSidebar`）。
- 侧边栏列背景 `bg-sidebar`，主区 `bg-background`，详情列左侧 `border-l border-border`。

### 4.3 侧边栏

**改 [`Sidebar.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/sidebar/Sidebar.tsx)** + **改 [`SessionList.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/sidebar/SessionList.tsx)**。

目标结构（对齐 deepseek snapshot）：

```
┌─ New session          [Collapse] ─┐
│ Workspaces                        │
│ [Search sessions] [view] [add]    │
│ ▾ workspace                       │
│   ├ 会话1  (选中)                 │
│   └ 会话2                          │
│                                   │
│ Settings                          │
└───────────────────────────────────┘
```

- `SessionList` 拆成三块：`SidebarHeader`（New + collapse）、`WorkspaceSection`（搜索/视图/添加）、`SessionTree`（workspace 分组树）、`SidebarFooter`（Settings）。
- 会话节点选中态：`bg-accent` + 左侧品牌蓝竖条（`--dsw-specific-sidebar-nav-item-active-accent` 对应 `--blue-100`）。
- 搜索框 v1 先做本地过滤（按 title 过滤已加载列表），不做后端搜索。

### 4.4 消息流（核心重构）

**废弃 `MessageBubble.tsx` / `ToolCard.tsx`**，替换为：

**`components/chat/MessageFlow.tsx`**（替代 `MessageList`）：

```ts
interface MessageFlowProps {
  messages: ChatMessage[];      // 新模型，见 §5
  isRunning: boolean;
  onSelectTool: (tool: ToolCallState) => void;  // 点工具行 → 开详情列
}
```

单列 `mx-auto max-w-3xl`，按 `ChatMessage` 顺序渲染，工具行作为 assistant 消息的子元素内嵌（不再独立于消息流）。

**`components/chat/UserMessage.tsx`**：

```ts
interface UserMessageProps {
  message: ChatMessage;
}
```

- 顶部一行：`text-sm text-muted-foreground`（turn 序号 / 时间，v1 先只显示固定"你"或省略）。
- 正文 `whitespace-pre-wrap`。
- 悬浮 `Copy` 按钮（ghost sm）。

**`components/chat/AssistantMessage.tsx`**：

```ts
interface AssistantMessageProps {
  message: ChatMessage;
  onSelectTool: (tool: ToolCallState) => void;
}
```

内部按序渲染三段：

1. **Think 块**：折叠按钮（`ChevronDown/Right` + "思考过程"），展开为 `border-l-2 pl-3 text-muted-foreground` 的等宽文本。
2. **工具行**（`ToolRow`，`message.toolCalls` 逐个渲染）。
3. **正文**：`MarkdownRenderer`。

操作区（v1 裁剪 Good/Bad/Branch，只留 Copy）。

**`components/chat/ToolRow.tsx`**（替代 `ToolCard`）：

```ts
interface ToolRowProps {
  tool: ToolCallState;
  onClick: () => void;
}
```

- 行式，`rounded-md px-3 py-1.5 hover:bg-muted cursor-pointer`。
- 左侧状态图标（running 用 spinner / done ✓ / error ✗），中间 `font-mono` 工具名 + 参数摘要（如 `Read a.txt`），右侧 chevron。
- 点击 → `onSelectTool` → 详情列展示。

**`components/chat/Composer.tsx`**（改）：

```ts
interface ComposerProps {
  isRunning: boolean;
  currentModel: string;        // 只读展示
  accessMode: string;          // 只读展示，如 "Workspace Write"
  onSend: (content: string) => void;
  onStop: () => void;
}
```

- 结构：`textarea` + 底部工具条 `[Commands] ... [Access mode] [Model] [Send/Stop]`。
- Commands / 访问模式 / 模型选择器 v1 都是只读按钮（模型名来自 `currentModel`，访问模式写死默认值），点击先 no-op 或弹简单 tooltip。
- 发送按钮 `variant="primary"`（胶囊，禁用态 `opacity-40`）。

### 4.5 详情列

**新增 `components/chat/DetailsPanel.tsx`**：

```ts
interface DetailsPanelProps {
  tool: ToolCallState | null;   // null = 空态
  onClose: () => void;
}
```

- 头部：`Details` 标题 + 关闭按钮。
- 空态：`Click a tool row ...`。
- 有值：展示 `tool.toolName` + `args`（JSON 美化）+ `result`（若 v1 后端已转发，否则留 "result 待后端补齐"）。

### 4.6 空态 hero

**新增 `components/chat/Hero.tsx`**：

```ts
interface HeroProps {
  onSend: (content: string) => void;
}
```

- 居中：标题（如 "mimi"）+ 副标题 + 大输入框（`textbox "Describe what you want to build"` 风格）。
- 复用一个简化 composer（只读模型/访问模式行 + 发送）。

### 4.7 首次引导页

**改 [`SetupView.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/setup/SetupView.tsx)**：

- 视觉对齐 deepseek onboarding：居中卡片 + 黑白主按钮（`variant="primary"` 胶囊）+ `--dsw-specific-login-input` 输入框底色。
- 逻辑不变（POST `/api/setup/apikey`）。

---

## 5. 数据模型设计

改 [`lib/types.ts`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/lib/types.ts)：

```ts
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinkingContent?: string;
  toolCalls?: ToolCallState[];   // 新增：内嵌到 assistant 消息
  usage?: TokenUsage;            // 预留（统计行）
}

export interface ToolCallState {
  toolCallId: string;
  toolName: string;
  status: "running" | "done" | "error";
  args?: Record<string, unknown>;
  result?: unknown;              // 新增：详情列展示（依赖后端转发）
}

export interface TokenUsage {    // 预留（统计行）
  input: number;
  output: number;
  totalTokens: number;
}

export interface SessionInfo {   // 不变
  id: string;
  title: string;
  messageCount: number;
  firstMessage: string;
  cwd: string;
}
```

### 关键变化：工具从"平铺"改为"挂到消息下"

现有 [`useAgentStream.ts`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/hooks/useAgentStream.ts) 把工具用独立的 `activeTools: ToolCallState[]` 状态平铺渲染（`MessageList` 里单独 map）。重构后：

- 工具事件（`tool_execution_start/end`）触发时，更新**当前 streaming assistant 消息**的 `toolCalls` 数组，而不是独立状态。
- `useAgentStream` 返回的 `activeTools` 移除，改为消息内嵌。
- 需要维护 `streamingAssistantIdRef`（已有），工具事件也按它定位消息。

---

## 6. 目录结构变更

```
packages/webui/src/
├── App.tsx                        # 改：状态机 + 三栏组装 + 详情列状态
├── globals.css                    # 改：token 双主题
├── components/
│   ├── AppFrame.tsx               # 新增：三栏布局
│   ├── chat/
│   │   ├── ChatView.tsx           # 改：编排 hero / flow / composer
│   │   ├── Hero.tsx               # 新增：空态
│   │   ├── MessageFlow.tsx        # 新增（替代 MessageList）
│   │   ├── UserMessage.tsx        # 新增
│   │   ├── AssistantMessage.tsx   # 新增
│   │   ├── ToolRow.tsx            # 新增（替代 ToolCard）
│   │   ├── DetailsPanel.tsx       # 新增
│   │   ├── Composer.tsx           # 改
│   │   ├── MessageList.tsx        # 删除
│   │   ├── MessageBubble.tsx      # 删除
│   │   └── ToolCard.tsx           # 删除
│   ├── sidebar/
│   │   ├── Sidebar.tsx            # 改
│   │   └── SessionList.tsx        # 改（拆 header/workspace/tree/footer）
│   ├── setup/SetupView.tsx        # 改
│   └── ui/                        # 基础组件微调
├── hooks/useAgentStream.ts        # 改：工具内嵌消息
└── lib/types.ts                   # 改：数据模型
```

---

## 7. 实现顺序与验收

| 阶段 | 改动 | 验收标准 |
|------|------|----------|
| 1 主题基建 | `globals.css` + `tailwind.config.ts` | 现有功能不变；页面变蓝灰 + 黑白主按钮；系统切深色跟随变暗 |
| 2 基础组件 | `button/textarea/input.tsx` | 全站按钮胶囊、圆角统一 |
| 3 布局 | 新增 `AppFrame.tsx`，改 `App.tsx` | 三栏骨架；侧边栏可折叠；详情列占位 |
| 4 侧边栏 | `Sidebar/SessionList.tsx` | 顶部 New + 折叠、搜索、会话树（选中态）。Workspaces 分组与 Settings 拆至 §8.2，需后端接口配合 |
| 5 消息流 | 新增 `MessageFlow/UserMessage/AssistantMessage/ToolRow`，改 `useAgentStream`、`types.ts` | 单列文档流；工具内嵌为行；点击开详情列 |
| 6 composer/hero | `Composer.tsx` + `Hero.tsx` | 输入区带 Commands/访问模式/模型选择器（只读）；空态 hero |
| 7 引导页 | `SetupView.tsx` | 风格化，逻辑不变 |

每个阶段独立提交、可回退；阶段 1 完成即整体观感改变，后续阶段是结构与交互深化。

### 实现进度（截至 2026-09-09）

| 阶段 | 状态 | 验证 |
|------|------|------|
| 1 主题基建 | ✅ 已提交 | — |
| 2 基础组件 | ✅ 已提交 | — |
| 3 布局 | ✅ 已提交 | — |
| 4 侧边栏 | ✅ 已提交 | — |
| 5 消息流 | ✅ 完成（未提交） | 16 文件 88 测试全绿 + `tsc -b && vite build` 通过 |
| 6 composer/hero | ⬜ 未开始 | — |
| 7 引导页 | ⬜ 未开始 | — |

**阶段 5 实现补充（相对 §4.4/§5 设计）**：为让核心状态机可脱离 React 单测，把事件处理从 `useAgentStream` 内联 `switch` 抽成三个独立纯函数：

- [`lib/message-reducer.ts`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/lib/message-reducer.ts)：`applyEvent(state, event)` 纯函数状态机，处理全部事件类型（工具内嵌逻辑在此）。
- [`lib/message-content.ts`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/lib/message-content.ts)：`extractTextContent(content)`。
- [`lib/tool-args.ts`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/lib/tool-args.ts)：`summarizeToolArgs(toolName, args?)`。

`useAgentStream` 退化为 `setState(prev => applyEvent(prev, raw))` 的 thin 调用。旧组件 `MessageList`/`MessageBubble`/`ToolCard` 已删除，由 `MessageFlow`/`UserMessage`/`AssistantMessage`/`ToolRow`/`DetailsPanel` 替代。

---

## 8. 后端接口配合

### 8.1 消息流相关（暂缓，不阻塞 v1）

- 统计行需要 `usage`（token/耗时/TTFT/cache）——server 已透传 `message.usage`，需确认完整性，缺则补。
- 详情列 `result` 需要 server 把 `tool_execution_end.result` 完整转发，当前前端 `ToolCallState` 未接 `result`。

### 8.2 侧边栏 Workspaces 分组 + Settings 面板（已决策：补后端，两个都做）

> 归档时间 2026-09-09。起因：阶段 4 原验收含「Workspaces 分组、底部 Settings」，落地时发现两者都需要后端接口支持，故暂停前端、先补后端。

**现状调查结论**

- **Workspaces 分组**：`SessionManager.listAll()` 原为**空桩**（`return []`，注释「V1 桩——不支持全局会话目录」）；server 的 `/api/sessions` 只调 `SessionManager.list(cwd)`，而 `cwd` 是 server 启动时的单一工作目录，前端因此拿不到跨 cwd 会话。会话实际按 cwd 分目录存储于 `agentDir/sessions/--<cwd 编码>--/`，每个会话文件的 header 已记录 `cwd` 字段。
- **Settings 面板**：`SettingsManager` 的 get/set 齐全（theme / defaultModel / defaultProvider / defaultThinkingLevel / compaction / retry / transport 等，且写 global settings 无 project-trust 门槛），但 server 无 `/api/settings` 路由，配置零暴露。

**实施计划**

| 步骤 | 内容 | 层 | 状态 |
|------|------|-----|------|
| 1 | 实现 `SessionManager.listAll(agentDir?)`（扫描 `sessions/` 下所有子目录汇总）+ 单测 | coding-agent | ✅ 完成（commit `a3d7342`） |
| 2 | server 会话路由改造：GET / messages / delete / WS upgrade 用 `listAll` 支持跨 cwd | server | ✅ 完成（未提交） |
| 3 | 新增 `/api/settings` 路由（GET/PATCH）+ `app.ts`/`index.ts` 传 `settingsManager` | server | ✅ 完成（未提交） |
| 4 | 前端 Workspaces 分组（`SessionList` 按 cwd 分组树） | webui | ✅ 完成（未提交） |
| 5 | 前端 Settings 面板（UI + 调接口） | webui | ✅ 完成（未提交） |
