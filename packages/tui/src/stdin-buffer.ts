/**
 * StdinBuffer：缓存 stdin 输入并发出完整的按键序列。
 *
 * stdin 的数据事件可能把一次按键拆成多个分片到达，尤其是转义序列（如鼠标事件）。
 * 如果不做缓冲，不完整的分片会被错误地解释为普通按键。
 *
 * 例如鼠标 SGR 序列 `\x1b[<35;20;5m` 可能分三次到达：
 * - 事件 1：`\x1b`
 * - 事件 2：`[<35`
 * - 事件 3：`;20;5m`
 *
 * 缓冲区会一直积累直到检测到一个完整序列才发出。
 *
 * 照抄 Pi tui/src/stdin-buffer.ts
 */

import { EventEmitter } from "events";

/** 转义字符 */
const ESC = "\x1b";
/** 括号粘贴模式开始标记 */
const BRACKETED_PASTE_START = "\x1b[200~";
/** 括号粘贴模式结束标记 */
const BRACKETED_PASTE_END = "\x1b[201~";

/**
 * 判断一个转义序列是完整的、不完整的、还是根本不是转义序列。
 *
 * @param data - 要检查的字符串
 * @returns "complete" 完整序列、"incomplete" 还需要更多数据、"not-escape" 不是转义序列
 */
function isCompleteSequence(data: string): "complete" | "incomplete" | "not-escape" {
  // 不以 ESC 开头 → 不是转义序列
  if (!data.startsWith(ESC)) {
    return "not-escape";
  }

  // 只有 ESC 一个字节 → 不完整，不知道后面是什么
  if (data.length === 1) {
    return "incomplete";
  }

  const afterEsc = data.slice(1);

  // CSI 序列：ESC [
  if (afterEsc.startsWith("[")) {
    // 老式鼠标序列：ESC [M + 3 字节，共需 6 字节
    if (afterEsc.startsWith("[M")) {
      return data.length >= 6 ? "complete" : "incomplete";
    }
    return isCompleteCsiSequence(data);
  }

  // OSC 序列：ESC ]
  if (afterEsc.startsWith("]")) {
    return isCompleteOscSequence(data);
  }

  // DCS 序列：ESC P ... ESC \
  if (afterEsc.startsWith("P")) {
    return isCompleteDcsSequence(data);
  }

  // APC 序列：ESC _ ... ESC \（包括 Kitty 图形响应）
  if (afterEsc.startsWith("_")) {
    return isCompleteApcSequence(data);
  }

  // SS3 序列：ESC O 后跟一个字符
  if (afterEsc.startsWith("O")) {
    return afterEsc.length >= 2 ? "complete" : "incomplete";
  }

  // Meta 键序列：ESC 后跟单个字符
  if (afterEsc.length === 1) {
    return "complete";
  }

  // 未知转义序列，视为完整
  return "complete";
}

/**
 * 判断 CSI 序列是否完整。
 *
 * CSI 序列格式：ESC [ ... 最后一个字节在 0x40-0x7E 范围内
 *
 * @param data - 要检查的字符串
 * @returns "complete" 完整、"incomplete" 还需要更多数据
 */
function isCompleteCsiSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(`${ESC}[`)) {
    return "complete";
  }

  // CSI 至少需要 ESC [ 加一个结束字节
  if (data.length < 3) {
    return "incomplete";
  }

  const payload = data.slice(2);
  const lastChar = payload[payload.length - 1];
  const lastCharCode = lastChar.charCodeAt(0);

  // CSI 序列以 0x40-0x7E（@ 到 ~）范围内的字节结束
  if (lastCharCode >= 0x40 && lastCharCode <= 0x7e) {
    // SGR 鼠标序列特殊处理 —— 格式：ESC [<B;X;Ym 或 ESC [<B;X;YM
    if (payload.startsWith("<")) {
      const mouseMatch = /^<\d+;\d+;\d+[Mm]$/.test(payload);
      if (mouseMatch) {
        return "complete";
      }
      if (lastChar === "M" || lastChar === "m") {
        const parts = payload.slice(1, -1).split(";");
        if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
          return "complete";
        }
      }
      return "incomplete";
    }
    return "complete";
  }

  return "incomplete";
}

/**
 * 判断 OSC（操作系统命令）序列是否完整。
 *
 * OSC 序列以 ST（ESC \ 或 BEL \x07）结束。
 *
 * @param data - 要检查的字符串
 */
function isCompleteOscSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(`${ESC}]`)) {
    return "complete";
  }
  if (data.endsWith(`${ESC}\\`) || data.endsWith("\x07")) {
    return "complete";
  }
  return "incomplete";
}

/**
 * 判断 DCS（设备控制字符串）序列是否完整。
 *
 * DCS 序列以 ST（ESC \）结束。用于 XTVersion 响应等。
 *
 * @param data - 要检查的字符串
 */
function isCompleteDcsSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(`${ESC}P`)) {
    return "complete";
  }
  if (data.endsWith(`${ESC}\\`)) {
    return "complete";
  }
  return "incomplete";
}

/**
 * 判断 APC（应用程序命令）序列是否完整。
 *
 * APC 序列以 ST（ESC \）结束。用于 Kitty 图形响应等。
 *
 * @param data - 要检查的字符串
 */
function isCompleteApcSequence(data: string): "complete" | "incomplete" {
  if (!data.startsWith(`${ESC}_`)) {
    return "complete";
  }
  if (data.endsWith(`${ESC}\\`)) {
    return "complete";
  }
  return "incomplete";
}

/**
 * 从 Kitty 协议序列中解析可打印字符的 Unicode 码点。
 *
 * Kitty CSI-u 格式：ESC [ codepoint u  或 ESC [ codepoint : modifiers u
 * 返回 >= 32 的码点（可打印字符），否则返回 undefined。
 *
 * @param sequence - Kitty CSI-u 序列
 */
function parseUnmodifiedKittyPrintableCodepoint(sequence: string): number | undefined {
  const match = sequence.match(/^\x1b\[(\d+)(?::\d*)?(?::\d+)?u$/);
  if (!match) return undefined;
  const codepoint = parseInt(match[1]!, 10);
  return codepoint >= 32 ? codepoint : undefined;
}

/**
 * 从累积的缓冲区中提取所有完整的按键序列。
 *
 * 遍历缓冲区，用 isCompleteSequence 判断每个前缀是否完整：
 * - 完整 → 加入结果，从下一个位置继续
 * - 不完整 → 延长候选前缀
 * - 非转义 → 取单个字符
 *
 * 特殊处理：WezTerm 的 ESC 键按/松会粘在一起（`\x1b\x1b[...u`），
 * 需要拆成两个 ESC 以避免把第二个 ESC 的开头吃掉。
 *
 * @param buffer - 累积的原始输入字符串
 * @returns 完整序列数组 + 剩余未完成的片段
 */
function extractCompleteSequences(buffer: string): { sequences: string[]; remainder: string } {
  const sequences: string[] = [];
  let pos = 0;

  while (pos < buffer.length) {
    const remaining = buffer.slice(pos);

    if (remaining.startsWith(ESC)) {
      let seqEnd = 1;
      while (seqEnd <= remaining.length) {
        const candidate = remaining.slice(0, seqEnd);
        const status = isCompleteSequence(candidate);

        if (status === "complete") {
          // WezTerm 特殊处理：`\x1b\x1b[` 是两个 ESC 粘在一起
          if (candidate === "\x1b\x1b") {
            const nextChar = remaining[seqEnd];
            if (
              nextChar === "[" ||
              nextChar === "]" ||
              nextChar === "O" ||
              nextChar === "P" ||
              nextChar === "_"
            ) {
              sequences.push(ESC);
              pos += 1;
              break;
            }
          }
          sequences.push(candidate);
          pos += seqEnd;
          break;
        } else if (status === "incomplete") {
          seqEnd++;
        } else {
          sequences.push(candidate);
          pos += seqEnd;
          break;
        }
      }

      // 候选前缀比剩余字符串还长 → 不完整，保留等更多数据
      if (seqEnd > remaining.length) {
        return { sequences, remainder: remaining };
      }
    } else {
      // 普通字符，每次取一个
      sequences.push(remaining[0]!);
      pos++;
    }
  }

  return { sequences, remainder: "" };
}

/** StdinBuffer 构造选项 */
export type StdinBufferOptions = {
  /** 等待序列完成的超时时间（毫秒），默认 10ms */
  timeout?: number;
};

/** StdinBuffer 事件类型映射 */
export type StdinBufferEventMap = {
  /** 单个完整的按键序列 */
  data: [string];
  /** 粘贴内容（括号粘贴模式） */
  paste: [string];
};

/**
 * StdinBuffer：stdin 输入缓冲器。
 *
 * 缓冲原始 stdin 输入，将其拆分为完整的按键序列后通过 'data' 事件发出。
 * 处理跨多次 data 事件的片段化转义序列。
 *
 * 照抄 Pi tui/src/stdin-buffer.ts
 */
export class StdinBuffer extends EventEmitter<StdinBufferEventMap> {
  /** 当前累积的缓冲区 */
  private buffer: string = "";
  /** 等待不完整序列的超时定时器 */
  private timeout: ReturnType<typeof setTimeout> | null = null;
  /** 超时时间（毫秒） */
  private readonly timeoutMs: number;
  /** 是否处于括号粘贴模式 */
  private pasteMode: boolean = false;
  /** 括号粘贴模式下的累积缓冲区 */
  private pasteBuffer: string = "";
  /** 待处理的 Kitty 可打印码点（用于去重） */
  private pendingKittyPrintableCodepoint: number | undefined;

  /**
   * @param options - 配置选项，timeout 默认 10ms
   */
  constructor(options: StdinBufferOptions = {}) {
    super();
    this.timeoutMs = options.timeout ?? 10;
  }

  /**
   * 处理一段原始输入数据。
   *
   * 核心流程：
   * 1. 清除旧的超时定时器
   * 2. 如果处于粘贴模式 → 累积到 pasteBuffer，遇到结束标记则发出 paste 事件
   * 3. 如果检测到粘贴开始标记 → 进入粘贴模式
   * 4. 普通模式 → 提取完整序列，逐条发出 data 事件
   * 5. 有剩余不完整片段 → 启动超时定时器，超时后强制 flush
   *
   * @param data - 原始输入数据，可以是 string 或 Buffer
   */
  public process(data: string | Buffer): void {
    // 每次新数据到来时取消旧定时器
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    // 处理 Buffer 输入：高位字节（>127）转换为 ESC + (byte-128) 的 Meta 键表示
    let str: string;
    if (Buffer.isBuffer(data)) {
      if (data.length === 1 && data[0]! > 127) {
        const byte = data[0]! - 128;
        str = `\x1b${String.fromCharCode(byte)}`;
      } else {
        str = data.toString();
      }
    } else {
      str = data;
    }

    // 空输入且缓冲区为空 → 发出空序列
    if (str.length === 0 && this.buffer.length === 0) {
      this.emitDataSequence("");
      return;
    }

    this.buffer += str;

    // === 粘贴模式：继续累积直到遇到结束标记 ===
    if (this.pasteMode) {
      this.pasteBuffer += this.buffer;
      this.buffer = "";

      const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);
      if (endIndex !== -1) {
        const pastedContent = this.pasteBuffer.slice(0, endIndex);
        const remaining = this.pasteBuffer.slice(endIndex + BRACKETED_PASTE_END.length);

        this.pasteMode = false;
        this.pasteBuffer = "";
        this.pendingKittyPrintableCodepoint = undefined;

        this.emit("paste", pastedContent);

        // 粘贴结束标记后面可能还有数据，递归处理
        if (remaining.length > 0) {
          this.process(remaining);
        }
      }
      return;
    }

    // === 检测粘贴开始标记 ===
    const startIndex = this.buffer.indexOf(BRACKETED_PASTE_START);
    if (startIndex !== -1) {
      // 粘贴标记之前的内容先正常处理
      if (startIndex > 0) {
        const beforePaste = this.buffer.slice(0, startIndex);
        const result = extractCompleteSequences(beforePaste);
        for (const sequence of result.sequences) {
          this.emitDataSequence(sequence);
        }
      }

      this.pendingKittyPrintableCodepoint = undefined;
      this.buffer = this.buffer.slice(startIndex + BRACKETED_PASTE_START.length);
      this.pasteMode = true;
      this.pasteBuffer = this.buffer;
      this.buffer = "";

      // 检查粘贴内容是否已经在当前 buffer 中结束了
      const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);
      if (endIndex !== -1) {
        const pastedContent = this.pasteBuffer.slice(0, endIndex);
        const remaining = this.pasteBuffer.slice(endIndex + BRACKETED_PASTE_END.length);

        this.pasteMode = false;
        this.pasteBuffer = "";
        this.pendingKittyPrintableCodepoint = undefined;

        this.emit("paste", pastedContent);

        if (remaining.length > 0) {
          this.process(remaining);
        }
      }
      return;
    }

    // === 普通模式：提取完整序列 ===
    const result = extractCompleteSequences(this.buffer);
    this.buffer = result.remainder;

    for (const sequence of result.sequences) {
      this.emitDataSequence(sequence);
    }

    // 有不完整片段残留 → 启动超时，超时后强制清空
    if (this.buffer.length > 0) {
      this.timeout = setTimeout(() => {
        const flushed = this.flush();
        for (const sequence of flushed) {
          this.emitDataSequence(sequence);
        }
      }, this.timeoutMs);
    }
  }

  /**
   * 发出单个按键序列（带 Kitty 可打印码点去重）。
   *
   * 某些终端在 Kitty 协议下对同一个按键会同时发出 raw 字节和 CSI-u 序列，
   * 本方法通过 pendingKittyPrintableCodepoint 机制去重。
   *
   * @param sequence - 要发出的按键序列
   */
  private emitDataSequence(sequence: string): void {
    const rawCodepoint = sequence.length === 1 ? sequence.codePointAt(0) : undefined;
    // 如果当前序列的码点匹配待处理的 Kitty 码点 → 这是重复事件，跳过
    if (rawCodepoint !== undefined && rawCodepoint === this.pendingKittyPrintableCodepoint) {
      this.pendingKittyPrintableCodepoint = undefined;
      return;
    }
    // 解析当前序列是否为 Kitty CSI-u 可打印字符序列
    this.pendingKittyPrintableCodepoint = parseUnmodifiedKittyPrintableCodepoint(sequence);
    this.emit("data", sequence);
  }

  /**
   * 强制清空缓冲区，返回所有残留数据。
   *
   * 超时或关闭时调用。清除定时器，把 buffer 中剩余的字节作为一个序列返回。
   *
   * @returns 残留序列数组
   */
  flush(): string[] {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.buffer.length === 0) {
      return [];
    }
    const sequences = [this.buffer];
    this.buffer = "";
    this.pendingKittyPrintableCodepoint = undefined;
    return sequences;
  }

  /**
   * 清空所有内部状态。
   *
   * 清除定时器、缓冲区、粘贴模式和 Kitty 码点跟踪。
   */
  clear(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.buffer = "";
    this.pasteMode = false;
    this.pasteBuffer = "";
    this.pendingKittyPrintableCodepoint = undefined;
  }

  /**
   * 获取当前缓冲区内尚未发出的数据。
   *
   * @returns 当前缓冲区内容
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * 销毁缓冲区实例。等同于 clear()。
   */
  destroy(): void {
    this.clear();
  }
}
