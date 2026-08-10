import { eastAsianWidth } from "get-east-asian-width";

// segmenters (shared instance)
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Get the shared grapheme segmenter instance.
 */
export function getGraphemeSegmenter(): Intl.Segmenter {
  return graphemeSegmenter;
}

/**
 * Check if a grapheme cluster (after segmentation) could possibly be an RGI emoji.
 * This is a fast heuristic to avoid the expensive rgiEmojiRegex test.
 * 照抄 Pi tui/src/utils.ts
 */
function couldBeEmoji(segment: string): boolean {
  const cp = segment.codePointAt(0)!;
  return (
    (cp >= 0x1f000 && cp <= 0x1fbff) || // Emoji and Pictograph
    (cp >= 0x2300 && cp <= 0x23ff) || // Misc technical
    (cp >= 0x2600 && cp <= 0x27bf) || // Misc symbols, dingbats
    (cp >= 0x2b50 && cp <= 0x2b55) || // Specific stars/circles
    segment.includes("️") || // Contains VS16 (emoji presentation selector)
    segment.length > 2 // Multi-codepoint sequences (ZWJ, skin tones, etc.)
  );
}

// Regexes for character classification (same as string-width library)
const zeroWidthRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/v;
const leadingNonPrintingRegex = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/v;
const rgiEmojiRegex = /^\p{RGI_Emoji}$/v;

// Cache for non-ASCII strings
const WIDTH_CACHE_SIZE = 512;
const widthCache = new Map<string, number>();

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
 * Calculate the terminal width of a single grapheme cluster.
 * 照抄 Pi tui/src/utils.ts graphemeWidth
 */
function graphemeWidth(segment: string): number {
  if (segment === "\t") {
    return 3;
  }

  // Zero-width clusters
  if (zeroWidthRegex.test(segment)) {
    return 0;
  }

  // Emoji check with pre-filter
  if (couldBeEmoji(segment) && rgiEmojiRegex.test(segment)) {
    return 2;
  }

  // Get base visible codepoint
  const base = segment.replace(leadingNonPrintingRegex, "");
  const cp = base.codePointAt(0);
  if (cp === undefined) {
    return 0;
  }

  // Regional indicator symbols (U+1F1E6..U+1F1FF) are often rendered as
  // full-width emoji in terminals
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
    return 2;
  }

  let width = eastAsianWidth(cp);

  // Trailing halfwidth/fullwidth forms and AM vowels
  if (segment.length > 1) {
    for (const char of segment.slice(1)) {
      const c = char.codePointAt(0)!;
      if (c >= 0xff00 && c <= 0xffef) {
        width += eastAsianWidth(c);
      } else if (c === 0x0e33 || c === 0x0eb3) {
        width += 1;
      }
    }
  }

  return width;
}

/**
 * Extract ANSI escape sequences from a string at the given position.
 * 照抄 Pi tui/src/utils.ts extractAnsiCode
 */
export function extractAnsiCode(str: string, pos: number): { code: string; length: number } | null {
  if (pos >= str.length || str[pos] !== "\x1b") return null;

  const next = str[pos + 1];

  // CSI sequence: ESC [ ... m/G/K/H/J
  if (next === "[") {
    let j = pos + 2;
    while (j < str.length && !/[mGKHJ]/.test(str[j]!)) j++;
    if (j < str.length) return { code: str.substring(pos, j + 1), length: j + 1 - pos };
    return null;
  }

  // OSC sequence: ESC ] ... BEL or ESC ] ... ST (ESC \)
  if (next === "]") {
    let j = pos + 2;
    while (j < str.length) {
      if (str[j] === "\x07") return { code: str.substring(pos, j + 1), length: j + 1 - pos };
      if (str[j] === "\x1b" && str[j + 1] === "\\") return { code: str.substring(pos, j + 2), length: j + 2 - pos };
      j++;
    }
    return null;
  }

  // APC sequence: ESC _ ... BEL or ESC _ ... ST (ESC \)
  if (next === "_") {
    let j = pos + 2;
    while (j < str.length) {
      if (str[j] === "\x07") return { code: str.substring(pos, j + 1), length: j + 1 - pos };
      if (str[j] === "\x1b" && str[j + 1] === "\\") return { code: str.substring(pos, j + 2), length: j + 2 - pos };
      j++;
    }
    return null;
  }

  return null;
}

/**
 * Calculate the visible width of a string in terminal columns.
 * 照抄 Pi tui/src/utils.ts visibleWidth
 */
export function visibleWidth(str: string): number {
  if (str.length === 0) {
    return 0;
  }

  // Fast path: pure ASCII printable
  if (isPrintableAscii(str)) {
    return str.length;
  }

  // Check cache
  const cached = widthCache.get(str);
  if (cached !== undefined) {
    return cached;
  }

  // Normalize: tabs to 3 spaces, strip ANSI escape codes
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
        i += ansi.length;
        continue;
      }
      stripped += clean[i];
      i++;
    }
    clean = stripped;
  }

  // Calculate width
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(clean)) {
    width += graphemeWidth(segment);
  }

  // Cache result
  if (widthCache.size >= WIDTH_CACHE_SIZE) {
    const firstKey = widthCache.keys().next().value;
    if (firstKey !== undefined) {
      widthCache.delete(firstKey);
    }
  }
  widthCache.set(str, width);

  return width;
}

/**
 * Extract a range of visible columns from a line.
 * 照抄 Pi tui/src/utils.ts sliceByColumn / sliceWithWidth
 */
export function sliceByColumn(line: string, startCol: number, length: number, strict = false): string {
  return sliceWithWidth(line, startCol, length, strict).text;
}

/** Like sliceByColumn but also returns the actual visible width of the result. */
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
    const ansi = extractAnsiCode(line, i);
    if (ansi) {
      if (currentCol >= startCol && currentCol < endCol) result += ansi.code;
      else if (currentCol < startCol) pendingAnsi += ansi.code;
      i += ansi.length;
      continue;
    }

    let textEnd = i;
    while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;

    for (const { segment } of graphemeSegmenter.segment(line.slice(i, textEnd))) {
      const w = graphemeWidth(segment);
      const inRange = currentCol >= startCol && currentCol < endCol;
      const fits = !strict || currentCol + w <= endCol;
      if (inRange && fits) {
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
