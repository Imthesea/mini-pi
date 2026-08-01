# Skills 与 Prompt Templates

> 本文档基于 `@mimi/agent` 包的 Skills / Prompt Templates 子系统实际代码整理。
> 详细设计 spec 见 [2026-07-30-phase02-agent-design.md](./superpowers/specs/2026-07-30-phase02-agent-design.md);
> 源代码入口: [skills/index.ts](file:///f:/allProject/githubProject/my-mimipi/packages/agent/src/harness/skills/index.ts) + [prompt-templates/index.ts](file:///f:/allProject/githubProject/my-mimipi/packages/agent/src/harness/prompt-templates/index.ts)。

## 概述

Skills 和 Prompt Templates 是 AgentHarness 的"prompt 内容复用机制",两者职责不同但**形式相似**:

- **Skill**:可复用的"行为脚本",通常来自 `SKILL.md` 文件(YAML frontmatter + Markdown body),通过 `setResources({ skills })` 注入到 harness;harness 把所有 skill 的 name + description 渲染成 system prompt 里的 XML 块,让 LLM 知道"我有哪些能力";当用户/上下文提示需要某个 skill 时,通过 `harness.skill(name, args)` 调起,把 skill 的 body 作为 prompt 内容(可带占位符参数)注入。
- **Prompt Template**:可复用的"prompt 模板",通过 `setResources({ promptTemplates })` 注入;`harness.promptFromTemplate(name, args)` 把模板的 `{{key}}` 占位符替换为 args,然后调 `prompt()`。

两者都用 `{{key}}` 占位符语法(允许字母/数字/下划线/短横线,周围允许空格),**未提供的占位符保留原样不抛错**(避免破坏 markdown),都是简单字符串替换不做表达式求值。

## 关键概念

### 1. Skill 文件格式(`SKILL.md`)

```
---
name: git-commit
description: 提交代码到 git,自动写 commit message
---

# Git Commit Skill

## 工作流程

1. `git status` 查看变更
2. `git diff --stat` 看变更规模
3. 用 LLM 生成 commit message 模板
4. `git commit -m "..."`

## 约束

- 不提交 {{branch}} 之外的分支
- commit message 必须中文
```

| 字段 | 必填 | 用途 |
|------|------|------|
| frontmatter `name` | ✅ | 唯一名,小写字母 + 短横线 |
| frontmatter `description` | ✅ | 一句话描述,进 system prompt |
| body (Markdown) | ✅ | skill 调起时注入的 prompt 内容 |

### 2. Prompt Template 结构

```typescript
interface PromptTemplate {
  name: string;          // 唯一名(在 resources.promptTemplates 中)
  description?: string;  // 可选描述(不影响调起)
  content: string;       // 模板内容,含 {{key}} 占位符
}
```

`PromptTemplate` 通常在代码中**直接构造**(`new PromptTemplate(...)` 或字面量),不走文件系统(与 Skill 通过 `SKILL.md` 加载不同)。

### 3. 占位符语法(共享)

| 语法 | 匹配 | 不匹配 |
|------|------|--------|
| `{{name}}` | `{{name}}` / `{{ name }}` / `{{name }}` | `{name}` / `{{name}}}` |
| `{{ key }}` | `{{key}}` / `{{ key }}` / `{{ key}}` | `{{key1}}` |
| `{{my-key}}` | `{{my-key}}` / `{{ my-key }}` | `{{my_key}}`(下划线不分隔) |

占位符 key 由**用户提供的 args key 决定**,**未在 args 中提供的占位符保留原样**。

### 4. Resources 注入

`AgentHarnessOptions.resources` 是 Skill / PromptTemplate 字典的容器:

```typescript
interface AgentHarnessResources {
  skills: Skill[];
  promptTemplates: PromptTemplate[];
}
```

构造时通过 `new AgentHarness({ ..., resources: { skills, promptTemplates } })` 注入;运行时通过 `harness.setResources({ ... })` 替换。**修改 resources 不会自动 emit `resources_update` 钩子**(钩子预声明但未启用)。

### 5. Skill vs Prompt Template 区别

| 维度 | Skill | Prompt Template |
|------|-------|----------------|
| 来源 | 文件系统(`SKILL.md`)+ 内存 | 纯内存(代码中构造) |
| frontmatter | 必需(name + description) | 无,直接构造对象 |
| system prompt 注入 | ✅(XML 块列出所有 skill) | ❌(不进 system prompt) |
| 调起方式 | `harness.skill(name, args)` | `harness.promptFromTemplate(name, args)` |
| 占位符语法 | `{{key}}` | `{{key}}` |
| XML 转义 | ✅(`<` `>` `&` `"` 转义) | ❌(纯文本替换) |

## API 速查

### Skills 模块

```typescript
// 类型
export interface Skill {
  name: string;
  description: string;
  content: string;                 // 调起时注入的 markdown body
}

export interface SkillFrontmatter {
  name: string;
  description: string;
}

export interface ParsedSkill extends SkillFrontmatter {
  content: string;
}

export type SkillArgs = Record<string, string>;

// 纯函数
export function parseSkillContent(content: string): ParsedSkill;
export function loadSkillFromFile(env: ExecutionEnv, path: string): Promise<Skill>;
export function formatSkillsForSystemPrompt(skills: readonly Skill[]): string;
export function formatSkillInvocation(skill: Skill, args?: SkillArgs): string;

// 错误
export class SkillParseError extends Error {
  code: "missing_frontmatter" | "unclosed_frontmatter" | "missing_field";
}
```

### Prompt Templates 模块

```typescript
// 类型
export interface PromptTemplate {
  name: string;
  description?: string;
  content: string;
}

export type PromptTemplateArgs = Record<string, string>;

// 纯函数
export function formatPromptTemplateInvocation(
  template: PromptTemplate,
  args: PromptTemplateArgs,
): string;
```

### AgentHarness 集成

```typescript
// 资源注入
harness.setResources({
  skills: Skill[],
  promptTemplates: PromptTemplate[],
}): void

harness.getResources(): AgentHarnessResources | undefined

// Skill 调起
harness.skill(name: string, args?: SkillArgs): Promise<void>
//   1. 从 resources.skills 找到 skill
//   2. formatSkillInvocation(skill, args)
//   3. 调 harness.prompt(调起文本)
//
// Prompt 模板调起
harness.promptFromTemplate(name: string, args: PromptTemplateArgs): Promise<void>
//   1. 从 resources.promptTemplates 找到 template
//   2. formatPromptTemplateInvocation(template, args)
//   3. 调 harness.prompt(替换后文本)
```

## 流程图

### `loadSkillFromFile` 流程

```
loadSkillFromFile(env, "skills/git-commit/SKILL.md")
  │
  ▼
[1] env.readFile(path)
  │   返回 Result<string, FileError>
  │
  ▼
[2] getResultOrThrow(result, "loadSkillFromFile 读文件失败")
  │   ← Err 时 throw FileError
  │   ← Ok 时返回 content 字符串
  │
  ▼
[3] parseSkillContent(content)
  │   │
  │   ├─ 检查 content.startsWith("---")
  │   │   ← 不通过 throw SkillParseError("missing_frontmatter")
  │   │
  │   ├─ 找下一个 --- 闭合行
  │   │   ← 找不到 throw SkillParseError("unclosed_frontmatter")
  │   │
  │   ├─ 解析 name: / description: 行
  │   │   ← 缺字段 throw SkillParseError("missing_field")
  │   │
  │   └─ 提取 body(闭合 --- 之后到末尾)
  │
  ▼
[4] return Skill { name, description, content: body }
```

### `harness.skill()` 调起流程

```
harness.skill("git-commit", { branch: "main" })
  │
  ▼
[1] assertNotDisposed()
  │
  ▼
[2] 从 resources.skills 找到 name === "git-commit" 的 skill
  │   ← 找不到抛 AgentHarnessError("skill_not_found")
  │
  ▼
[3] formatSkillInvocation(skill, { branch: "main" })
  │   │   ├─ 遍历 args
  │   │   ├─ 对每个 key:result.replace(/\{\{\s*key\s*\}\}/g, value)
  │   │   └─ 未提供的占位符保留原样
  │   │
  │   └─ 返回替换后的 markdown 文本
  │
  ▼
[4] harness.prompt(调起文本)
  │   ← 后续走正常 prompt() 流程
  │     (phase 转换、钩子、session 写入等)
  │
  ▼
return
```

### System Prompt 注入流程

```
构造 harness { resources: { skills: [skillA, skillB, ...] } }
  │
  ▼
每次 prompt() 系统会:
  │
  ▼
[1] buildSystemPrompt(skills)
  │   ├─ formatSkillsForSystemPrompt(skills)
  │   │   │
  │   │   ├─ 空数组 → return ""
  │   │   │
  │   │   └─ 非空 → 拼 XML 块
  │   │       <available_skills>
  │   │       <skill>
  │   │         <name>skillA</name>
  │   │         <description>...</description>
  │   │       </skill>
  │   │       <skill>
  │   │         <name>skillB</name>
  │   │         <description>...</description>
  │   │       </skill>
  │   │       </available_skills>
  │   │
  │   └─ 把 XML 块拼到 system prompt 的 skills 段
  │
  ▼
[2] LLM 看到完整 system prompt + user message
  │
  ▼
[3] LLM 自主决定是否在响应中"调起"某个 skill(通过用户消息引用 skill 名称)
  │
  ▼
[4] 外部代码(或 agent 自己)调 harness.skill("skillA", args)
```

### `formatSkillInvocation` 占位符替换

```
skill.content:
  "# Git Commit\n\n提交 {{branch}} 分支的变更"
  │
  ▼
args: { branch: "main" }
  │
  ▼
遍历 args:
  key = "branch", value = "main"
  regex = /\{\{\s*branch\s*\}\}/g
  result = result.replace(regex, "main")
  │
  ▼
result:
  "# Git Commit\n\n提交 main 分支的变更"
  │
  ▼
return result
```

## 已知限制

1. **占位符是简单字符串替换,不做表达式求值**:`{{a + b}}` 不会被计算;类型转换 / 算术 / 条件分支都不支持。
2. **未提供的占位符保留原样**:`harness.skill("foo")` 而 `foo` 的 content 含 `{{arg}}` 时,LLM 会看到 `{{arg}}` 原样,不会自动报错;**调用方需自行保证 args 完整**。
3. **Skill name 唯一性约束由调用方保证**:`resources.skills` 中不允许两个同名 skill,代码不检查;后注册的会覆盖前面的查找结果(`find` 返回第一个)。
4. **`loadSkillFromFile` 不缓存**:每次调用都走 `env.readFile`,无内存缓存;高频调用时建议自行缓存。
5. **frontmatter 解析只支持 flat key-value**:`parseSkillContent` 不支持嵌套 YAML / 数组 / 多行字符串;`name: "a", "b"` 这种带逗号的字符串会失败。
6. **`content` 不转义 Markdown**:`formatSkillInvocation` / `formatPromptTemplateInvocation` 假设输出是 markdown 文本,不转义 `*` `_` 等 markdown 特殊字符;调用方需保证 args 值是合法 markdown 片段。
7. **Skill description 不进 system prompt 外的任何地方**:`formatSkillsForSystemPrompt` 只输出 name + description;skill 的 `content` 只在 `harness.skill()` 调起时使用。
8. **`resources_update` 钩子未启用**:`setResources` 不会 emit 钩子;外部需要追踪 resources 变更时需自行包装 setResources 或注册 `model_update` 替代。
9. **prompt-template 不支持 description 进 system prompt**:与 skill 不同,`prompt-templates` 没有 XML 块注入,LLM 不知道有哪些模板可用;调用方需自己告诉 LLM "我有 `code-review` 模板,你可以用 `harness.promptFromTemplate('code-review', { prUrl: '...' })` 调起"。
