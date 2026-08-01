# 压缩与分支摘要(Compaction)

> 本文档基于 `@mimi/agent` 包的压缩系统实际代码整理。
> 详细设计 spec 见 [2026-07-30-phase02-agent-design.md](./superpowers/specs/2026-07-30-phase02-agent-design.md);
> 源代码入口: [compaction/index.ts](file:///f:/allProject/githubProject/my-mimipi/packages/agent/src/harness/compaction/index.ts)。

## 概述

压缩(Compaction)是 AgentHarness 的"长上下文管理机制":当一个 session 的 entry 树积累到一定程度(超过 LLM 上下文窗口),把旧的 entries 压缩成一段 summary,新 entry 从 summary 之后继续生长,达到"用 token 换对话深度"的目的。`@mimi/agent` 实现了两件事:**Compaction(对历史消息做摘要压缩)**和 **Branch Summary(切 leaf 时给旧分支生成摘要)**。两者都通过 session 的 `appendCompaction` / `appendBranchSummary` 写入对应 entry,后续 `buildContext` 走"压缩感知"规则自动只取 summary 之后的部分。手动触发(`harness.compact()`),不接触发器;走 `session_before_compact` 钩子,可被取消或注入已有结果跳过 LLM 调用。

核心定位:Compression **不是** 简单的"截断前 N 条",而是"基于 keepRecentTokens 选保留边界 + LLM 生成 summary + file-ops 提取",保留 file 操作的语义以便后续工具调用时知道哪些文件已被读写。

## 关键概念

### 1. 核心数据结构

| 类型 | 字段 | 用途 |
|------|------|------|
| `CompactionSettings` | `keepRecentTokens` / `maxSummaryTokens` / `summaryModel` / `instructions` | 压缩策略配置 |
| `CompactOptions` | `settings?: CompactionSettings` / `signal?: AbortSignal` | 运行时参数 |
| `CompactionPreparation` | `keptEntries: KeptEntries` / `summaryInput: readonly AgentMessage[]` | 选保留边界的结果 |
| `CompactionResult` | `summary: string` / `firstKeptEntryId: string` / `tokensBefore: number` / `details?: CompactionDetails` | 压缩产物 |
| `CompactionDetails` | `readFiles: string[]` / `modifiedFiles: string[]` | 压缩时收集的文件操作 |
| `BranchSummaryOptions` | `model?` / `targetEntryId: string` | 分支摘要参数 |
| `BranchSummaryResult` | `summary: string` / `details?: BranchSummaryDetails` | 分支摘要产物 |

### 2. 默认设置

```typescript
const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  keepRecentTokens: 20000,        // 保留最近 20k token 不压缩
  maxSummaryTokens: 4000,         // 生成的 summary 最多 4k token
  summaryModel: undefined,        // 用 harness 当前的 model
  instructions: "",               // 自定义 LLM prompt
};
```

### 3. 文件操作提取(`extractFileOpsFromMessage`)

压缩时除了生成 summary,还会扫描被丢弃的 entries 中的 `toolResult`,提取 read / modified 的文件路径,作为 `CompactionDetails` 保存。**这个信息后续工具调用时会用到**(避免重读未变更的文件)。

```typescript
function extractFileOpsFromMessage(message: AgentMessage): {
  readFiles: string[];          // 从 read_file toolResult 提取
  modifiedFiles: string[];     // 从 write_file/edit_file toolResult 提取
}
```

> 实现是"看 toolResult content 文本 + 工具名启发式匹配",不是结构化解析,简单可靠。

### 4. Token 估算(`estimateTokens`)

```typescript
function estimateTokens(message: AgentMessage): number;
```

基于 `chars / 4` 的启发式估算(英文 ≈ 1 token / 4 chars),用于在调 LLM 之前粗略判断要不要压缩。**不是精确 token 数**,只为决策提供依据。

### 5. `shouldCompact` 工具函数

虽然 `@mimi/agent` 包内不自动触发压缩,但仍导出 `shouldCompact`,供外部代码(如未来的 trigger 系统)判断是否需要压缩:

```typescript
function shouldCompact(entries: SessionTreeEntry[], settings: CompactionSettings): boolean;
```

> 当前 `harness.compact()` 是手动触发,`shouldCompact` 仅供外部参考。

### 6. 钩子集成

压缩走 2 个钩子(都属于"session_before_*" 系列):

| 钩子 | 触发点 | 钩子可做 |
|------|--------|----------|
| `session_before_compact` | `compact()` 入口 | `cancel: true` 阻止压缩;`compaction: CompactionResult` 注入已有结果跳过 LLM |
| `session_compact` | `compact()` 完成(预声明,未启用) | 通知压缩完成 |

## API 速查

### 公开函数

```typescript
// 主入口
async function compact(
  harness: AgentHarness,
  options?: CompactOptions,
): Promise<CompactionResult | undefined>;                    // 钩子 cancel 时返回 undefined

// 选保留边界
function prepareCompaction(
  entries: readonly SessionTreeEntry[],
  settings: CompactionSettings,
): CompactionPreparation;

// Token 估算
function estimateTokens(message: AgentMessage): number;

// 文件操作提取
function extractFileOpsFromMessage(message: AgentMessage): {
  readFiles: string[];
  modifiedFiles: string[];
};

// 分支摘要
async function generateBranchSummary(
  entries: readonly SessionTreeEntry[],
  model: Model<any>,
  options?: BranchSummaryOptions,
): Promise<BranchSummaryResult>;

function collectEntriesForBranchSummary(
  entries: readonly SessionTreeEntry[],
  targetId: string,
): SessionTreeEntry[];

// 工具函数
function shouldCompact(
  entries: readonly SessionTreeEntry[],
  settings: CompactionSettings,
): boolean;
```

### AgentHarness 集成

```typescript
harness.compact(): Promise<string | undefined>
//   返回新 session leaf id(若有);钩子 cancel 时返回 undefined
harness.navigateTree({ targetId: string }): Promise<void>
//   切到历史 entry,可选生成 BranchSummary
```

### 配置

```typescript
const mySettings: CompactionSettings = {
  keepRecentTokens: 30000,
  maxSummaryTokens: 5000,
  summaryModel: customModel,             // 可选,默认用 harness model
  instructions: "用中文写摘要,保留代码块",
};

await harness.compact();                // 用默认 settings
// 等价于
// await runCompactOp(harness, { settings: DEFAULT_COMPACTION_SETTINGS });
```

## 流程图

### `harness.compact()` 主流程

```
harness.compact()
  │
  ▼
[1] assertPhase("idle")                              ← 非 idle 抛 AgentHarnessError("busy")
  │
  ▼
[2] #phase = "compaction"
  │
  ▼
[3] emit("session_before_compact")
  │   ├─ 钩子返回 { cancel: true }      → 直接 return(undefined)
  │   └─ 钩子返回 { compaction: result } → 跳到 [8]
  │
  ▼
[4] runCompactOp()
  │   │
  │   ├─ session.getEntries()
  │   │   ← 拿到完整 entry 树
  │   │
  │   ├─ prepareCompaction(entries, settings)
  │   │   │   ├─ 反向遍历 entries,累计 token 数
  │   │   │   ├─ 找到"首次累计超过 keepRecentTokens"的边界
  │   │   │   ├─ keptEntries = 边界之后到 leaf
  │   │   │   └─ summaryInput = 边界之前的 messages(给 LLM)
  │   │
  │   ├─ buildCompactSummaryPrompt(summaryInput, settings)
  │   │   ← 构造 LLM prompt(含 instructions + 要摘要的 messages)
  │   │
  │   ├─ harness.streamFn(model, ctx, options)        ← 调 LLM
  │   │   ← 流式生成 summary 文本
  │   │
  │   ├─ 扫描 summaryInput 的 toolResult
  │   │   ├─ extractFileOpsFromMessage 每条
  │   │   └─ 合并为 { readFiles, modifiedFiles }
  │   │
  │   ├─ CompactionResult = { summary, firstKeptEntryId, tokensBefore, details }
  │   │
  │   └─ session.appendCompaction(CompactionResult)    ← 写 CompactionEntry
  │       └─ session.setLeafId(newEntryId)             ← 切 leaf 到 compaction
  │
  ▼
[5] emit("session_compact")(预声明,未实际触发)
  │
  ▼
[6] #phase = "idle"
  │
  ▼
return newLeafId
```

### `prepareCompaction` 选保留边界

```
entries[] (按时间顺序)
  │
  ▼
从 leaf 反向遍历,累计 estimateTokens 估算值
  │
  ▼
[边界判定]
  for i from len-1 to 0:
    if 累计 token > keepRecentTokens:
      keptStartIndex = i + 1
      break
  │
  ▼
keptEntries = entries.slice(keptStartIndex)     ← 保留这些
summaryInput = entries.slice(0, keptStartIndex) ← 丢弃,需摘要
firstKeptEntryId = keptEntries[0]?.id ?? leafId
  │
  ▼
return { keptEntries, summaryInput }
```

### `harness.navigateTree()` 流程

```
harness.navigateTree({ targetId })
  │
  ▼
[1] assertPhase("idle")
  │
  ▼
[2] #phase = "branch_summary"
  │
  ▼
[3] emit("session_before_tree")(预声明)
  │
  ▼
[4] runNavigateTreeOp({ targetId, generateBranchSummary?: true })
  │   │
  │   ├─ session.getEntries()
  │   │
  │   ├─ collectEntriesForBranchSummary(entries, targetId)
  │   │   ← 收集从 root 到 targetId 路径上"被丢弃的"entries
  │   │
  │   ├─ if generateBranchSummary:
  │   │     generateBranchSummary(discarded, model)
  │   │     session.appendBranchSummary(result)
  │   │
  │   └─ session.setLeafId(targetId)                  ← 切 leaf
  │
  ▼
[5] emit("session_tree")(预声明)
  │
  ▼
[6] #phase = "idle"
```

## 已知限制

1. **手动触发,不接触发器**:`@mimi/agent` 不自动判断何时压缩,需要调用方自己调 `harness.compact()`;`shouldCompact` 函数虽导出,但包内不调用。
2. **Token 估算不精确**:`estimateTokens` 用 `chars / 4` 启发式,对中文 / 代码块 / 特殊符号偏差较大;只供"是否要压缩"决策,不能作为 LLM 真 token 数。
3. **file-ops 提取是启发式**:`extractFileOpsFromMessage` 看 `toolResult.content[0].text` + 工具名匹配,不支持自定义工具 schema;扩展工具需自己实现文件操作记录。
4. **压缩会调真实 LLM**:`runCompactOp` 走 `harness.streamFn` 调真实模型,会消耗 token + 时间;`session_before_compact` 钩子可注入 `compaction` 字段跳过 LLM。
5. **`maxSummaryTokens` 不可强制**:`buildCompactSummaryPrompt` 不会在 prompt 里硬性要求 LLM 输出长度限制,只通过 `instructions` 软性提示。
6. **pre-Compaction entries 永远在文件里**:`appendCompaction` 不删除旧 entry,只标记 `firstKeptEntryId` 让 `buildContext` 跳过;JSONL 文件大小只增不减。
7. **`session_compact` 钩子未启用**:虽然 `session_compact` 类型已声明,但 `compact()` 完成时不主动 emit;外部需要时手动 `hooks.emit({ type: "session_compact" })`。
8. **`generateBranchSummary` 不传 model 时会 throw**:必须显式传 `model` 或在 `harness.getModel()` 拿到;与 `compact()` 走 `harness` model 不同。
