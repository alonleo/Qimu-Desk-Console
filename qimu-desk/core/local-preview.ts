import { createHmac, timingSafeEqual } from "node:crypto";

export const PREVIEW_COOKIE = "alon_workbench_preview";
const TTL = 3600;
export function previewEnabled() {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.LOCAL_PREVIEW_ENABLED === "true" &&
    Boolean(
      process.env.LOCAL_PREVIEW_PASSWORD && process.env.LOCAL_PREVIEW_SECRET,
    )
  );
}
export function localRequest(headers: Headers) {
  const host = headers.get("host") || "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return false;
  const forwarded = headers.get("x-forwarded-host");
  if (forwarded && forwarded !== host) return false;
  const origin = headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}
function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function sign(value: string) {
  return createHmac("sha256", process.env.LOCAL_PREVIEW_SECRET || "")
    .update(value)
    .digest("hex");
}
export function validPreviewPassword(username: unknown, password: unknown) {
  return (
    previewEnabled() &&
    username === "preview" &&
    typeof password === "string" &&
    equal(password, process.env.LOCAL_PREVIEW_PASSWORD || "")
  );
}
export function previewSession() {
  if (!previewEnabled()) throw new Error("Local preview is disabled");
  const expiry = String(Math.floor(Date.now() / 1000) + TTL);
  return `${expiry}.${sign(expiry)}`;
}
export function validPreviewSession(value?: string) {
  if (!previewEnabled() || !value) return false;
  const parts = value.split(".");
  if (parts.length !== 2 || !/^\d+$/.test(parts[0])) return false;
  const expiry = Number(parts[0]),
    now = Math.floor(Date.now() / 1000);
  return expiry > now && expiry <= now + TTL && equal(parts[1], sign(parts[0]));
}
export const previewCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: false,
  path: "/",
  maxAge: TTL,
};
