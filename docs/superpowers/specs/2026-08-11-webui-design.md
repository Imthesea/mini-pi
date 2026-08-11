# WebUI 前端系统设计方案

> 日期：2026-08-11 | 状态：待审查
> 参考项目：nanobot (`F:\allProject\githubProject\nanobot\webui`)

## 1. 目标与范围

为 pi 项目新增 Web 前端，与现有 TUI 并行运行，共享同一套 agent 核心。

### v1 范围（中等）

- 聊天界面：消息列表 + 输入框 + 工具执行展示
- 侧边栏会话列表：新建、切换、删除会话
- Web 端首次引导页：收集 API Key
- localhost 免密访问

### v1 不做

- 设置页（模型切换、thinking level 等走 CLI 或手动编辑 JSON）
- 多语言、深色/浅色主题
- 远程访问认证

---

## 2. 包架构

当前 monorepo 4 个包，新增 2 个：

```
packages/
├── ai/              # 不变 - LLM API 抽象层
├── agent/           # 不变 - Agent 运行时（零侵入）
├── tui/             # 不变 - TUI 框架
├── coding-agent/    # 不变 - CLI + TUI 入口
├── server/          # 新增 - @mimi/server  Web 服务层
└── webui/           # 新增 - @mimi/webui React 前端
```

### 依赖关系

```
@mimi/coding-agent  ← 产品层（AgentSession、SessionManager、SettingsManager）
    ↑              ↑
    │              │
@mimi/tui    @mimi/server    ← 两个渲染层，平级
```

```
@mimi/server  → @mimi/coding-agent（依赖 AgentSession、SessionManager 等）
@mimi/webui   → 无 mimi 内部依赖（独立前端）
@mimi/coding-agent → @mimi/tui, @mimi/agent, @mimi/ai  （不变）
```

`@mimi/server` 和 `@mimi/tui` 是平级的**渲染层**：
- TUI 订阅 `AgentSession` 事件 → 渲染到终端
- Server 订阅 `AgentSession` 事件 → 转发到 WebSocket → 浏览器渲染

两者通过完全相同的 API（`AgentSession.subscribe()`）消费同一套事件流。

---

## 3. @mimi/server 设计

### 3.1 职责

薄封装层，将 agent 核心能力暴露为 HTTP + WebSocket API。不包含任何 agent 逻辑，只做协议转换。

### 3.2 技术选型

- Node.js 内置 `http` 模块（零依赖）
- `ws` 库做 WebSocket

### 3.3 通信架构

```
浏览器 ──WebSocket──┐
                    ├── @mimi/server ── AgentSession.subscribe() ── @mimi/coding-agent
浏览器 ──REST API───┘
```

双通道：
- **WebSocket**：实时事件流（agent 运行期间）
- **REST**：会话列表、历史消息

### 3.4 WebSocket 协议

server 不自己定义事件类型，直接透传 `AgentSessionEvent`（定义于 `packages/coding-agent/src/core/agent-session.ts`）。

#### 连接模型

一个 chat 一个 WebSocket 连接。用户切换会话时关闭旧连接、建立新连接。v1 无"多个 chat 同时跑"的需求，不需要多路复用。

#### Server → Client（透传 AgentSessionEvent）

| 事件 | Payload | 前端处理 |
|------|---------|---------|
| `message_start` | `{ message: AgentMessage }` | 创建消息气泡 |
| `message_update` | `{ message: AgentMessage; assistantMessageEvent }` | rAF 批处理后更新消息内容 |
| `message_end` | `{ message: AgentMessage }` | 标记消息完成 |
| `tool_execution_start` | `{ toolCallId, toolName, args }` | 展示工具卡片（running） |
| `tool_execution_update` | `{ toolCallId, toolName, args, partialResult }` | 实时更新工具输出 |
| `tool_execution_end` | `{ toolCallId, toolName, result, isError }` | 显示最终结果 + 折叠 |
| `turn_start` | `{}` | UI 分组边界 |
| `turn_end` | `{ message, toolResults }` | 回合结束标记 |
| `agent_end` | `{ messages, willRetry }` | 标记本轮完成 |
| `agent_settled` | `{}` | 输入框恢复可用 |

#### Client → Server

| 消息 | Payload | 含义 |
|------|---------|------|
| `{ type: "message", content: string }` | 用户文本 | 发送用户消息 |
| `{ type: "stop" }` | 无 | 停止当前 agent 运行 |

#### 事件时序

```
agent_start
  turn_start
    message_start (user)
    message_end (user)
    message_start (assistant, partial)
      message_update × N   ← 高频：text_delta / thinking_delta / toolcall_delta
    message_end (assistant)
    tool_execution_start × M
      tool_execution_update × N
    tool_execution_end × M
  turn_end
  [多轮 turn 循环...]
agent_end
agent_settled
```

### 3.5 REST API

```
POST /api/auth                      认证（v1：localhost 免密，直接返回 token）
GET  /api/sessions                  会话列表
GET  /api/sessions/:id/messages     单会话历史消息（cursor 分页）
POST /api/sessions                  创建新会话
DELETE /api/sessions/:id            删除会话
POST /api/setup/apikey              首次引导：写入 API Key 到 .env
GET  /api/setup/status              检查是否已配置 API Key
```

#### 会话消息分页

采用 cursor 分页，用消息 ID 做锚点：

```
GET /api/sessions/:id/messages?limit=50          → 最新 50 条
GET /api/sessions/:id/messages?limit=50&before=m3 → m3 之前的 50 条
```

响应：
```json
{
  "messages": [...],
  "hasMore": true,
  "oldestId": "m1"
}
```

理由：offset/page 分页在聊天场景下，新消息追加会导致翻页内容重复或跳跃。cursor 用消息 ID 做锚点，无论追加多少新消息，结果始终确定。

### 3.6 认证

v1 localhost 免密：

- `POST /api/auth`：检测请求来自 localhost → 直接签发短期 JWT（有效期 5 分钟）
- 后续 REST 请求携带 `Authorization: Bearer <token>`
- WebSocket 连接时通过 URL 参数传递 token
- Token 过期前 30 秒自动刷新

### 3.7 启动命令

```bash
mimi serve                    # 默认 http://127.0.0.1:32123
mimi serve --port 8080        # 指定端口
```

启动时输出：
```
WebUI → http://127.0.0.1:32123
```

### 3.8 server 目录结构

```
packages/server/src/
├── index.ts              # 入口：创建 HTTP server，挂载 WS + REST 路由
├── ws-server.ts          # WebSocket 服务：连接管理、事件转发
├── agent-bridge.ts       # Agent 桥接：AgentSession 订阅 → WS 广播（依赖 @mimi/coding-agent）
├── routes/
│   ├── auth.ts           # /api/auth
│   ├── sessions.ts       # /api/sessions/*
│   └── setup.ts          # /api/setup/*
├── auth.ts               # JWT 签发/验证
└── static-handler.ts     # 托管 webui 构建产物
```

---

## 4. @mimi/webui 设计

### 4.1 技术栈

| 类别 | 选型 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建 | Vite 5 |
| CSS | Tailwind CSS 3 |
| UI 组件 | shadcn/ui（基于 Radix UI） |
| Markdown | react-markdown + remark-gfm |
| 测试 | Vitest + @testing-library/react |

### 4.2 目录结构

```
packages/webui/src/
├── components/
│   ├── chat/
│   │   ├── ChatView.tsx          # 聊天主视图（消息列表 + 输入框）
│   │   ├── MessageBubble.tsx     # 消息气泡（user / assistant）
│   │   ├── MessageList.tsx       # 消息列表（滚动容器）
│   │   ├── Composer.tsx          # 消息输入框 + 发送/停止按钮
│   │   └── ToolCard.tsx          # 工具执行卡片（running / done / error）
│   ├── sidebar/
│   │   ├── Sidebar.tsx           # 侧边栏容器
│   │   └── SessionList.tsx       # 会话列表
│   ├── setup/
│   │   └── SetupView.tsx         # 首次引导页（收集 API Key）
│   ├── ui/                       # shadcn/ui 基础组件
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── dialog.tsx
│   │   ├── separator.tsx
│   │   ├── textarea.tsx
│   │   └── tooltip.tsx
│   └── MarkdownRenderer.tsx      # Markdown 渲染
├── hooks/
│   ├── useAgentStream.ts         # WebSocket 流数据核心 Hook
│   ├── useSessions.ts            # 会话列表管理
│   └── useWebSocket.ts           # WebSocket 连接管理
├── lib/
│   ├── client.ts                 # WebSocket 客户端（连接、重连）
│   ├── api.ts                    # REST API 封装
│   └── types.ts                  # 类型定义
├── App.tsx                       # 根组件（状态机：setup → chat）
├── main.tsx                      # 入口
└── globals.css                   # 全局样式
```

### 4.3 组件职责

| 组件 | 职责 | nanobot 参考 |
|------|------|-------------|
| `ChatView` | 编排聊天视图：消息列表 + 输入框 + agent 状态 | `ThreadShell` |
| `MessageList` | 渲染消息列表，自动滚动到底部 | — |
| `MessageBubble` | 单条消息：user 文本 / assistant Markdown + thinking block | `MessageBubble` + `MarkdownText` |
| `ToolCard` | 工具执行：名称 + 状态指示。不展示 stdout（参考 nanobot，工具原始输出不出现在前端活动中，用户通过模型回复看摘要） | `ActivityStep` |
| `Composer` | 文本输入 + 发送/停止按钮 | `ThreadComposer` |
| `Sidebar` | 会话列表 + 新建按钮 | `Sidebar` + `ChatList` |
| `SetupView` | 首次引导页：输入 API Key | — |

### 4.4 核心 Hook：`useAgentStream`

借鉴 nanobot 的 `useNanobotStream`，核心逻辑：

```
WebSocket 事件 → message_update → rAF 批量合并 → setState
```

合并策略：同一个 `requestAnimationFrame` 帧内的多个 `message_update` 事件只触发一次 React state 更新，避免高频渲染。

管理状态：
- `messages: AgentMessage[]` — 当前会话的消息列表
- `streamingContent: string` — 当前正在流式输出的文本
- `thinkingContent: string` — 当前 thinking block 内容
- `activeTools: Map<string, ToolState>` — 当前正在执行的工具
- `isAgentRunning: boolean` — agent 是否在运行

### 4.5 App 状态机

```
┌─────────────────────────────────────┐
│  App 启动                            │
│    │                                 │
│    ├─ GET /api/setup/status          │
│    │                                 │
│    ├─ 无 API Key → SetupView         │
│    │   ├─ 输入 Key → POST /api/setup/apikey  │
│    │   └─ 写入成功 → 刷新页面          │
│    │                                 │
│    └─ 有 API Key → ChatView           │
│        ├─ POST /api/auth → 获取 token │
│        ├─ new WebSocket(token) → 连接 │
│        ├─ GET /api/sessions → 侧边栏  │
│        └─ 等待用户输入                │
└─────────────────────────────────────┘
```

### 4.6 路由

Hash 路由，不引入 React Router：

| Hash | 视图 |
|------|------|
| `#/` | 新对话（默认） |
| `#/chat/:sessionId` | 打开指定会话 |
| 无 hash | 重定向到 `#/` |

### 4.7 消息渲染

- **assistant 文本**：Markdown（react-markdown + remark-gfm），代码块带语法高亮
- **thinking block**：默认折叠，点击展开（`<details>` 或 Collapsible）
- **工具调用**：`ToolCard` 卡片
  - 只显示 toolName + 状态图标（⏳ running / ✅ done / ❌ error）
  - 不展示 stdout/stderr（参考 nanobot：工具原始输出不出现在前端活动中，用户通过模型回复的摘要来理解工具结果）
- **user 消息**：纯文本

---

## 5. 首次引导流程

### 5.1 背景

pi 项目当前 TUI 首次引导（`startup-ui.ts`）在 interactive 模式下弹出，收集 DeepSeek API Key 写入 `${cwd}/.env`。Web 模式下用户看不到 TUI，需要 Web 端引导页。

### 5.2 Web 端引导流程

```
mimi serve 启动
  └─ server 启动时不检查 API Key（允许无 Key 启动）

用户打开 http://127.0.0.1:32123
  └─ App 加载
      ├─ GET /api/setup/status
      ├─ 返回 { hasApiKey: false }
      └─ 显示 SetupView 引导页

SetupView:
  ┌──────────────────────────────────┐
  │         MIMI                     │
  │   Minimal Coding Agent           │
  │                                  │
  │  输入你的 DeepSeek API Key：      │
  │  [____________________________]  │
  │                                  │
  │  在 https://platform.deepseek.com │
  │  创建 API Key                    │
  │                                  │
  │  [ 开始使用 ]                    │
  └──────────────────────────────────┘

用户输入 Key → 点击"开始使用"
  → POST /api/setup/apikey { apiKey: "sk-xxx" }
  → server 将 MIMI_API_KEY_DEEPSEEK=sk-xxx 写入 ${cwd}/.env
  → 返回成功
  → 前端刷新页面 → GET /api/setup/status → { hasApiKey: true }
  → 进入 ChatView
```

### 5.3 检测逻辑

`GET /api/setup/status` 复用 `shouldRunFirstTimeSetup()` 的逻辑（来自 `startup-ui.ts`）：

```typescript
// 检查 process.env + .env 文件中 MIMI_API_KEY_DEEPSEEK / _ANTHROPIC / _OPENAI
// 任一存在且非占位值 → hasApiKey: true
// 全部不存在 → hasApiKey: false
```

---

## 6. 构建与开发

### 6.1 开发模式

```
终端 1: mimi serve              # 启动后端 (HTTP :32123 + WS)
终端 2: cd packages/webui && pnpm dev   # Vite dev server (:5173)
                                           # proxy /api → :32123
                                           # proxy /ws   → :32123
```

### 6.2 生产构建

```
pnpm build:webui    # Vite 构建 → packages/server/static/
pnpm build:server   # tsc 编译 @mimi/server

mimi serve          # server 托管静态文件 + API
```

### 6.3 vite.config.ts 关键配置

```typescript
{
  plugins: [react()],
  resolve: { alias: { "@": "./src" } },
  build: {
    outDir: "../server/static",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:32123",
      "/ws":  { target: "ws://127.0.0.1:32123", ws: true },
    },
  },
}
```

---

## 7. 与 nanobot 的关键差异

| 方面 | nanobot | pi (mimi) |
|------|---------|-----------|
| 后端语言 | Python (FastAPI + websockets) | TypeScript (Node.js 内置 http + ws) |
| 事件系统 | 20+ 种自定事件类型 | 直接透传 AgentSessionEvent（10+ 种） |
| 认证 | JWT + 共享密钥（远程需密码） | v1 localhost 免密 |
| 设置页 | 完整设置（模型/频道/工具等） | v1 不做 |
| 多语言 | 9 种语言 | v1 不做 |
| 前端路由 | Hash 路由，无 React Router | 同 |
| 主题 | 深色/浅色 | v1 不做 |
| 首次引导 | `nanobot onboard --wizard`（终端向导） | Web 端引导页 + 终端 TUI 引导（已有） |
| Delta 批处理 | rAF 合并 | 借鉴相同策略 |

---

## 8. 已确认的设计决策

| 决策点 | 结论 |
|--------|------|
| `mimi serve` 命令位置 | `@mimi/coding-agent` 的 CLI 中（和 TUI 入口平级），`@mimi/server` 只提供 `startServer()` 函数 |
| WebSocket 连接模型 | 一个 chat 一个连接，切换会话时断开旧连新。v1 不需要多路复用 |
| 会话消息分页 | cursor 分页（`limit` + `before`），用消息 ID 做锚点 |
| 工具 stdout 展示 | 不展示。ToolCard 只显示工具名 + 状态，用户通过模型回复的摘要来理解工具结果（与 nanobot 一致）
