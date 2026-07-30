# Phase 02 Agent 层工程原则

> **目的**:为 `@mimi/agent` 包(Task 2~8)的实施提供可执行的可读性 / 可维护性标准。
> **制定时间**:2026-07-30(在 Task 2 实施过程中遇到"agent-loop.ts 1000+ 行无法维护"的问题后补建)
> **范围**:仅适用于 Phase 02 实施期(每个 Task 落地时要回看本原则)
> **配套**:[实施 Plan](../plans/2026-07-30-phase02-agent-plan.md)

---

## 1. 核心原则

### 1.1 可读性 + 可维护性优先于一切

- **宁愿多写 50% 的代码也要保持单文件清晰**
- 不追求"代码行数最少"或"复用最大化"
- 宁可有重复实现,也不要因为追求复用而牺牲拆分

**触发该原则的教训**:Task 2 实施时一次性写了 1000+ 行的 `agent-loop.ts`,内含公共 API、状态机、流式响应、工具执行、参数校验、helper 六大块关注点。后续 5 个测试 bug 几乎都因为"在一个文件里找不到出错位置"而耗费大量排查时间,拆分后立即明朗。

### 1.2 单文件行数软上限 ≤ 500 行(非硬性)

- **500 行是软上限,不是硬性**:经验值,基于"一个文件能在 5 分钟内完整理解"的工程直觉
- **可以超过 500 行**:为合理性可超过——例如:
  - 一个主类的多个方法天然强内聚(拆开反而来回跳)
  - 工具执行的"准备→执行→终结化"三个阶段虽然拆开了,但加起来超过 500 行
  - 测试文件本身需要大量用例
- **超过 500 行必须走确认流程**:
  1. 停下,评估是否还有合理拆分方式
  2. 如果选择不拆,在 plan / 对话 / commit 信息中**显式说明理由**(不只说"翻译自 pi")
  3. 提交给用户审查
  4. **用户同意后才能继续**
- **不接受'先用大文件跑通,以后再拆'的拖延**:已有 Task 2 教训(1000+ 行无法维护)

**风格参考**(非强制,仅作参考):
- 公共 API 入口文件:倾向 200-300 行
- 内部实现文件:倾向 150-250 行
- 测试文件:倾向 200-400 行
- 类型定义文件:倾向 100-300 行
- 软上限超出时,不必每次都解释——只在**实际超过 500 行**时才需要确认

### 1.3 拆分原则:为可读性、可维护性、合理性而拆,不为拆而拆

**拆分要服务于目的**——让代码更易读、更易改、更合理。不是机械地按行数切分。

**该拆的判据**(满足任一即拆):
- 多个**互不相关**的职责混在一起(公共 API + 内部状态机 + 工具执行 = 三件不同的事)
- 关闭 IDE 折叠,打开文件能在 5 分钟内**完整理解**这块逻辑
- 单个文件能**独立测试**(每个文件有对应的单测)
- 改一个逻辑点时,**只需要在一个文件里改**

**不该拆的判据**(满足任一不拆):
- 同一件事的**不同阶段**——比如 `prepare → execute → finalize` 是工具调用的完整生命周期,合在一起读更顺
- 类的**内部状态**——主类本身的方法互相依赖(emit 内部要用 handlers / observers),拆开反而来回跳
- **胶水代码**——纯转发的 boilerplate,拆出去读者要追两层才知道做了什么
- **过度抽象**——为了"对称"或"看起来整齐"而拆,实际没有任何职责区分

**预先拆分 vs 边写边拆**:
- **会跨多个 Task 增量增长的主类**(如 `agent-harness.ts`):**在写之前就按职责预先拆成 2-4 个文件**。这样从 Task 3 到 Task 8 都不会超过 500 行
- **单 Task 内的实现文件**:可以先写一个文件,如果快接近 500 行且有清晰职责边界,**立刻拆**;如果职责仍然紧密耦合,保持合在一起
- **不要"等接近 500 行再拆"**——那时已经堆积了几百行难以重构

**判断示例**(以工具执行三阶段为例):

| 情况 | 是否拆 | 理由 |
|------|--------|------|
| 每阶段 30-50 行,纯函数,无共享状态 | ✅ 拆 | 每个独立可测,信息局部性强 |
| 每阶段 80-150 行,共享部分状态,需要顺序阅读 | ⚠️ 评估 | 看具体耦合度,可拆可合 |
| 三阶段加起来 250+ 行,合在一起 | ✅ 合 | 顺序流程,合在一起读最快 |
| 三阶段分散到 3 个文件,但每个文件只有 30 行 | ❌ 拆过头 | 30 行不值得独立成文件,合并 |

**核心判断标准**:
1. 拆开后的每个文件是否能**独立可测**?
2. 拆开后的每个文件是否**信息局部**(读完一个文件能独立理解该阶段)?
3. 合在一起是否会让单个文件**突破 500 行软上限**?
4. 三个标准都满足才拆;任一不满足则保持合并

**反例**(不该拆的):
- 30 行的工具函数硬拆到 3 个文件(每个 10 行),读者要追三个文件
- 类的方法集合按 getter / setter 维度拆(拆开无职责区分,只是"对称")
- 5 个同模板的钩子语义处理器拆到 5 个文件(本质是同一处理模式的 5 种 case)

**正例**(该拆的):
- 工具执行流水线(prepare 校验参数 / execute 调函数 / finalize 生成消息),每个阶段 80+ 行,信息独立
- 公共 API 入口(200 行编排)与内部实现(分散到子目录)
- 类型定义文件超过 300 行时拆为 `types/` 子目录

### 1.4 目录组织

```
packages/agent/src/
├── index.ts                          # 公共 API 入口
├── types.ts                          # 跨模块公共类型(只放 AgentEvent / AgentContext / AgentLoopConfig 这类真正跨模块的类型)
├── <module>/                         # 一级模块(如 loop / harness)
│   ├── <sub-file>.ts                 # 模块内按职责拆分的子文件
│   ├── <sub-module>/                 # 子模块(如 harness/session / harness/hooks)
│   │   ├── <file>.ts
│   │   └── index.ts
│   └── index.ts                      # 模块内公共导出(可选)
```

- 顶层 `src/` 只放**纯公共 API** 文件
- 内部实现用 `src/<module>/` 子目录隔离
- 不在 `src/` 下直接堆 5+ 个并列文件(那不是拆分,那是堆砌)

### 1.5 类型就近原则

- **不**把所有类型堆到 `types.ts`
- **就近放置**:某个类型只被一个文件用,放那个文件;被一个模块用,放模块的 `types.ts` 或就近文件
- `types.ts` 只放**真正跨模块共享**的类型(如 `AgentContext` / `AgentEvent` / `AgentLoopConfig`)

### 1.6 函数粒度

- 优先**纯函数**(无副作用 / 不依赖外部状态)
- 单个函数**不超过 50 行**
- 嵌套层级**不超过 3 层**(超过就拆函数)
- 复杂 if/else 用 early return 扁平化

### 1.7 注释

- 每个**公共导出符号**有中文 JSDoc
- 每个**内部函数**有 1~2 句中文说明用途
- 复杂逻辑块**就近写中文注释**
- 中文优先;命名可用英文

---

## 2. 单文件行数限制的执行规则

### 2.1 软性要求 + 解释机制

500 行是软上限,**不强制拆分**。执行规则:

- **任何文件写完后,跑 `wc -l` 检查**:
  - < 400 行:OK,继续
  - 400-500 行:警觉,评估是否还有合理拆分
  - > 500 行:**必须停下,走确认流程**(见 2.2)
- **`wc -l` 含空行和注释**:日常检查用 `wc -l` 即可,简单可靠
- **不用 SLOC 工具**:除非用户特别要求,不需要用 cloc 等精确工具

### 2.2 超过 500 行的确认流程

当 `wc -l` > 500 时,执行以下流程:

```
1. 停下编写
2. 评估:是否还能合理拆分?
   - 能拆 → 拆完再继续(不进入确认流程)
   - 不能拆 / 不该拆 → 进入第 3 步
3. 在 plan 文档或对话中,显式说明:
   - 当前文件行数
   - 拆不开的合理性理由(不只说"翻译自 pi",要说明为什么拆开反而不好)
   - 是否可以合并到现有文件而非单独成文件
4. 提交给用户审查
5. 用户同意 → 继续;用户不同意 → 拆分
```

**可以超过 500 行的典型场景**:
- 一个强内聚的主类方法集合(类的方法互相依赖,拆开要来回跳)
- 测试文件,大量 cases 自然堆叠
- 翻译自 pi 的"阶段"代码(prepare / execute / finalize),虽然拆了但单个文件合理
- 状态机的 `switch` 块(每个 case 几行,合在一起更直观)

**不应该超过 500 行的场景**:
- 公共 API 入口 + 内部实现混在一个文件
- 多个互不相关职责拼在一起
- 单个 `if-else` 链占满文件

### 2.3 例外情况

如确认流程不适用(紧急修复等),可以在 commit 信息中事后说明,但**默认所有超 500 行文件必须先确认**。

### 2.4 行数统计方式

- 用 `wc -l <file>` 检查(物理行数,含空行和注释)
- 不强制用 SLOC 精确统计
- 软上限以 `wc -l` 为准

---

## 3. 命名约定

### 3.1 文件名

- 公共 API:`<feature>.ts` 单数(如 `agent-loop.ts` / `agent-harness.ts`)
- 内部模块:`<concern>.ts`(`stream-assistant.ts` / `tool-execution.ts`)
- 内部子目录:`<sub-feature>/`(`session/` / `compaction/`)
- 测试:`<feature>.test.ts`(与源文件同名 + `.test.ts` 后缀)
- 例子:`<NN>-<feature>.ts`(`01-basic.ts` / `03-session.ts`)

### 3.2 内部子目录展开模式

当一个文件即将超过 500 行,**优先**考虑转为子目录:

```
# 之前(单文件,800 行)
src/foo.ts

# 之后(子目录,每个文件 ≤ 250 行)
src/foo/
├── index.ts           # 公共 API 重新聚合
├── main.ts            # 入口逻辑
├── part-a.ts          # 子职责 A
├── part-b.ts          # 子职责 B
└── types.ts           # 内部类型
```

这种"单文件 → 子目录"模式的好处:外部 import 路径可以保持不变(`./foo.js`),只要 foo.ts 改为 foo/index.ts。

### 3.3 公共导出

- 公共 API 文件**只**导出符号 + 编排,实现细节不导出
- 内部模块用 `index.ts` 显式控制哪些符号对外
- 不用 `export *`(隐式导出容易泄露内部细节)

---

## 4. Task 2~8 详细目录结构

### 4.1 Task 2: agent-loop 核心循环

**目标**:实现 LLM → tool → repeat 状态机。**从 pi 完整保留功能,但物理拆分**。

```
packages/agent/src/
├── agent-loop.ts                          # 公共 API + runLoop 编排 (~200 行)
├── loop/
│   ├── stream-assistant.ts                # 流式响应 + 重试包装 (~180 行)
│   ├── tool-execution.ts                  # 工具执行入口(sequential/parallel 路由) (~120 行)
│   ├── tool-execution/
│   │   ├── sequential.ts                  # 串行执行 (~100 行)
│   │   ├── parallel.ts                    # 并行执行 (~150 行)
│   │   ├── prepare.ts                     # prepareToolCall(参数校验 + beforeToolCall 钩子) (~120 行)
│   │   ├── execute.ts                     # executePreparedToolCall(onUpdate 派发) (~90 行)
│   │   ├── finalize.ts                    # finalizeExecutedToolCall(afterToolCall 钩子) (~90 行)
│   │   ├── truncate.ts                    # failToolCallsFromTruncatedMessage (~60 行)
│   │   └── types.ts                       # 内部类型(PreparedToolCall / FinalizedToolCallOutcome 等) (~80 行)
│   ├── tool-validation.ts                 # TypeBox 参数校验 (~50 行)
│   └── helpers.ts                         # sleep / createErrorToolResult / createToolResultMessage / emit* (~100 行)
```

**文件大小估算**:
- `agent-loop.ts`:~200 行
- `loop/stream-assistant.ts`:~180 行
- `loop/tool-execution.ts`:~120 行
- `loop/tool-execution/sequential.ts`:~100 行
- `loop/tool-execution/parallel.ts`:~150 行
- `loop/tool-execution/prepare.ts`:~120 行
- `loop/tool-execution/execute.ts`:~90 行
- `loop/tool-execution/finalize.ts`:~90 行
- `loop/tool-execution/truncate.ts`:~60 行
- `loop/tool-execution/types.ts`:~80 行
- `loop/tool-validation.ts`:~50 行
- `loop/helpers.ts`:~100 行

**最大单文件**:180 行 ✓

### 4.2 Task 3: AgentHarness 骨架 + messages + system-prompt

**目标**:实现 `AgentHarness` 主类骨架(phase 状态机 + prompt + subscribe + abort),集成 messages 转换和 system prompt 拼接。

**关键设计决策:在 Task 3 末尾就预先拆分 `agent-harness.ts` 为 3 个职责文件**,避免 Task 4-8 增量到 500+ 行。

```
packages/agent/src/
├── harness/
│   ├── agent-harness/                     # 3 个职责文件(不按读/写维度拆,按职责/配置维度拆)
│   │   ├── agent-harness.ts               # 核心类:构造 + 字段 + 事件订阅 + 生命周期 (~250 行)
│   │   ├── config.ts                      # 配置管理:getter + setter 合在一起(按"配置维度"组织) (~200 行)
│   │   └── prompt.ts                      # 业务入口:prompt() 主流程 (~150 行)
│   ├── phase.ts                           # AgentHarnessPhase 状态机 + phase 转换规则 (~100 行)
│   ├── messages/
│   │   ├── convert.ts                     # convertToLlm 主入口 + custom 过滤 (~150 行)
│   │   ├── assistant.ts                   # buildAssistantMessage + content 顺序 (~120 行)
│   │   └── custom.ts                      # bashExecution / branchSummary 等自定义消息投影 (~150 行)
│   ├── system-prompt/
│   │   ├── build.ts                       # buildSystemPrompt 主入口(~150 行)
│   │   ├── parts.ts                       # 各部分拼装 (~180 行)
│   │   └── index.ts                       # 公共导出
│   ├── types/
│   │   ├── harness.ts                     # Skill / PromptTemplate / HookEvent (~150 行)
│   │   ├── events.ts                      # AgentHarnessEvent 联合 (~150 行)
│   │   └── options.ts                     # AgentHarnessOptions / 构造选项 (~120 行)
│   └── index.ts                           # 公共 API 重新聚合
```

**预先拆分的判据**:
- **agent-harness.ts** = 核心类声明 + 字段 + 构造 + 事件订阅 + 生命周期,这些是**一个类的"骨架"**,其他方法可以视作"挂在骨架上的功能"
- **config.ts** = 全部 getter + setter(共 13-15 个方法),**按"配置维度"组织**(不是按读/写维度)。getter 和 setter 操作同一组字段,共享状态,合在一起便于一眼看到"harness 暴露哪些配置接口",避免跳两个文件
- **prompt.ts** = 业务方法,**每个方法都涉及 LLM turn 编排**——这是 harness 的"主业务",与"骨架"是不同关注点
- 拆完每个文件 150-250 行,Task 4-8 增量时**只在对应文件加方法**,**不会**让任何文件超过 500 行软上限

> **为什么不按读/写维度拆 queries.ts / mutators.ts**:这是 § 1.3 警告的"为对称而拆"反例。getter 和 setter 操作同一组字段,共享状态,拆成两个文件读者要来回跳,没有职责区分,只是"看起来整齐"。

**导出方式**:
- `agent-harness/agent-harness.ts` 中 `export class AgentHarness`(主类)
- `config.ts` 中用 `export function AgentHarness_getModel(this: AgentHarness) { ... }` 形式挂载 getter/setter,或用 mixin 模式
- `harness/index.ts` 重新聚合:`export { AgentHarness } from "./agent-harness/agent-harness.js";`
- **不**用 `export *`(避免泄露内部细节)

**`prompt.ts` 行数预估**:
- Task 3 末尾:150 行(只有 prompt 方法)
- Task 4 末尾(hooks emit 点加在 prompt 内):+30 = 180 行
- Task 5 末尾(session 接入):+30 = 210 行
- Task 6 末尾(compact 方法移到 compaction/compaction.ts,harness 只放 wrapper):+20 = 230 行
- Task 7 末尾(skill / promptFromTemplate):+50 = 280 行
- Task 8 末尾(steer / followUp / nextTurn):+60 = 340 行(若把队列内部逻辑拆到 `agent-harness/queue.ts`,实际 < 250 行)

**最大单文件**:~250 行 ✓

### 4.3 Task 4: 钩子系统

**目标**:实现 `DefaultAgentHarnessHooks` + 17 个 hook 事件 + 变更语义(完整保留 pi 协议)。

```
packages/agent/src/
├── harness/
│   ├── hooks/
│   │   ├── types.ts                       # 8 个核心事件 + 9 个预声明事件 + HookEvent 泛型 (~250 行)
│   │   ├── semantics.ts                   # 5 种语义的纯函数(顺序转换 / 累积补丁 / block / cancel / fire-forget) (~200 行)
│   │   ├── default-hooks-state.ts         # 内部状态:handlers / observers / cleanups 三个 Map 的封装 (~120 行)
│   │   ├── default-hooks.ts               # DefaultAgentHarnessHooks 主类:构造 + observe + on + emit + addCleanup + clear + dispose (~300 行)
│   │   └── index.ts
```

**拆分理由**(避免冗余):
- `default-hooks.ts` 300 行 = 主类公共 API(observe / on / emit / addCleanup / clear / dispose) + 内部 state 协作 —— **dispatch 和 cleanup 与主类公共 API 紧密耦合(observe/on 调 dispatch,clear/dispose 调 cleanup),不分离**
- `default-hooks-state.ts` 120 行 = 内部数据结构,封装三个 Map 的增删改查,**纯粹的状态管理,可独立单测**
- `semantics.ts` 200 行 = 5 种语义的纯函数,统一在一个文件 —— **5 个文件每个 80-100 行本质是同模板,合并后便于读者对比共性**
- `types.ts` 250 行 = 8 个核心事件 + 9 个预声明事件(只声明类型,不实现 emit 路由)

> **为什么不按事件拆 5 个 semantics 文件**:`context / tool-call / tool-result / session / other` 5 个文件的纯函数每个 80-100 行,本质是同一种"对 handler 列表跑某种语义"模板的 5 个 case,拆开读者要跳 5 个文件对比共性。这是 § 1.3 警告的"为对称而拆"反例,合并为 `semantics.ts` 一个文件。
>
> **为什么不独立 `emit.ts` / `dispatch.ts` / `cleanup.ts`**:emit 流程(按事件类型路由到对应语义函数)、handler 注册与移除、cleanup 队列管理,都依赖主类的 `handlers / observers / cleanups` 内部状态。强行拆出后,每个文件都只剩 80-150 行 boilerplate,读者要在 3-4 个文件间来回跳。合在 `default-hooks.ts` 内,公共 API + dispatch + cleanup + state 协作一目了然。

**最大单文件**:~300 行(可接受,主类方法紧密耦合)

### 4.4 Task 5: Session 双后端 + env

**目标**:实现 Session 类(树形 entry + 上下文构建 + fork)+ InMemory/JSONL 双后端 + NodeExecutionEnv。

```
packages/agent/src/
├── harness/
│   ├── session/
│   │   ├── types.ts                       # SessionTreeEntry 联合 + 各变体 (~250 行)
│   │   ├── session.ts                     # Session 主类(append / getLeaf / setLeaf / fork)(~350 行,含 fork 合并)
│   │   ├── context-builder.ts             # buildContextEntries + buildContext (~250 行)
│   │   ├── storage.ts                     # SessionStorage 接口 + FileError (~80 行)
│   │   ├── repos/
│   │   │   ├── memory-storage.ts          # 内存 storage 实现 (~150 行)
│   │   │   ├── memory-repo.ts             # 内存 repo(Session 适配器) (~150 行)
│   │   │   ├── jsonl-storage.ts           # JSONL storage 实现 (~200 行)
│   │   │   ├── jsonl-repo.ts              # JSONL repo(Session 适配器) (~200 行)
│   │   │   └── repo-utils.ts              # 共享工具(serialize / deserialize) (~120 行)
│   │   └── index.ts
│   ├── env/
│   │   ├── types.ts                       # ExecutionEnv 接口 + FileError + ExecOptions (~120 行)
│   │   ├── result.ts                      # Result<T, E> 工具类型 (~50 行)
│   │   ├── nodejs.ts                      # NodeExecutionEnv(readFile / writeFile / stat / exec) (~280 行)
│   │   └── index.ts
```

**判断**:
- `session.ts` 350 行(含 fork)虽然较大,但主类 `append / getLeaf / setLeaf / fork` 互相依赖,合在一起反而直观
- `context-builder.ts` 与 `session.ts` 职责不同(一个建树,一个建上下文),分两个文件合理

**为什么 `session.ts` + `fork` 合并(不独立 `fork.ts`)**:
- `fork` 是 session 的一个方法,操作 session 内部状态(树形 entries + leaf),强耦合
- 拆到独立 `fork.ts` 后,读代码的人要跳两个文件才能理解"fork 怎么工作"
- 预估 350 行,远低于 500 软上限
- 若实际接近 500,可拆出 `session-fork.ts` 子模块,但目前没必要预先拆

**最大单文件**:~350 行 ✓

### 4.5 Task 6: 压缩 + 分支摘要

**目标**:实现 `compact()` + `navigateTree()` + branch summary。完整保留 pi 三件套。

```
packages/agent/src/
├── harness/
│   ├── compaction/
│   │   ├── types.ts                       # CompactionSettings / CompactionResult / BranchSummaryResult (~150 行)
│   │   ├── settings.ts                    # DEFAULT_COMPACTION_SETTINGS + shouldCompact 工具函数 (~120 行,合并)
│   │   ├── estimate.ts                    # estimateTokens(基于 chars / 4 启发式) (~80 行)
│   │   ├── prepare.ts                     # prepareCompaction(选保留边界) (~150 行)
│   │   ├── compact.ts                     # compact 主入口 + file-ops 内联(走 session_before_compact 钩子) (~300 行)
│   │   ├── branch-summarization.ts        # generateBranchSummary + collectEntriesForBranchSummary (~250 行)
│   │   └── index.ts
```

**判断**:`compact.ts` 300 行 = 准备 + 压缩 + 写 CompactionEntry + 触发钩子 + 内联 file-ops,是同一件事的多个阶段,合在一起合理。

**为什么 `should-compact.ts` 取消 + `file-ops.ts` 合并**:
- `shouldCompact` 本包内不调用(spec 8.1 明确"仅手动触发",整个 `packages/agent/src/` 搜索 `shouldCompact` 调用 0 次)。既然不调用,单独 80 行文件没意义;并入 `settings.ts` 约 120 行,函数 + 常量共置便于对比
- `extractFileOpsFromMessage` 是 compact 内部使用的工具函数,强耦合;独立 120 行文件 + 主类依赖它,跳文件;直接内联到 `compact.ts` 末尾
- **不是为拆而拆**——两个文件都服务于"compact 主流程",合在一起读最快

**最大单文件**:~300 行(主入口 + file-ops 内联,可接受)

### 4.6 Task 7: Skills + Prompt Templates

**目标**:实现 skills 加载、format、prompt templates 占位符替换。

```
packages/agent/src/
├── harness/
│   ├── skills/
│   │   ├── types.ts                       # Skill 类型 (~100 行)
│   │   ├── format.ts                      # formatSkillsForSystemPrompt + formatSkillInvocation (~200 行)
│   │   ├── parse.ts                       # parseSkillContent(YAML frontmatter) (~150 行)
│   │   ├── load.ts                        # loadSkillFromFile(走 ExecutionEnv) (~120 行)
│   │   └── index.ts
│   ├── prompt-templates/
│   │   ├── types.ts                       # PromptTemplate 类型 (~80 行)
│   │   ├── format.ts                      # formatPromptTemplateInvocation + 占位符替换 (~150 行)
│   │   └── index.ts
```

**最大单文件**:200 行 ✓

### 4.7 Task 8: 队列操作 + 自定义消息示例

**目标**:实现 steer / followUp / nextTurn 三个队列方法 + CustomAgentMessages 演示。

```
packages/agent/src/
├── harness/
│   ├── agent-harness/                     # 3 个职责文件(继承 Task 3 决策,本步只增量 config.ts / prompt.ts)
│   │   ├── agent-harness.ts               # 核心类 - 不变 (~250 行)
│   │   ├── config.ts                      # 配置管理 - 增量 getSteeringMode / getFollowUpMode / setSteeringMode / setFollowUpMode (~220 行)
│   │   ├── prompt.ts                      # 业务入口 - 增量 steer / followUp / nextTurn 三个方法 (~250 行)
│   │   └── queue.ts                       # 队列处理内部逻辑(从 prompt.ts 拆出,避免 prompt.ts 超过 250 行) (~120 行)
│   ├── queue.ts                           # 队列处理纯函数:steer / followUp / nextTurn 三个函数 + QueueMode 行为差异 (~300 行,合并三个原独立文件)
│   └── index.ts                           # 公共 API 重新聚合
```

**为什么合并 `queue/` 子目录的 3 个文件**:
- 三个队列操作(steer / followUp / nextTurn)本质是同一种模式(drain queue + 决定何时投递 + QueueMode 行为差异),**为对称而拆**——这正是 § 1.3 警告的反例
- 合并 `queue.ts` 约 300 行,5 个纯函数(`enqueueSteer` / `drainSteerQueue` / `enqueueFollowUp` / `drainFollowUpQueue` / `enqueueNextTurn`),读者能在一个文件里看到所有 3 种队列处理 + QueueMode 差异
- `agent-harness/queue.ts` 是 harness 内部协作层(120 行,与 prompt.ts 共享 queue.ts 的纯函数),与 `queue.ts` 是"调用方"和"被调用方"关系,不是双重抽象

**预先拆 agent-harness 的好处**(回到 Task 3 的决策):
- Task 3 末尾:`agent-harness/agent-harness.ts` 250 + `config.ts` 200 + `prompt.ts` 150 = 总 ~600 行
- Task 8 末尾:`agent-harness/agent-harness.ts` 250 + `config.ts` 220 + `prompt.ts` 250 + `queue.ts` 120 = 总 ~840 行
- **没有任何单文件超过 500 软上限**
- 如果实际接近 500,可拆出 `prompt-queue.ts` / `config-queue.ts` 等子模块,但目前没必要预先拆

**最大单文件**:~300 行(可接受,队列处理模式统一)

---

## 5. 测试组织

### 5.1 目录镜像原则

测试目录结构镜像源码:

```
src/
├── harness/agent-harness.ts
├── harness/messages.ts
├── harness/system-prompt.ts
__tests__/
├── harness/agent-harness.test.ts
├── harness/messages.test.ts
├── harness/system-prompt.test.ts
```

### 5.2 测试粒度

- 单元测试:每个 `src/<module>/<file>.ts` 配套 `<file>.test.ts`
- 集成测试:用 example(`examples/<NN>-<feature>.ts`)做端到端验证
- 测试**可独立运行**:`pnpm test <file>` 跑单个测试文件

### 5.3 测试文件大小

- 单个 `*.test.ts` ≤ 400 行
- 单个 `describe` 块 ≤ 150 行
- 超过就拆 `describe` 块,或拆到多个测试文件

---

## 6. examples 组织

```
packages/agent/examples/
├── 01-basic.ts                # Task 2: 最小 LLM turn
├── 02-tools.ts                # Task 2: 工具调用演示
├── 03-session.ts              # Task 5: Session 持久化演示
├── 04-compaction.ts           # Task 6: 压缩演示
├── 05-skills.ts               # Task 7: Skills 演示
├── 06-prompt-templates.ts     # Task 7: Prompt Templates 演示
├── 07-hooks.ts                # Task 4: 钩子演示
└── 08-custom-messages.ts      # Task 8: 自定义消息演示
```

每个 example 文件 ≤ 200 行。

---

## 7. 实施流程(每个 Task 通用)

```
1. 写测试文件(全部 case,先 RED)
2. 拆分设计:对照本原则,确认每个新文件大小 ≤ 500 行
3. 写实现(每写一个文件,检查行数)
4. 跑测试(GREEN)
5. 写 example
6. 跑 example 验证
7. 跑 vitest + tsc + pnpm build
8. 暂停,等用户审查
9. 展示 git diff
10. 用户确认后 commit
```

**第 3 步检查**:每写完一个文件立即 `wc -l` 检查:
- < 400 行:OK,继续
- 400-500 行:警觉,评估是否还有合理拆分
- > 500 行:停下,走 § 2.2 确认流程

---

## 8. 违反原则的处理

- **发现文件超 500 行**:停下,先走 § 2.2 确认流程(不是立即拆分)
- **发现目录混乱**:重构,不要"以后再修"
- **重复检查**:每个 Task 结束前,审查所有新文件行数

---

## 9. 修订记录

| 日期 | 修订 | 原因 |
|------|------|------|
| 2026-07-30 | 初版 | Task 2 实施遇到 1000+ 行单文件无法维护的问题后建立 |
| 2026-07-30 | § 4.2 / 4.3 / 4.4 / 4.5 / 4.7 与 Plan 对齐 | 初版 § 4.2 拆 `queries.ts` / `mutators.ts`(按读/写维度)、§ 4.3 拆 `semantics/` 5 文件 + `emit.ts` / `dispatch.ts` / `cleanup.ts`、§ 4.4 独立 `fork.ts`、§ 4.5 独立 `file-ops.ts` / `should-compact.ts`、§ 4.7 独立 `queue/` 4 文件——均属于 § 1.3 警告的"为对称而拆"反例,且与 Plan 口径冲突。本次按 Plan 调整:queries/mutators 合到 config.ts;5 语义合到 semantics.ts,emit/dispatch/cleanup 合到 default-hooks.ts;fork 合到 session.ts;file-ops 内联到 compact.ts,shouldCompact 合到 settings.ts;queue/ 4 文件合到单文件 queue.ts |
