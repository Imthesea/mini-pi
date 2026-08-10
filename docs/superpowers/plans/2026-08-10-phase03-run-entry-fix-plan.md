# mimi CLI 运行入口修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复 `mimi` CLI 无法运行的问题，让 `pnpm build` 后 `node dist/cli.js` / `npx mimi` 可用。完全对齐 Pi 项目的「生产全编译、开发全直跑」分离模式。

**架构：** 参照 Pi 三个包（`@earendil-works/pi-ai` / `pi-agent-core` / `pi-coding-agent`）的配置体系：
1. 所有包的 `main`/`types`/`exports` 指向 `dist/*.js` / `dist/*.d.ts`（生产解析走编译产物）；
2. `bin` 直接指向 `dist/cli.js`（tsc 产物，无需手写 `.mjs` 包装）；
3. vitest 用 `resolve.alias` 把 `@mimi/*` 指回 `src/index.ts`（测试/开发始终吃源码，不依赖 dist）。

**技术栈：** TypeScript 5.9+ / Node.js 22+ / pnpm workspace / vitest / tsc

---

## 背景：问题根因与 Pi 的对照

### 现状问题（三层嵌套）

1. **bin 文件没被构建出来**：`packages/coding-agent/package.json` 声明 `"bin": { "mimi": "./dist/bin/mimi.mjs" }`，但 `src/bin/mimi.mjs` 是手写 `.mjs`，`tsc` 只编译 `.ts`，从不复制 `.mjs` 进 `dist/`。
2. **包装文件是多余的中间层**：`src/bin/mimi.mjs` 是手写 `.mjs`，`tsc` 只编译 `.ts`，从不复制 `.mjs` 进 `dist/`。build script 里的 `fs.copyFileSync` hack 虽然复制了它，但这个中间层完全多余——`src/cli.ts` 已带 shebang，编译产物 `dist/cli.js` 可以直接当 bin。
3. **依赖包 main 指向源码**：`@mimi/ai` 和 `@mimi/agent` 的 `main` 是 `./src/index.ts`。编译后的 `dist/cli.js` 运行时 `import "@mimi/agent"` 会让 Node 加载 `src/index.ts`（Node 24 原生 type-strip），而源码里 `import ... from "./agent.js"` 是按编译后路径写的，在 `src/` 下不存在 `agent.js` → `Cannot find module packages/agent/src/agent.js`。

### Pi 的做法（对照目标）

| | Pi（`@earendil-works/*`） | 我们（`@mimi/*`）现状 | 修复后（对齐 Pi） |
|---|---|---|---|
| ai 包 main/types | `./dist/index.js` + exports | `./src/index.ts` | `./dist/index.js` + exports |
| agent 包 main/types | `./dist/index.js` + exports | `./src/index.ts` | `./dist/index.js` + exports |
| coding-agent bin | `dist/cli.js`（tsc 产物） | `dist/bin/mimi.mjs`（手写包装） | `dist/cli.js`（删除包装） |
| vitest 解析 `@mimi/*` | `resolve.alias` → `../*/src/index.ts` | 无 alias（靠 main→src） | `resolve.alias` → `../*/src/index.ts` |
| build 后 dist 是否含测试 | 否（测试在 `test/`，`tsconfig.build.json` include `src`） | 是（测试在 `src/__tests__/`） | 本次不动，记为已知遗留 |

Pi 的关键文件佐证：
- [pi-ai package.json](file:///F:/allProject/githubProject/pi/packages/ai/package.json#L6-L7)：`"main": "./dist/index.js"`，完整 `exports`。
- [pi-agent package.json](file:///F:/allProject/githubProject/pi/packages/agent/package.json#L6-L7)：同上。
- [pi-coding-agent package.json](file:///F:/allProject/githubProject/pi/packages/coding-agent/package.json#L9-L11)：`"bin": { "pi": "dist/cli.js" }`，无任何 `.mjs` 包装。
- [pi-agent vitest.config.ts](file:///F:/allProject/githubProject/pi/packages/agent/vitest.config.ts#L15-L19)：`resolve.alias` 把 `@earendil-works/pi-ai` 指回 `../ai/src/index.ts`。
- Pi 的 `src/cli.ts` 带 `#!/usr/bin/env node` shebang，直接编译成 bin 入口。

### 为什么我们有这个问题

Phase 03 plan 抄 Pi 时只抄了「生产入口长什么样」（bin→dist、cli 调 main），没抄「配置体系」（main/exports→dist、vitest alias、tsconfig.build.json）。于是做出一个「半编译、半直跑」的混合体：开发吃 main→src 的源码包，生产 bin 却要求依赖包可被 Node 直接加载，接缝没接上。

---

## 目标状态（本计划完成后）

```text
packages/ai/package.json       main/types/exports → ./dist/*
packages/agent/package.json    main/types/exports → ./dist/*
packages/coding-agent/package.json   bin → ./dist/cli.js；build = "tsc"
packages/coding-agent/src/bin/mimi.mjs  已删除
packages/agent/vitest.config.ts      alias: @mimi/ai → ../ai/src/index.ts
packages/coding-agent/vitest.config.ts alias: @mimi/ai|agent → ../*/src/index.ts
```

效果：
- `pnpm build`（根目录，拓扑序 ai→agent→coding-agent）后，`node dist/cli.js --version`、`npx mimi --help` 可用；
- `pnpm test` 不依赖 dist（alias 直吃 src），行为与现状一致；
- 无任何手写 `.mjs` 中间层。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `packages/ai/package.json` | 包入口指向 dist | 修改 |
| `packages/agent/package.json` | 包入口指向 dist | 修改 |
| `packages/coding-agent/package.json` | bin 指向 dist/cli.js；build 还原为 `tsc` | 修改 |
| `packages/coding-agent/src/bin/mimi.mjs` | 多余的 CLI 包装层 | 删除 |
| `packages/agent/vitest.config.ts` | 测试 alias @mimi/ai → src | 修改 |
| `packages/coding-agent/vitest.config.ts` | 测试 alias @mimi/ai、@mimi/agent → src | 修改 |

---

## 任务分解

### Task 1：`@mimi/ai` 包入口指向 dist

**文件：**
- 修改：`packages/ai/package.json`

**背景：** 对齐 [pi-ai package.json](file:///F:/allProject/githubProject/pi/packages/ai/package.json#L6-L7)。`@mimi/ai` 无子路径导出（代码中只 `import "@mimi/ai"`），故只需 `.` 一个入口；`types` 条件必须在 `import` 之前。

- [ ] **Step 1：修改 packages/ai/package.json**

将 `main` 从 `./src/index.ts` 改为 `./dist/index.js`，`types` 从 `./src/index.ts` 改为 `./dist/index.d.ts`，并新增 `exports` 字段。修改后完整内容：

```json
{
  "name": "@mimi/ai",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.91.1",
    "openai": "6.26.0",
    "typebox": "1.1.38",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0",
    "tsx": "^4.22.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2：构建 ai 包**

运行（仓库根目录）：

```bash
pnpm --filter @mimi/ai build
```

预期：tsc 成功退出，`packages/ai/dist/index.js` 与 `dist/index.d.ts` 存在。

- [ ] **Step 3：验证生产入口走 dist**

运行（仓库根目录）：

```bash
node -e "import('@mimi/ai').then(m => console.log('ok, exports:', Object.keys(m).length)).catch(e => { console.error(e); process.exit(1); })"
```

预期：输出 `ok, exports: <N>`（N > 0）。说明 Node 通过 package.json `main`/`exports` 加载了 `dist/index.js`，而不是 src TS。

- [ ] **Step 4：Commit**

```bash
git add packages/ai/package.json
git commit -m "fix(ai): point package main/types/exports to dist (align pi)"
```

---

### Task 2：`@mimi/agent` 包入口指向 dist

**文件：**
- 修改：`packages/agent/package.json`

**背景：** 对齐 [pi-agent package.json](file:///F:/allProject/githubProject/pi/packages/agent/package.json#L6-L7)。`@mimi/agent` 同样无子路径导出，只需 `.` 入口。

- [ ] **Step 1：修改 packages/agent/package.json**

修改 `main`/`types`，新增 `exports`。修改后完整内容：

```json
{
  "name": "@mimi/agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run && tsc -p tsconfig.test.json",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.test.json"
  },
  "dependencies": {
    "@mimi/ai": "workspace:*",
    "typebox": "1.1.38"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0",
    "tsx": "^4.22.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2：构建 agent 包**

运行（仓库根目录，依赖 Task 1 已 build 的 ai dist）：

```bash
pnpm --filter @mimi/agent build
```

预期：tsc 成功退出，`packages/agent/dist/index.js` 与 `dist/index.d.ts` 存在。

- [ ] **Step 3：验证生产入口走 dist**

运行（仓库根目录）：

```bash
node -e "import('@mimi/agent').then(m => console.log('ok, exports:', Object.keys(m).length)).catch(e => { console.error(e); process.exit(1); })"
```

预期：输出 `ok, exports: <N>`（N > 0）。说明 Node 通过 package.json 加载了 `dist/index.js`。

- [ ] **Step 4：Commit**

```bash
git add packages/agent/package.json
git commit -m "fix(agent): point package main/types/exports to dist (align pi)"
```

---

### Task 3：coding-agent bin 指向 dist/cli.js，删除 mimi.mjs 包装

**文件：**
- 修改：`packages/coding-agent/package.json`
- 删除：`packages/coding-agent/src/bin/mimi.mjs`

**背景：** 对齐 [pi-coding-agent package.json](file:///F:/allProject/githubProject/pi/packages/coding-agent/package.json#L9-L11)。`src/cli.ts` 已带 `#!/usr/bin/env node` shebang（tsc 会保留，见 [dist/cli.js 第 1 行](file:///f:/allProject/githubProject/my-mimipi/packages/coding-agent/dist/cli.js#L1)），编译产物 `dist/cli.js` 直接作为 bin，无需任何 `.mjs` 包装。同时删掉我们之前临时加的复制 hack，build 脚本还原为纯 `tsc`。

- [ ] **Step 1：修改 packages/coding-agent/package.json**

`bin` 改为 `"./dist/cli.js"`；`build` 脚本还原为 `"tsc"`。修改后完整内容：

```json
{
  "name": "@mimi/coding-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "mimi": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@mimi/agent": "workspace:*",
    "@mimi/ai": "workspace:*",
    "@sinclair/typebox": "^0.34.0"
  },
  "devDependencies": {
    "@types/node": "^22.20.1",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2：删除 src/bin/mimi.mjs**

删除文件 `packages/coding-agent/src/bin/mimi.mjs`（整个文件）。

- [ ] **Step 3：清理旧 dist 并重建**

运行：

```bash
rm -rf packages/coding-agent/dist
pnpm --filter @mimi/coding-agent build
```

预期：构建成功；`packages/coding-agent/dist/cli.js` 存在；`dist/bin/` 目录不存在（旧残留已清）。

- [ ] **Step 4：CLI smoke 测试**

运行（在 `packages/coding-agent` 目录）：

```bash
node dist/cli.js --version
node dist/cli.js --help
```

预期：
- `--version` 输出 `0.1.0`；
- `--help` 输出完整帮助文本（Usage / Options / Environment）。

- [ ] **Step 5：Commit**

```bash
git add packages/coding-agent/package.json
git add -u packages/coding-agent/src/bin/mimi.mjs
git commit -m "fix(coding-agent): bin points to dist/cli.js, remove mimi.mjs wrapper"
```

> 注：`dist/` 已在 `.gitignore` 中（见根目录 `.gitignore` 第 2 行），构建产物不入库，只提交 package.json 修改与 mimi.mjs 删除。

---

### Task 4：vitest alias 指向源码（agent + coding-agent）

**文件：**
- 修改：`packages/agent/vitest.config.ts`
- 修改：`packages/coding-agent/vitest.config.ts`

**背景：** 对齐 [pi-agent vitest.config.ts](file:///F:/allProject/githubProject/pi/packages/agent/vitest.config.ts#L15-L19)。Task 1/2 把 `main` 指向 dist 后，vitest 解析 `@mimi/*` 会走 dist 产物；加 `resolve.alias` 让测试始终吃源码，保证「测试不依赖 dist、行为与现状一致」。regex `^@mimi\/ai$` 精确匹配顶层包名（不误匹配子路径）。

- [ ] **Step 1：修改 packages/agent/vitest.config.ts**

修改后完整内容：

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts", "src/**/*.test.ts"],
  },
  resolve: {
    alias: [
      { find: /^@mimi\/ai$/, replacement: aiSrcIndex },
    ],
  },
});
```

- [ ] **Step 2：验证 agent 测试仍通过**

运行（在 `packages/agent` 目录）：

```bash
pnpm test
```

预期：vitest 全部通过（现状为 127 条用例全绿）+ `tsc -p tsconfig.test.json` 0 错误。测试解析的是 `../ai/src/index.ts` 而非 dist。

- [ ] **Step 3：修改 packages/coding-agent/vitest.config.ts**

修改后完整内容：

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("../agent/src/index.ts", import.meta.url));

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: [
      { find: /^@mimi\/ai$/, replacement: aiSrcIndex },
      { find: /^@mimi\/agent$/, replacement: agentSrcIndex },
    ],
  },
});
```

- [ ] **Step 4：验证 coding-agent 测试仍通过**

运行（在 `packages/coding-agent` 目录）：

```bash
pnpm test
```

预期：vitest 全部通过（session-manager / model-runtime / agent-session / tools 全部用例）。

- [ ] **Step 5：Commit**

```bash
git add packages/agent/vitest.config.ts packages/coding-agent/vitest.config.ts
git commit -m "chore(vitest): alias @mimi packages to src (align pi test workflow)"
```

---

### Task 5：全量验证

**背景：** 模拟干净的 CI 流程。注意顺序：**先 build（生成 dist）再 typecheck/test**——因为 `main`→dist 后，`@mimi/agent` 的 `tsc --noEmit` 和 agent 的 `tsc -p tsconfig.test.json` 会读 `@mimi/ai/dist/index.d.ts`，必须先有 ai 的 dist。

- [ ] **Step 1：清空三个包的 dist**

运行（仓库根目录）：

```bash
rm -rf packages/ai/dist packages/agent/dist packages/coding-agent/dist
```

- [ ] **Step 2：全量构建（拓扑序 ai → agent → coding-agent）**

运行（仓库根目录）：

```bash
pnpm build
```

预期：三个包依次构建成功（pnpm `-r` 按依赖拓扑排序），退出码 0。

- [ ] **Step 3：全量类型检查**

运行（逐个包目录）：

```bash
cd packages/ai && npx tsc --noEmit
cd ../agent && npx tsc --noEmit && npx tsc -p tsconfig.test.json
cd ../coding-agent && npx tsc --noEmit
```

预期：全部 0 错误。

- [ ] **Step 4：全量单元测试**

运行（仓库根目录）：

```bash
pnpm test
```

预期：三个包 vitest 全绿，退出码 0。

- [ ] **Step 5：CLI 端到端 smoke**

运行（在 `packages/coding-agent` 目录）：

```bash
node dist/cli.js --version
node dist/cli.js --help
npx mimi --version
```

预期：
- `--version` → `0.1.0`；
- `--help` → 完整帮助文本；
- `npx mimi --version` → `0.1.0`（走 workspace 链接的 `.bin/mimi` → `dist/cli.js`）。

- [ ] **Step 6：无 API key 时的错误路径（可选）**

运行（在 `packages/coding-agent` 目录，确认当前环境未设置 `MIMI_API_KEY_DEEPSEEK`）：

```bash
node dist/cli.js "hello"
```

预期：不崩溃，输出可读错误（如 `No API key found for provider 'deepseek'...`），退出码 1。说明模型解析、会话创建、CLI 主流程已打通，只剩认证。

---

## 总验证清单

```bash
# 1. 构建
pnpm build
# 2. 类型检查
cd packages/ai && npx tsc --noEmit
cd packages/agent && npx tsc --noEmit && npx tsc -p tsconfig.test.json
cd packages/coding-agent && npx tsc --noEmit
# 3. 测试
pnpm test
# 4. CLI
cd packages/coding-agent && node dist/cli.js --version && node dist/cli.js --help
```

---

## 已知遗留（本次不做，仅记录）

1. **dist 含 `__tests__` 编译产物**：ai / coding-agent 的测试位于 `src/__tests__/`，`tsc` 会一并编译进 dist。不影响运行。Pi 的做法是测试放独立 `test/` 目录 + `tsconfig.build.json` 只 include `src`，后续如需彻底对齐再引入 `tsconfig.build.json` 并排除测试目录。
2. **Unix 可执行位**：`tsc` 保留 shebang；npm 安装 bin 时自动设置可执行位，本地 `node dist/cli.js` 无需 chmod。Pi 额外 `shx chmod +x` 仅为二进制发布场景，V1 不需要。
3. **`npx mimi` 依赖 workspace bin 链接**：本仓库 `private` 未发布，`npx mimi` 仅在 `pnpm install` 后、从包内或 workspace 根可用。
