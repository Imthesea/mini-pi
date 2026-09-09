# WebUI 单元测试（UT）设计

> 日期：2026-09-09 | 状态：设计稿（阶段 5 消息流相关测试已落地，见 §12）
> 关联设计：[`2026-09-09-webui-style-redesign.md`](./2026-09-09-webui-style-redesign.md)
> 测试框架：Vitest 3 + jsdom + @testing-library/react + @testing-library/jest-dom

本文回答：这次视觉重构**要测什么、怎么测、测到什么程度、代码要怎样改才可测**。

---

## 1. 目标与原则

### 目标

- 覆盖本次重构的**全部新增/变更逻辑**，重点是把"工具从平铺改为内嵌消息"这个核心行为锁死，防止回归。
- 覆盖到组件渲染、交互、状态流转三层，而非只测纯函数。

### 原则（对齐项目工程偏好）

1. **纯函数优先**：把可脱离 React 的逻辑抽成纯函数单独测，组件只测"渲染 + 接线"。
2. **测行为，不测实现**：断言用户可见结果（渲染出的文本、回调触发），不断言内部 state 形状。
3. **mock 只 mock 边界**：只 mock 网络（fetch）、WebSocket、Markdown 渲染；不 mock 被测模块内部。
4. **一个用例一个断言焦点**：命名用"动词 + 条件 + 结果"。

---

## 2. 测试分层

| 层 | 对象 | 工具 | 数量占比（预估） |
|----|------|------|------------------|
| L1 纯函数 | reducer / 工具参数摘要 / 文本提取 / cn | Vitest 直接调用 | 30% |
| L2 组件 | 渲染 + props 分支 + 交互回调 | @testing-library/react | 50% |
| L3 Hook | useAgentStream / useWebSocket 状态流转 | renderHook | 20% |

---

## 3. 测试基础设施：现状与补齐

### 现状（已有）

- `vite.config.ts` 已配 `test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"] }`。
- `test-setup.ts` 已有 `@testing-library/jest-dom`。
- 已有测试：`lib/utils.test.ts`、`lib/client.test.ts`、`lib/api.test.ts`（纯逻辑 + FakeWebSocket / stubFetch）。

### 需要补齐

| 项 | 说明 | 是否必须 |
|----|------|----------|
| `@testing-library/user-event` | 组件交互（点击/输入/键盘）比 `fireEvent` 更贴近真实用户 | ✅ 必须 |
| `@vitest/coverage-v8` | 覆盖率报告（可选，见 §10） | 建议 |
| 共享 mock helper | `FakeWebSocket` / `stubFetch` 目前内联在各自测试里，抽到 `src/test/` 复用 | ✅ 必须 |

### `test-setup.ts` 补充

```ts
import "@testing-library/jest-dom";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());
```

> 说明：`@testing-library/react` 的 `render` 在 `globals: true` 下会自动 cleanup，显式补一条作为兜底，避免用例间 DOM 泄漏。

---

## 4. 为可测试性做的代码重构（关键前置）

当前 [`useAgentStream.ts`](file:///F:/allProject/githubProject/my-mimipi/packages/webui/src/hooks/useAgentStream.ts) 把所有事件处理内联在一个 `switch` 里，**无法脱离 React 单测**。设计上做一次拆分：

### 4.1 抽纯函数 `message-reducer.ts`

把"事件 → 状态变化"抽成纯函数，`useAgentStream` 变成 thin 调用：

```ts
// lib/message-reducer.ts
export interface StreamState {
  messages: ChatMessage[];
  streamingId: string | null;
  isRunning: boolean;
}

export type StreamEvent =
  | { type: "message_start"; message: ... }
  | { type: "message_update"; message: ... }
  | { type: "message_end" }
  | { type: "tool_execution_start"; toolCallId; toolName; args }
  | { type: "tool_execution_end"; toolCallId; toolName; result; isError }
  | { type: "agent_end"; willRetry: boolean };

export function applyEvent(state: StreamState, event: StreamEvent): StreamState;
```

`useAgentStream` 内部用 `setState(prev => applyEvent(prev, raw))` 替换现有 switch。**好处**：核心状态机逻辑 100% 纯函数可测，组件/hook 测试只关心接线。

### 4.2 抽纯函数 `summarizeToolArgs`

工具行需要"参数摘要"（如 `Read a.txt`），抽成纯函数：

```ts
// lib/tool-args.ts
export function summarizeToolArgs(toolName: string, args?: Record<string, unknown>): string;
```

### 4.3 抽纯函数 `extractTextContent`

已存在于 `useAgentStream.ts` 内部（未导出），移入 `lib/message-content.ts` 并导出，供 reducer 与测试共用。

---

## 5. L1 纯函数测试设计

### 5.1 `lib/message-reducer.ts`（核心，覆盖最重）

| # | 用例 | 期望 |
|---|------|------|
| 1 | `message_start(user)` | 清掉以 `user-` 开头的乐观消息，追加一条 user 消息 |
| 2 | `message_start(assistant)` | 追加空 assistant 消息，`streamingId` 指向它 |
| 3 | `message_update` 有 `streamingId` | 更新对应消息的 `content` / `thinkingContent` |
| 4 | `message_update` 无 `streamingId` | 状态不变（幂等） |
| 5 | `message_update` 只带 thinking 不带 content | content 保持旧值，只更新 thinking |
| 6 | `tool_execution_start` | 挂到 streaming 消息的 `toolCalls`，status=running |
| 7 | `tool_execution_start` 重复 toolCallId | 去重，不追加重复项 |
| 8 | `tool_execution_start` 无 streaming 消息 | 不抛错，状态不变 |
| 9 | `tool_execution_end` 成功 | 对应 tool 状态=done，写入 result |
| 10 | `tool_execution_end` 失败 | 对应 tool 状态=error |
| 11 | `tool_execution_end` 找不到 toolCallId | 状态不变 |
| 12 | `agent_end` willRetry=false | `isRunning=false` |
| 13 | `agent_end` willRetry=true | `isRunning` 保持 true |
| 14 | 多轮事件序列（start→update×N→end→agent_end） | 最终 messages/streamingId/isRunning 正确 |
| 15 | `message_end` | 清空 `streamingId` |

### 5.2 `lib/tool-args.ts`

| # | 用例 | 期望 |
|---|------|------|
| 1 | `read` 带 filePath | 返回路径（如 `a.txt`） |
| 2 | `bash` 带 command | 返回命令 |
| 3 | `write`/`edit` 带路径 | 返回路径 |
| 4 | 无 args | 只返回工具名 |
| 5 | args 里无已知字段 | 返回工具名（兜底） |

### 5.3 `lib/message-content.ts`

| # | 用例 | 期望 |
|---|------|------|
| 1 | content 为 string | 原样返回 |
| 2 | content 为数组含 text 块 | 拼接 text |
| 3 | content 为数组不含 text | 返回空串 |
| 4 | content 为 undefined | 返回空串 |

### 5.4 `lib/utils.ts`（补足已有）

- 空输入返回 `""`；含 `undefined`/`null` 混合。

---

## 6. L2 组件测试设计

统一约定：**MarkdownRenderer 用 `vi.mock` 替换为纯文本桩**，避免真实 react-markdown 干扰断言；交互用 `userEvent`。

### 6.1 `ui/button.tsx`

| # | 用例 | 期望 |
|---|------|------|
| 1 | 默认渲染 | 有 button 角色，包含 children |
| 2 | `variant="primary"` | class 含 primary 对应类 |
| 3 | `variant="ghost"` / `outline` | class 正确 |
| 4 | `size="sm"` | class 含 sm 尺寸 |
| 5 | disabled | 点击不触发 onClick |
| 6 | 点击 | onClick 触发一次 |

### 6.2 `AppFrame.tsx`

| # | 用例 | 期望 |
|---|------|------|
| 1 | 渲染三栏 | sidebar/conversation/details 都在 |
| 2 | `details` 为 undefined | 不渲染详情列 |
| 3 | `sidebarCollapsed` | 传入折叠标记（data 属性 / 列宽 class） |
| 4 | 点击折叠按钮 | `onToggleSidebar` 触发 |

### 6.3 `Sidebar` / `SessionList`

| # | 用例 | 期望 |
|---|------|------|
| 1 | 空会话 | 显示空态文案 |
| 2 | 有会话 | 渲染会话项，显示 title |
| 3 | `activeSessionId` 匹配 | 该项有选中态 class |
| 4 | 点击会话 | `onSelectSession(id)` 触发 |
| 5 | 点击删除 | `onDeleteSession(id)` 触发，且不触发 select（冒泡隔离） |
| 6 | 点击新建 | `onNewSession` 触发 |
| 7 | 搜索输入过滤 | 只显示匹配 title 的会话（过滤逻辑若抽纯函数，见 5.5） |

> 搜索过滤逻辑抽成 `lib/filter-sessions.ts` 纯函数单独测：按 title 子串匹配、空关键字返回全部、大小写不敏感。

### 6.4 `UserMessage` / `AssistantMessage` / `MessageFlow`

| # | 用例 | 期望 |
|---|------|------|
| 1 | UserMessage 渲染 | 显示 content |
| 2 | UserMessage 悬浮 Copy | 触发复制（或先只断言 Copy 按钮存在） |
| 3 | AssistantMessage 有 thinking | 默认折叠，点开显示 thinking 文本 |
| 4 | AssistantMessage 有 toolCalls | 渲染对应数量 ToolRow |
| 5 | AssistantMessage 点 ToolRow | `onSelectTool` 传入对应 tool |
| 6 | AssistantMessage 无工具 | 只渲染正文 |
| 7 | MessageFlow 空消息 + 非运行 | 显示空态提示 |
| 8 | MessageFlow 多消息 | 按顺序渲染 user/assistant |

### 6.5 `ToolRow.tsx`

| # | 用例 | 期望 |
|---|------|------|
| 1 | status=running | 显示运行态图标/文案 |
| 2 | status=done | 显示完成态 |
| 3 | status=error | 显示错误态 |
| 4 | 显示参数摘要 | 用 `summarizeToolArgs` 结果（`Read a.txt`） |
| 5 | 点击 | `onClick` 触发 |

### 6.6 `Composer.tsx`

| # | 用例 | 期望 |
|---|------|------|
| 1 | 输入文本点发送 | `onSend(content)` 触发，输入框清空 |
| 2 | 空输入点发送 | 不触发 onSend，按钮禁用 |
| 3 | Enter 发送 | 触发 onSend |
| 4 | Shift+Enter | 不触发 onSend（换行） |
| 5 | `isRunning=true` | 显示停止按钮，textarea 禁用 |
| 6 | 点停止 | `onStop` 触发 |
| 7 | 显示模型名 | `currentModel` 文本可见 |
| 8 | 显示访问模式 | `accessMode` 文本可见 |

### 6.7 `DetailsPanel.tsx`

| # | 用例 | 期望 |
|---|------|------|
| 1 | `tool=null` | 显示空态文案 |
| 2 | 有 tool | 显示 toolName + args（JSON 美化） |
| 3 | 点关闭 | `onClose` 触发 |

### 6.8 `Hero.tsx`

| # | 用例 | 期望 |
|---|------|------|
| 1 | 渲染标题 | 标题可见 |
| 2 | 发送 | `onSend` 触发 |

### 6.9 `SetupView.tsx`

| # | 用例 | 期望 |
|---|------|------|
| 1 | 渲染表单 | 输入框 + 提交按钮 |
| 2 | 空 key | 按钮禁用 |
| 3 | 提交成功（mock fetch ok） | 触发 `location.reload` |
| 4 | 提交失败（mock fetch !ok） | 显示错误信息 |
| 5 | Enter 提交 | 触发提交 |

### 6.10 `MarkdownRenderer.tsx`

| # | 用例 | 期望 |
|---|------|------|
| 1 | 纯文本 | 渲染为段落 |
| 2 | 代码块 | 渲染 pre/code |
| 3 | 内联代码 | 渲染 inline code |

---

## 7. L3 Hook 测试设计

用 `@testing-library/react` 的 `renderHook` + `act`。

### 7.1 `useAgentStream`

| # | 用例 | 期望 |
|---|------|------|
| 1 | 加载历史消息（mock request） | `messages` 为历史内容 |
| 2 | 收到 `message_start(assistant)` | `messages` 追加空 assistant |
| 3 | 收到 `tool_execution_start/end` | 工具内嵌到 streaming 消息 `toolCalls`，非独立数组 |
| 4 | `sendMessage` | 乐观追加 user 消息 + 调 `send` |
| 5 | `stopAgent` | 调 `send({type:"stop"})` |
| 6 | `agent_end` willRetry=false | `isRunning=false` |

> 关键断言点：**工具不再以 `activeTools` 平铺返回**，而是 `messages` 中 assistant 消息的 `toolCalls` 字段。

### 7.2 `useWebSocket`

| # | 用例 | 期望 |
|---|------|------|
| 1 | 首次挂载 | 认证后建立连接（mock authenticate + WebSocket） |
| 2 | sessionId 变化 | 关闭旧连接、建立新连接 |
| 3 | 卸载 | 调用 close |

---

## 8. Mock 策略与共享 helper

### 8.1 抽共享 helper（`src/test/`）

```ts
// src/test/fake-websocket.ts
export class FakeWebSocket { ... }   // 从 client.test.ts 抽出

// src/test/stub-fetch.ts
export function stubFetch(response: Partial<Response>) { ... }
export function jsonResponse(body, ok = true, status = 200) { ... }

// src/test/render-with-mock-markdown.tsx（可选）
// 统一挂载 vi.mock("...MarkdownRenderer") 的 helper
```

### 8.2 Mock 边界清单

| 目标 | 方式 | 范围 |
|------|------|------|
| `fetch` | `vi.stubGlobal("fetch", ...)` | api / hook 加载历史 |
| `WebSocket` | `vi.stubGlobal("WebSocket", FakeWebSocket)` | client / useWebSocket |
| `MarkdownRenderer` | `vi.mock` | 所有依赖它的组件测试 |
| `location.reload` | `vi.spyOn` 替换 | SetupView |
| `location.hash` | 直接设置 + 恢复 | App 路由相关（若测） |

---

## 9. 测试文件组织

沿用现有同目录 `*.test.ts` 风格，组件用 `.test.tsx`：

```
packages/webui/src/
├── lib/
│   ├── utils.test.ts              # 已有，补足
│   ├── client.test.ts             # 已有，抽 helper
│   ├── api.test.ts                # 已有，抽 helper
│   ├── message-reducer.test.ts    # 新增（核心）
│   ├── tool-args.test.ts          # 新增
│   ├── message-content.test.ts    # 新增
│   └── filter-sessions.test.ts    # 新增
├── hooks/
│   ├── useAgentStream.test.tsx    # 新增
│   └── useWebSocket.test.tsx      # 新增
├── components/
│   ├── ui/button.test.tsx
│   ├── AppFrame.test.tsx
│   ├── sidebar/Sidebar.test.tsx
│   ├── sidebar/SessionList.test.tsx
│   ├── chat/MessageFlow.test.tsx
│   ├── chat/UserMessage.test.tsx
│   ├── chat/AssistantMessage.test.tsx
│   ├── chat/ToolRow.test.tsx
│   ├── chat/Composer.test.tsx
│   ├── chat/DetailsPanel.test.tsx
│   ├── chat/Hero.test.tsx
│   ├── setup/SetupView.test.tsx
│   └── MarkdownRenderer.test.tsx
└── test/
    ├── fake-websocket.ts
    └── stub-fetch.ts
```

---

## 10. 覆盖率目标

建议补 `@vitest/coverage-v8`，脚本加：

```json
"test:coverage": "vitest run --coverage"
```

目标阈值：

| 范围 | 目标 |
|------|------|
| `lib/` 纯函数（reducer、tool-args、message-content、filter-sessions、utils） | 100% 行/分支 |
| 组件 + hook | lines ≥ 85%，关键交互分支 100% |

> 阈值是目标不是硬门槛；先追求"核心 reducer 100% + 组件关键路径全覆盖"，再谈全局数字。

---

## 11. 验收标准

设计落地后，满足以下即视为 UT 完备：

1. `pnpm --filter @mimi/webui test` 全绿。
2. `lib/message-reducer.ts` 的 15 条用例全过（工具内嵌逻辑被锁死）。
3. 每个新/改组件都有对应 `.test.tsx`，覆盖：正常渲染、关键 props 分支、交互回调、边界空态。
4. `useAgentStream` 的"工具内嵌到消息"行为有 hook 测试佐证。
5. Mock helper 复用（无重复 FakeWebSocket/stubFetch 定义）。

---

## 12. 落地进度（截至 2026-09-09）

阶段 5 消息流重构相关的 L1/L2/L3 测试已全部落地，`pnpm --filter @mimi/webui test` 全绿：**16 文件 88 条**。

已落地的测试文件（与阶段 5 强相关）：

| 层 | 文件 | 用例数 |
|----|------|--------|
| L1 | `lib/message-reducer.test.ts` | 15 |
| L1 | `lib/message-content.test.ts` | 4 |
| L1 | `lib/tool-args.test.ts` | 5 |
| L3 | `hooks/useAgentStream.test.tsx` | 6 |
| L2 | `components/chat/MessageFlow.test.tsx` | 2 |
| L2 | `components/chat/UserMessage.test.tsx` | 2 |
| L2 | `components/chat/AssistantMessage.test.tsx` | 4 |
| L2 | `components/chat/ToolRow.test.tsx` | 5 |
| L2 | `components/chat/DetailsPanel.test.tsx` | 3 |

（另有阶段 4 的 `lib/group-sessions.test.ts`、`lib/settings-api.test.ts`、`sidebar/SessionList.test.tsx`、`sidebar/SettingsPanel.test.tsx` 及既有 `lib/client.test.ts`、`lib/api.test.ts`、`lib/utils.test.ts`。）

### 与 §9 设计清单的差异

1. **`filter-sessions.test.ts` 未落地**：阶段 4 实际实现的是"workspace 分组"（`lib/group-sessions.ts`），而非 §6.3 预想的"搜索过滤"（`filter-sessions.ts`）；搜索功能 v1 未做，故该测试不存在。
2. **共享 mock helper（§8.1 `src/test/`）未落地**：`lib/client.test.ts` / `lib/api.test.ts` 仍内联各自 `FakeWebSocket` / `stubFetch`，验收第 5 条（Mock helper 复用）待后续清理。
3. 其余 §9 列出的组件测试（`button`、`AppFrame`、`Sidebar`、`Composer`、`Hero`、`SetupView`、`MarkdownRenderer`、`useWebSocket`）对应阶段 2/3/4 的 UI 细节、阶段 6/7，随对应阶段实现推进时补充。
