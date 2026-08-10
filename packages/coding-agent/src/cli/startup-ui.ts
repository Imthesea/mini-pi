/**
 * 首次启动引导：检测 API Key 是否已配置，未配置则弹出 TUI 引导界面。
 *
 * 照抄 Pi startup-ui.ts 的结构，仅去掉主题系统和扩展选择器（V1 不涉及）。
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ProcessTerminal, TUI } from "@mimi/tui";
import {
  FirstTimeSetupComponent,
  type FirstTimeSetupResult,
} from "../modes/interactive/components/first-time-setup.ts";

// ═══════════════════════════════════════════
// 创建 / 启动 / 清理 独立 TUI（照抄 Pi 结构）
// ═══════════════════════════════════════════

/**
 * 为首次引导创建一个独立的 TUI 实例。
 * 照抄 Pi createStartupTui，去掉主题加载（V1 不涉及主题）。
 */
function createStartupTui(): TUI {
  const ui = new TUI(new ProcessTerminal());
  return ui;
}

/**
 * 启动独立 TUI。
 * 照抄 Pi startStartupTui，去掉终端主题自动检测（V1 不涉及）。
 */
function startStartupTui(ui: TUI): void {
  ui.start();
}

/**
 * 清屏并关闭独立 TUI。
 * 照抄 Pi clearStartupTui。
 */
async function clearStartupTui(ui: TUI): Promise<void> {
  ui.clear();
  ui.requestRender();
  await new Promise((resolve) => setTimeout(resolve, 25));
}

// ═══════════════════════════════════════════
// 首次设置判断
// ═══════════════════════════════════════════

/** 需要检测的 API Key 环境变量名列表 */
const API_KEY_ENV_NAMES = [
  "MIMI_API_KEY_DEEPSEEK",
  "MIMI_API_KEY_ANTHROPIC",
  "MIMI_API_KEY_OPENAI",
];

/**
 * 判断是否需要运行首次设置。
 *
 * 照抄 Pi shouldRunFirstTimeSetup 的结构。
 * Pi 检查：官方发行版 + 实验性功能 + 默认 agentDir + settings.json 不存在。
 * 我们简化为：进程环境变量无 API Key + .env 文件无有效 API Key → 需要首次设置。
 *
 * @param cwd - 工作目录（.env 文件所在目录）
 */
export function shouldRunFirstTimeSetup(cwd: string): boolean {
  // 检查进程环境变量
  for (const name of API_KEY_ENV_NAMES) {
    if (process.env[name]) return false;
  }

  // 检查 .env 文件
  const envPath = join(cwd, ".env");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    for (const name of API_KEY_ENV_NAMES) {
      const match = content.match(new RegExp(`^${name}=(.+)$`, "m"));
      if (match && match[1] && match[1] !== "sk-xxx" && match[1] !== "sk-ant-xxx") {
        return false;
      }
    }
  }

  return true;
}

// ═══════════════════════════════════════════
// 首次设置引导
// ═══════════════════════════════════════════

/**
 * 显示首次设置 TUI 引导界面。
 *
 * 照抄 Pi showFirstTimeSetup 的结构：
 * 1. createStartupTui() 创建独立 TUI
 * 2. 创建 FirstTimeSetupComponent
 * 3. ui.addChild + ui.setFocus
 * 4. ui.start() → 等待用户完成 → clearStartupTui() + ui.stop()
 * 5. 持久化结果（Pi 写 settings.json，我们写 .env）
 *
 * @param cwd - 工作目录
 */
export async function showFirstTimeSetup(cwd: string): Promise<void> {
  const ui = createStartupTui();

  return new Promise<void>((resolve) => {
    let settled = false;

    /** 完成引导并持久化结果 */
    const finish = async (result: FirstTimeSetupResult | undefined) => {
      if (settled) return;
      settled = true;

      // 持久化 API Key 到 .env 文件
      if (result?.apiKey) {
        const envPath = join(cwd, ".env");

        let content = "";
        try {
          content = readFileSync(envPath, "utf-8");
        } catch {
          // .env 不存在，创建新的
        }

        const line = `MIMI_API_KEY_DEEPSEEK=${result.apiKey}`;
        if (content.includes("MIMI_API_KEY_DEEPSEEK=")) {
          content = content.replace(/^MIMI_API_KEY_DEEPSEEK=.*$/m, line);
        } else {
          if (content && !content.endsWith("\n")) content += "\n";
          content += line + "\n";
        }
        writeFileSync(envPath, content, "utf-8");
      }

      await clearStartupTui(ui);
      ui.stop();
      resolve();
    };

    // 显示引导界面
    const showSetup = async () => {
      startStartupTui(ui);

      const component = new FirstTimeSetupComponent({
        onSubmit: (result) => void finish(result),
        onCancel: () => void finish(undefined),
      });

      ui.addChild(component);
      ui.setFocus(component);
      ui.requestRender();
    };

    void showSetup();
  });
}
