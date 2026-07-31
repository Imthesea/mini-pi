/**
 * 测试用内存文件系统 mock。
 *
 * 实现 FileSystem 接口的最小子集,用于 JSONL repo 测试。
 * 不持久化,测试结束自动丢弃。
 */

import { err, ok } from "../../../../src/harness/session/types.js";
import type {
  FileError,
  Result,
} from "../../../../src/harness/session/types.js";

// ── 内部文件/目录节点 ──

interface FileNode {
  kind: "file";
  content: string;
}

interface DirNode {
  kind: "directory";
  children: Map<string, FsNode>;
}

type FsNode = FileNode | DirNode;

function isDir(node: FsNode | undefined): node is DirNode {
  return !!node && node.kind === "directory";
}

function isFile(node: FsNode | undefined): node is FileNode {
  return !!node && node.kind === "file";
}

// ── 路径工具 ──

/** 规范化路径(移除末尾 /) */
function normalizePath(path: string): string {
  if (!path) return "/";
  // 简单处理:统一用 / 分隔
  return path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

function splitPath(path: string): string[] {
  const normalized = normalizePath(path);
  if (normalized === "/") return [];
  return normalized.split("/").filter(Boolean);
}

// ── MockFs ──

/**
 * 内存版 FileSystem mock,支持 JSONL repo 测试需要的所有方法。
 */
export class MockFs {
  private root: DirNode = { kind: "directory", children: new Map() };
  public readonly cwd: string;

  constructor(cwd = "/") {
    this.cwd = cwd;
  }

  // ── 内部工具 ──

  private resolveNode(path: string): FsNode | undefined {
    const parts = splitPath(path);
    let current: FsNode = this.root;
    for (const part of parts) {
      if (!isDir(current)) return undefined;
      const child = current.children.get(part);
      if (!child) return undefined;
      current = child;
    }
    return current;
  }

  private resolveParent(path: string): { parent: DirNode; name: string } | undefined {
    const parts = splitPath(path);
    if (parts.length === 0) return undefined;
    const name = parts[parts.length - 1]!;
    const parentParts = parts.slice(0, -1);
    let current: FsNode = this.root;
    for (const part of parentParts) {
      if (!isDir(current)) return undefined;
      const child = current.children.get(part);
      if (!child) return undefined;
      current = child;
    }
    if (!isDir(current)) return undefined;
    return { parent: current, name };
  }

  private notFound(path: string): Result<never, FileError> {
    return err(
      Object.assign(new Error(`File not found: ${path}`), {
        code: "not_found",
        path,
      }) as FileError,
    );
  }

  // ── 公开 API(满足 JsonlSessionRepoFileSystem 形状) ──

  async absolutePath(path: string): Promise<Result<string, FileError>> {
    if (path.startsWith("/")) return ok(path);
    // 简单解析:cwd + path
    const cwdParts = splitPath(this.cwd);
    const pathParts = splitPath(path);
    return ok("/" + [...cwdParts, ...pathParts].join("/"));
  }

  async joinPath(parts: string[]): Promise<Result<string, FileError>> {
    if (parts.length === 0) return ok("");
    const all = parts.flatMap((p) => splitPath(p));
    return ok("/" + all.join("/"));
  }

  async readTextFile(path: string): Promise<Result<string, FileError>> {
    const node = this.resolveNode(path);
    if (!isFile(node)) return this.notFound(path);
    return ok(node.content);
  }

  async readTextLines(
    path: string,
    options?: { maxLines?: number },
  ): Promise<Result<string[], FileError>> {
    const result = await this.readTextFile(path);
    if (!result.ok) return result;
    const lines = result.value.split("\n");
    if (options?.maxLines !== undefined) {
      return ok(lines.slice(0, options.maxLines));
    }
    return ok(lines);
  }

  async writeFile(
    path: string,
    content: string,
  ): Promise<Result<void, FileError>> {
    // 自动创建父目录(类似真实 fs)
    const parts = splitPath(path);
    if (parts.length > 1) {
      const parentParts = parts.slice(0, -1);
      let current: FsNode = this.root;
      for (const part of parentParts) {
        if (!isDir(current)) {
          return err(
            Object.assign(new Error(`Invalid path: ${path}`), {
              code: "invalid",
              path,
            }) as FileError,
          );
        }
        let child = current.children.get(part);
        if (!child) {
          child = { kind: "directory", children: new Map() };
          current.children.set(part, child);
        }
        if (!isDir(child)) {
          return err(
            Object.assign(new Error(`Not a directory: ${path}`), {
              code: "not_directory",
              path,
            }) as FileError,
          );
        }
        current = child;
      }
    }
    const target = this.resolveParent(path);
    if (!target) {
      return err(
        Object.assign(new Error(`Invalid path: ${path}`), {
          code: "invalid",
          path,
        }) as FileError,
      );
    }
    target.parent.children.set(target.name, { kind: "file", content });
    return ok(undefined);
  }

  async appendFile(
    path: string,
    content: string,
  ): Promise<Result<void, FileError>> {
    const node = this.resolveNode(path);
    if (!node) {
      // appendFile 通常会创建文件
      return this.writeFile(path, content);
    }
    if (!isFile(node)) {
      return err(
        Object.assign(new Error(`Is a directory: ${path}`), {
          code: "is_directory",
          path,
        }) as FileError,
      );
    }
    node.content += content;
    return ok(undefined);
  }

  async listDir(
    path: string,
  ): Promise<Result<Array<{ name: string; path: string; kind: string }>, FileError>> {
    const node = this.resolveNode(path);
    if (!node) return this.notFound(path);
    if (!isDir(node)) {
      return err(
        Object.assign(new Error(`Not a directory: ${path}`), {
          code: "not_directory",
          path,
        }) as FileError,
      );
    }
    const items: Array<{ name: string; path: string; kind: string }> = [];
    for (const [name, child] of node.children) {
      items.push({
        name,
        path: (path === "/" ? "" : path) + "/" + name,
        kind: child.kind === "directory" ? "directory" : "file",
      });
    }
    return ok(items);
  }

  async exists(path: string): Promise<Result<boolean, FileError>> {
    return ok(!!this.resolveNode(path));
  }

  async createDir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<Result<void, FileError>> {
    const parts = splitPath(path);
    if (parts.length === 0) return ok(undefined);
    if (options?.recursive !== false) {
      // 默认 recursive: true
      let current: FsNode = this.root;
      for (const part of parts) {
        if (!isDir(current)) {
          return err(
            Object.assign(new Error(`Invalid path: ${path}`), {
              code: "invalid",
              path,
            }) as FileError,
          );
        }
        let child = current.children.get(part);
        if (!child) {
          child = { kind: "directory", children: new Map() };
          current.children.set(part, child);
        }
        if (!isDir(child)) {
          return err(
            Object.assign(new Error(`Not a directory: ${path}`), {
              code: "not_directory",
              path,
            }) as FileError,
          );
        }
        current = child;
      }
      return ok(undefined);
    }
    // 非 recursive:父目录必须存在
    const target = this.resolveParent(path);
    if (!target) {
      return err(
        Object.assign(new Error(`Parent not found: ${path}`), {
          code: "not_found",
          path,
        }) as FileError,
      );
    }
    const name = parts[parts.length - 1]!;
    target.parent.children.set(name, { kind: "directory", children: new Map() });
    return ok(undefined);
  }

  async remove(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<Result<void, FileError>> {
    const node = this.resolveNode(path);
    if (!node) {
      if (options?.force) return ok(undefined);
      return this.notFound(path);
    }
    if (isDir(node) && node.children.size > 0 && !options?.recursive) {
      return err(
        Object.assign(new Error(`Directory not empty: ${path}`), {
          code: "not_directory",
          path,
        }) as FileError,
      );
    }
    const target = this.resolveParent(path);
    if (target) {
      const name = splitPath(path)[splitPath(path).length - 1]!;
      target.parent.children.delete(name);
    }
    return ok(undefined);
  }

  // ── Mock-only 工具(测试用) ──

  /** 读取原始文件内容(测试调试用) */
  async _readRaw(path: string): Promise<string | undefined> {
    const node = this.resolveNode(path);
    return isFile(node) ? node.content : undefined;
  }

  /** 列出所有文件路径(测试用) */
  _allFiles(): string[] {
    const result: string[] = [];
    const walk = (node: FsNode, prefix: string) => {
      if (isFile(node)) {
        result.push(prefix);
        return;
      }
      for (const [name, child] of node.children) {
        walk(child, prefix + "/" + name);
      }
    };
    walk(this.root, "");
    return result;
  }
}
