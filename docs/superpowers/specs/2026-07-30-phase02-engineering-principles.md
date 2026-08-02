# Phase 02 Agent 层工程原则

> **目的**:为 `@mimi/agent` 包(Task 2~12)实施提供可执行的标准。
> **配套**:[实施 Plan](../plans/2026-07-30-phase02-agent-plan.md) / [设计 Spec](./2026-07-30-phase02-agent-design.md)
> **强制级别**:本文档是 Phase 02 实施的最高决策依据。所有代码改动必须以本文档为准。

---

## 1. 核心原则

### 1.1 可读性 = 让读者第一遍能看懂

**唯一标准**:一个 TypeScript 开发者第一次接触这段代码时,能用最少时间理解"它在做什么、为什么这么写、我想改的地方在哪里"。

**4 个检验问题**(任何技术决策都要回这 4 个问题):

1. **拆 vs 合** — 拆完后读者花多少时间理解?看 3+ 文件才能懂 → 拆过头了
2. **抽象 vs 直白** — 抽象后读者花多少时间理解?没复用收益 → 直白
3. **加注释 vs 不加** — 因为代码本身没说清,不是为了显得专业
4. **私有 vs 公开** — 选哪种让读者更容易跟代码?

**3 个快速判断**(拆文件前必答,任一"否"则保持合并):

1. 拆完后,读者要打开几个文件才能理解一个功能?3+ → 拆过头
2. 拆出去的文件能独立测试吗(有自己的 `*.test.ts`)?不能 → 保持合并
3. 拆出去的文件脱离主类还有独立意义吗(可被其他模块复用 / 单独维护)?没有 → 保持合并

**不接受的理由**:

- 以"未来扩展性"为由增加阅读成本
- 以"对称 / 整齐"为由牺牲阅读速度
- 以"复用最大化"为由过度抽象
- 以"封装性"为由引入 `#` 硬私有字段
- 以"职责分离"为由把主类方法拆到子文件

**设计哲学**(所有实施的总纲):

- **主类方法直接写在主类里**(原 pi 风格),不拆"协作层"
- **真正可独立测的纯函数/模块**保留独立子目录
- **`#` → `private`**,字段访问轻量
- **1:1 翻译原 pi 的方法体**,不复刻 API 形状而用"自认更好"的设计填充

### 1.2 文件行数规则(3 类文件,3 套规则)

| 类型 | 行数 | 说明 |
|------|------|------|
| **主类**(`AgentHarness` / `Session` / `DefaultAgentHarnessHooks` 等) | 500-1000 行 OK | 天然强内聚,字段+方法互相依赖,合在一起读最快。**超过 500 行不需要 justification** |
| **真独立模块**(`compaction/` / `session/` / `hooks/` / `messages/` / `skills/` / `prompt-templates/`) | 单文件 ≤ 300 行 | 有自己的目录、有独立测试、可单独维护 |
| **其他文件**(既不是主类,也不是真独立模块) | **不存在** | 没有"中间地带" — 该合回主类 |

**判断"主类 vs 真独立模块 vs 不存在"**:

- **主类** = 状态机 + 业务入口,字段多方法互相依赖
- **真独立模块** = 纯函数/独立类,**能独立写测试**,脱离主类还有独立价值
- **不存在** = 既不是主类也不满足"独立可测"的文件 — 这种就是**该合回主类**

**主类超 1000 行的处理**:超 1000 时评估 — 主类内是否有真独立模块?有 → 抽到独立目录 + 独立测试;没有(全是相互依赖的状态+方法)→ 保持合并,在主类内用注释分章节。**不要因为"看起来太大"就用 § 1.3 禁止的"胶水子文件"模式强行拆。**

### 1.3 6 条反模式禁令(强制红线)

#### ❌ 反模式 1:`#` 硬私有字段

```ts
// ❌ 反模式
class AgentHarness {
  #options: AgentHarnessOptions;        // this.#xxx 视觉重 1 档
  #runtime: { model: Model<any>; ... };
  #steerQueue: readonly AgentMessage[] = [];
  // 100+ 处 this.#xxx 访问,视觉噪声爆表
}

// ✅ 正模式
class AgentHarness {
  private options: AgentHarnessOptions;
  private runtime: { model: Model<any>; ... };
  private steerQueue: AgentMessage[] = [];
}
```

**为什么禁**:`#` 字段 TS 项目无实际收益(无子类 / 内部 `as any` 没用过),且导致"主类不能拆"的循环论证。

#### ❌ 反模式 2:把整个 `this` 当参数传出去

```ts
// ❌ 反模式
return buildHookContext({
  harness: this,
  loadSessionMessages: (s) => this.#loadSessionMessages(s),  // 闭包 + this 嵌套
});

// ✅ 正模式
return buildHookContext({
  env: this.options.env,           // 只传值
  session: this.options.session,
  loadSessionMessages: (s) => this.loadSessionMessages(s),   // 方法引用
});
```

**为什么禁**:破坏代码边界,读者无法判断"这个外部函数能改哪些状态"。

#### ❌ 反模式 3:闭包委托(`#buildXxxDeps()`)

```ts
// ❌ 反模式
#buildQueueOpDeps(): QueueOpDeps {
  return {
    getSteerQueue: () => this.#steerQueue,
    setSteerQueue: (q) => { this.#steerQueue = q; },
  };
}
steer(text) { runSteerOp(this.#buildQueueOpDeps(), text); }  // 跳 3 个文件

// ✅ 正模式
steer(text) {
  this.steerQueue.push(createUserMessage(text, options?.images));
  void this.emitQueueUpdate();
}
```

**为什么禁**:状态留在类,逻辑跑到外部纯函数,再用闭包把状态"借"过去。**伪拆分**。

#### ❌ 反模式 4:主类方法"搬运"到子文件

```ts
// ❌ 反模式
export async function executeTurn(deps: { runtime; hooks; session; streamFn; ... }, ...) { ... }

// ✅ 正模式
class AgentHarness {
  private async executeTurn(text, options?): Promise<AgentMessage[]> {
    // 直接 this.runtime / this.hooks / this.options.session,无闭包
  }
}
```

**为什么禁**:拆到外部纯函数后要 8+ deps 闭包把内部状态"借"过去。读 `prompt` 怎么工作要跳 2 个文件 + 看 8 个 deps。

#### ❌ 反模式 5:为拆而拆的"协作层"(`runXxxOp(deps, ...)`)

```ts
// ❌ 反模式
async compact(): Promise<string | undefined> {
  return runCompactOp({ session, model, hooks, streamFn });  // 4 个 deps
}
// + runCompactOp(deps, customInstructions) { ... }  // 协作层 60 行

// ✅ 正模式
async compact(customInstructions?: string): Promise<...> {
  if (this.phase !== "idle") throw ...;
  this.phase = "compaction";
  try {
    const preparation = prepareCompaction(branchEntries, DEFAULT_COMPACTION_SETTINGS);
    // ... 直接处理
  } finally { this.phase = "idle"; }
}
```

**为什么禁**:`runXxxOp` 不能脱离主类状态跑(它要 4+ deps),**不是真独立可测,只是"看起来独立"**。业务方法(操作主类状态)就是主类方法,不是纯函数,不是"协作层"。

#### ❌ 反模式 6:堆 N 个胶水子文件

```ts
// ❌ 反模式:主类旁边堆 9 个胶水子文件
agent-harness/
  agent-harness.ts        (主类,但大量"委托调用")
  event-bus.ts            (68 行)
  subscription-factory.ts (50 行)
  hooks-bridge.ts         (118 行)
  turn-execution.ts       (180 行)
  hook-context-builder.ts (85 行)
  compaction-ops.ts       (172 行)
  skill-ops.ts            (79 行)
  queue.ts                (107 行)
  is-agent-harness.ts     (13 行)

// ✅ 正模式:主类单文件,真独立功能模块才拆子目录
agent-harness.ts          (主类,1000 行,直接 this.xxx 操作)
hooks/                    (真独立模块)
session/                  (真独立模块)
compaction/               (真独立模块)
```

**为什么禁**:每个子文件 50-200 行,纯转发主类方法 + 一点点重写。文件名看不出是 `AgentHarness` 的什么方法。**这些"独立可测"的子文件其实不能独立测 — 它们依赖主类内部状态**。拆完后**总行数变多**。

**判断标准**:`runXxxOp(deps, ...)` 接收 ≥ 4 个 deps → 大概率该合回主类(因为 4+ deps = 状态机,不是纯函数)。

### 1.4 主类内部 helper 模式(4 类小 helper + 1 个步骤化)

**问题**:撤掉 9 个胶水子文件后,主类内又出现"小重复"——重复的 `as` 强转 / 重复的 `void this.hooks.emit(...)` / 90+ 行带编号注释的方法。

**正模式**:在主类内抽 4 类**纯转发型内部 helper**(不引新文件,不拆"协作层")。

#### ✅ 正模式 A:`getSessionInternal()` — 集中类型断言

```ts
/** 取 session 实例(内部用,统一做类型断言) */
private getSessionInternal(): Session<any> | undefined {
  return this.options.session as Session<any> | undefined;
}
```

**应用**:5 处 `const session = this.options.session as Session<any> | undefined` → 5 处 `const session = this.getSessionInternal()`。

**为什么不是"协作层"**:helper 只做 1 行类型断言,无业务逻辑,不能独立测试。

#### ✅ 正模式 B:`appendSessionMessage()` — 集中 fire-and-forget 块

```ts
/** 写消息到 session(失败只 log,不阻塞 turn) */
private appendSessionMessage(session: Session<any> | undefined, message: AgentMessage): void {
  if (!session) return;
  void session.appendMessage(message).catch((err) => {
    console.error("[AgentHarness] session.appendMessage failed:", err);
  });
}
```

**应用**:2 处 5 行 `if (session) { void session.appendMessage(...).catch(...) }` → 2 处 1 行调用。

#### ✅ 正模式 C:`emitAsync()` — 集中 fire-and-forget emit

```ts
/** 派发钩子事件(异步 fire-and-forget) */
private emitAsync(event: { type: string; [key: string]: unknown }): void {
  void this.hooks.emit(event as any);
}
```

**应用**:8 处 `void this.hooks.emit({...} as any)` → 8 处 `this.emitAsync({...})`。

**为什么 `as any` 集中到这里**:HookEvent 泛型要求字面量带 `__result` 字段,TS 写不出来。集中到 helper 后,业务方法里**不再有 `as any`**,后续如放宽 HookEvent 类型可一处清理。

#### ✅ 正模式 D:`emitAwait<T>()` — 集中 await + 强转 emit

```ts
/** 派发钩子事件并 await handler 结果 */
private async emitAwait<T = unknown>(
  event: { type: string; [key: string]: unknown },
): Promise<T | undefined> {
  return (await this.hooks.emit(event as any)) as T | undefined;
}
```

**应用**:2 处 `(await this.hooks.emit({...} as any)) as { cancel?: boolean; ... } | undefined` → 2 处 `await this.emitAwait<{ cancel?: boolean; ... }>({...})`。

**比 C 更优**:调用方用 generic 声明期望返回类型,避免强转 `as any` 泄露到调用方。

#### ✅ 正模式 E:`executeTurn` 拆为 5 个命名步骤

**问题**:`executeTurn` 一个方法 90+ 行,带 9 个 `// 0.~9.` 编号注释 — 这是"方法做太多事"的最强信号。

**正模式**:主方法只剩 28 行编排,5 个步骤抽出为命名私有方法:

```ts
private async executeTurn(text, options, startHookResult): Promise<AgentMessage[]> {
  // 1. 准备输入
  const { userMessage, nextTurnMessages } = this._prepareTurnInput(text, options?.images);
  // 2. 同步 session 状态
  this._syncSessionForTurn(userMessage);
  // 3. 构造 prompt
  const systemPrompt = await this._buildTurnPrompt(startHookResult);
  const initialMessages = this._combineInitialMessages(nextTurnMessages, userMessage, startHookResult);
  // 4. 构造 AgentContext + 走 context 钩子
  const context = await this._buildTurnContext(initialMessages, systemPrompt);
  // 5. 跑 agent-loop,转发事件
  return await this._runAgentLoopAndForward(initialMessages, context);
}
```

**关键判断**:5 步 vs 9 步的差别 — 5 步是"主类方法做 N 件事",9 步是"主类方法当脚本使"。**当方法体出现 `// 0.` `// 1.` 编号注释时,就是拆分信号**。

#### ❌ 反模式 7:把"内部 helper"误拆到子文件

```ts
// ❌ 反模式
harness/agent-harness.ts          (主类)
harness/agent-harness-helpers.ts  (4 个 helper,~60 行)
harness/agent-harness-types.ts    (内部类型,~30 行)
```

**为什么禁**:`emitAsync` 调 `this.hooks.emit(...)` 必须传 `this`,要么闭包闭包再闭包;`getSessionInternal()` 同样要闭包。拆出去后,helper 文件要 import 类型 + 接收 `this`,反而比"主类内直接写"难读。

**判断标准**:helper 只依赖 `this.xxx` 单点状态 / 调 `this.xxx` 单点方法 → 留主类;helper 调 `this.xxx1` / `this.xxx2` / `this.xxx3` → 才能算"真独立可测" → 才考虑拆。

---

## 2. 命名约定

| 类型 | 命名 | 例子 |
|------|------|------|
| 公共 API | `<feature>.ts` 单数 | `agent-loop.ts` / `agent-harness.ts` |
| 内部模块 | `<concern>.ts` | `messages.ts` / `system-prompt.ts` |
| 内部子目录 | `<sub-feature>/` | `session/` / `compaction/` / `hooks/` |
| 测试 | `<feature>.test.ts` | `agent-harness.test.ts` |
| 例子 | `<NN>-<feature>.ts` | `01-basic.ts` / `03-session.ts` |

**子目录展开模式**:单文件超过 300 行时,转为子目录(`index.ts` 聚合 + 主文件 + 分片文件),外部 import 路径可保持不变。**公共 API 文件只导出符号 + 编排,实现细节不导出**;内部模块用 `index.ts` 显式控制对外;**不用 `export *`**。

---

## 3. 测试 + examples 规则

**测试粒度**:
- 单元测试:每个真独立模块配套 `*.test.ts`,**可独立运行**(`pnpm test <file>`)
- 集成测试:用 example(`examples/<NN>-<feature>.ts`)做端到端验证

**测试文件大小**:单个 `*.test.ts` ≤ 400 行,单个 `describe` ≤ 150 行,超过就拆 describe 块或拆文件。

**examples**:`packages/agent/examples/01-08-*.ts`,每个 ≤ 200 行,从 01 顺序递增(01-basic / 03-session / 04-compaction / 05-skills / 06-prompt-templates / 07-hooks / 08-custom-messages)。
