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
| 8 | 队列操作 + 自定义消息示例 | ⏳ | — | — |
| 9 | 文档输出 (5 篇中文文档) | ⏳ | — | — |
| 10 | 全量验证 + Phase 02 收尾 | ⏳ | — | — |

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

- 源文件数:~25 个核心文件 + 6 个 examples(01/03/04/05/06/07,共 ~1300 行)
- 测试文件数:34 个
- 测试数:450 通过
- 最大单文件:`agent-harness.ts` 479 行(< 500 软限 21 行,不再需要 explicit justification)
- 总 commit 数:8 个(从 `9f6be26` 到 `54b7707`)

### 关键设计模式

- **依赖注入**:`ExecutionEnv` / `streamFn` / `model` 通过 `AgentHarnessOptions` 注入,便于测试
- **钩子 5 语义**:顺序转换 / 遇 block 退出 / 累积补丁 / 遇 cancel 退出 / fire-and-forget
- **拆分布局**:`agent-harness.ts` 单类 + 8 个子文件(event-bus / subscription-factory / hooks-bridge / turn-execution / hook-context-builder / compaction-ops / skill-ops / is-agent-harness)
- **YAML 极简解析**:Skill frontmatter 仅支持 `name` / `description`,不引外部库
- **占位符统一**:`{{name}}` 语法在 skills 和 prompt-templates 共用
