/**
 * Extension loader - 使用 jiti 加载 TypeScript 扩展模块。
 *
 * 对齐 pi 项目 extensions/loader.ts（V1 最小化）。
 * 删减说明（均为 V1 范围外）：
 * - virtualModules（Bun 二进制打包场景）：本项目纯 Node + pnpm workspace，不需要
 * - 扩展缓存（extensionCache / clearExtensionCache / loadExtensionsCached）
 * - ExtensionRuntime（动作方法 sendMessage / setModel / events 等）
 * - package.json "pi" manifest 发现（保留 index.ts/index.js 规则）
 * - pi 的 createExtension 中的 sourceInfo（本项目无 source-info 模块）
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { CONFIG_DIR_NAME, getAgentDir } from "../../config.js";
import { resolvePath } from "../../utils/paths.js";
import type {
  Extension,
  ExtensionAPI,
  ExtensionFactory,
  LoadExtensionsResult,
  ToolDefinition,
} from "./types.js";

const require = createRequire(import.meta.url);

/**
 * jiti 在 Node.js/开发模式下解析 workspace 包的 alias。
 * 原因：pnpm workspace 中 `@mimi/coding-agent` 没有指向自身的 node_modules 符号链接，
 * 扩展（如 examples/extensions/subagent）从包导入时无法用标准 resolve 找到它，
 * 因此需显式映射到各包的 dist 产物。
 */
let _aliases: Record<string, string> | null = null;

function getAliases(): Record<string, string> {
  if (_aliases) return _aliases;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const packageIndex = path.resolve(__dirname, "../..", "index.js");

  const typeboxEntry = require.resolve("typebox");
  const typeboxCompileEntry = require.resolve("typebox/compile");
  const typeboxValueEntry = require.resolve("typebox/value");

  const packagesRoot = path.resolve(__dirname, "../../../../");
  const resolveWorkspaceOrImport = (workspaceRelativePath: string, specifier: string): string => {
    const workspacePath = path.join(packagesRoot, workspaceRelativePath);
    if (fs.existsSync(workspacePath)) {
      return workspacePath;
    }
    return fileURLToPath(import.meta.resolve(specifier));
  };

  _aliases = {
    "@mimi/coding-agent": packageIndex,
    "@mimi/agent": resolveWorkspaceOrImport("agent/dist/index.js", "@mimi/agent"),
    "@mimi/ai": resolveWorkspaceOrImport("ai/dist/index.js", "@mimi/ai"),
    "@mimi/tui": resolveWorkspaceOrImport("tui/dist/index.js", "@mimi/tui"),
    typebox: typeboxEntry,
    "typebox/compile": typeboxCompileEntry,
    "typebox/value": typeboxValueEntry,
    "@sinclair/typebox": typeboxEntry,
    "@sinclair/typebox/compile": typeboxCompileEntry,
    "@sinclair/typebox/value": typeboxValueEntry,
  };

  return _aliases;
}

/**
 * Create the ExtensionAPI for an extension.
 * Registration methods write to the extension object.
 */
function createExtensionAPI(extension: Extension): ExtensionAPI {
  return {
    registerTool(tool: ToolDefinition): void {
      extension.tools.set(tool.name, tool);
    },
  };
}

async function loadExtensionModule(extensionPath: string): Promise<ExtensionFactory | undefined> {
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: getAliases(),
  });
  const module = await jiti.import(extensionPath, { default: true });
  const factory = module as ExtensionFactory;
  if (typeof factory !== "function") {
    return undefined;
  }
  return factory;
}

/**
 * Create an Extension object with empty collections.
 */
function createExtension(extensionPath: string, resolvedPath: string): Extension {
  return {
    path: extensionPath,
    resolvedPath,
    tools: new Map(),
  };
}

async function loadExtension(
  extensionPath: string,
  cwd: string,
): Promise<{ extension: Extension | null; error: string | null }> {
  const resolvedPath = resolvePath(extensionPath, cwd, { normalizeUnicodeSpaces: true });

  try {
    const factory = await loadExtensionModule(resolvedPath);
    if (!factory) {
      return { extension: null, error: `Extension does not export a valid factory function: ${extensionPath}` };
    }

    const extension = createExtension(extensionPath, resolvedPath);
    const api = createExtensionAPI(extension);
    await factory(api);

    return { extension, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { extension: null, error: `Failed to load extension: ${message}` };
  }
}

/**
 * Create an Extension from an inline factory function.
 */
export async function loadExtensionFromFactory(
  factory: ExtensionFactory,
  cwd: string,
  extensionPath = "<inline>",
): Promise<Extension> {
  const extension = createExtension(extensionPath, extensionPath);
  const resolvedCwd = resolvePath(cwd);
  const api = createExtensionAPI(extension);
  await factory(api);
  return extension;
}

/**
 * Load extensions from paths.
 */
async function loadExtensions(paths: string[], cwd: string): Promise<LoadExtensionsResult> {
  const extensions: Extension[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  const resolvedCwd = resolvePath(cwd);

  for (const extPath of paths) {
    const { extension, error } = await loadExtension(extPath, resolvedCwd);

    if (error) {
      errors.push({ path: extPath, error });
      continue;
    }

    if (extension) {
      extensions.push(extension);
    }
  }

  return { extensions, errors };
}

function isExtensionFile(name: string): boolean {
  return name.endsWith(".ts") || name.endsWith(".js");
}

/**
 * Resolve extension entry points from a directory.
 *
 * Checks for:
 * 1. index.ts or index.js -> returns the index file
 *
 * Returns resolved paths or null if no entry points found.
 */
function resolveExtensionEntries(dir: string): string[] | null {
  // Check for index.ts or index.js
  const indexTs = path.join(dir, "index.ts");
  const indexJs = path.join(dir, "index.js");
  if (fs.existsSync(indexTs)) {
    return [indexTs];
  }
  if (fs.existsSync(indexJs)) {
    return [indexJs];
  }

  return null;
}

/**
 * Discover extensions in a directory.
 *
 * Discovery rules:
 * 1. Direct files: `extensions/*.ts` or `*.js` -> load
 * 2. Subdirectory with index: `extensions/* /index.ts` or `index.js` -> load
 *
 * No recursion beyond one level.
 */
function discoverExtensionsInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const discovered: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);

      // 1. Direct files: *.ts or *.js
      if ((entry.isFile() || entry.isSymbolicLink()) && isExtensionFile(entry.name)) {
        discovered.push(entryPath);
        continue;
      }

      // 2. Subdirectories
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const entries = resolveExtensionEntries(entryPath);
        if (entries) {
          discovered.push(...entries);
        }
      }
    }
  } catch {
    return [];
  }

  return discovered;
}

/**
 * Discover and load extensions from standard locations.
 */
export async function discoverAndLoadExtensions(
  configuredPaths: string[],
  cwd: string,
  agentDir: string = getAgentDir(),
): Promise<LoadExtensionsResult> {
  const resolvedCwd = resolvePath(cwd);
  const resolvedAgentDir = resolvePath(agentDir);
  const allPaths: string[] = [];
  const seen = new Set<string>();

  const addPaths = (paths: string[]) => {
    for (const p of paths) {
      const resolved = path.resolve(p);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        allPaths.push(p);
      }
    }
  };

  // 1. Project-local extensions: cwd/${CONFIG_DIR_NAME}/extensions/
  const localExtDir = path.join(resolvedCwd, CONFIG_DIR_NAME, "extensions");
  addPaths(discoverExtensionsInDir(localExtDir));

  // 2. Global extensions: agentDir/extensions/
  const globalExtDir = path.join(resolvedAgentDir, "extensions");
  addPaths(discoverExtensionsInDir(globalExtDir));

  // 3. Explicitly configured paths
  for (const p of configuredPaths) {
    const resolved = resolvePath(p, resolvedCwd, { normalizeUnicodeSpaces: true });
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      // Check for index.ts
      const entries = resolveExtensionEntries(resolved);
      if (entries) {
        addPaths(entries);
        continue;
      }
      // No explicit entries - discover individual files in directory
      addPaths(discoverExtensionsInDir(resolved));
      continue;
    }

    addPaths([resolved]);
  }

  return loadExtensions(allPaths, resolvedCwd);
}
