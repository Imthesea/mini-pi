# WebUI 前端系统 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [x]` = 已完成，`- [ ]` = 未完成）语法来跟踪进度。

**目标：** 为 pi 项目新增 Web 前端系统（React + Vite），通过 `@mimi/server` 将 agent 事件桥接到浏览器。

**架构：** 新增 `@mimi/server`（HTTP/WS 服务，依赖 `@mimi/coding-agent`）和 `@mimi/webui`（React 前端，独立包）。server 订阅 AgentSessionEvent 并透传到 WebSocket，前端通过 WebSocket 接收实时事件流 + REST API 做会话管理。

**技术栈：** TypeScript, Node.js http + ws, React 18, Vite 5, Tailwind CSS 3, shadcn/ui, react-markdown

**参考设计文档：** `docs/superpowers/specs/2026-08-11-webui-design.md`

---

## 进度总览

| Phase | 状态 | 说明 |
|-------|------|------|
| Phase 1 | ✅ 完成 | 项目脚手架（server + webui + coding-agent CLI） |
| Phase 2 | ✅ 完成 | HTTP 核心（auth + 静态文件 + 路由） |
| Phase 3 | ✅ 完成 | WebSocket + AgentSession 桥接 |
| Phase 4 | ✅ 完成 | REST API（sessions CRUD + setup） |
| Phase 5 | ✅ 完成 | 前端基础框架（UI 组件 + App Shell + 路由） |
| Phase 6 | ✅ 完成 | 聊天组件（MarkdownRenderer + MessageBubble + Composer + ChatView） |
| Phase 7 | ✅ 完成 | WebSocket 集成（api/client/useWebSocket + useAgentStream + ChatView 接入） |
| Phase 8 | ✅ 完成 | 构建集成 + 端到端验证（待用户手动验证） |

---

## 文件结构总览

```
packages/server/
├── package.json, tsconfig.json
└── src/
    ├── index.ts              # startServer() 入口
    ├── cli-entry.ts          # mimi-serve CLI 入口（bin）
    ├── app.ts                # HTTP + WS 应用组装
    ├── ws-server.ts          # WebSocket 连接管理
    ├── agent-bridge.ts       # AgentSession 订阅 → WS 转发
    ├── auth.ts               # HMAC-SHA256 token 签发/验证
    ├── static-handler.ts     # 托管 webui/ 构建产物
    ├── __tests__/
    │   ├── auth.test.ts      # 5 tests
    │   └── ws-server.test.ts # 2 tests
    └── routes/
        ├── auth.ts           # POST /api/auth
        ├── sessions.ts       # POST/GET/DELETE /api/sessions, GET /api/sessions/:id/messages
        └── setup.ts          # GET /api/setup/status, POST /api/setup/apikey

packages/webui/
├── package.json, tsconfig.json, vite.config.ts
├── tailwind.config.ts, postcss.config.js, index.html
└── src/
    ├── main.tsx, App.tsx, globals.css, test-setup.ts
    ├── components/
    │   ├── chat/    (ChatView, MessageList, MessageBubble, Composer, ToolCard)
    │   ├── sidebar/ (Sidebar, SessionList)
    │   ├── setup/   (SetupView)
    │   ├── ui/      (button, input, textarea, separator)
    │   └── MarkdownRenderer.tsx
    ├── hooks/   (useAgentStream, useSessions, useWebSocket)
    └── lib/      (client.ts, api.ts, types.ts)

packages/coding-agent/src/
├── cli/args.ts           # CLI 参数解析（不再含 --serve/--port）
├── main.ts               # 主入口（不再含 serve 模式分支）
└── serve-options.ts      # ServeOptions 类型定义（供 @mimi/server 导入）
```

---

### Phase 1：项目脚手架

#### 任务 1.1：创建 @mimi/server 包

**文件：**
- 创建：`packages/server/package.json`
- 创建：`packages/server/tsconfig.json`

**步骤：**

- [x] 创建 `packages/server/package.json`，name `@mimi/server`，type `module`，依赖 `@mimi/coding-agent: workspace:*` 和 `ws: ^8.18.0`，devDependencies 含 `@types/node`、`@types/ws`、`typescript`、`vitest`
- [x] 创建 `packages/server/tsconfig.json`，extends `../../tsconfig.base.json`，outDir `./dist`，rootDir `./src`，references `../coding-agent`
- [x] 运行 `pnpm install` 安装依赖
- [x] 提交：`git add packages/server/ && git commit -m "feat: scaffold @mimi/server package"`

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

- [x] 创建 package.json，含 react 18、react-dom、react-markdown、remark-gfm、clsx、tailwind-merge、class-variance-authority。devDeps 含 vite、@vitejs/plugin-react、tailwindcss、postcss、autoprefixer、vitest、@testing-library/react、jsdom、lucide-react
- [x] 创建 tsconfig.json，target ES2022，jsx react-jsx，paths `@/*` → `./src/*`，noEmit true
- [x] 创建 vite.config.ts，plugins [react()]，alias `@` → `./src`，build outDir `../server/static`，server proxy `/api` 和 `/ws` 到 `127.0.0.1:32123`
- [x] 创建 tailwind.config.ts（content 含 `./index.html` 和 `./src/**/*.{js,ts,jsx,tsx}`）、postcss.config.js（tailwindcss + autoprefixer）
- [x] 创建 index.html（`<div id="root">` + module script `main.tsx`）
- [x] 创建占位 `src/main.tsx`（渲染 "mimi WebUI"）、`src/globals.css`（tailwind directives + CSS 变量）和 `src/test-setup.ts`（jest-dom import）
- [x] 运行 `pnpm install && pnpm --filter @mimi/webui build`，验证 Vite 构建成功
- [x] 提交

> **偏差说明：** `postcss.config.js` 必须用 .js（PostCSS 不支持 .ts）。webui 包额外新增 `src/test-setup.ts`（jest-dom）。`tailwind.config.js` 最终用 `.ts`。

---

#### 任务 1.3：在 coding-agent CLI 中新增 `mimi serve` 命令入口

**文件：**
- 修改：`packages/coding-agent/src/cli/args.ts`
- 创建：`packages/coding-agent/src/server-entry.ts`
- 修改：`packages/coding-agent/src/main.ts`
- 修改：`packages/coding-agent/package.json`

**步骤：**

- [x] 在 `args.ts` 的 `Args` 接口中新增 `serve?: boolean` 和 `port?: number`。在 `parseArgs()` switch 中新增 `--serve` 和 `--port <num>` case
- [x] 在 `args.ts` 的 `printHelp()` 中添加 `--serve` 和 `--port` 帮助文本
- [x] 创建 `packages/coding-agent/src/server-entry.ts`：导出 `ServeOptions` 接口（`{ port, cwd, settingsManager, sessionManager }`）和 `startServe()` 函数（动态 `import("@mimi/server")` 并调用 `startServer`）
- [x] 在 `main.ts` 的 `main()` 中，检查 `parsed.serve` → 调用 `startServe()` 并 return
- [x] 在 `packages/coding-agent/package.json` 中添加 `"@mimi/server": "workspace:*"` 依赖
- [x] 运行 `pnpm install`；验证编译：`pnpm --filter @mimi/coding-agent build`
- [x] 提交

> **偏差说明：**
> - `ServeOptions` 接口实际参数在 Phase 3 扩展了 `services: AgentSessionServices` 字段
> - `coding-agent/package.json` 额外添加了 `"main": "./dist/index.js"`，因为 Node.js 解析 workspace 包需要该字段
> - **2026-08-11 重构**：`mimi serve` CLI 入口从 `coding-agent` 移到 `@mimi/server`（`server/src/cli-entry.ts`），`ServeOptions` 留在 `coding-agent/src/serve-options.ts`。循环 workspace 依赖已消除

---

### Phase 2：@mimi/server HTTP 核心

#### 任务 2.1：HMAC-SHA256 Token 签发与验证

**文件：**
- 创建：`packages/server/src/auth.ts`
- 创建：`packages/server/src/__tests__/auth.test.ts`

**步骤：**

- [x] 实现 `createAuth()`：返回 `issueToken()`（签发 5 分钟有效期的 HMAC-SHA256 签名 token）、`validateToken()`、`shouldRefresh()`。用 `crypto.randomUUID` 做 secret，`crypto.createHmac("sha256")` 签名，`timingSafeEqual` 防时序攻击。token 格式为 `base64url(JSON).base64url(sig)`
- [x] 编写 vitest 测试（5 tests）：验证签发/验证流程，验证无效 token 被拒绝
- [x] 运行 `pnpm --filter @mimi/server test`，全部 PASS
- [x] 提交

> **偏差说明：** 计划标题写 "JWT 签发与验证"，但实际实现使用 HMAC-SHA256 签名（非标准 JWT 格式），更简单且满足 v1 需求。token 格式为 `base64url(JSON).base64url(sig)`，无 JWT header。

---

#### 任务 2.2：HTTP 路由分发 + /api/auth + 静态文件托管

**文件：**
- 创建：`packages/server/src/app.ts`
- 创建：`packages/server/src/routes/auth.ts`
- 创建：`packages/server/src/static-handler.ts`
- 创建：`packages/server/src/index.ts`

**步骤：**

- [x] 实现 `routes/auth.ts`：`POST /api/auth` 调用 `issueToken()` 返回 `{ token, expires_in }`
- [x] 实现 `static-handler.ts`：`handleStatic(req, res, url)` 将非 `/api/` 的 GET 请求路由到 `../static/` 目录（SPA fallback：非文件路径返回 index.html）。支持 MIME 类型映射，路径穿越防护
- [x] 实现 `app.ts`：`createApp(deps)` 返回 `handleRequest(req, res)`。设置 CORS 头，OPTIONS 预检返回 204，路由 `/api/auth`、其他 `/api/*`（占位 404）、静态文件
- [x] 实现 `index.ts`：`startServer(options)` 创建 `http.createServer`（WebSocket 升级在 Phase 3 补充），监听 `127.0.0.1:${port}`，打印 URL
- [x] 运行 `pnpm --filter @mimi/server build`，编译通过
- [x] 提交

> **偏差说明：**
> - `AppDeps` 实际字段为 `{ auth, wsServer, agentBridge, sessionManager, cwd }`，计划中列了 `settingsManager` 但 app.ts 中不需要（settingsManager 仅在 index.ts 的 WebSocket 升级时用于获取默认 model/thinkingLevel）
> - Phase 2 的 `index.ts` 仅创建 `http.createServer`，`WebSocketServer` 和 upgrade 处理在 Phase 3 中集成

---

### Phase 3：WebSocket + Agent 桥接

#### 任务 3.1：WebSocket 连接管理

**文件：**
- 创建：`packages/server/src/ws-server.ts`
- 创建：`packages/server/src/__tests__/ws-server.test.ts`

**步骤：**

- [x] 实现 `createWsServer(callbacks)`：管理 `Set<WebSocket>` 连接集合。`send(ws, event)` 序列化 JSON 发送，`handleConnection(ws, req)` 处理 message/close/error 事件。定义 `ClientMessage` 类型为 `{ type: "message", content: string } | { type: "stop" }`
- [x] 编写测试（2 tests）：验证 send 正确序列化 JSON
- [x] 运行测试，全部 PASS
- [x] 提交

---

#### 任务 3.2：Agent 桥接

**文件：**
- 创建：`packages/server/src/agent-bridge.ts`
- 修改：`packages/coding-agent/src/core/index.ts`（如需要）

**步骤：**

- [x] 确认 `packages/coding-agent/src/core/index.ts` 导出了 `createAgentSessionFromServices`（新增）。同时在 `packages/coding-agent/src/index.ts` 中新增 `AgentSession`、`AgentSessionServices`、`SettingsManager`、`createAgentSessionFromServices`、`ServeOptions` 导出
- [x] 实现 `createAgentBridge(wsServer)`：`bindSession(ws, session)` 调用 `session.subscribe(listener)` 将事件转发到 WS；`unbindSession(ws)` 取消订阅并删除 WeakMap 映射；`getSession(ws)` 从 WeakMap 查询绑定关系。`sendMessage` 和 `stopAgent` 逻辑直接写在 `index.ts` 的 `onMessage` 回调中（非 agent-bridge 方法）
- [x] 编译验证

> **偏差说明：**
> - 计划中 `createAgentBridge` 包含 `sendMessage(session, content)` 和 `stopAgent(session)` 方法，但实际消息转发逻辑直接写在 `index.ts` 的 `onMessage`/`onClose` 回调中 —— agent-bridge 只负责绑定/解绑/查询
> - 使用 `WeakMap<WebSocket, AgentSession>` 管理 WS ↔ Session 映射（计划未指定数据结构）
> - `ServeOptions` 接口新增 `services: AgentSessionServices` 字段，因为 open 会话后需要通过 `createAgentSessionFromServices()` 创建 AgentSession（传 services + sessionManager），需在 server 入口可访问 services

---

#### 任务 3.3：整合 WS + Agent 到 index.ts

**文件：**
- 修改：`packages/server/src/index.ts`
- 修改：`packages/server/src/app.ts`

**步骤：**

- [x] 更新 `app.ts`：`AppDeps` 新增 `wsServer`、`agentBridge`（`settingsManager` 不在 app.ts 中使用，仅在 index.ts 中使用）
- [x] 更新 `index.ts`：在 `httpServer.on("upgrade")` 中处理 WebSocket 升级（路径 `/ws?session=xxx`），回调中：通过 `SessionManager.list(cwd)` 查找会话 → `SessionManager.open(info.path)` 打开文件 → `createAgentSessionFromServices()` 创建 AgentSession → `agentBridge.bindSession()` 绑定 → `wsServer.handleConnection()` 注册消息/关闭处理
- [x] 编译验证：`pnpm --filter @mimi/server build` 通过

> **偏差说明：** 计划将 3.1/3.2/3.3 分三步，但实际实现时 3.3 的整合逻辑与 3.1/3.2 在同一轮完成（index.ts 在 Phase 3 一次性完成 WebSocket 升级 + agent 桥接 + 消息处理的完整集成）

---

### Phase 4：REST API

#### 任务 4.1：会话 API（列表、创建、删除、分页）

**文件：**
- 创建：`packages/server/src/routes/sessions.ts`

**步骤：**

- [x] 实现 `handleSessions(req, res, url, deps)`：
  - `POST /api/sessions` → `deps.sessionManager.create(cwd)` → 返回 `{ id }`
  - `GET /api/sessions` → `deps.sessionManager.list(cwd)` → 返回 `[{ id, title, messageCount, firstMessage, cwd }]`
  - `DELETE /api/sessions/:id` → `SessionManager.list(cwd)` 查找 → `fs.unlinkSync(info.path)` 删除文件 → `{ ok: true }`
  - `GET /api/sessions/:id/messages` → 解析 `limit` 和 `before` 参数，cursor 分页。通过 `SessionManager.open(info.path)` 打开 → `sessionManager.getEntries()` 过滤 `type === "message"`，返回 `{ messages, hasMore, oldestId }`
- [x] 编译验证

> **偏差说明（多项与计划不一致）：**
> - **`SessionManager.create(cwd)`**：实际方法接收 `cwd` 参数，返回 `{ id }`（非 SessionManager 实例）
> - **`SessionManager.list(cwd)`**：是静态 async 方法，返回 `SessionInfo[]`（含 `path`、`id`、`cwd`、`messageCount`、`firstMessage`），非 `[{ id, title }]`
> - **`SessionManager.open(path)`**：通过**文件路径**打开（非 sessionId），返回 SessionManager 实例（非 AgentSession）；AgentSession 需额外通过 `createAgentSessionFromServices()` 创建
> - **无 `SessionManager.delete()` 方法**：删除通过 `SessionManager.list()` 拿到 `info.path` 后用 `fs.unlinkSync(info.path)` 直接删除文件
> - **`getEntries()`**：是 SessionManager 实例的同步方法，返回 `FileEntry[]`（含 header + 所有条目），需过滤 `type === "message"` 获取消息
> - **认证**：V1 版本的 sessions/setup 路由 **未验证 Authorization header**，简化实现（v1 localhost 免密）

---

#### 任务 4.2：Setup API

**文件：**
- 创建：`packages/server/src/routes/setup.ts`

**步骤：**

- [x] 实现 `handleSetup(req, res, url, deps)`：
  - `GET /api/setup/status` → 检测 `process.env` 中 `MIMI_API_KEY_DEEPSEEK|_ANTHROPIC|_OPENAI`，返回 `{ hasApiKey: boolean }`
  - `POST /api/setup/apikey` → 通过 `req.on('data')`/`req.on('end')` 读取 body → 解析 `{ apiKey }` → 写入 `MIMI_API_KEY_DEEPSEEK=<key>` 到 `cwd/.env` → `{ ok: true }`
- [x] 编译验证
- [x] 整体编译：`pnpm --filter @mimi/server build` 通过

> **偏差说明：**
> - body 解析方式：计划写 "解析 body `{ apiKey }`"，实际使用 Node.js 原生 `req.on('data')`/`req.on('end')` 事件读取原始 body（无第三方 body parser）
> - API Key 检测仅查 `process.env`（计划写了 "`.env` 文件"，但 setup status 实际不读 .env 文件内容，只检查环境变量是否已加载）

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

- [x] `utils.ts`：导出 `cn()` 函数（clsx + tailwind-merge 合并类名）
- [x] `button.tsx`：`<Button>` 组件，支持 `variant`（default/ghost/outline）和 `size`（sm/default/lg），使用 `React.forwardRef`
- [x] `input.tsx`：`<Input>` 组件，标准 input 样式，`React.forwardRef`
- [x] `textarea.tsx`：`<Textarea>` 组件，`React.forwardRef`
- [x] `separator.tsx`：`<Separator>` 组件，支持 `orientation`
- [x] 编译验证

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

- [x] 更新 `globals.css`：补充 `--muted`、`--muted-foreground` CSS 变量，自定义滚动条样式
- [x] 创建 `types.ts`：定义 `ChatMessage`（id, role, content, thinkingContent?）、`ToolCallState`（toolCallId, toolName, status, args?）
- [x] 创建 `SetupView`：居中卡片布局，包含 MIMI Logo 文字、API Key 输入框、"开始使用"按钮。调用 `POST /api/setup/apikey` 后 `window.location.reload()`
- [x] 创建 `Sidebar` + `SessionList`：Sidebar 为固定宽度侧边栏容器（w-64），SessionList 渲染会话列表（id + 删除按钮），底部"新建会话"按钮。Props：`sessions`、`activeSessionId`、`onNewSession`、`onSelectSession`、`onDeleteSession`
- [x] 实现 `App.tsx` 状态机：
  - 启动时 `fetch("/api/setup/status")` → 无 key → `setup` 状态 → 渲染 `SetupView`
  - 有 key → `chat` 状态 → 渲染 `Sidebar` + `ChatView`（占位空 div）
  - 使用 `location.hash` 管理当前激活会话（`#/chat/:id`），监听 `hashchange`
- [x] 更新 `main.tsx`：`React.StrictMode` + `App`
- [x] 编译验证：`pnpm --filter @mimi/webui build` 通过

---

### Phase 6：聊天组件

#### 任务 6.1：MarkdownRenderer

**文件：**
- 创建：`packages/webui/src/components/MarkdownRenderer.tsx`

**步骤：**

- [x] 实现 `MarkdownRenderer`：使用 `react-markdown` + `remark-gfm`。自定义 `pre`（bg-muted rounded p-3 overflow-x-auto）和 `code`（inline: bg-muted px-1 rounded）组件
- [x] 编译验证

---

#### 任务 6.2：MessageBubble + ToolCard

**文件：**
- 创建：`packages/webui/src/components/chat/MessageBubble.tsx`
- 创建：`packages/webui/src/components/chat/ToolCard.tsx`

**步骤：**

- [x] 实现 `MessageBubble`：user 消息右对齐（bg-foreground text-background），assistant 消息左对齐（bg-muted）。thinking block 默认折叠，点击展开。assistant 内容用 MarkdownRenderer，user 内容纯文本
- [x] 实现 `ToolCard`：显示状态图标（running ⏳ / done ✅ / error ❌）+ 工具名（font-mono），不同状态不同颜色
- [x] 编译验证

---

#### 任务 6.3：Composer + MessageList + ChatView

**文件：**
- 创建：`packages/webui/src/components/chat/Composer.tsx`
- 创建：`packages/webui/src/components/chat/MessageList.tsx`
- 创建：`packages/webui/src/components/chat/ChatView.tsx`

**步骤：**

- [x] `Composer`：`<Textarea>` + `<Button>`（Send/Stop 图标用 lucide-react）。Enter 发送，Shift+Enter 换行。isRunning 时显示 Stop 按钮并禁用输入
- [x] `MessageList`：渲染 MessageBubble 列表 + 活跃 ToolCard。底部 ref 自动 scrollIntoView
- [x] `ChatView`：组合 MessageList + Composer，管理 messages/activeTools/isRunning 状态。handleSend 创建 userMsg 并追加到 messages（WebSocket 集成在 Phase 7）
- [x] 编译验证：`pnpm --filter @mimi/webui build` 通过

---

### Phase 7：WebSocket 集成

#### 任务 7.1：WebSocket 客户端 + useWebSocket

**文件：**
- 创建：`packages/webui/src/lib/api.ts`
- 创建：`packages/webui/src/lib/client.ts`
- 创建：`packages/webui/src/hooks/useWebSocket.ts`

**步骤：**

- [x] `api.ts`：管理 `token` 变量。`authenticate()` → POST /api/auth → 保存 token。`request(path, options)` 封装 fetch 并注入 Authorization header
- [x] `client.ts`：`createWsClient()` 返回 `{ connect(url), send(msg), close(), onEvent(handler) }`。自动重连（2s 间隔），onEvent 管理 handler Set
- [x] `useWebSocket({ sessionId })`：useEffect 中先 `authenticate()`，然后构造 WS URL（`ws://host/ws?session=...`）并 connect。cleanup 时 close。返回 `{ send, onEvent }`
- [x] 编译验证

---

#### 任务 7.2：useAgentStream Hook

**文件：**
- 创建：`packages/webui/src/hooks/useAgentStream.ts`

**步骤：**

- [x] 实现 `useAgentStream({ sessionId })`：
  - 用 `useWebSocket` 建立连接
  - useEffect 加载历史消息：`fetch(/api/sessions/:id/messages?limit=50)` → setMessages
  - `onEvent` 监听 WS 事件：
    - `message_start` → 创建新消息到 messages，如果是 assistant 设为 "streaming"
    - `message_update` → 用 `requestAnimationFrame` 批处理：同一帧内多次 update 合并为一次 setState。更新 streamingContent / thinkingContent
    - `message_end` → 标记消息完成
    - `tool_execution_start` → 添加 ToolCallState（status: running）
    - `tool_execution_end` → 更新 ToolCallState（status: done/error）
    - `agent_end` → 用 `agent_end` 代替计划中的 `agent_settled`（实际事件类型），`!willRetry` 时 setIsRunning(false)
  - `sendMessage(content)` → ws.send({ type: "message", content })
  - `stopAgent()` → ws.send({ type: "stop" })
  - 返回 `{ messages, activeTools, isRunning, sendMessage, stopAgent, loadMore }`
- [x] 编译验证

> **偏差说明：** 计划中使用 `agent_settled` 事件，但实际 AgentSessionEvent 中该事件名为 `agent_end`（含 `willRetry` 字段）。使用 `agent_end` + `!willRetry` 判断 agent 运行完成。

---

#### 任务 7.3：ChatView 接入 useAgentStream

**文件：**
- 修改：`packages/webui/src/components/chat/ChatView.tsx`

**步骤：**

- [x] 将 ChatView 中的状态管理替换为 `useAgentStream({ sessionId })` 的返回值
- [x] `handleSend` 调用 `sendMessage(content)`
- [x] `handleStop` 调用 `stopAgent()`
- [x] `MessageList` 接收 `messages` 和 `activeTools`
- [x] `Composer` 接收 `isRunning`
- [x] 编译验证：`pnpm --filter @mimi/webui build` 通过

---

### Phase 8：构建集成 + 端到端验证

#### 任务 8.1：构建流水线

**文件：**
- 修改：`packages/coding-agent/package.json`（build 脚本）
- 修改：根 `package.json`（build 脚本）

**步骤：**

- [x] 确保 `mimi-serve` 启动时，先检查 `packages/server/static/` 是否有 `index.html`，若没有则打印提示 "请先运行 pnpm --filter @mimi/webui build"
- [x] 根 package.json build 脚本无需修改（已有 `pnpm -r build`）
- [x] 运行 `pnpm build` 验证全量编译通过（6 包全部通过）

> **偏差说明：** Phase 1.3 重构后 CLI 入口从 `mimi --serve` 变为 `npx mimi-serve`，启动命令相应调整。

---

#### 任务 8.2：端到端手动验证

**步骤：**（以下由用户手动执行）

- [ ] 终端 1：`pnpm build && npx mimi-serve`
- [ ] 终端 2：浏览器打开 `http://127.0.0.1:32123`
- [ ] 验证首次引导页：显示 SetupView → 输入 API Key → 页面刷新 → 进入聊天
- [ ] 验证聊天流程：输入消息 → agent 回复流式展示 → 工具执行卡片显示状态
- [ ] 验证会话管理：侧边栏显示会话列表 → 新建/切换/删除会话
- [ ] 验证历史消息加载：打开旧会话 → 显示历史消息 → 向上滚动触发分页加载
- [ ] 记录发现的 bug 到 TD Registry

---

## 已知风险点

> 以下风险点在 Phase 1-4 实现过程中已全部核实，状态更新：

1. ~~**AgentSession API**~~ → ✅ 已确认：`subscribe`/`prompt`/`abort` 方法与计划一致
2. ~~**SessionManager API**~~ → ✅ 已确认，但与计划有多项偏差：
   - `create(cwd)` 接收 cwd 参数
   - `open(path)` 通过文件路径打开（非 sessionId），返回 SessionManager 实例
   - `list(cwd)` 是静态 async 方法
   - **无 `delete()` 方法**（用 `fs.unlinkSync(info.path)` 替代）
   - 详见 Phase 4.1 偏差说明
3. ~~**消息 ID 与 cursor**~~ → ✅ 已确认：每个 entry 有稳定的 `id` 字段，可用于 cursor 分页
4. ~~**静态文件路径**~~ → ✅ 已确认：`static-handler.ts` 中 `../static/` 相对于 `dist/` 的路径关系正确
5. ~~**循环 workspace 依赖**~~ → ✅ 已解决（2026-08-11）：将 `mimi serve` CLI 入口从 `coding-agent` 移到 `@mimi/server`（新文件 `server/src/cli-entry.ts`），删除 `coding-agent/src/server-entry.ts`，依赖方向变为单向 `server → coding-agent`。`ServeOptions` 类型留在 `coding-agent/src/serve-options.ts`
