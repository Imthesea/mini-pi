# Subagent 示例

将任务委托给具有隔离上下文窗口的专用子代理。

## 功能特性

- **隔离上下文**：每个子代理在独立的 `mimi` 进程中运行
- **流式输出**：实时查看工具调用和进度
- **并行流式**：所有并行任务同时流式更新
- **中止支持**：Ctrl+C 传播以终止子代理进程

## 目录结构

```
subagent/
├── README.md            # 本文件
├── index.ts             # 扩展入口
├── agents.ts            # 代理发现逻辑
├── agents/              # 示例代理定义
│   ├── scout.md         # 快速侦察，返回压缩后的上下文
│   ├── planner.md       # 创建实现计划
│   ├── reviewer.md      # 代码审查
│   └── worker.md        # 通用型（完整能力）
└── prompts/             # 工作流预设（提示模板）
    ├── implement.md     # scout -> planner -> worker
    ├── scout-and-plan.md    # scout -> planner（不执行实现）
    └── implement-and-review.md  # worker -> reviewer -> worker
```

## 安装

从仓库根目录开始，创建文件符号链接：

```bash
# 链接扩展（必须在包含 index.ts 的子目录中）
mkdir -p ~/.mimi/extensions/subagent
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/index.ts" ~/.mimi/extensions/subagent/index.ts
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/agents.ts" ~/.mimi/extensions/subagent/agents.ts

# 链接代理
mkdir -p ~/.mimi/agents
for f in packages/coding-agent/examples/extensions/subagent/agents/*.md; do
  ln -sf "$(pwd)/$f" ~/.mimi/agents/$(basename "$f")
done

# 链接工作流提示
mkdir -p ~/.mimi/prompts
for f in packages/coding-agent/examples/extensions/subagent/prompts/*.md; do
  ln -sf "$(pwd)/$f" ~/.mimi/prompts/$(basename "$f")
done
```

## 安全模型

此工具执行一个独立的 `mimi` 子进程，带有委托的系统提示和工具/模型配置。

**项目级代理**（`.mimi/agents/*.md`）是仓库控制的提示，可以指示模型读取文件、运行 bash 命令等。

**默认行为**：仅从 `~/.mimi/agents` 加载**用户级代理**。

要启用项目级代理，传入 `agentScope: "both"`（或 `"project"`）。仅对你信任的仓库执行此操作。

## 用法

### 单个代理
```
Use scout to find all authentication code
```

### 并行执行
```
Run 2 scouts in parallel: one to find models, one to find providers
```

### 链式工作流
```
Use a chain: first have scout find the read tool, then have planner suggest improvements
```

### 工作流提示
```
/implement add Redis caching to the session store
/scout-and-plan refactor auth to support OAuth
/implement-and-review add input validation to API endpoints
```

## 工具模式

| 模式 | 参数 | 描述 |
|------|-----------|-------------|
| 单个 | `{ agent, task }` | 一个代理，一个任务 |
| 并行 | `{ tasks: [...] }` | 多个代理并发运行（最多 8 个，4 个同时执行） |
| 链式 | `{ chain: [...] }` | 顺序执行，支持 `{previous}` 占位符 |

## 代理定义

代理是带有 YAML frontmatter 的 markdown 文件：

```markdown
---
name: my-agent
description: What this agent does
tools: read_file, grep, find, ls
---

System prompt for the agent goes here.
```

**位置：**
- `~/.mimi/agents/*.md` - 用户级（始终加载）
- `.mimi/agents/*.md` - 项目级（仅在 `agentScope: "project"` 或 `"both"` 时加载）

当 `agentScope: "both"` 时，项目代理覆盖同名的用户代理。

## 示例代理

| 代理 | 用途 | 模型 | 工具 |
|-------|---------|-------|-------|
| `scout` | 快速代码侦察 | 默认 | read_file, grep, find, ls, bash |
| `planner` | 实现计划 | 默认 | read_file, grep, find, ls |
| `reviewer` | 代码审查 | 默认 | read_file, grep, find, ls, bash |
| `worker` | 通用型 | 默认 | （所有默认工具） |

## 工作流提示

| 提示 | 流程 |
|--------|------|
| `/implement <query>` | scout -> planner -> worker |
| `/scout-and-plan <query>` | scout -> planner |
| `/implement-and-review <query>` | worker -> reviewer -> worker |

## 错误处理

- **退出码 != 0**：工具返回错误及 stderr/输出
- **stopReason "error"**：LLM 错误传播并附带错误消息
- **stopReason "aborted"**：用户中止（Ctrl+C）终止子进程，抛出错误
- **链式模式**：在第一个失败步骤停止，报告失败的步骤

## 限制

- 并行模式下模型可见输出每个任务上限 50 KB；完整结果保留在工具详情中
- 每次调用重新发现代理（允许会话中编辑）
- 并行模式限制为 8 个任务，4 个并发
