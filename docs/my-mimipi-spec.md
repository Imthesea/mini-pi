# my-mimipi 项目总览 Spec

> 本文档是 my-mimipi 项目的"门面文档",给出当前整体状态、各 Phase 状态、核心约定。
> 详细 spec 见 `docs/superpowers/specs/` 目录;实施日志见 `docs/project-log/` 目录;用户文档见 `docs/` 根目录。

## 项目定位

my-mimipi 是从 Anthropic 的 [pi-mono](https://github.com/badlogic/pi-mono) 精简出来的 monorepo 项目,保留核心能力、移除冗余复杂度,目标是用最小代码量复现一个可用的 AI Agent 编程助手。

**精简前后规模对比**:

| 包 | pi 原版 | my-mimipi | 压缩比 |
|----|---------|-----------|--------|
| `@mimi/ai` (Phase 01) | ~25,000 行 / 35+ Provider | ~1,200 行 / 3 Provider | ~21x |
| `@mimi/agent` (Phase 02) | ~10,000+ 行 / 完整 agent | ~9,400 行 / 完整 agent | ~1x |
| `@mimi/coding-agent` (Phase 02.5) | ~6,000 行 / CLI | (Phase 02.5 待开始) | — |

**monorepo 结构**:

```
my-mimipi/
├── packages/
│   ├── ai/                    # AI 层(Provider/Models/EventStream)
│   ├── agent/                 # Agent 层(AgentHarness/session/hooks/...)
│   └── coding-agent/          # CLI 编程助手(Phase 02.5 待开始)
├── docs/                      # 文档
│   ├── agent-harness.md       # 主类(142 行)
│   ├── hooks.md               # 钩子系统(137 行)
│   ├── session.md             # 会话系统(163 行)
│   ├── compaction.md          # 压缩(163 行)
│   ├── skills-and-templates.md# Skills + Templates(187 行)
│   ├── project-log/           # 实施日志
│   └── superpowers/           # 详细 spec/plan
└── package.json               # pnpm workspace
```

## Phase 状态总览

| Phase | 标题 | 状态 | 完成日期 | Commit 数 | 文档 |
|-------|------|------|----------|-----------|------|
| **Phase 01** | AI 层核心 | ✅ 完成 | 2026-07-29 | (单独分支) | [log](../../project-log/phase-01-ai-core/log.md) |
| **Phase 02** | Agent 层 | ✅ 完成 | 2026-08-01 | 9 | [log](../../project-log/phase-02-agent/log.md) |
| **Phase 02.5** | CLI 编程助手 | 🔜 计划 | — | — | [plan](../../superpowers/plans/2026-07-30-phase02.5-coding-agent-plan.md) |

## Phase 02 核心交付(已完成)

`@mimi/agent` 包完整能力,包括:

- **AgentHarness 主类**:14 个 getter/setter + 8 个业务入口(prompt / compact / navigateTree / skill / promptFromTemplate / steer / followUp / nextTurn)
- **agent-loop 核心循环**:LLM → tool → repeat 状态机,支持重试 / abort / beforeToolCall / afterToolCall
- **钩子系统**:20 事件(8 核心 + 12 预声明)+ 5 种语义纯函数 + Handler/Observer 角色分离
- **Session 双后端**:InMemory + JSONL,支持 fork / 11 种 Entry 联合 / 压缩感知 buildContext
- **压缩 + 分支摘要**:手动触发,带 file-ops 提取
- **Skills + Prompt Templates**:SKILL.md frontmatter 解析 + {{key}} 占位符
- **队列操作**:steer / followUp / nextTurn,支持 all / one-at-a-time 排空模式
- **5 篇中文用户文档**:agent-harness / hooks / session / compaction / skills-and-templates

**最终验证状态**(2026-08-01):

| 维度 | 数值 |
|------|------|
| 源文件数 | 73 个 |
| 测试文件数 | 35 个 |
| 测试用例 | 499 全 pass |
| examples | 7 个(全部真实 DeepSeek API 验证) |
| 中文文档 | 5 篇(共 790 行) |
| Commit 数 | 9 个(`9f6be26` → `9f29334`) |

## 工程原则

详见 [2026-07-30-phase02-engineering-principles.md](../../superpowers/specs/2026-07-30-phase02-engineering-principles.md)。核心点:

1. **单文件 500 软限**:超过需在文件头加 explicit justification
2. **依赖注入优于单例**:`ExecutionEnv` / `streamFn` / `model` 全部走 options 注入
3. **私有字段封装**:`#field` + getter/setter,业务方法通过 `xxx-op.ts` 桥接(不直接暴露)
4. **TDD 红绿循环**:测试先于实现,`pnpm test` = `vitest run && tsc --noEmit`
5. **文档与代码同步**:每个 Task 完成后,立即更新 spec / plan / log

## 核心约定

- **沟通语言**:中文(user preference)
- **commit 规范**:Conventional Commits,中文 commit message body 可选
- **文件路径引用**:用户文档用 `file:///` 协议绝对路径(便于跨平台跳转)
- **流程图**:ASCII 纯文本,避免 mermaid 等需要渲染的格式
- **依赖管理**:pnpm workspace,所有包名 `@mimi/*`
- **测试覆盖**:核心模块每个源文件 5-8 个测试用例
- **LLM 调用**:所有 examples 优先用真实 API(DeepSeek),mock 仅在内部测试用

## 下一步

**Phase 02.5(CLI 编程助手)**:
- 设计 spec 已就绪:`docs/superpowers/specs/2026-07-30-phase02.5-coding-agent-design.md`
- 实施 plan 已就绪:`docs/superpowers/plans/2026-07-30-phase02.5-coding-agent-plan.md`
- 启动时间:按用户决定

**Phase 03(浏览器/Web UI 客户端)**:
- 暂未规划,详见 pi `packages/webui/` 源参考

---

**最后更新**:2026-08-01(Phase 02 完成)
