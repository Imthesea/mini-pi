# Session 会话系统

> 本文档基于 `@mimi/agent` 包的 Session 系统实际代码整理。
> 详细设计 spec 见 [2026-07-30-phase02-agent-design.md](./superpowers/specs/2026-07-30-phase02-agent-design.md);
> 源代码入口: [session/index.ts](file:///f:/allProject/githubProject/my-mimipi/packages/agent/src/harness/session/index.ts)。

## 概述

`Session` 是 AgentHarness 的"持久化层":它把每一轮对话的 user / assistant / toolResult 消息以及压缩 / 分支 / 配置变更 / label 等元数据组织成一个**树形 entry 流**,并通过 `SessionStorage` 接口提供内存和 JSONL 两种后端实现。`Session` 类的核心是"append-only 树 + leaf 指针":任何状态变化都通过 `appendXxx` 方法追加 entry,leaf 切换通过 `setLeafId` 显式追加 `LeafEntry`(而非仅修改内存),保证所有变更可追溯。`buildContext` 方法从当前 leaf 反向回溯,按压缩感知规则派生 LLM 需要的 messages 数组,过滤掉 `role: "custom"` 的消息(除非提供 entry projector)。整体设计目标是"完整保留 pi 风格的可分叉会话树 + 压缩感知上下文"。

核心定位:Session **不是** 简单的消息日志;它是"agent 完整状态变更历史的不可变日志 + 当前 leaf 指针"。

## 关键概念

### 1. 11 种 Entry 类型

| Entry 类型 | 必填字段 | 用途 |
|------------|----------|------|
| `MessageEntry` | `message: AgentMessage` | 记录 user / assistant / toolResult 消息 |
| `ThinkingLevelChangeEntry` | `thinkingLevel: string` | 记录 thinking level 切换 |
| `ModelChangeEntry` | `modelName, providerName` | 记录 model 切换 |
| `ActiveToolsChangeEntry` | `activeToolNames: string[]` | 记录 tool 列表变更 |
| `CompactionEntry<T>` | `summary, firstKeptEntryId, tokensBefore, details?` | 压缩占位,被它覆盖的 entry 不再出现在 context |
| `BranchSummaryEntry<T>` | `summary, details?` | 分支摘要(切 leaf 时生成) |
| `CustomEntry<T>` | `customType: string, data: T` | 通用扩展点(声明合并) |
| `CustomMessageEntry<T>` | `customType: string, data: T` | 自定义消息投影到 LLM context |
| `LabelEntry` | `targetId, label: string` | 给 entry 打标签(便于检索) |
| `SessionInfoEntry` | `name: string` | session 元信息(显示名) |
| `LeafEntry` | `targetId: string` | leaf 切换记录(append-only 切 leaf) |

所有 entry 共享 `id` / `parentId` / `timestamp` 三个基础字段(`SessionTreeEntryBase`)。

### 2. 树形结构与 Leaf 指针

```
entries[] 顺序:
[id-0] MessageEntry (user: "hi")
  ↓ parentId
[id-1] MessageEntry (assistant: "hello")
  ↓ parentId
[id-2] MessageEntry (user: "what's pi?")
  ↓ parentId
[id-3] MessageEntry (assistant: "...")
  ↓ parentId
[id-4] CompactionEntry (summary: "...")
  ↓ parentId
[id-5] MessageEntry (user: "继续")
  ↓ parentId
[id-6] LeafEntry (targetId: id-5)   ← 当前 leaf = id-5
```

`setLeafId(newId)` **不是**直接修改内存,而是 append 一条 `LeafEntry(targetId: newId)`。这样切 leaf 的历史也保留,可以回溯到任意历史 leaf。

### 3. 两种后端

| 后端 | 存储方式 | 适用场景 |
|------|----------|----------|
| `InMemorySessionStorage` | `Map<sessionId, SessionTreeEntry[]>` | 测试 / 短生命周期场景 |
| `JsonlSessionStorage` | 一个 session 一个 `<dir>/<id>.jsonl` 文件 | 跨进程持久化 |

JSONL 文件首行是 `{"type":"header","version":3,...}` 元数据,后续每行一个 entry,append 走 `fs.appendFile`(因为每次只写一条,无并发风险)。目录名通过 `cwd` 编码(`/home/user/proj` → `--home-user-proj--`,`/` `\` `:` 合并为 `-`)。

### 4. 压缩感知(`buildContextEntries`)

- 从 leaf 反向回溯到 root,收集路径上的所有 entry
- 遇到 `CompactionEntry` 时:**只取 firstKeptEntryId 之后的 entry**,把 summary 作为前缀 user 消息插入
- 默认过滤 `role: "custom"` 的消息(LLM 不认识)

### 5. Session Repo 与 Fork

```typescript
interface SessionRepo<TMetadata> {
  create(metadata: TMetadata): Promise<Session<TMetadata>>;
  open(id: string): Promise<Session<TMetadata>>;
  list(): Promise<Array<{ id: string; updatedAt: Date }>>;
  delete(id: string): Promise<void>;
  fork(id: string, options: { fromEntryId: string; newId?: string }): Promise<Session<TMetadata>>;
}
```

`fork` 从某个 entry 创建新 session,把 root 到 fromEntryId 的所有 entry 复制过去(去掉 LeafEntry),生成独立的会话树。

## API 速查

### Session 类公共方法

```typescript
class Session<TMetadata> {
  // ── 状态查询 ──
  getMetadata(): Promise<TMetadata>
  getStorage(): SessionStorage<TMetadata>
  getLeafId(): Promise<string | null>
  getEntry(id: string): Promise<SessionTreeEntry | undefined>
  getEntries(): Promise<SessionTreeEntry[]>
  getBranch(fromId?: string): Promise<SessionTreeEntry[]>
  getLabel(id: string): Promise<string | undefined>
  getSessionName(): Promise<string | undefined>

  // ── Append 方法(每种 entry 一对一)──
  appendMessage(message: AgentMessage): Promise<string>           // 返回新 entry id
  appendThinkingLevelChange(level: string): Promise<string>
  appendModelChange(modelName: string, providerName: string): Promise<string>
  appendActiveToolsChange(activeToolNames: string[]): Promise<string>
  appendCompaction<T>(input: { summary, firstKeptEntryId, tokensBefore, details? }): Promise<string>
  appendCustomEntry<T>(customType: string, data: T): Promise<string>
  appendCustomMessageEntry<T>(customType: string, data: T): Promise<string>
  appendLabel(targetId: string, label: string): Promise<string>
  appendSessionName(name: string): Promise<string>

  // ── 状态变更 ──
  setLeafId(leafId: string | null): Promise<void>                // 追加 LeafEntry
  moveTo(targetId: string, options?: { generateBranchSummary?: boolean }): Promise<void>

  // ── 上下文构建 ──
  buildContextEntries(options?: BuildContextEntriesOptions): Promise<SessionTreeEntry[]>
  buildContext(options?: BuildContextOptions): Promise<AgentMessage[]>
}
```

### 存储接口

```typescript
interface SessionStorage<TMetadata> {
  load(sessionId: string): Promise<SessionTreeEntry[]>;
  append(sessionId: string, entries: SessionTreeEntry[]): Promise<void>;
  list(): Promise<Array<{ id: string; updatedAt: Date }>>;
  delete(sessionId: string): Promise<void>;
}
```

### 上下文构建选项

```typescript
interface BuildContextEntriesOptions {
  entryProjectors?: Record<string, (entry: SessionTreeEntry) => AgentMessage | undefined>;
  entryTransforms?: Array<(entries: SessionTreeEntry[]) => SessionTreeEntry[]>;
}

interface BuildContextOptions extends BuildContextEntriesOptions {
  // 默认会过滤 role: "custom",可通过 projectors 投影回来
}
```

### 工厂方法

```typescript
async function openSession<TMetadata>(
  repo: SessionRepo<TMetadata>,
  id: string,
): Promise<Session<TMetadata>>;

async function createSession<TMetadata>(
  repo: SessionRepo<TMetadata>,
  metadata: TMetadata,
): Promise<Session<TMetadata>>;
```

## 流程图

### `appendMessage` 时序

```
session.appendMessage(userMessage)
  │
  ▼
[1] 取当前 leaf 的 entry 作为 parent
  │
  ▼
[2] 生成新 entry id(uuidv7, 末 8 位)
  │
  ▼
[3] 构造 MessageEntry
  │   { type: "message", id, parentId, timestamp, message: userMessage }
  │
  ▼
[4] this.entries.push(entry)
  │
  ▼
[5] await this.storage.append(sessionId, [entry])
  │   ← JSONL:fs.appendFile(同步);Memory:Map.set
  │
  ▼
[6] await this.setLeafId(newId)
  │   ← 追加 LeafEntry,leaf 指向新 entry
  │
  ▼
return newId
```

### `buildContext` 派生 LLM Messages

```
buildContext(options?)
  │
  ▼
[1] buildContextEntries(options)
  │   │
  │   ├─ 从 leaf 反向回溯到 root
  │   │   (经过 CompactionEntry 时,只取 firstKeptEntryId 之后)
  │   │
  │   ├─ 应用 entryTransforms(可选)
  │   │
  │   └─ 应用 entryProjectors(custom entry → AgentMessage)
  │
  ▼
[2] 把 entries 投影为 AgentMessage[]
  │   ├─ MessageEntry → 直接取 .message
  │   ├─ CompactionEntry → user 消息(content: summary)
  │   ├─ BranchSummaryEntry → user 消息(content: summary)
  │   ├─ CustomMessageEntry → 走 projector
  │   └─ 其他 → 跳过
  │
  ▼
[3] 默认过滤 role: "custom" 的消息
  │
  ▼
return AgentMessage[]
```

### JSONL 存储文件结构

```
{"type":"header","version":3,"id":"session-abc","createdAt":...}
{"type":"entry","data":{"type":"message","id":"m1","parentId":null,"message":{...}}}
{"type":"entry","data":{"type":"message","id":"m2","parentId":"m1","message":{...}}}
{"type":"entry","data":{"type":"compaction","id":"c1","parentId":"m2","summary":"...","firstKeptEntryId":"m3","tokensBefore":1234}}
{"type":"entry","data":{"type":"leaf","id":"l1","parentId":"c1","targetId":"m3"}}
```

## 已知限制

1. **JSONL 后端是同步 fs.appendFile**:依赖 Node.js 的同步追加语义,假设单进程写入;多进程并发写同一 session 会出现行交错。
2. **Entry tree 是 append-only**:不可删除 entry,只能通过 `CompactionEntry` 标记"被覆盖";旧 entry 永远在文件里。
3. **leafId 在 `setLeafId(null)` 时行为**:append 一条 `LeafEntry(targetId: null)`,后续 `getLeafId()` 返回 null,`buildContext` 会抛错。
4. **CustomEntry 不会自动投影到 context**:必须提供 `entryProjectors`,否则 `buildContext` 跳过它。
5. **Session.moveTo 不强制要求 generateBranchSummary**:参数默认 `false`,跳过 branch summary 生成;如果切 leaf 时希望保留旧分支摘要,需显式传 `true`。
6. **JSONL 格式版本 3**:旧版本文件(header version < 3)会被拒绝读取,需手动迁移。
7. **session.appendMessage 失败不阻塞 turn**:AgentHarness 集成时,`session.appendMessage` 失败只 `console.error`,不抛;调用方需要自行监控持久化。
8. **fork 不复制 setLeafId 状态**:fork 出来的新 session leaf 指向 fromEntryId,不会继承原 session 的 leaf;调用方需自行 `setLeafId`。
