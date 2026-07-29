# my-mimipi

从 [pi](https://github.com/earendil-works/pi) 项目精简而来的 AI Agent 项目。逐层构建，逐步验证。

## 当前状态

**Phase 01 完成** ✅ — AI 层（`packages/ai`）已实现。

- 3 个 Provider：Anthropic (mock) / OpenAI / DeepSeek ✅
- 29 个单元测试通过
- DeepSeek 真实 API 流式对话 + 工具调用 + 多轮对话验证通过

## 快速开始

```bash
pnpm install
pnpm test
```

运行示例（需要 DeepSeek API Key）：

```bash
cp packages/ai/.env.example packages/ai/.env
# 编辑 .env 填入 DEEPSEEK_API_KEY
cd packages/ai && npx tsx examples/03-deepseek-chat.ts
```

## 文档

- 主方案：`my-minipi-spec.md`
- 详细设计：`docs/superpowers/specs/`
- 实施计划：`docs/superpowers/plans/`
- 项目日志：`docs/project-log/`

## 架构

```
packages/ai/     ← AI 层（已完成）
packages/agent/  ← Agent 运行时（待开发）
```
