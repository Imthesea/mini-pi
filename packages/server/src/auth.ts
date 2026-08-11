/**
 * JWT 签发与验证。v1 仅 localhost 免密模式。
 * 签名 token（v1 不需要完整 JWT 库，local 场景下就够用）。
 */
import { randomUUID, createHmac, timingSafeEqual } from "crypto";

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 分钟
const TOKEN_REFRESH_BEFORE_MS = 30 * 1000; // 过期前 30 秒可刷新

interface TokenPayload {
  iat: number;
  exp: number;
}

function sign(payload: TokenPayload, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload), "utf-8");
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data.toString("base64url")}.${sig}`;
}

function verify(token: string, secret: string): TokenPayload | null {
  const [dataPart, sigPart] = token.split(".");
  if (!dataPart || !sigPart) return null;
  const data = Buffer.from(dataPart, "base64url");
  const expectedSig = createHmac("sha256", secret).update(data).digest("base64url");

  try {
    const sigBuf = Buffer.from(sigPart, "base64url");
    const expectedBuf = Buffer.from(expectedSig, "base64url");
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  } catch {
    return null;
  }

  const payload = JSON.parse(data.toString("utf-8")) as TokenPayload;
  if (Date.now() >= payload.exp) return null;
  return payload;
}

export function createAuth() {
  const secret = randomUUID();

  return {
    /** 签发票证 */
    issueToken(): { token: string; expiresIn: number } {
      const now = Date.now();
      const payload: TokenPayload = { iat: now, exp: now + TOKEN_TTL_MS };
      return { token: sign(payload, secret), expiresIn: TOKEN_TTL_MS };
    },

    /** 验证票证 */
    validateToken(token: string): boolean {
      return verify(token, secret) !== null;
    },

    /** 是否需要刷新（过期前 30 秒内） */
    shouldRefresh(token: string): boolean {
      const payload = verify(token, secret);
      if (!payload) return false;
      return Date.now() >= payload.exp - TOKEN_REFRESH_BEFORE_MS;
    },
  };
}
