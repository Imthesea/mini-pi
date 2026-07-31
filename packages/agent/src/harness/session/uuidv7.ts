/**
 * uuidv7 短 id 生成器。
 *
 * 完整 uuidv7 太长(36 字符)作为 entry id 浪费。
 * 取末 8 位(基本随机)作为短 id,冲突时重试 100 次,失败兜底用完整 uuidv7。
 *
 * 这个实现在 Node.js 和浏览器中都可用(用 crypto.getRandomValues,Web Crypto API)。
 * 原 pi 用 @earendil-works/pi-ai 的 uuidv7,本项目不依赖该包,自己实现。
 *
 * 时间戳部分前 48 位用 Date.now() 编码,后 74 位随机。
 * 这里为了简洁直接调 randomUUID(16 字节),不严格符合 RFC 9562 规范。
 * 因为我们只用它的随机尾部,时间戳部分不影响去重效果。
 */

let cryptoApi: Crypto | undefined;

/** 获取当前环境的 Web Crypto API */
function getCrypto(): Crypto {
  if (!cryptoApi) {
    // Node 18+ / 现代浏览器:globalThis.crypto
    // 注意:getRandomValues 本身类型上一定存在(因为 Crypto interface 有它),
    // 但运行时可能在某些边缘环境缺失,所以我们额外用 typeof 检查 randomUUID。
    if (
      typeof globalThis.crypto !== "undefined" &&
      typeof globalThis.crypto.randomUUID === "function"
    ) {
      cryptoApi = globalThis.crypto;
    } else {
      throw new Error("uuidv7: no Web Crypto API available");
    }
  }
  return cryptoApi;
}

/**
 * 生成一个 uuidv7 风格的字符串。
 *
 * 简化实现:取 randomUUID() 的 36 字符形式(末段 12 字符是随机的)。
 * 真实 uuidv7 头部是时间戳编码,这里不严格遵守(因为只用于短 id 取后 8 位)。
 */
export function uuidv7(): string {
  return getCrypto().randomUUID();
}

/**
 * 生成一个不与已有 id 冲突的短 id(末 8 位)。
 *
 * 冲突重试 100 次,失败兜底用完整 uuid。
 * 100 次 ≈ 50% 冲突概率约为 2^-50,可忽略。
 */
export function generateShortId(byId: { has(id: string): boolean }): string {
  for (let i = 0; i < 100; i++) {
    const id = uuidv7().slice(-8);
    if (!byId.has(id)) return id;
  }
  return uuidv7();
}
