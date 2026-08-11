# WebUI 前端系统 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 pi 项目新增 Web 前端系统（React + Vite），通过 `@mimi/server` 将 agent 事件桥接到浏览器。

**架构：** 新增 `@mimi/server`（HTTP/WS 服务，依赖 `@mimi/coding-agent`）和 `@mimi/webui`（React 前端，独立包）。server 订阅 AgentSessionEvent 并透传到 WebSocket，前端通过 WebSocket 接收实时事件流 + REST API 做会话管理。

**技术栈：** TypeScript, Node.js http + ws, React 18, Vite 5, Tailwind CSS 3, shadcn/ui, react-markdown

**参考设计文档：** `docs/superpowers/specs/2026-08-11-webui-design.md`

---

## 文件结构总览

```
packages/server/
├── package.json, tsconfig.json
└── src/
    ├── index.ts              # startServer() 入口
    ├── app.ts                # HTTP + WS 应用组装
    ├── ws-server.ts          # WebSocket 连接管理
    ├── agent-bridge.ts       # AgentSession 订阅 → WS 转发
    ├── auth.ts               # JWT 签发/验证
    ├── static-handler.ts     # 托管 webui/ 构建产物
    └── routes/
        ├── auth.ts           # POST /api/auth
        ├── sessions.ts       # GET/POST/DELETE /api/sessions/*
        └── setup.ts          # GET /api/setup/status, POST /api/setup/apikey

packages/webui/
├── package.json, tsconfig.json, vite.config.ts
├── tailwind.config.js, postcss.config.js, index.html
└── src/
    ├── main.tsx, App.tsx, globals.css
    ├── components/
    │   ├── chat/    (ChatView, MessageList, MessageBubble, Composer, ToolCard)
    │   ├── sidebar/ (Sidebar, SessionList)
    │   ├── setup/   (SetupView)
    │   ├── ui/      (button, input, textarea, separator)
    │   └── MarkdownRenderer.tsx
    ├── hooks/   (useAgentStream, useSessions, useWebSocket)
    └── lib/      (client.ts, api.ts, types.ts)

packages/coding-agent/src/
├── cli/args.ts           # 新增 --serve / --port 参数
├── main.ts               # 新增 serve 模式分支
└── server-entry.ts       # 新增：server 启动入口
```

---

### Phase 1：项目脚手架

#### 任务 1.1：创建 @mimi/server 包

**文件：**
- 创建：`packages/server/package.json`
- 创建：`packages/server/tsconfig.json`

**步骤：**

- [ ] 创建 `packages/server/package.json`，name `@mimi/server`，type `module`，依赖 `@mimi/coding-agent: workspace:*` 和 `ws: ^8.18.0`，devDependencies 含 `@types/node`、`@types/ws`、`typescript`、`vitest`
- [ ] 创建 `packages/server/tsconfig.json`，extends `../../tsconfig.base.json`，outDir `./dist`，rootDir `./src`，references `../coding-agent`
- [ ] 运行 `pnpm install` 安装依赖
- [ ] 提交：`git add packages/server/ && git commit -m "feat: scaffold @mimi/server package"`

---

#### 任务 1.2：创建 @mimi/webui 包（Vite + React + Tailwind）

**文件：**
- 创建：`packages/webui/package.json`
- 创建：`packages/webui/tsconfig.json`
- 创建：`packages/webui/vite.config.ts`
- 创建：`packages/webui/tailwind.config.js`
- 创建：`packages/webui/postcss.config.js`
- 创建：`packages/webui/index.html`

**步骤：**

- [ ] 创建 package.json，含 react 18、react-dom、react-markdown、remark-gfm、clsx、tailwind-merge、class-variance-authority。devDeps 含 vite、@vitejs/plugin-react、tailwindcss、postcss、autoprefixer、vitest、@testing-library/react、jsdom、lucide-react
- [ ] 创建 tsconfig.json，target ES2022，jsx react-jsx，paths `@/*` → `./src/*`，noEmit true
- [ ] 创建 vite.config.ts，plugins [react()]，alias `@` → `./src`，build outDir `../server/static`，server proxy `/api` 和 `/ws` 到 `127.0.0.1:32123`
- [ ] 创建 tailwind.config.js（content 含 `./index.html` 和 `./src/**/*.{js,ts,jsx,tsx}`）、postcss.config.js（tailwindcss + autoprefixer）
- [ ] 创建 index.html（`<div id="root">` + module script `main.tsx`）
- [ ] 创建占位 `src/main.tsx`（渲染 "mimi WebUI"）和 `src/globals.css`（tailwind directives + CSS 变量 `--background`/`--foreground`/`--border`）
- [ ] 运行 `pnpm install && pnpm --filter @mimi/webui dev`，验证 Vite 启动成功
- [ ] 提交

---

#### 任务 1.3：在 coding-agent CLI 中新增 `mimi serve` 命令入口

**文件：**
- 修改：`packages/coding-agent/src/cli/args.ts`
- 创建：`packages/coding-agent/src/server-entry.ts`
- 修改：`packages/coding-agent/src/main.ts`
- 修改：`packages/coding-agent/package.json`

**步骤：**

- [ ] 在 `args.ts` 的 `Args` 接口中新增 `serve?: boolean` 和 `port?: number`。在 `parseArgs()` switch 中新增 `--serve` 和 `--port <num>` case
- [ ] 在 `args.ts` 的 `printHelp()` 中添加 `--serve` 和 `--port` 帮助文本
- [ ] 创建 `packages/coding-agent/src/server-entry.ts`：导出 `ServeOptions` 接口（`{ port, cwd, settingsManager, sessionManager }`）和 `startServe()` 函数（动态 `import("@mimi/server")` 并调用 `startServer`）
- [ ] 在 `main.ts` 的 `main()` 中，检查 `parsed.serve` → 调用 `startServe()` 并 return
- [ ] 在 `packages/coding-agent/package.json` 中添加 `"@mimi/server": "workspace:*"` 依赖
- [ ] 运行 `pnpm install`；验证编译：`pnpm --filter @mimi/coding-agent build`
- [ ] 提交

---

### Phase 2：@mimi/server HTTP 核心

#### 任务 2.1：JWT 签发与验证

**文件：**
- 创建：`packages/server/src/auth.ts`
- 创建：`packages/server/src/__tests__/auth.test.ts`

**步骤：**

- [ ] 实现 `createAuth()`：返回 `issueToken()`（签发 5 分钟有效期的 HMAC-SHA256 签名 token）、`validateToken()`、`shouldRefresh()`。用 `crypto.randomUUID` 做 secret，`crypto.createHmac("sha256")` 签名，`timingSafeEqual` 防时序攻击。token 格式为 `base64url(JSON).base64url(sig)`
- [ ] 编写 vitest 测试：验证签发/验证流程，验证无效 token 被拒绝
- [ ] 运行 `pnpm --filter @mimi/server test`，全部 PASS
- [ ] 提交

---

#### 任务 2.2：HTTP 路由分发 + /api/auth + 静态文件托管

**文件：**
- 创建：`packages/server/src/app.ts`
- 创建：`packages/server/src/routes/auth.ts`
- 创建：`packages/server/src/static-handler.ts`
- 创建：`packages/server/src/index.ts`

**步骤：**

- [ ] 实现 `routes/auth.ts`：`POST /api/auth` 调用 `issueToken()` 返回 `{ token, expires_in }`
- [ ] 实现 `static-handler.ts`：`handleStatic(req, res, url)` 将非 `/api/` 的 GET 请求路由到 `../static/` 目录（SPA fallback：非文件路径返回 index.html）。支持 MIME 类型映射，路径穿越防护
- [ ] 实现 `app.ts`：`createApp(deps)` 返回 `handleRequest(req, res)`。设置 CORS 头，OPTIONS 预检返回 204，路由 `/api/auth`、其他 `/api/*`（占位 404）、静态文件
- [ ] 实现 `index.ts`：`startServer(options)` 创建 `http.createServer` + `WebSocketServer`，监听 `127.0.0.1:${port}`，打印 URL
- [ ] 运行 `pnpm --filter @mimi/server build`，编译通过
- [ ] 提交

---

### Phase 3：WebSocket + Agent 桥接

#### 任务 3.1：WebSocket 连接管理

**文件：**
- 创建：`packages/server/src/ws-server.ts`
- 创建：`packages/server/src/__tests__/ws-server.test.ts`

**步骤：**

- [ ] 实现 `createWsServer(callbacks)`：管理 `Set<WebSocket>` 连接集合。`send(ws, event)` 序列化 JSON 发送，`handleConnection(ws, req)` 处理 message/close/error 事件。定义 `ClientMessage` 类型为 `{ type: "message", content: string } | { type: "stop" }`
- [ ] 编写测试：验证 send 正确序列化 JSON
- [ ] 运行测试，全部 PASS
- [ ] 提交

---

#### 任务 3.2：Agent 桥接

**文件：**
- 创建：`packages/server/src/agent-bridge.ts`
- 修改：`packages/coding-agent/src/core/index.ts`（如需要）

**步骤：**

- [ ] 确认 `packages/coding-agent/src/core/index.ts` 导出了 `AgentSession` 和 `AgentSessionEvent` 类型。若未导出，新增导出
- [ ] 实现 `createAgentBridge(wsServer)`：`bindSession(ws, session)` 调用 `session.subscribe(listener)` 将事件转发到 WS。`sendMessage(session, content)` 调用 `session.prompt(content)`。`stopAgent(session)` 调用 `session.abort()`
- [ ] 编译验证

---

#### 任务 3.3：整合 WS + Agent 到 index.ts

**文件：**
- 修改：`packages/server/src/index.ts`
- 修改：`packages/server/src/app.ts`

**步骤：**

- [ ] 更新 `AppDeps`：新增 `wsServer`、`agentBridge`、`sessionManager`、`settingsManager`、`cwd`
- [ ] 更新 `index.ts`：在 `httpServer.on("upgrade")` 中处理 WebSocket 升级（路径 `/ws`），回调中调用 `wsServer.handleConnection`
- [ ] 更新 `app.ts` 的 `handleRequest`：已有 `/api/sessions` 和 `/api/setup` 路由分发（占位，Phase 4 实现）
- [ ] 编译验证

---

### Phase 4：REST API

#### 任务 4.1：会话 API（列表、创建、删除、分页）

**文件：**
- 创建：`packages/server/src/routes/sessions.ts`

**步骤：**

- [ ] 实现 `handleSessions(req, res, url, deps)`：
  - `POST /api/sessions` → `deps.sessionManager.create()` → 返回 `{ id }`
  - `GET /api/sessions` → `deps.sessionManager.list()` → 返回 `[{ id, title }]`
  - `DELETE /api/sessions/:id` → `deps.sessionManager.delete(id)` → `{ ok: true }`
  - `GET /api/sessions/:id/messages` → 解析 `limit` 和 `before` 参数，cursor 分页。从 `session.getEntries()` 中提取 message 类型的 entry，返回 `{ messages, hasMore, oldestId }`
  - 所有路由先验证 `Authorization: Bearer <token>`
- [ ] 注意：需要确认 `SessionManager` 实际 API 方法名（`create`/`open`/`list`/`delete`/`getEntries`），按实际情况调整调用
- [ ] 编译验证

---

#### 任务 4.2：Setup API

**文件：**
- 创建：`packages/server/src/routes/setup.ts`

**步骤：**

- [ ] 实现 `handleSetup(req, res, url, deps)`：
  - `GET /api/setup/status` → 检测 `process.env` + `.env` 文件中 `MIMI_API_KEY_DEEPSEEK|_ANTHROPIC|_OPENAI`，返回 `{ hasApiKey: boolean }`
  - `POST /api/setup/apikey` → 解析 body `{ apiKey }` → 写入 `MIMI_API_KEY_DEEPSEEK=<key>` 到 `cwd/.env` → `{ ok: true }`
- [ ] 编译验证
- [ ] 整体编译：`pnpm --filter @mimi/server build` 通过

---

### Phase 5：@mimi/webui 基础框架

#### 任务 5.1：shadcn/ui 基础组件 + 工具函数

**文件：**
- 创建：`packages/webui/src/lib/utils.ts`
- 创建：`packages/webui/src/components/ui/button.tsx`
- 创建：`packages/webui/src/components/ui/input.tsx`
- 创建：`packages/webui/src/components/ui/textarea.tsx`
- 创建：`packages/webui/src/components/ui/separator.tsx`

**步骤：**

- [ ] `utils.ts`：导出 `cn()` 函数（clsx + tailwind-merge 合并类名）
- [ ] `button.tsx`：`<Button>` 组件，支持 `variant`（default/ghost/outline）和 `size`（sm/default/lg），使用 `React.forwardRef`
- [ ] `input.tsx`：`<Input>` 组件，标准 input 样式，`React.forwardRef`
- [ ] `textarea.tsx`：`<Textarea>` 组件，`React.forwardRef`
- [ ] `separator.tsx`：`<Separator>` 组件，支持 `orientation`
- [ ] 编译验证

---

#### 任务 5.2：App Shell + Hash 路由 + SetupView + Sidebar 占位

**文件：**
- 创建：`packages/webui/src/App.tsx`
- 创建：`packages/webui/src/components/setup/SetupView.tsx`
- 创建：`packages/webui/src/components/sidebar/Sidebar.tsx`
- 创建：`packages/webui/src/components/sidebar/SessionList.tsx`
- 修改：`packages/webui/src/main.tsx`
- 修改：`packages/webui/src/globals.css`
- 创建：`packages/webui/src/lib/types.ts`

**步骤：**

- [ ] 更新 `globals.css`：补充 `--muted`、`--muted-foreground` CSS 变量，自定义滚动条样式
- [ ] 创建 `types.ts`：定义 `ChatMessage`（id, role, content, thinkingContent?）、`ToolCallState`（toolCallId, toolName, status, args?）
- [ ] 创建 `SetupView`：居中卡片布局，包含 MIMI Logo 文字、API Key 输入框、"开始使用"按钮。调用 `POST /api/setup/apikey` 后 `window.location.reload()`
- [ ] 创建 `Sidebar` + `SessionList`：Sidebar 为固定宽度侧边栏容器（w-64），SessionList 渲染会话列表（id + 删除按钮），底部"新建会话"按钮。Props：`sessions`、`activeSessionId`、`onNewSession`、`onSelectSession`、`onDeleteSession`
- [ ] 实现 `App.tsx` 状态机：
  - 启动时 `fetch("/api/setup/status")` → 无 key → `setup` 状态 → 渲染 `SetupView`
  - 有 key → `chat` 状态 → 渲染 `Sidebar` + `ChatView`（占位空 div）
  - 使用 `location.hash` 管理当前激活会话（`#/chat/:id`），监听 `hashchange`
- [ ] 更新 `main.tsx`：`React.StrictMode` + `App`
- [ ] 编译验证：`pnpm --filter @mimi/webui build`（ChatView 占位即可）

---

### Phase 6：聊天组件

#### 任务 6.1：MarkdownRenderer

**文件：**
- 创建：`packages/webui/src/components/MarkdownRenderer.tsx`

**步骤：**

- [ ] 实现 `MarkdownRenderer`：使用 `react-markdown` + `remark-gfm`。自定义 `pre`（bg-muted rounded p-3 overflow-x-auto）和 `code`（inline: bg-muted px-1 rounded）组件
- [ ] 编译验证

---

#### 任务 6.2：MessageBubble + ToolCard

**文件：**
- 创建：`packages/webui/src/components/chat/MessageBubble.tsx`
- 创建：`packages/webui/src/components/chat/ToolCard.tsx`

**步骤：**

- [ ] 实现 `MessageBubble`：user 消息右对齐（bg-foreground text-background），assistant 消息左对齐（bg-muted）。thinking block 默认折叠，点击展开。assistant 内容用 MarkdownRenderer，user 内容纯文本
- [ ] 实现 `ToolCard`：显示状态图标（running ⏳ / done ✅ / error ❌）+ 工具名（font-mono），不同状态不同颜色
- [ ] 编译验证

---

#### 任务 6.3：Composer + MessageList + ChatView

**文件：**
- 创建：`packages/webui/src/components/chat/Composer.tsx`
- 创建：`packages/webui/src/components/chat/MessageList.tsx`
- 创建：`packages/webui/src/components/chat/ChatView.tsx`

**步骤：**

- [ ] `Composer`：`<Textarea>` + `<Button>`（Send/Stop 图标用 lucide-react）。Enter 发送，Shift+Enter 换行。isRunning 时显示 Stop 按钮并禁用输入
- [ ] `MessageList`：渲染 MessageBubble 列表 + 活跃 ToolCard。底部 ref 自动 scrollIntoView
- [ ] `ChatView`：组合 MessageList + Composer，管理 messages/activeTools/isRunning 状态。handleSend 创建 userMsg 并追加到 messages（WebSocket 集成在 Phase 7）
- [ ] 编译验证：`pnpm --filter @mimi/webui build` 通过

---

### Phase 7：WebSocket 集成

#### 任务 7.1：WebSocket 客户端 + useWebSocket

**文件：**
- 创建：`packages/webui/src/lib/api.ts`
- 创建：`packages/webui/src/lib/client.ts`
- 创建：`packages/webui/src/hooks/useWebSocket.ts`

**步骤：**

- [ ] `api.ts`：管理 `token` 变量。`authenticate()` → POST /api/auth → 保存 token。`request(path, options)` 封装 fetch 并注入 Authorization header
- [ ] `client.ts`：`createWsClient()` 返回 `{ connect(url), send(msg), close(), onEvent(handler) }`。自动重连（2s 间隔），onEvent 管理 handler Set
- [ ] `useWebSocket({ sessionId })`：useEffect 中先 `authenticate()`，然后构造 WS URL（`ws://host/ws?token=...&session=...`）并 connect。cleanup 时 close。返回 `{ send, onEvent }`
- [ ] 编译验证

---

#### 任务 7.2：useAgentStream Hook

**文件：**
- 创建：`packages/webui/src/hooks/useAgentStream.ts`

**步骤：**

- [ ] 实现 `useAgentStream({ sessionId })`：
  - 用 `useWebSocket` 建立连接
  - useEffect 加载历史消息：`fetch(/api/sessions/:id/messages?limit=50)` → setMessages
  - `onEvent` 监听 WS 事件：
    - `message_start` → 创建新消息到 messages，如果是 assistant 设为 "streaming"
    - `message_update` → 用 `requestAnimationFrame` 批处理：同一帧内多次 update 合并为一次 setState。更新 streamingContent / thinkingContent
    - `message_end` → 标记消息完成
    - `tool_execution_start` → 添加 ToolCallState（status: running）
    - `tool_execution_end` → 更新 ToolCallState（status: done/error）
    - `agent_settled` → setIsRunning(false)
  - `sendMessage(content)` → ws.send({ type: "message", content })
  - `stopAgent()` → ws.send({ type: "stop" })
  - 返回 `{ messages, activeTools, isRunning, sendMessage, stopAgent, loadMore }`
- [ ] 注意：rAF 批处理实现：维护 `pendingUpdate` ref，`message_update` 到来时更新 ref，若未调度则 `requestAnimationFrame(() => { apply pending; 标记已调度=false })`
- [ ] 编译验证

---

#### 任务 7.3：ChatView 接入 useAgentStream

**文件：**
- 修改：`packages/webui/src/components/chat/ChatView.tsx`

**步骤：**

- [ ] 将 ChatView 中的状态管理替换为 `useAgentStream({ sessionId })` 的返回值
- [ ] `handleSend` 调用 `sendMessage(content)`
- [ ] `handleStop` 调用 `stopAgent()`
- [ ] `MessageList` 接收 `messages` 和 `activeTools`
- [ ] `Composer` 接收 `isRunning`
- [ ] 编译验证：`pnpm --filter @mimi/webui build` 通过

---

### Phase 8：构建集成 + 端到端验证

#### 任务 8.1：构建流水线

**文件：**
- 修改：`packages/coding-agent/package.json`（build 脚本）
- 修改：根 `package.json`（build 脚本）

**步骤：**

- [ ] 确保 `mimi serve` 启动时，先检查 `packages/server/static/` 是否有 `index.html`，若没有则打印提示 "请先运行 pnpm build:webui"
- [ ] 更新根 package.json 的 build 脚本：`pnpm -r build`（server 和 webui 的 build 脚本已分别在各自 package.json 中定义）
- [ ] 运行 `pnpm build` 验证全量编译通过
- [ ] 提交

---

#### 任务 8.2：端到端手动验证

**步骤：**

- [ ] 终端 1：`pnpm build && node packages/coding-agent/dist/cli.js --serve`
- [ ] 终端 2：浏览器打开 `http://127.0.0.1:32123`
- [ ] 验证首次引导页：显示 SetupView → 输入 API Key → 页面刷新 → 进入聊天
- [ ] 验证聊天流程：输入消息 → agent 回复流式展示 → 工具执行卡片显示状态
- [ ] 验证会话管理：侧边栏显示会话列表 → 新建/切换/删除会话
- [ ] 验证历史消息加载：打开旧会话 → 显示历史消息 → 向上滚动触发分页加载
- [ ] 记录发现的 bug 到 TD Registry

---

## 已知风险点

1. **AgentSession API**：`subscribe`/`prompt`/`abort` 方法的实际签名需在编码时确认，可能与设计文档有偏差
2. **SessionManager API**：`create`/`open`/`list`/`delete`/`getEntries` 的具体方法名需确认
3. **消息 ID 与 cursor**：当前消息条目中是否每个 entry 都有稳定的 `id` 字段用于 cursor 分页，需确认
4. **静态文件路径**：生产环境 `static/` 目录相对于 `dist/` 的路径关系需在 build 配置中验证
