import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { row } from "./db";

/**
 * 认证（统一后：后端 JWT）
 *
 * 彻底统一后不再有独立的本地账号/会话体系：
 * - 账号只存在于后端 users 表（后端 BCrypt + JWT 签发）；
 * - 工作台登录时把用户名/密码交给后端 /api/auth/login，拿到 JWT 后写入
 *   本域 httpOnly Cookie（域名不同，无法共享后端 Cookie，需自持一份）；
 * - currentUser()：本地用同一 JWT_SECRET 校验签名与过期（零网络往返），
 *   再从 MySQL users 表取权威角色/显示名/禁用态。
 */

export const AUTH_COOKIE = "wb_token";
export const TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 与后端 app.jwt.expire-hours 保持一致

/** 仅本地开发使用的默认密钥（生产环境禁止使用）；须与 admin-backend application.yml 的 dev 默认值一致 */
const DEV_JWT_SECRET = "alon-workbench-dev-only-secret-0123456789abcdef";

/**
 * JWT 密钥：优先取环境变量 JWT_SECRET。
 * 生产（NODE_ENV=production，next start 自动置位）下缺失即抛错快速失败，
 * 绝不回退到可预测的默认值；本地开发缺省时用带警告的 dev 密钥。
 */
function jwtSecret(): string {
  const s = process.env.JWT_SECRET?.trim();
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET 环境变量未配置：生产环境禁止使用默认密钥，请设置 ≥32 位随机密钥并保持与 admin-backend 一致"
    );
  }
  console.warn(
    "[auth] JWT_SECRET 未配置，本地开发使用内置默认密钥；生产部署时必须通过环境变量 JWT_SECRET 注入。"
  );
  return DEV_JWT_SECRET;
}

export type User = {
  id: number;
  username: string;
  role: "admin" | "member";
  displayName: string | null;
};

type JwtPayload = { sub?: string; username?: string; role?: string; exp?: number };

/** JWT alg → Node 摘要算法；后端 jjwt 按密钥长度自动选 HS256/384/512，这里跟随 token header */
const JWT_ALG_TO_HASH: Record<string, string> = {
  HS256: "sha256",
  HS384: "sha384",
  HS512: "sha512",
};

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/** 本地校验 JWT（HMAC 签名随 header alg：HS256/384/512 + 过期），返回 claims；非法/过期返回 null */
export function decodeToken(token: string | undefined | null): JwtPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  try {
    const headerText = JSON.parse(b64urlDecode(header).toString("utf8")) as { alg?: string };
    const hashAlg = headerText.alg ? JWT_ALG_TO_HASH[headerText.alg] : undefined;
    if (!hashAlg) return null;
    const expected = createHmac(hashAlg, jwtSecret())
      .update(`${header}.${payload}`)
      .digest();
    const sig = b64urlDecode(signature);
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;

    const claims = JSON.parse(b64urlDecode(payload).toString("utf8")) as JwtPayload;
    if (!claims.sub || !claims.username || !claims.role) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/** 当前登录用户：JWT 验签后，回 MySQL users 表取权威角色/显示名/禁用态 */
export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  const claims = decodeToken(token);
  if (!claims) return null;

  try {
    const u = await row<{
      id: number;
      username: string;
      role: string;
      display_name: string | null;
      disabled: number;
    }>("SELECT id, username, role, display_name, disabled FROM users WHERE id = ?", [
      Number(claims.sub),
    ]);
    if (!u || u.disabled) return null;
    return {
      id: u.id,
      username: u.username,
      role: u.role === "admin" ? "admin" : "member",
      displayName: u.display_name,
    };
  } catch (e) {
    // fail-closed：DB 不可用时拒绝放行，避免“已禁用/降权”用户凭旧 claims 进入。
    // 页面渲染不应依赖该降级路径；如需容错应在更高层做“有缓存会话才放行”的受控策略。
    console.error("[auth] currentUser 读取用户状态失败，拒绝本次访问：", (e as Error).message);
    return null;
  }
}

/** 仅供后端代理类路由使用：取当前请求携带的 JWT（无则 null） */
export async function requestToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(AUTH_COOKIE)?.value ?? null;
}

export function tokenCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: (process.env.APP_URL || "").startsWith("https"),
    path: "/",
    maxAge: Math.floor(TOKEN_TTL_MS / 1000),
  };
}

/** 后端地址（Spring Boot），供登录代理 / admin 代理路由使用 */
export function backendBaseUrl(): string {
  return (process.env.ADMIN_BACKEND_URL || "http://localhost:8080").replace(/\/+$/, "");
}
