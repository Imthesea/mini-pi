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
- `src/utils/transform-messages.ts`（注意：早期在 `api/` 目录，代码审查 #7 后移到 `utils/`）
- DeepSeek 真实 API 验证通过 ✅
- OpenAI 需代理（代码就绪）

### Task 6: Anthropic API（真实 SDK）
- `src/api/anthropic.ts`：`@anthropic-ai/sdk` 真实调用，事件流映射
- 等用户提供 ANTHROPIC_API_KEY 后可端到端验证

### Task 7：错误处理 + 工具调用 + 多轮对话
- `src/utils/retry.ts`：错误分类（可重试/不可重试）
- `src/utils/error-body.ts`：跨 Provider 错误规范化
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
| `example 02-anthropic-mock` | ✅（用户批准） |
| `example 04-openai-mock` | ✅（用户批准） |

**测试**: vitest 55 passed（7 个测试文件），tsc 零错误

## 代码审查修复

### 第一轮（#1-#15）
| # | 问题 | 处置 |
|---|------|------|
| 1 | pnpm-workspace.yaml 非法 YAML | approve-builds 配置 |
| 3 | toolcall_end contentIndex 不一致 | 统一 index+2 |
| 4 | signal 未传 SDK | TODO 标注 |
| 5 | convertMessages 无测试 | 新增 openai-messages.test.ts |
| 6a | parseStreamingJson 无调用 | 删除 |
| 6b | normalizeProviderError 无测试 | 新增 error-body.test.ts |
| 7 | transform-messages.ts 位置 | api/ → utils/ |
| 8 | mock setInterval 泄漏 | 改为同步 push（后被替换） |
| 9 | stopReason 映射不全 | 补 length 映射 |
| 10 | onResponse 硬编码假数据 | 改为 TODO |
| 11 | complete() 重复实现 | 抽 defaultComplete() |
| 12 | partial 复制 N 次 | pi 协议兼容，不动 |
| 13 | examples 编号不连续 | 补 02/04 占位，删冗余 02 |
| 14 | 缺 README | 新增 |
| 15 | cache cost 永远 0 | ModelCost/Usage 删除 cache 字段 |

### 第二轮（#16-#20）
| # | 问题 | 处置 |
|---|------|------|
| 16 | 缺 engines 字段 | 加 `"node": ">=20"` |
| 17 | vitest coverage | 不改，Phase 02 |
| 18 | allowBuilds 过时 | 不改，正常工作 |
| 19 | transformMessages 路径 | #7 已修复 |
| 20 | onPayload 返回值未消费 | Object.assign 应用替换 |

### 第三轮（A-K）
| # | 问题 | 处置 |
|---|------|------|
| A | tool args 永远是 {} | 累积 input_json_delta，stop 时 parse |
| B | text/thinking_end 空串 | 累积 delta.text/delta.thinking |
| C | input_tokens 没读 | 从 message_start 读取 |
| D | stopReason 硬编码 | mapStopReason() 映射 |
| E | thinking 块强转 text | 多轮回传跳过 thinking |
| F | reasoning 强度没映射 | low=4000/med=8000/high=32000 |
| G | SDK Tool 命名冲突 | import as AnthropicTool |
| H | convertMessages 没真测 | 重写为 7 个真实测试 |
| I | openai as any | as ChatCompletionMessageParam[] |
| J | currentContent any | 累积字符串替代 |
| K | mimeType string | 联合类型 |

### 重大规则
- **业务代码绝对禁止 mock**：`src/api/anthropic.ts` 从 mock 改为真实 SDK 实现
- **mock 仅限 examples 且需用户批准**：已记录到记忆系统

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
      anthropic.ts          (真实 SDK)
      openai.ts             (OpenAI + DeepSeek)
    utils/
      assistant-message.ts, retry.ts, error-body.ts, transform-messages.ts
    __tests__/
      auth.test.ts, stream.test.ts, provider.test.ts
      transform-messages.test.ts, retry.test.ts
      error-body.test.ts, openai-messages.test.ts
  examples/
    01-core-types.ts        ✅
    02-anthropic-mock.ts    ✅（已批准）
    03-deepseek-chat.ts     ✅
    04-openai-mock.ts       ✅（已批准）
    06-tool-use.ts          ✅
    07-multi-turn.ts        ✅
```

## NEXT

- 等用户提供 Anthropic API Key 后，替换 mock 为真实实现
- 等用户批准后开始 agent 层（Phase 02）
