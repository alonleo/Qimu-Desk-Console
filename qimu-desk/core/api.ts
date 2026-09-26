import { NextResponse } from "next/server";
import { currentUser, type User } from "./auth";

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export function assertOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const allowed = new Set<string>();
    const forwardedHost = req.headers.get("x-forwarded-host");
    const host = req.headers.get("host");
    if (forwardedHost) allowed.add(forwardedHost.toLowerCase());
    if (host) allowed.add(host.toLowerCase());
    if (process.env.APP_URL) {
      try {
        allowed.add(new URL(process.env.APP_URL).host.toLowerCase());
      } catch {
        /* APP_URL 非法时忽略 */
      }
    }
    return allowed.has(originHost);
  } catch {
    return false;
  }
}

export async function requireUser(): Promise<User | null> {
  return currentUser();
}

export async function requireAdmin(): Promise<User | null> {
  const user = await currentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
