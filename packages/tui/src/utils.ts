/**
 * TUI 文本工具：终端字符宽度计算、ANSI 转义序列提取、按列切片。
 *
 * 照抄 Pi tui/src/utils.ts 的核心函数。
 */

import { eastAsianWidth } from "get-east-asian-width";

// ═══════════════════════════════════════════
// Grapheme segmenter（字形分割器）
// ═══════════════════════════════════════════

/** 共享的 Intl.Segmenter 实例，按字形（grapheme）分割文本 */
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * 获取共享的字形分割器实例。
 *
 * Intl.Segmenter 创建成本较高，所以整个模块共用一个。
 */
export function getGraphemeSegmenter(): Intl.Segmenter {
  return graphemeSegmenter;
}

// ═══════════════════════════════════════════
// 字符宽度判断
// ═══════════════════════════════════════════

/**
 * 快速判断一个字形簇是否可能是 Emoji。
 *
 * 这是一个启发式预过滤器，用于在运行昂贵的 rgiEmojiRegex 测试之前
 * 快速排除不可能是 Emoji 的字符。覆盖的 Unicode 区块故意放宽范围
 * 以容纳未来的 Unicode 新增。
 *
 * @param segment - 字形分割后的单个片段
 * @returns 可能是 Emoji 则返回 true
 *
 * 照抄 Pi tui/src/utils.ts couldBeEmoji
 */
function couldBeEmoji(segment: string): boolean {
  const cp = segment.codePointAt(0)!;
  return (
    (cp >= 0x1f000 && cp <= 0x1fbff) || // Emoji 和象形文字
    (cp >= 0x2300 && cp <= 0x23ff) || // 杂项技术符号
    (cp >= 0x2600 && cp <= 0x27bf) || // 杂项符号、装饰符号
    (cp >= 0x2b50 && cp <= 0x2b55) || // 特定星形/圆形符号
    segment.includes("️") || // 包含 VS16（Emoji 呈现选择器）
    segment.length > 2 // 多码点序列（ZWJ、肤色修饰等）
  );
}

/** 零宽字符正则：默认可忽略码点、控制字符、标记字符、代理对 */
const zeroWidthRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/v;
/** 前导不可见字符正则 */
const leadingNonPrintingRegex = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/v;
/** RGI Emoji 正则：精确匹配 RGI（Recommended for General Interchange）Emoji */
const rgiEmojiRegex = /^\p{RGI_Emoji}$/v;

/** 宽度缓存大小上限 */
const WIDTH_CACHE_SIZE = 512;
/** 非 ASCII 字符串的宽度缓存 */
const widthCache = new Map<string, number>();

/**
 * 判断字符串是否全部由可打印 ASCII 字符组成。
 *
 * ASCII 可打印范围：0x20（空格）到 0x7E（~）。
 *
 * @param str - 要检查的字符串
 */
function isPrintableAscii(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      return false;
    }
  }
  return true;
}

/**
 * 计算单个字形簇在终端上占用的列宽。
 *
 * 规则：
 * - Tab → 3 列
 * - 零宽字符 → 0 列
 * - Emoji → 2 列
 * - 区域指示符号（U+1F1E6..U+1F1FF）→ 2 列（终端常渲染为全宽）
 * - 其余字符 → 查 eastAsianWidth 表
 * - 多字符片段 → 额外处理半角/全角变体和泰文/老挝文 AM 元音
 *
 * @param segment - 字形分割后的单个片段
 * @returns 终端列宽
 *
 * 照抄 Pi tui/src/utils.ts graphemeWidth
 */
function graphemeWidth(segment: string): number {
  // Tab 展开为 3 个空格
  if (segment === "\t") {
    return 3;
  }

  // 零宽字符簇
  if (zeroWidthRegex.test(segment)) {
    return 0;
  }

  // Emoji 检测（先启发式预过滤，再精确匹配）
  if (couldBeEmoji(segment) && rgiEmojiRegex.test(segment)) {
    return 2;
  }

  // 获取基础可见码点
  const base = segment.replace(leadingNonPrintingRegex, "");
  const cp = base.codePointAt(0);
  if (cp === undefined) {
    return 0;
  }

  // 区域指示符号在终端中常渲染为全宽 Emoji
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
    return 2;
  }

  // 查 east-asian-width 表获取基础宽度
  let width = eastAsianWidth(cp);

  // 处理多字符片段中的尾随半角/全角变体和 AM 元音
  if (segment.length > 1) {
    for (const char of segment.slice(1)) {
      const c = char.codePointAt(0)!;
      if (c >= 0xff00 && c <= 0xffef) {
        // 半角/全角变体
        width += eastAsianWidth(c);
      } else if (c === 0x0e33 || c === 0x0eb3) {
        // 泰文/老挝文 AM 元音
        width += 1;
      }
    }
  }

  return width;
}

// ═══════════════════════════════════════════
// ANSI 转义序列提取
// ═══════════════════════════════════════════

/**
 * 从字符串的指定位置提取 ANSI 转义序列。
 *
 * 支持的序列类型：
 * - CSI（ESC [ ... 结束字节）：样式、光标控制
 * - OSC（ESC ] ... BEL 或 ST）：超链接、窗口标题
 * - APC（ESC _ ... BEL 或 ST）：应用程序命令（如光标标记）
 *
 * @param str - 要搜索的字符串
 * @param pos - 起始位置
 * @returns 提取到的序列对象 { code, length }，或 null（当前位置不是 ESC）
 *
 * 照抄 Pi tui/src/utils.ts extractAnsiCode
 */
export function extractAnsiCode(str: string, pos: number): { code: string; length: number } | null {
  // 不在范围内或不是 ESC 开头 → 不是 ANSI 序列
  if (pos >= str.length || str[pos] !== "\x1b") return null;

  const next = str[pos + 1];

  // CSI 序列：ESC [ 参数... 结束字节（m/G/K/H/J）
  if (next === "[") {
    let j = pos + 2;
    while (j < str.length && !/[mGKHJ]/.test(str[j]!)) j++;
    if (j < str.length) return { code: str.substring(pos, j + 1), length: j + 1 - pos };
    return null;
  }

  // OSC 序列：ESC ] ... BEL（\x07）或 ST（ESC \）
  if (next === "]") {
    let j = pos + 2;
    while (j < str.length) {
      if (str[j] === "\x07") return { code: str.substring(pos, j + 1), length: j + 1 - pos };
      if (str[j] === "\x1b" && str[j + 1] === "\\") return { code: str.substring(pos, j + 2), length: j + 2 - pos };
      j++;
    }
    return null;
  }

  // APC 序列：ESC _ ... BEL 或 ST（ESC \）
  if (next === "_") {
    let j = pos + 2;
    while (j < str.length) {
      if (str[j] === "\x07") return { code: str.substring(pos, j + 1), length: j + 1 - pos };
      if (str[j] === "\x1b" && str[j + 1] === "\\") return { code: str.substring(pos, j + 2), length: j + 2 - pos };
      j++;
    }
    return null;
  }

  // 不是已知的 ANSI 序列类型
  return null;
}

// ═══════════════════════════════════════════
// 可见宽度计算
// ═══════════════════════════════════════════

/**
 * 计算字符串在终端上的可见列宽。
 *
 * 这是 TUI 布局的核心函数。正确计算宽度需要：
 * 1. 跳过大括号内的 ANSI 转义序列（不计宽度）
 * 2. Tab 按 3 列展开
 * 3. CJK 全角字符、Emoji 按 2 列计算
 * 4. 组合字符、零宽字符按 0 列计算
 *
 * 包含 LRU 缓存（最多 512 条）以加速重复字符串的计算。
 *
 * @param str - 要测量宽度的字符串
 * @returns 终端列数
 *
 * 照抄 Pi tui/src/utils.ts visibleWidth
 */
export function visibleWidth(str: string): number {
  if (str.length === 0) {
    return 0;
  }

  // 快速路径：纯 ASCII 可打印字符 → 宽度 = 长度
  if (isPrintableAscii(str)) {
    return str.length;
  }

  // 查缓存
  const cached = widthCache.get(str);
  if (cached !== undefined) {
    return cached;
  }

  // 规范化：Tab → 3 空格，去掉 ANSI 转义序列
  let clean = str;
  if (str.includes("\t")) {
    clean = clean.replace(/\t/g, "   ");
  }
  if (clean.includes("\x1b")) {
    let stripped = "";
    let i = 0;
    while (i < clean.length) {
      const ansi = extractAnsiCode(clean, i);
      if (ansi) {
        // 跳过整个 ANSI 序列
        i += ansi.length;
        continue;
      }
      stripped += clean[i];
      i++;
    }
    clean = stripped;
  }

  // 逐字形计算宽度
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(clean)) {
    width += graphemeWidth(segment);
  }

  // 写入缓存（LRU 淘汰：缓存满时删除最早条目）
  if (widthCache.size >= WIDTH_CACHE_SIZE) {
    const firstKey = widthCache.keys().next().value;
    if (firstKey !== undefined) {
      widthCache.delete(firstKey);
    }
  }
  widthCache.set(str, width);

  return width;
}

// ═══════════════════════════════════════════
// 按列切片
// ═══════════════════════════════════════════

/**
 * 从一行文本中提取指定列范围的可见内容。
 *
 * 正确处理 ANSI 转义序列（不计宽度但保留到结果中）和宽字符。
 *
 * @param line - 源文本行（可包含 ANSI 序列）
 * @param startCol - 起始列（从 0 开始）
 * @param length - 要提取的列数
 * @param strict - 严格模式：排除边界处会超出范围的宽字符
 * @returns 切片后的文本
 *
 * 照抄 Pi tui/src/utils.ts sliceByColumn
 */
export function sliceByColumn(line: string, startCol: number, length: number, strict = false): string {
  return sliceWithWidth(line, startCol, length, strict).text;
}

/**
 * 与 sliceByColumn 相同，但同时返回结果的实际可见宽度。
 *
 * 遍历逻辑：
 * 1. 累积 ANSI 序列（暂不输出，等遇到可见字符再附加）
 * 2. 对于每个字形：检查是否在目标列范围内
 * 3. 在 strict 模式下，如果宽字符会超出结束列则跳过
 *
 * @param line - 源文本行
 * @param startCol - 起始列
 * @param length - 提取长度
 * @param strict - 严格模式
 * @returns 切片文本及其实际列宽
 *
 * 照抄 Pi tui/src/utils.ts sliceWithWidth
 */
export function sliceWithWidth(
  line: string,
  startCol: number,
  length: number,
  strict = false,
): { text: string; width: number } {
  if (length <= 0) return { text: "", width: 0 };

  const endCol = startCol + length;
  let result = "",
    resultWidth = 0,
    currentCol = 0,
    i = 0,
    pendingAnsi = "";

  while (i < line.length) {
    // 遇到 ANSI 序列：如果在目标范围内就加入结果，否则暂存等待后续可见字符
    const ansi = extractAnsiCode(line, i);
    if (ansi) {
      if (currentCol >= startCol && currentCol < endCol) result += ansi.code;
      else if (currentCol < startCol) pendingAnsi += ansi.code;
      i += ansi.length;
      continue;
    }

    // 找到下一个 ANSI 序列或字符串末尾
    let textEnd = i;
    while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;

    // 逐字形处理这段纯文本
    for (const { segment } of graphemeSegmenter.segment(line.slice(i, textEnd))) {
      const w = graphemeWidth(segment);
      const inRange = currentCol >= startCol && currentCol < endCol;
      const fits = !strict || currentCol + w <= endCol;

      if (inRange && fits) {
        // 在范围内 → 附加暂存的 ANSI 序列和当前字形
        if (pendingAnsi) {
          result += pendingAnsi;
          pendingAnsi = "";
        }
        result += segment;
        resultWidth += w;
      }
      currentCol += w;
      if (currentCol >= endCol) break;
    }
    i = textEnd;
    if (currentCol >= endCol) break;
  }

  return { text: result, width: resultWidth };
}
