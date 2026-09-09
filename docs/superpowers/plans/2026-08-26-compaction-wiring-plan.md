# 压缩接线计划（照抄 pi · coding-agent 层）

> **面向 AI 代理的工作者：** 逐任务实现此计划，使用复选框（`- [ ]`）跟踪进度。

**目标：** 把原 pi 项目 `packages/coding-agent/src/core/` 里的压缩接线（`AgentSession.compact()` 手动压缩 + 自动压缩触发链路）照抄进本项目 `@mimi/coding-agent`，让当前项目已有的压缩纯函数（`compaction/compaction.ts`）真正被调用起来。

**现状一句话：** 当前项目压缩的「发动机」（`compact` / `prepareCompaction` / `shouldCompact` 等纯函数）已抄齐，但「点火开关」没接——`AgentSession.compact()` 还是 `throw new Error("compact: not yet implemented")` 桩，且没有任何地方调用 `shouldCompact` / `prepareCompaction` / `compact`。

---

## 已确认的 6 个决策

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 范围 | 照抄 pi 的完整循环结构（含自动压缩触发 + 重试检查） |
| 2 | `streamSimple` 判断 | **删掉**（`agent.streamFn` 恒为 `modelRuntime.stream`，`=== streamSimple` 永远 false） |
| 3 | `SessionManager.getBranch()` | **补等价方法**（复用现有 `buildSessionPath` 逻辑，返回当前叶子到根的路径条目） |
| 4 | `settingsManager` 注入 | **新增**（`AgentSessionConfig` 加 `settingsManager` 字段） |
| 5 | 扩展钩子（`session_before_compact` / `session_compact` / `_emitExtensionEvent`） | **删掉**（当前项目无 ExtensionRunner，扩展系统只有 `registerTool`） |
| 6 | `compact()` 签名 | **保持当前 options 风格**（不照抄 pi 的位置参数风格，符合本项目「API 简化」偏好） |

---

## 关键架构差异（必须适配，不能无脑照抄）

原 pi 的 agent-loop 是「一步一 continue」模型：

```
pi:  agent.prompt() 跑一步 → 返回 → AgentSession._handlePostAgentRun() 检查(retry? compact? queued?) → agent.continue() 再跑一步
```

当前项目 `@mimi/agent` 的 `runAgentLoop`（[agent-loop.ts](file:///f:/allProject/githubProject/my-mimipi/packages/agent/src/agent-loop.ts)）是**内部闭环**：

```
当前:  agent.prompt() 内部 while(true) 跑完 工具循环 + follow-up 续命，直到 emit agent_end 才返回
```

**因此 pi 的 `_runAgentPrompt` / `_handlePostAgentRun` 的「分步 while 循环」无法原样照抄**——当前 `agent.prompt()` 返回时已经彻底结束（agent_end 已 emit），不存在「跑一步停下来检查」的中间态。

**适配方案（推荐 A）：**

- 保留当前 `agent.prompt()` 的闭环（工具循环 + follow-up 由 agent 层负责）。
- `AgentSession.prompt()` 里，`await this.agent.prompt(text)` **返回之后**，做一次 post-run 检查：
  1. `_isRetryableError(lastAssistant)` → `_prepareRetry` → `agent.continue()`
  2. `_checkCompaction(lastAssistant)` → 自动压缩 → 按 `willRetry` / `hasQueuedMessages()` 决定是否 `agent.continue()`
- 这等价于 pi 的 `_handlePostAgentRun`，只是「检查点」从「每步之间」收敛到「整个 run 结束后」。

> 备选 B：用 agent-loop 已有的 `prepareNextTurn` 钩子（[agent-loop.ts 阶段 G](file:///f:/allProject/githubProject/my-mimipi/packages/agent/src/agent-loop.ts#L421-L442)，注释已写明「上下文窗口快满时做压缩」）在 agent 层触发压缩。但用户已选「照抄 pi 的 AgentSession 层接线」，故方案 A 为准，B 仅在 A 有阻塞时作为 fallback。

### 第二个适配点：`agent.continue()` 语义

当前 [agent.continue()](file:///f:/allProject/githubProject/my-mimipi/packages/agent/src/agent.ts#L351-L379) 从 assistant 且无 steer/followUp 队列时会 `throw "Cannot continue from message role: assistant"`。而 pi 的 retry 是「移除错误 assistant 消息后 continue」。

**适配：** `_prepareRetry` 里照抄 pi 的做法——先 `messages.pop()` 移除错误 assistant 消息（保留在 session 历史，但移出 context），此时 `messages` 末尾变成 toolResult 或 user，`agent.continue()` 会走 `_runContinuation()` 正常续接，不会 throw。

---

## 要照抄 / 补齐的清单

### 1. 纯函数层（补缺的 helper）

| 函数 | pi 源位置 | 目标位置 | 状态 |
|------|-----------|----------|------|
| `getLatestCompactionEntry(entries)` | `session-manager.ts:312` | 当前 `session-manager.ts` | ❌ 缺 |
| `withoutDeletedHeaders(headers)` | `agent-session.ts:171` | 当前 `agent-session.ts` | ❌ 缺 |
| `estimateMessagesTokens(messages)` | `agent-session.ts:265` | 当前 `agent-session.ts` | ❌ 缺 |
| `formatNoModelSelectedMessage()` | `auth-guidance.ts:18` | 新建 `core/auth-guidance.ts`（或就近放） | ❌ 缺 |
| `formatNoApiKeyFoundMessage(provider)` | `auth-guidance.ts:22` | 同上 | ❌ 缺 |
| `sleep(ms, signal)` | `utils/sleep.ts:4` | 新建 `core/utils/sleep.ts`（或就近放） | ❌ 缺 |
| `isContextOverflow(message, contextWindow)` | `packages/ai/src/utils/overflow.ts`（整文件，含 `OVERFLOW_PATTERNS` / `NON_OVERFLOW_PATTERNS` / `getOverflowPatterns`） | 照抄到 `@mimi/ai/src/utils/overflow.ts` 并导出 | ❌ 缺 |

> 已有（无需补）：`isRetryableAssistantError`（[`@mimi/ai` index.ts:17](file:///f:/allProject/githubProject/my-mimipi/packages/ai/src/index.ts#L17)）、`contentText`（index.ts:23）。

### 2. SessionManager 层

- **补 `getBranch(fromId?)`**：照抄 pi 的 `session-manager.ts:1288`（从 `fromId ?? leafId` 沿 `parentId` 回溯到根，reverse 返回路径条目）。当前项目已有私有 `buildSessionPath(entries, leafId)`（[session-manager.ts:210](file:///f:/allProject/githubProject/my-mimipi/packages/coding-agent/src/core/session-manager.ts#L210)），可直接包装成公开方法。

### 3. AgentSession 层（核心工作量）

**新增字段/依赖：**
- `AgentSessionConfig` 加 `settingsManager: SettingsManager`（构造注入）
- 私有字段 `_lastAssistantMessage: AssistantMessage | undefined`

**新增 getter：**
- `get model()` → `this.agent.state.model`
- `get thinkingLevel()` → `this.agent.state.thinkingLevel`

**新增/实现方法（照抄 pi，做 4 处删减：streamSimple 判断 + 扩展钩子）：**

| 方法 | pi 源行 | 删减 |
|------|---------|------|
| `_getRequiredRequestAuth(model)` | 389 | 无 |
| `_getSummarizationRequestAuth(model)` | 425 | 删 `if (streamFn === streamSimple)` 分支，统一走 `_modelRuntime.getAuth` try-catch 宽容路径 |
| `_disconnectFromAgent()` / `_reconnectToAgent()` | 800 / 811 | 无 |
| `_findLastAssistantMessage()` | 668 | 无 |
| `_isRetryableError(msg)` | 2609 | 无 |
| `_prepareRetry(msg)` | 2619 | 无（依赖 `sleep`） |
| `_checkCompaction(msg, skipAbortedCheck)` | 1931 | 无 |
| `_runAutoCompaction(reason, willRetry)` | 2025 | 删 streamSimple 分支 + 删扩展钩子 |
| `compact(customInstructions?)` | 1767 | 删扩展钩子；`compact()` 调用改用当前 options 风格签名 |
| `abortCompaction()` | 1908 | 无 |
| `abortRetry()` / `isRetrying` / `autoRetryEnabled` / `setAutoRetryEnabled` | 2674 / 2679 / 2684 / 2691 | 无 |
| `setAutoCompactionEnabled(enabled)` / `autoCompactionEnabled` | 2196 / 2201 | 无 |

**改造 `prompt()`：** 在 `await this.agent.prompt(text)` 返回后，接入 post-run 检查（见「关键架构差异」适配方案 A）。

**`_handleAgentEvent` 改造：** 照抄 pi 的 `message_end` 分支——在 `appendMessage` 时同步记录 `_lastAssistantMessage`（role === "assistant" 时）；并在 `agent_end` 后做 post-run 检查（而非 pi 的 `_runAgentPrompt` while 循环）。

### 4. 事件类型扩展

当前 `AgentSessionEvent`（[agent-session.ts:93](file:///f:/allProject/githubProject/my-mimipi/packages/coding-agent/src/core/agent-session.ts#L93-L105)）需补 pi 的 4 个事件：

```ts
| { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
| {
    type: "compaction_end";
    reason: "manual" | "threshold" | "overflow";
    result: CompactionResult | undefined;
    aborted: boolean;
    willRetry: boolean;
    errorMessage?: string;
  }
| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
```

### 5. 依赖注入接线（工厂层）

`agent-session-services.ts` 的 `createAgentSessionFromServices` 与 `sdk.ts` 里 `new AgentSession({...})` 处，需补传 `settingsManager`。

---

## 目标目录结构（变更点）

```
packages/ai/src/
├── utils/overflow.ts            # 🆕 照抄 pi 的 isContextOverflow + OVERFLOW_PATTERNS
└── index.ts                     # 🔧 导出 isContextOverflow / getOverflowPatterns

packages/coding-agent/src/core/
├── session-manager.ts           # 🔧 补 getBranch() + getLatestCompactionEntry()
├── auth-guidance.ts             # 🆕 formatNoModelSelectedMessage / formatNoApiKeyFoundMessage
├── utils/sleep.ts               # 🆕 sleep(ms, signal)
├── agent-session.ts             # 🔧 核心：compact() 实现 + 自动压缩触发 + post-run 检查 + 事件类型
└── agent-session-services.ts    # 🔧 补传 settingsManager
packages/coding-agent/src/sdk.ts # 🔧 补传 settingsManager（若在 sdk 里 new AgentSession）
```

---

## 分步任务

### Task 1 — 补纯函数与 @mimi/ai 的 overflow

- [ ] 照抄 `packages/ai/src/utils/overflow.ts`（整文件，含正则表 + `isContextOverflow` + `getOverflowPatterns`），并在 `@mimi/ai` index.ts 导出 `isContextOverflow` / `getOverflowPatterns`
- [ ] 照抄 `getLatestCompactionEntry` 到 `session-manager.ts`
- [ ] 照抄 `withoutDeletedHeaders` / `estimateMessagesTokens` 到 `agent-session.ts`（模块级纯函数）
- [ ] 新建 `auth-guidance.ts`（两个 format 函数）、`utils/sleep.ts`（sleep）

### Task 2 — SessionManager 补 getBranch

- [ ] 新增公开 `getBranch(fromId?)`，复用现有 `buildSessionPath` 逻辑

### Task 3 — AgentSession 基础 getter + 事件类型 + 依赖注入

- [ ] `AgentSessionConfig` 加 `settingsManager` 字段，构造注入
- [ ] 新增 `model` / `thinkingLevel` getter
- [ ] 扩展 `AgentSessionEvent` 类型（4 个事件）
- [ ] `agent-session-services.ts` / `sdk.ts` 补传 settingsManager

### Task 4 — 手动压缩 compact() + 认证 helper

- [ ] 实现 `_getRequiredRequestAuth` / `_getSummarizationRequestAuth`（删 streamSimple 分支）
- [ ] 实现 `_disconnectFromAgent` / `_reconnectToAgent`
- [ ] 实现 `compact(customInstructions?)`（删扩展钩子，compact 调用用 options 风格签名）
- [ ] 实现 `abortCompaction()`

### Task 5 — 自动压缩触发 + 重试

- [ ] 实现 `_findLastAssistantMessage` / `_isRetryableError` / `_prepareRetry` / `abortRetry` / `isRetrying` / `autoRetryEnabled` / `setAutoRetryEnabled`
- [ ] 实现 `_checkCompaction` / `_runAutoCompaction`（删 streamSimple 分支 + 扩展钩子）
- [ ] 实现 `setAutoCompactionEnabled` / `autoCompactionEnabled`
- [ ] `_handleAgentEvent` 里记录 `_lastAssistantMessage` + agent_end 后触发 post-run 检查
- [ ] `prompt()` 接入 post-run 检查（适配方案 A）

### Task 6 — 验证

- [ ] `pnpm test` 全绿（vitest + tsc）
- [ ] 手动验证：小会话 `compact()` 抛「Nothing to compact」；大会话触发自动压缩；overflow 场景 compact-and-retry

---

## 兼容性差异记录（供 review）

| # | pi 原实现 | 本项目处理 | 理由 |
|---|-----------|-----------|------|
| 1 | `streamSimple` 判断区分认证方式 | 删除，统一走 `modelRuntime.getAuth` | `agent.streamFn` 恒为 `modelRuntime.stream`，判断恒 false |
| 2 | 扩展钩子 `session_before_compact` / `session_compact` | 删除 | 当前无 ExtensionRunner |
| 3 | `_emitExtensionEvent` 在 `_handleAgentEvent` 转发 | 删除 | 同上 |
| 4 | `_runAgentPrompt` while 分步循环 | 收敛为 prompt() 返回后的一次 post-run 检查 | agent-loop 已内部闭环 |
| 5 | `compact()` 位置参数签名 | 保持 options 风格 | 项目「API 简化」偏好 |
| 6 | `formatNoModelSelectedMessage` 等在 auth-guidance.ts | 新建同名文件 | 原项目无此文件 |
| 7 | `sleep` 在 `utils/sleep.ts` | 新建 `core/utils/sleep.ts` | 原项目无此文件 |
