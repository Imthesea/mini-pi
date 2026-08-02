# Phase 02: Agent 层 — 实施日志

> 开始: 2026-07-30
> 配套: [设计 Spec](../specs/2026-07-30-phase02-agent-design.md) · [实施 Plan](../plans/2026-07-30-phase02-agent-plan.md)
> 上游: [Phase 01 AI 层](../../project-log/phase-01-ai-core/log.md) ✅ 已完成

## 进度总览

| Task | 标题 | 状态 | 完成日期 | Commit |
|------|------|------|----------|--------|
| 1 | 包骨架 + types.ts | ✅ | 2026-07-30 | (Task 1 前) |
| 2 | 核心 agent-loop 循环 | ✅ | 2026-07-30 | `9f6be26` |
| 3 | AgentHarness 主类 (skeleton + messages + system-prompt) | ✅ | 2026-07-30 | `736d060` |
| 4 | 钩子系统 (hooks + emit + handlers) | ✅ | 2026-07-31 | (含 `2253875` 修复) |
| 5 | Session 双后端 (session + repos + env/nodejs) | ✅ | 2026-07-31 | `e2e325b` |
| 6 | 压缩 + 分支摘要 (compaction) | ✅ | 2026-07-31 | `8594b4a` |
| 7 | Skills + Prompt Templates | ✅ | 2026-07-31 | `54b7707` |
| 8 | 队列操作 + 自定义消息示例 | ✅ | 2026-08-01 | `d61e9a0` |
| 9 | 文档输出 (5 篇中文文档) | ✅ | 2026-08-01 | `9f29334` |
| 10 | 全量验证 + Phase 02 收尾 | ✅ | 2026-08-01 | (即将提交) |

## 文档节奏约定

每完成一个 Task 追加一个 section 到本文件,记录:
- 实际产出
- 实施偏差（与 plan 的差异及原因）
- 验证结果
- 遗留问题

Task 9/10 的最终文档/日志以本文件为基础合并。

---

## Task 1: 包骨架 + types.ts ✅ 2026-07-30

### 实际产出

- `packages/agent/package.json` — name `@mimi/agent`, 依赖 `@mimi/ai` workspace + `typebox 1.1.38`
- `packages/agent/tsconfig.json` — 继承 `tsconfig.base.json`
- `packages/agent/vitest.config.ts` — 测试路径含 `__tests__/` 和 `src/`
- `packages/agent/src/types.ts` — 15 个核心类型 (~400 行),从 pi `packages/agent/src/types.ts` 翻译
- `packages/agent/src/index.ts` — 公共 API 导出
- `packages/agent/__tests__/types.test.ts` — 18 个测试用例

### 实施偏差

| # | 计划 | 实际 | 原因 |
|---|------|------|------|
| 1 | 步骤 1-4: 测试→类型→index→跑测试;步骤 5-6: 写 package.json + tsconfig + vitest.config + pnpm install | 调整为: 步骤 1: 写 package.json + tsconfig + vitest.config; 步骤 2: pnpm install; 步骤 3: 写测试; 步骤 4: 写类型; 步骤 5: 写 index; 步骤 6: 跑测试 | 原顺序中,没有 package.json 时 vitest 无法工作,`pnpm test` 立刻会因 "找不到包" 而失败(不是我们要的红)。先把骨架建好,再写测试-写实现-跑绿,才能体现真正的 TDD 循环 |
| 2 | `pnpm test` = `vitest run` | 改为 `vitest run && tsc --noEmit` | esbuild 会剥离 `import type`,单独 vitest 无法检测类型错误。加上 tsc 后,`pnpm test` 失败/通过才能真正反映"红→绿" |
| 3 | index.ts 只 re-export types | 额外 re-export 了 9 个 `@mimi/ai` 常用类型(`AssistantMessage` / `Context` / `Message` / `Model` / `TextContent` / `ThinkingContent` / `Tool` / `ToolResultMessage` / `UserMessage`) | 上层用户(后续 harness / coding-agent)不需要再额外 import `@mimi/ai`,减少样板 |
| 4 | types.ts 删除 `Agent` 类相关引用 | 已删除 `AgentState` 等 pi agent.ts 专用类型 | 符合 plan "完整优先于精简" 中的"只保留共用部分"原则 |
| 5 | `dist/` 默认排除在 include 外 | 已正确配置,`pnpm build` 生成 dist/{index,types}.{js,d.ts,map} | — |

### 类型清单

**15 个类型**全部从 pi 翻译:

1. `ThinkingLevel` — 7 个等级
2. `ToolExecutionMode` — 顺序/并行
3. `QueueMode` — 队列模式
4. `AgentToolCall` — AssistantMessage 里的 tool call 块
5. `AgentToolResult<T>` — 工具结果
6. `AgentToolUpdateCallback<T>` — 工具增量更新回调
7. `AgentTool<TParameters, TDetails>` — 工具定义
8. `AgentContext` — LLM 调用前的快照
9. `CustomAgentMessages` — 声明合并空接口
10. `AgentMessage` — LLM 消息 + 自定义消息联合
11. `BeforeToolCallResult` / `AfterToolCallResult` — 钩子返回值
12. `BeforeToolCallContext` / `AfterToolCallContext` / `ShouldStopAfterTurnContext` / `PrepareNextTurnContext` — 钩子入参
13. `AgentLoopTurnUpdate` — 下一 turn 状态覆盖
14. `AgentEvent` — 10 个事件变体
15. `StreamFn` / `AgentLoopConfig` — agent-loop 配置

### 测试清单（18 个）

- `AgentContext` 必填字段 (2)
- `AgentEvent` type 联合 + payload 形状 (2)
- `CustomAgentMessages` 默认空 + 声明合并 (2)
- `AgentMessage` 是 LLM 消息联合 (1)
- `AgentTool` parameters 是 TypeBox + execute 签名 (2)
- `QueueMode` 联合 (1)
- `ThinkingLevel` 联合 (1)
- `ToolExecutionMode` 联合 (1)
- `AgentToolResult` + `AgentToolUpdateCallback` (2)
- `AgentLoopConfig` 必填 + 9 个可选钩子 (2)
- `BeforeToolCallResult` / `AfterToolCallResult` (2)

### 验证结果

```bash
$ pnpm test
✓ __tests__/types.test.ts  (18 tests) 11ms
Test Files  1 passed (1)
Tests  18 passed (18)
tsc --noEmit: 0 errors

$ pnpm -r test
packages/ai test:  Tests  51 passed (51)
packages/agent test: Tests  18 passed (18)

$ pnpm build
$ # dist/ 生成 {index,types}.{js,d.ts,map}
```

### 遗留问题

- 无

### 提交状态

- 改完未提交（按用户偏好,等审查后再 commit）

---

## Task 2-7: 批量补登(2026-07-31)

> 说明:Task 2-7 已陆续完成但未在 log 中追加 section。本节批量补登核心信息,
> 详细实施细节见 [实施 Plan](../plans/2026-07-30-phase02-agent-plan.md) 对应 Task 完成备注。

### Task 2 ✅ agent-loop 核心循环(commit `9f6be26`)

- 翻译自 pi `packages/agent/src/agent-loop.ts` (~792 行)
- 物理拆分到 10 个文件:`loop/{stream-assistant,tool-execution,helpers,tool-validation}.ts` + `loop/tool-execution/{sequential,parallel,prepare,execute,finalize,truncate,types}.ts`
- 最大单文件 180 行(低于 500 软上限)
- 公共 API 入口 `agent-loop.ts` ~200 行,只做编排
- example `01-basic.ts` 用 mock provider 跑通(后已切换到真实 API)

### Task 3 ✅ AgentHarness 主类(commit `736d060`,含 Task 3.5 TD-001 清理)

- 实际 12 个源文件:`harness/{agent-harness/agent-harness,event-bus,helpers,phase}.ts` + `harness/messages/{convert,assistant,custom}.ts` + `harness/system-prompt/{build,parts,index}.ts` + `harness/types/{harness,events,options}.ts` + `harness/index.ts`
- **重构决策**:从"3 文件拆 config / prompt"合并为单 `agent-harness.ts` 394 行(`Object.assign` + `declare module` 模式可读性差)
- 修了 12 个 pre-existing 错误(StreamFn import / AgentTool 不匹配 / 联合 narrow)
- `vitest` 218 / 218 通过,`tsc` 0 错误

### Task 4 ✅ 钩子系统(commit `736d060` 后,含 `2253875` 修复)

- 8 个核心事件 + 9 个预声明事件(`hooks/types.ts` 296 行)
- 5 种语义纯函数合并到 `hooks/semantics.ts` 265 行(避免"为对称而拆")
- `default-hooks.ts` 257 行(主类 + dispatch + cleanup 紧密耦合不分离)
- 11 个事件 emit 点接入 `agent-harness.ts`(`+agent-harness.ts` 53 行)
- 修复:`tool_call` hook 携带 `toolCall` 上下文 + `subscribe` cancel 修 bug(`2253875`)

### Task 5 ✅ Session 双后端(commit `e2e325b`)

- 14 个源文件 + 10 个测试文件
- 11 种 `SessionTreeEntry` 联合(`session/types.ts` 259 行)
- Session 主类含 fork 合并到 `session.ts` 355 行(低于 500 软上限)
- 双后端:`InMemorySessionStorage` + `JsonlSessionStorage`(header + appendFile 同步落盘)
- `NodeExecutionEnv` 387 行(readFile / writeFile / exec 等)
- example `03-session.ts` 8 阶段演示
- `vitest` 366 / 366 通过

### Task 6 ✅ 压缩 + 分支摘要(commit `8594b4a`)

- 7 个 compaction 源文件(`compaction/{types,settings,estimate,prepare,branch-summarization,compact,index}.ts`)
- 4 个子文件从 `agent-harness.ts` 抽出:`compaction-ops.ts` / `turn-execution.ts` / `hook-context-builder.ts` / `subscription-factory.ts`
- `compact.ts` 内联 `extractFileOpsFromMessage` + `shouldCompact` 合并入 `settings.ts`(避免"为拆而拆")
- example `04-compaction.ts` 用真实 DeepSeek API 跑通
- `vitest` 422 / 422 通过

### Task 7 ✅ Skills + Prompt Templates(commit `54b7707`)

- 8 个源文件:`skills/{types,format,load,errors,index}.ts` + `prompt-templates/{types,format,index}.ts`
- 2 个子文件从 `agent-harness.ts` 抽出:`skill-ops.ts` + `is-agent-harness.ts`
- Skill frontmatter YAML 极简解析(不引 yaml 库,避免依赖)
- 占位符语法统一 `{{name}}`(skills + templates 共用)
- 2 个 example 全部用真实 DeepSeek API
- `vitest` 450 / 450 通过(vitest 34 文件 + tsc 0 错误)

### 累计行数与规模(2026-07-31 Task 7 末尾)

- 源文件数:71 个(其中 8 个为子目录 `index.ts` 公共 API 入口,63 个业务实现,~9400 行)
- 测试文件数:34 个(~6900 行)
- 测试数:450 通过
- examples:6 个(01/03/04/05/06/07,共 ~1700 行)
- 最大单文件:`agent-harness.ts` 479 行(< 500 软限 21 行,不再需要 explicit justification)
- 总 commit 数:8 个(从 `9f6be26` 到 `54b7707`)

### 关键设计模式

- **依赖注入**:`ExecutionEnv` / `streamFn` / `model` 通过 `AgentHarnessOptions` 注入,便于测试
- **钩子 5 语义**:顺序转换 / 遇 block 退出 / 累积补丁 / 遇 cancel 退出 / fire-and-forget
- **拆分布局**:`agent-harness.ts` 单类 + 8 个子文件(event-bus / subscription-factory / hooks-bridge / turn-execution / hook-context-builder / compaction-ops / skill-ops / is-agent-harness)
- **YAML 极简解析**:Skill frontmatter 仅支持 `name` / `description`,不引外部库
- **占位符统一**:`{{name}}` 语法在 skills 和 prompt-templates 共用

---

## Task 8 ✅ 队列操作 + 自定义消息示例(2026-08-01,commit `d61e9a0`)

### 实际产出

- `src/harness/queue.ts` — 5 个纯函数(`enqueueSteer` / `drainSteerQueue` / `enqueueFollowUp` / `drainFollowUpQueue` / `enqueueNextTurn`),统一合一个文件(避免"为对称而拆")
- `src/harness/agent-harness/queue.ts` — 3 个 op 桥接函数(`runSteerOp` / `runFollowUpOp` / `runNextTurnOp`),通过 `QueueOpDeps` 接口依赖注入
- `src/harness/agent-harness/agent-harness.ts` — 增量 3 个队列字段 + `QueueMode` 字段 + 6 个 getter/setter + 3 个业务方法(`steer` / `followUp` / `nextTurn`)
- `src/harness/agent-harness/turn-execution.ts` — 接入 `getSteeringMessages` / `getFollowUpMessages` 回调到 `AgentLoopConfig`
- `__tests__/harness/queue.test.ts` — 19 个纯函数测试
- `__tests__/harness/agent-harness/prompt.test.ts` — 增量 20 个队列方法测试
- `__tests__/harness/agent-harness/config.test.ts` — 增量 8 个 mode getter/setter 测试
- `examples/08-custom-messages.ts` — 演示 `CustomAgentMessages` 声明合并(`notification` 自定义类型)+ 队列操作,真实 DeepSeek API
- 独立 `.d.ts` 声明合并文件 — 避免污染 `tsconfig.test.json` 编译

### 实施偏差

| # | 计划 | 实际 | 原因 |
|---|------|------|------|
| 1 | queue.ts 拆 5 个文件(每个函数一个) | 合并到 1 个文件 80 行 | 函数都很短(5-10 行),拆开会变成"为对称而拆";语义紧密,合在一起更易读 |
| 2 | 5 种 QueueMode 都要测 | `nextTurn` 不需要 QueueMode(只是 prompt 入口 prepend,语义与 steer/followUp 不同) | 与设计 spec 一致:nextTurn 队列只 prepend,没有"drain"语义 |
| 3 | example 直接声明合并 | 声明合并放独立 `.d.ts` 文件,example import 那个文件 | 避免 `CustomAgentMessages` 类型扩展污染 test 编译(测试 exclude examples) |

### 关键决策

- **依赖注入保持封装**:`#steerQueue` 等私有字段不直接暴露,`runSteerOp(deps, ...)` 接收 `QueueOpDeps` 接口(`getXxx` + `setXxx`),主类只提供 `#buildQueueOpDeps()` 方法构造
- **回调注入到 `AgentLoopConfig`**:`turn-execution.ts` 在构造 `config` 时注入 `getSteeringMessages` / `getFollowUpMessages`,agent-loop 内部按需 poll
- **`nextTurn` 是 prompt 入口 prepend**:`runNextTurnOp` 不调 drain 函数(没有 drain 语义),只在用户下次调 `harness.prompt(text)` 时,把队列 prepend 到 user message 前面
- **hook emit 走 `queue_update`**:3 个 op 末尾都 emit `{ type: "queue_update" }`,让 observer 知道队列有变化

### 验证结果

```bash
$ pnpm test
Test Files  35 passed (35)
Tests       499 passed (499)

$ tsc -p tsconfig.test.json
# 0 错误

$ npx tsx examples/08-custom-messages.ts
# 4 个演示全部成功,真实 DeepSeek API
```

### 遗留问题

- `agent-harness.ts` 实测 682 行(超 500 软限 182 行,文件头已 explicit justification)

### 提交状态

- ✅ `d61e9a0` feat(agent): queue ops + custom messages demo (Task 8/10) — 已推送到 GitHub

---

## Task 9 ✅ 文档输出 — 5 篇中文文档(2026-08-01,commit `9f29334`)

### 实际产出

5 篇中文文档,统一结构(概述 / 关键概念 / API 速查 / 流程图 / 已知限制),放置在 `docs/` 根目录:

| 文档 | 行数 | 主题 |
|------|------|------|
| [docs/agent-harness.md](../../agent-harness.md) | 142 | 主类生命周期、状态机、14 个 getter/setter、8 个业务入口 |
| [docs/hooks.md](../../hooks.md) | 137 | 20 事件(8 核心 + 12 预声明)、5 种语义、Handler/Observer |
| [docs/session.md](../../session.md) | 163 | Session 类、11 种 Entry、InMemory + JSONL 双后端、buildContext |
| [docs/compaction.md](../../compaction.md) | 163 | 手动压缩、prepareCompaction、estimateTokens、file-ops 提取 |
| [docs/skills-and-templates.md](../../skills-and-templates.md) | 187 | SKILL.md 格式、{{key}} 占位符、resources、Skill vs Template |

### 实施偏差

| # | 计划 | 实际 | 原因 |
|---|------|------|------|
| 1 | 英文文档为主 | 全部中文 | 用户偏好(沟通语言 + 文档本地化) |
| 2 | 文档结构由 plan 给定 | 统一 5 章节:概述 / 关键概念 / API 速查 / 流程图 / 已知限制 | plan 已规定,严格遵循 |
| 3 | 文件路径用相对路径 | 全部用 `file:///` 协议绝对路径 | 方便跨平台点击跳转 |

### 关键决策

- **流程图用 ASCII 纯文本**:避免 mermaid 等需要渲染的格式,直接看代码就能理解
- **API 速查只列签名,不带实现**:读者通过 `file:///` 链接跳到源代码
- **已知限制每篇 6-9 条**:从 spec 沿用真实约束,避免描述"应该可以但还没做"的功能
- **关键概念用表格**:API 速查适合文字 + 表格混合,流程图用 ASCII

### 验证结果

- 5 篇全部 < 500 软限(最大 187 行,最小 137 行)
- 类型签名与实际源代码一致
- 流程图与实现一致
- 文件路径引用全部 `file:///` 协议
- 工作区干净

### 提交状态

- ✅ `9f29334` docs(agent): 5 篇中文文档(Task 9/10) — 已推送到 GitHub

---

## Task 10 ✅ 全量验证 + Phase 02 收尾(2026-08-01)

### 实际产出

- 全量测试:499/499 pass,35 个测试文件
- 全量 examples:7 个(01/03/04/05/06/07/08)全部 exit=0
- `tsc --noEmit`:0 错误
- `pnpm build`:0 错误 0 warning
- 实施日志:本文档
- Spec 偏差附录:`docs/superpowers/specs/2026-07-30-phase02-agent-design.md` 末尾
- 根 spec 状态:`docs/superpowers/my-mimipi-spec.md` 标记 Phase 02 完成

### 验证结果

```bash
$ pnpm test
Test Files  35 passed (35)
Tests       499 passed (499)
Duration    7.74s

$ pnpm tsc --noEmit
# 0 错误

$ pnpm build
# 0 错误 0 warning

$ npx tsx examples/01-basic.ts            # exit=0
$ npx tsx examples/03-session.ts          # exit=0
$ npx tsx examples/04-compaction.ts       # exit=0
$ npx tsx examples/05-skills.ts           # exit=0
$ npx tsx examples/06-prompt-templates.ts # exit=0
$ npx tsx examples/07-hooks.ts            # exit=0
$ npx tsx examples/08-custom-messages.ts  # exit=0
```

### Phase 02 最终规模

| 维度 | 数值 |
|------|------|
| 源文件数 | 73 个(含 5 篇文档,~13000 行) |
| 测试文件数 | 35 个(~7200 行) |
| 测试用例 | 499 全 pass |
| examples | 7 个(~1900 行,全部真实 API 验证) |
| 中文文档 | 5 篇(~790 行) |
| Commit 数 | 9 个(从 `9f6be26` 到 `9f29334`) |
| GitHub | 已推送到 `origin/master`,本地与远端同步 |

### Phase 02 关键设计模式总结

1. **依赖注入**:`ExecutionEnv` / `streamFn` / `model` 通过 `AgentHarnessOptions` 注入
2. **钩子 5 语义**:顺序转换 / 遇 block 退出 / 累积补丁 / 遇 cancel 退出 / fire-and-forget
3. **拆分布局**:`agent-harness.ts` 主类 + 8 个子文件分工明确
4. **YAML 极简解析**:Skill frontmatter 仅 `name` / `description`
5. **占位符统一**:`{{name}}` 在 skills + templates 共用
6. **声明合并**:`CustomAgentMessages` 通过独立 `.d.ts` 扩展,避免污染编译
7. **队列纯函数**:enqueue / drain 函数独立可测,业务逻辑通过 deps 桥接
8. **压缩感知**:`buildContext` 反向回溯遇到 `CompactionEntry` 自动跳到 `firstKeptEntryId`
9. **append-only tree**:Session entry 不可删除,只能通过 compaction / branch summary 标记
10. **JSONL 同步落盘**:`fs.appendFile` 同步,无并发风险

### Phase 02 已知遗留问题

1. `agent-harness.ts` 682 行,超 500 软限 182 行(文件头已 explicit justification)
2. 9 个预声明 hook 事件未启用(`session_compact` / `session_tree` 等)
3. `resources_update` / `tools_update` / `thinking_level_update` 钩子未主动 emit
4. `nextTurn` 不需要 QueueMode(spec 已说明)
5. 压缩 token 估算不精确(`chars / 4` 启发式)
6. `extractFileOpsFromMessage` 是启发式,不支持自定义工具 schema
7. JSONL 后端假设单进程写入,多进程并发会行交错
8. CustomEntry 不会自动投影到 context(必须提供 `entryProjectors`)

### 提交状态

- 即将:`chore(agent): phase 02 complete` — 包含本文档 + spec 偏差附录 + 根 spec 状态

---

## 后续更新(2026-08-02,对照原 pi 复查)

对照 `F:\allProject\githubProject\pi` 源码复查,发现 3 处翻译差异,均已修复并补测试:

1. **`before_agent_start` 补入参**(重大):原 pi 的 emit 携带 `prompt` / `images` / `systemPrompt` / `resources`,my-mimipi 之前只传 `{ type }`,导致 handler 读不到"当前已拼好的 systemPrompt"、只能盲目覆盖。已补齐事件类型 + harness 调用 + 文档。
2. **`buildSystemPrompt` 统一 async**:原实现返回 `string | Promise<string>` 半异步 API(内部分叉、调用方 await 一个可能非 Promise 的值),已改为始终返回 `Promise<string>`。
3. **`drainQueue` 消费通知 + 回滚**:原实现同步、消费时无 `queue_update` 通知、无失败回滚;已对齐 pi 的 `drainQueuedMessages`(消费后 emit `queue_update`,失败 `queue.unshift(...messages)` 回滚)。

验证:`pnpm test`(vitest 438/438 + tsc 0 错误)+ `tsc -p tsconfig.json` 0 错误。

---

## 总结

Phase 02 从 2026-07-30 启动,2026-08-01 完成,共历时 3 天,9 个 commit,产出:

- 73 个源文件
- 499 个测试用例(全 pass)
- 7 个真实 API 验证的 examples
- 5 篇中文用户文档
- 1 个完整的 AgentHarness 系统

**Phase 02 完成 ✅**

下一步:Phase 02.5(基于 AgentHarness 的 CLI 编程助手),见 [Phase 02.5 设计 Spec](../specs/2026-07-30-phase02.5-coding-agent-design.md)。
