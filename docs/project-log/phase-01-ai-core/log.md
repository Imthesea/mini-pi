# Phase 01: AI 层核心实现 — 项目日志

> 开始: 2026-07-29 | 完成: 2026-07-29

## 目标

从 pi 项目的 `packages/ai`（~25,000 行，35+ Provider）精简出最小化可运行的 AI 层（~1,200 行，3 个 Provider）。

## 已完成 Task

### Task 1: Monorepo 脚手架 + 核心类型
- pnpm workspace monorepo（`packages/ai`）
- `src/types.ts`：从 pi 精简，保留 Model/Context/Message/Tool/AssistantMessage 等核心类型
- `examples/01-core-types.ts`：类型系统验证，`npx tsx` 跑通

### Task 2: EventStream 事件流
- `src/stream/index.ts`：从 pi 原样保留 EventStream + AssistantMessageEventStream（89 行）
- 5 个单元测试覆盖 push/iterate/result/end/error 全路径

### Task 3: 认证 + Provider/Models 框架
- `src/auth/index.ts`：envApiKey() + dotenv 自动加载 .env
- `src/provider/index.ts`：Provider 接口 + Models 集合 + createModels()
- `src/index.ts`：公共 API 导出
- 重构：模块目录化（auth/ provider/ stream/ 各自独立目录，`index.ts` 导出）

### Task 4+5: OpenAI + DeepSeek API
- `src/api/openai.ts`：OpenAI Chat Completions + DeepSeek
- 共用 `createOpenAICompatibleProvider()` 工厂，通过 `reasoningFormat` 区分
- `src/utils/text.ts`、`src/api/transform-messages.ts`
- DeepSeek 真实 API 验证通过 ✅
- OpenAI 需代理（代码就绪）

### Task 6: Anthropic API（mock）
- `src/api/anthropic.ts`：mock 实现，无 API Key 时可验证框架流程
- 等真实 Key 后替换

### Task 7: 错误处理 + 工具调用 + 多轮对话
- `src/utils/retry.ts`：错误分类（可重试/不可重试）
- `src/utils/error-body.ts`：跨 Provider 错误规范化
- `src/utils/json-parse.ts`：流式 JSON 解析
- `example/06-tool-use.ts`：工具调用验证 ✅
- `example/07-multi-turn.ts`：多轮对话 + 工具结果注入 ✅
- 修复：OpenAI 消息转换支持 `reasoning_content` 回传（DeepSeek 要求）

## 验证状态

| 检查项 | 结果 |
|--------|------|
| `tsc --noEmit` | ✅ 零错误 |
| `vitest run` | ✅ 29 passed（5 个测试文件） |
| `example 01` 类型系统 | ✅ |
| `example 02` OpenAI 框架 | ⚠️ 需代理（代码就绪） |
| `example 03` DeepSeek 流式 | ✅ |
| `example 06` 工具调用 | ✅ |
| `example 07` 多轮对话 | ✅ |

## 关键决策

1. **可扩展优先**：每个模块以目录组织，通过 `index.ts` 导出。后续扩展只需在目录内新增文件
2. **认证极简化**：整个 auth 模块只有一个 `envApiKey()` 函数 + dotenv
3. **DeepSeek 优先验证**：因国内网络环境，DeepSeek 是唯一能直连的 Provider
4. **mock 需批准**：OpenAI/Anthropic 使用 mock 必须先经用户同意

## 遇到的问题及解决

| 问题 | 解决 |
|------|------|
| TS import 路径（`.ts` vs `.js`） | 统一使用 `.js` 扩展名（Node16 模块规范） |
| `this` 类型在箭头函数中丢失 | 使用命名变量代替 `this` 引用 |
| DeepSeek 多轮回传 `reasoning_content` | 在消息转换中保留 thinking 内容并作为 `reasoning_content` 传回 |
| OpenAI 国内网络超时 | 标记为需代理，优先用 DeepSeek 验证 |

## 当前目录结构

```
packages/ai/
  src/
    index.ts
    types.ts
    auth/index.ts
    provider/index.ts
    stream/index.ts
    api/
      anthropic.ts          (mock)
      openai.ts             (OpenAI + DeepSeek)
      transform-messages.ts
    utils/
      text.ts, retry.ts, error-body.ts, json-parse.ts
    __tests/
      auth.test.ts, stream.test.ts, provider.test.ts
      transform-messages.test.ts, retry.test.ts
  examples/
    01-core-types.ts        ✅
    02-auth-and-models.ts   ⚠️ (OpenAI 需代理)
    03-deepseek-chat.ts     ✅
    06-tool-use.ts          ✅
    07-multi-turn.ts        ✅
```

## NEXT

- 等用户提供 Anthropic API Key 后，替换 mock 为真实实现
- 等用户批准后开始 agent 层（Phase 02）
