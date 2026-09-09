# WebUI 视觉风格对齐方案（参考 deepseek-harness）

> 日期：2026-09-09 | 状态：已确认技术路线
> 目标：把 `@mimi/webui` 的视觉风格尽量向 [deepseek-harness](file:///F:/allProject/githubProject/deepseek-harness) 前端靠拢

---

## 1. 背景与目标

我们现有前端 [`packages/webui`](file:///F:/allProject/githubProject/my-mimipi/packages/webui) 是基于 React + Tailwind + shadcn/ui 风格实现的，功能已经跑通（会话列表、聊天、工具卡片、API Key 引导）。但视觉上是"通用模板感"：左右气泡聊天 + 简单侧边栏，缺少设计语言。

本方案回答一个问题：**把 deepseek-harness 的"感觉"搬过来，具体要改什么、怎么改、分几步。**

先说结论，再展开：

- **要搬的核心是"设计语言"，不是"技术架构"。** deepseek-harness 前端用 CSS Modules + clsx（明确禁止 Tailwind），我们不必推翻 Tailwind 重写，重点是把它的**视觉规则、配色 token、布局结构、交互模式**搬过来。
- **两个版本都要做暗色主题**（deepseek-harness 浅色/深色都完整设计）。
- 改动集中在 `packages/webui`，后端 `packages/server` 基本不动（个别接口可能需要补字段，见 §5）。

---

## 2. deepseek-harness 的视觉语言（我们要"靠"什么）

我把它的前端翻了一遍，提炼出 7 个真正决定"观感"的特征。这些是后续所有改动的锚点。

### 2.1 配色：蓝灰中性色 + 黑白主按钮 + 蓝色点缀

这是最关键的一条，也是最容易抄错的。

- **中性色是"蓝灰"（bluish neutral），不是纯灰。** 它的中性色阶 `--dsw-static-neutral-bluish-*` 从 `#ffffff`、`#f9fafb`、`#f5f6f7` 一路到近黑 `#0f1115`，都带一点蓝调。
- **主按钮不是蓝色，是近黑（浅色主题）/ 近白（深色主题）。** 对应 token：
  - `--dsw-alias-brand-primary: neutral-bluish-1000`（浅色 = `#0f1115`）
  - `--dsw-alias-button-primary-fill: brand-primary`
- **品牌蓝 `#4176e6`（`--dsw-static-deepseek-500`）只做"点缀色"**：info 按钮、链接/激活态、状态色（business-primary）、侧边栏选中高亮。
- 状态色沿用常见语义：成功绿 `#22c55e`、错误红 `#ef4444`、警告琥珀 `#f59e0b`。

> 一句话：**浅色主题下是"白底 + 黑胶囊按钮 + 蓝灰层次 + 蓝色点缀"，整体是 Linear / Vercel 那种现代产品风格，不是蓝色主按钮风格。**

完整 token 定义见 [`packages/client/ui-theme/src/styles/design-platform.css`](file:///F:/allProject/githubProject/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css)，§附录给出我们可直接落地的对照表。

### 2.2 布局：可拖拽三栏

[`AppFrame.tsx`](file:///F:/allProject/githubProject/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx) 是三栏 grid：

```
┌──────────┬────────────────────────────┬───────────┐
│ sidebar  │  center (conversation)     │  details  │
│ 会话树/    │  消息流 + 底部 composer      │  工具行详情 │
│ workspace │                            │           │
└──────────┴────────────────────────────┴───────────┘
```

- **侧边栏**可折叠成窄条（rail），窄视口自动折叠；两栏之间可拖拽调宽（pointer capture + rAF 节流）。
- **详情列（details）**：点消息流里的某个工具行，右侧展开它的输入/输出详情；默认宽度为 0 但保持挂载。
- 三栏背景：`sidebar` 用 `--dsw-specific-sidebar-fill`（略深于主区），主区用 `--dsw-alias-bg-base`。

### 2.3 侧边栏内容结构

从 snapshot 能反推出完整结构（[`lifecycle-chrome/hero.expected.md`](file:///F:/allProject/githubProject/deepseek-harness/apps/web/tests/snapshots/lifecycle-chrome/hero.expected.md)）：

- 顶部：`New session` 按钮 + `Collapse sidebar`
- `Workspaces` 分组：`Search sessions`、`View options`、`Add workspace`
- 会话树（tree 语义）：`workspace` 节点 → 会话节点，带选中态
- 底部：`Settings`

### 2.4 消息流：单列文档流，不是左右气泡

这是和我们现在**差别最大**的地方。

deepseek-harness 的消息不是"用户右蓝气泡 / AI 左气泡"，而是**一条连续的单列文档流**（类似 Claude / Cursor）：

```
user: "Use the read tool twice ..."                     ← 用户消息，带 7/25 时钟
  [Copy]
assistant:
  [Think ...]        ← 思考块，可折叠/展开
  [Read a.txt]       ← 工具行：图标 + 动词 + 参数按钮
  [Read b.txt]
  [Think ...]
  DONE               ← 正文
  [Copy] [Good response] [Bad response] [Branch]
底部统计行：1 turns · 2 steps · LLM ... · Cache hit 98% · Input 15.8K · Output 135
```

关键点：

- **工具调用内嵌在消息流里**，是"Read a.txt"这种带图标的可点击行，不是独立状态卡片。
- 每条 assistant 消息带操作：`Copy` / `Good response` / `Bad response` / `Branch into a new conversation`。
- **思考块**是折叠的 `Think ...` 按钮。
- 底部有一条**运行统计行**（turns / steps / 耗时 / TTFT / 吞吐 / cache hit / token 用量），这是产品"工程师工具"气质的关键细节。

### 2.5 composer（输入区）

从 snapshot 反推：

```
[textbox "Message the agent" / "Describe what you want to build"]
[Commands]  [Access mode: Workspace Write]  [Select model: DeepSeek-V4-Flash]  [Send]
```

- 输入框左侧有 `Commands` 按钮（斜杠命令）。
- 右侧一排：访问模式切换（workspace read/write）、模型选择器、发送按钮。
- 空态（hero）下是居中的大输入框 + `Choose workspace` + `Standard mode`，标题为 `Into the Unknown Preview`。

### 2.6 按钮与圆角：胶囊形

[`Button.module.css`](file:///F:/allProject/githubProject/deepseek-harness/packages/client/ui-primitives/src/Button.module.css)：

- 胶囊形（capsule）：高 36px、内边距 `0 14px`、圆角 `18px`；紧凑态 28px / 圆角 14px。
- 变体：`primary`（黑/白）、`ghost`、`outline`（描边胶囊）、`toolbar`。
- 我们现在的 `rounded-md`（6px 方角）按钮要整体换成胶囊。

### 2.7 字体、滚动条、动效

[`base.css`](file:///F:/allProject/githubProject/deepseek-harness/packages/client/ui-theme/src/styles/base.css) + [`scrollbar.css`](file:///F:/allProject/githubProject/deepseek-harness/packages/client/ui-theme/src/styles/scrollbar.css)：

- 字体栈（中文友好）：`-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', ...`
- 代码字体：`'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, ...`（刻意不加裸 `monospace`，避免 Windows 中文回退到宋体）
- 滚动条：8px、透明轨道、圆角 thumb、颜色走 token（深色下不会出现浅色原生滚动条）
- 动效曲线 `cubic-bezier(0.4, 0, 0.2, 1)`，时长 0.2s / 0.3s，并支持 `prefers-reduced-motion`。

---

## 3. 现状差距

| 维度 | deepseek-harness | 我们现状（`packages/webui`） | 差距 |
|------|------------------|------------------------------|------|
| 配色 | 蓝灰中性色 + 黑白主按钮 + `#4176e6` 点缀，明暗双主题 | 只有 5 个 HSL 变量（[`globals.css`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/globals.css)），无暗色 | 大 |
| 布局 | 可拖拽三栏（sidebar / center / details） | 固定宽度侧边栏 + 单列聊天（[`App.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/App.tsx)） | 大 |
| 消息 | 单列文档流，工具内嵌、带操作与统计行 | 左右气泡（[`MessageBubble.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/chat/MessageBubble.tsx)） | 大 |
| 工具展示 | 内嵌可点击行，点开进详情列 | 独立状态卡片（[`ToolCard.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/chat/ToolCard.tsx)） | 大 |
| 输入区 | textbox + Commands + 访问模式 + 模型选择器 | 纯 textarea + 发送/停止按钮（[`Composer.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/chat/Composer.tsx)） | 中 |
| 按钮 | 胶囊形 | `rounded-md` 方角（[`button.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/ui/button.tsx)） | 中 |
| 侧边栏 | 会话树 + workspace 分组 + 搜索 + 设置 | 扁平会话列表（[`SessionList.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/sidebar/SessionList.tsx)） | 中 |
| 字体/滚动条 | 完整字体栈 + token 化滚动条 | 基础字体 + 6px 滚动条 | 小 |
| 空态 | hero 引导页（标题 + 大输入框） | "选择或创建一个会话开始" 一行字 | 中 |

---

## 4. 目标视觉规范（我们落地后的样子）

### 4.1 设计 token

在 [`globals.css`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/globals.css) 里建立一套 token，名字沿用 deepseek 的 `--dsw-static-*`（色阶）与 `--dsw-alias-*`（语义）双层层级，但用 Tailwind 惯用的方式消费。明暗主题通过 `body[data-ds-dark-theme]` 切换。

核心色（浅色 / 深色，其余见 §附录）：

| 语义 | 浅色 | 深色 |
|------|------|------|
| 主背景 `bg-base` | `#ffffff` | `#151517` |
| 侧边栏 `sidebar-fill` | `#f9fafb` | `#1b1b1c` |
| 主按钮 `primary-fill` | `#0f1115` | `#f9fafb` |
| 主按钮文字 `primary-foreground` | `#ffffff` | `#0f1115` |
| 品牌蓝 `business-primary` | `#4176e6` | `#4176e6` |
| 边框 `border-l2` | `rgba(0,0,0,0.10)` | `rgba(255,255,255,0.12)` |
| 文字主 `label-primary` | `#0f1115` | `#f9fafb` |
| 文字次 `label-secondary` | `#434548` | `#cfd3d6` |

### 4.2 组件规范

- **按钮**：胶囊，`h-9 rounded-full`（≈36px），sm `h-7 rounded-full`（≈28px）；`primary` = 黑白胶囊，`ghost` / `outline` 保留。
- **圆角**：卡片/输入框统一 `rounded-lg`（8px）级别，按钮胶囊。
- **字体**：body 用 deepseek 的字体栈，代码用其代码栈（在 `globals.css` 落 `--font-sans` / `--font-mono`）。
- **滚动条**：8px、透明轨道、`#e5e5e5`/hover `#d4d4d4`（深色下 `#3c3c3d`/`#38383a`）。

### 4.3 目标布局与组件清单

```
App（三栏 grid）
├── Sidebar            # 折叠/展开 + 拖拽，内部：New session / Workspaces / 会话树 / Settings
├── Conversation       # 消息流 + 空态 hero + composer
│   ├── Hero           # 空态：标题 + 大输入框 + workspace/mode 选择
│   ├── MessageFlow    # 单列文档流
│   │   ├── UserMessage    # 文本 + Copy
│   │   └── AssistantMessage # Think 块 + 工具行 + 正文 + 操作 + 统计行
│   ├── ToolRow        # 内嵌工具行（Read a.txt），点开 → details
│   └── Composer       # textbox + Commands + 访问模式 + 模型选择器 + Send
├── Details            # 工具行详情（点 ToolRow 展开）
└── SetupView          # 首次引导（风格化，沿用深色 hero 风）
```

---

## 5. 实施路线

### 5.1 技术选型：两条路，推荐 A

| | 路线 A（推荐） | 路线 B（彻底对齐） |
|---|---|---|
| 做法 | 保留 React + Tailwind，把 deepseek 的 token 体系与视觉规则移植进 Tailwind | 迁到 CSS Modules + clsx，禁用 Tailwind，完全复刻 deepseek 架构 |
| 改动量 | 中，集中在 `globals.css` + 组件 | 大，几乎重写样式层 |
| 收益 | 快速拿到"观感"，风险低，可回退 | 架构与上游一致，长期好维护 |
| 代价 | 双主题 + token 要自己用 Tailwind 表达 | 学习/迁移成本高，短期收益慢 |
| 结论 | ✅ 先走这条 | 后续若觉得 Tailwind 束缚再评估 |

**推荐 A 的理由**：我们已经有 Tailwind + shadcn 基础，deepseek 的"观感" 90% 来自配色/圆角/布局/交互，而非 CSS Modules 本身。Tailwind 完全能表达这些 token（`bg-[var(--...)]` 或扩展 `theme.colors`）。

### 5.2 分阶段（每阶段可独立交付、可回退）

**阶段 1：主题基建（纯视觉，零逻辑改动）**

1. 重写 [`globals.css`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/globals.css)：落 `--dsw-static-*` + `--dsw-alias-*` 双主题 token，字体栈、滚动条、动效曲线。
2. 扩展 [`tailwind.config.ts`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/tailwind.config.ts)：把语义 token 映射成 `colors.background` / `foreground` / `muted` / `border` / `ring` 等，替换现有 HSL 变量。
3. 增加 `body[data-ds-dark-theme]` 切换入口（先默认浅色，暗色作为 CSS 就绪即可）。
4. **验收**：现有功能不变，页面颜色变成蓝灰 + 黑白主按钮。

**阶段 2：按钮与输入组件胶囊化**

1. 改 [`button.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/ui/button.tsx)：`rounded-md` → `rounded-full`，尺寸对齐 36/28px，补 `toolbar` 变体。
2. 改 [`textarea.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/ui/textarea.tsx) / [`input.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/ui/input.tsx)：圆角统一。
3. **验收**：全站按钮胶囊，观感立刻接近。

**阶段 3：三栏布局 + 侧边栏升级**

1. 改 [`App.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/App.tsx)：从"固定侧边栏 + main"改成三栏 grid，加列宽拖拽与侧边栏折叠（可简化：先不做拖拽，仅折叠）。
2. 改 [`Sidebar.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/sidebar/Sidebar.tsx) + [`SessionList.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/sidebar/SessionList.tsx)：顶部 New session、Workspaces 分组、会话树、底部 Settings。
3. 新增 `Details` 列占位（空态：`Click a tool row ...`）。
4. **验收**：三栏骨架 + 侧边栏结构与 deepseek 对齐。

**阶段 4：消息流重构（改动最大）**

1. 改 [`MessageBubble.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/chat/MessageBubble.tsx) + [`MessageList.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/chat/MessageList.tsx)：左右气泡 → 单列文档流。
2. 工具从独立卡片改为内嵌 `ToolRow`，点开联动 Details 列。
3. assistant 消息加操作（Copy / Good / Bad / Branch，后三者先占位或裁剪）。
4. 底部加统计行（需要后端补 token/耗时字段，见 §5.3）。
5. **验收**：消息流观感对齐。

**阶段 5：composer 升级 + 空态 hero**

1. 改 [`Composer.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/chat/Composer.tsx)：加 Commands / 访问模式 / 模型选择器（后者可先只读展示当前模型）。
2. 新增 `Hero` 空态组件。
3. **验收**：输入区与空态对齐。

**阶段 6：首次引导页风格化**

1. 改 [`SetupView.tsx`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/components/setup/SetupView.tsx)：对齐 deepseek 的 onboarding 视觉（居中卡片、黑白主按钮）。

### 5.3 后端可能需要补的字段（`packages/server`）

- **统计行**需要每条 assistant 消息的 token 用量、耗时、TTFT、cache hit。目前 [`useAgentStream.ts`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/hooks/useAgentStream.ts) 收到的 `message.usage` 是透传的 `unknown`，需确认 `packages/server` 是否已把 `usage` 转发完整；不足则在 server 的 `agent-bridge`/`ws-server` 补齐，不涉及 agent 核心逻辑。
- **工具详情列**需要工具行的完整 args/result，目前 `ToolCallState` 只有 `toolName` + `status` + `args`，`result` 未落到前端状态，需要 server 把 `tool_execution_end.result` 完整转发并在前端保存。

> 这两处是"锦上添花"，阶段 4/5 可以先做占位，后端补齐可并行推进。

---

## 6. 已确认的决策

| 决策点 | 结论 |
|--------|------|
| 技术路线 | ✅ A：保留 Tailwind，移植 deepseek token 与视觉规则 |
| v1 范围 | ✅ 视觉骨架优先：配色/暗色/胶囊按钮/三栏/单列消息流/工具行 + 详情列；模型选择器与访问模式先做只读展示；Good/Bad/Branch 与统计行暂缓 |
| 暗色主题 | ✅ 跟随系统（`prefers-color-scheme`），CSS 双主题一次就绪 |
| 拖拽调宽 | 默认 v1 先做"折叠/展开"、跳过列宽拖拽（成本高，可后续补） |

---

## 附录：设计 token 对照表（可直接落地到 `globals.css`）

### 静态色阶（浅色主题，`body`）

```css
body {
  /* 蓝灰中性色 */
  --dsw-static-neutral-bluish-00:  #ffffff;
  --dsw-static-neutral-bluish-50:  #f9fafb;
  --dsw-static-neutral-bluish-60:  #f5f6f7;
  --dsw-static-neutral-bluish-75:  #f1f3f5;
  --dsw-static-neutral-bluish-100: #ebeff2;
  --dsw-static-neutral-bluish-150: #e9ecef;
  --dsw-static-neutral-bluish-200: #e1e5ee;
  --dsw-static-neutral-bluish-300: #cfd3d6;
  --dsw-static-neutral-bluish-400: #adb2b8;
  --dsw-static-neutral-bluish-500: #979da6;
  --dsw-static-neutral-bluish-600: #81858c;
  --dsw-static-neutral-bluish-700: #61666b;
  --dsw-static-neutral-bluish-800: #353638;
  --dsw-static-neutral-bluish-900: #1b1b1c;
  --dsw-static-neutral-bluish-1000: #0f1115;

  /* DeepSeek 品牌蓝 */
  --dsw-static-deepseek-50:  #edf3fe;
  --dsw-static-deepseek-100: #e4edfd;
  --dsw-static-deepseek-200: #d3e2ff;
  --dsw-static-deepseek-400: #679efe;
  --dsw-static-deepseek-450: #5686fe;
  --dsw-static-deepseek-500: #4176e6;
  --dsw-static-deepseek-600: #4868b2;

  /* 状态色 */
  --dsw-static-green-500: #22c55e;
  --dsw-static-green-100: #e6faed;
  --dsw-static-red-500:   #ef4444;
  --dsw-static-red-400:   #f25a5a;
  --dsw-static-red-100:   #fee2e2;
  --dsw-static-amber-500: #f59e0b;
  --dsw-static-amber-100: #fef5e7;
}
```

### 语义别名（浅色主题）

```css
body {
  --dsw-alias-bg-base: var(--dsw-static-neutral-bluish-00);
  --dsw-specific-sidebar-fill: var(--dsw-static-neutral-bluish-50);
  --dsw-alias-brand-primary: var(--dsw-static-neutral-bluish-1000);
  --dsw-alias-button-primary-fill: var(--dsw-alias-brand-primary);
  --dsw-alias-label-primary-foreground: var(--dsw-static-neutral-bluish-00);
  --dsw-alias-button-primary-hover: var(--dsw-static-neutral-bluish-750);
  --dsw-alias-label-primary: var(--dsw-static-neutral-bluish-1000);
  --dsw-alias-label-secondary: var(--dsw-static-neutral-bluish-700);
  --dsw-alias-label-tertiary: var(--dsw-static-neutral-bluish-600);
  --dsw-alias-border-l1: rgba(0, 0, 0, 0.04);
  --dsw-alias-border-l2: rgba(0, 0, 0, 0.10);
  --dsw-alias-border-l3: rgba(0, 0, 0, 0.12);
  --dsw-alias-state-business-primary: var(--dsw-static-deepseek-500);
  --dsw-alias-state-error-primary: var(--dsw-static-red-500);
  --dsw-alias-state-success-primary: var(--dsw-static-green-500);
  --dsw-alias-button-info-fill: var(--dsw-static-deepseek-500);
  --dsw-alias-button-info-hover: var(--dsw-static-deepseek-400);
  --dsw-alias-interactive-bg-hover: rgba(38, 49, 72, 0.06);
  --dsw-alias-interactive-bg-active: rgba(38, 49, 72, 0.10);
  --dsw-specific-sidebar-nav-item-hover: var(--dsw-static-neutral-bluish-75);
  --dsw-specific-sidebar-nav-item-active: var(--dsw-static-neutral-bluish-100);
  --dsw-specific-sidebar-nav-item-active-accent: var(--dsw-static-deepseek-100);
}
```

### 深色主题（`body[data-ds-dark-theme]`）

只列出与浅色不同的关键项，其余色阶见 `design-platform.css`：

```css
body[data-ds-dark-theme] {
  --dsw-alias-bg-base: var(--dsw-static-neutral-bluish-950);   /* #151517 */
  --dsw-specific-sidebar-fill: var(--dsw-static-neutral-bluish-900); /* #1b1b1c */
  --dsw-alias-brand-primary: var(--dsw-static-neutral-bluish-50);    /* #f9fafb */
  --dsw-alias-button-primary-fill: var(--dsw-alias-brand-primary);
  --dsw-alias-label-primary-foreground: var(--dsw-static-neutral-bluish-1000); /* #0f1115 */
  --dsw-alias-label-primary: var(--dsw-static-neutral-bluish-50);
  --dsw-alias-label-secondary: var(--dsw-static-neutral-bluish-300);
  --dsw-alias-border-l1: rgba(255, 255, 255, 0.06);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
  --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.08);
  --dsw-alias-button-info-fill: var(--dsw-static-deepseek-400);
}
```

---

## 参考资料

- deepseek-harness 样式规范：[`docs/web-styling.zh.md`](file:///F:/allProject/githubProject/deepseek-harness/docs/web-styling.zh.md)
- 设计 token 源码：[`packages/client/ui-theme/src/styles/design-platform.css`](file:///F:/allProject/githubProject/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css)
- 三栏框架：[`packages/client/ui-layout/src/client/AppFrame.tsx`](file:///F:/allProject/githubProject/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx)
- 按钮原语：[`packages/client/ui-primitives/src/Button.tsx`](file:///F:/allProject/githubProject/deepseek-harness/packages/client/ui-primitives/src/Button.tsx)
- UI snapshot（真实界面反推）：[`apps/web/tests/snapshots/seeded-history/ui.expected.md`](file:///F:/allProject/githubProject/deepseek-harness/apps/web/tests/snapshots/seeded-history/ui.expected.md)
- 我方现有前端设计：[`docs/superpowers/specs/2026-08-11-webui-design.md`](file:///F:/allProject/githubProject/my-mimipi/docs/superpowers/specs/2026-08-11-webui-design.md)
