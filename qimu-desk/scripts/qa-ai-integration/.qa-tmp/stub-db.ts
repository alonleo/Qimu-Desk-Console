// QA 自动生成：DB 写通道桩。若被测纯函数意外走到写库，将在此抛错暴露。
export async function createSkill(): Promise<never> { throw new Error("QA: unexpected createSkill call"); }
export async function createWorkflow(): Promise<never> { throw new Error("QA: unexpected createWorkflow call"); }
export async function createDoc(): Promise<never> { throw new Error("QA: unexpected createDoc call"); }
export async function runShell(): Promise<never> { throw new Error("QA: unexpected runShell call"); }
export async function runHttp(): Promise<never> { throw new Error("QA: unexpected runHttp call"); }
export async function row(): Promise<never> { throw new Error("QA: unexpected row call"); }
export async function rows(): Promise<never> { throw new Error("QA: unexpected rows call"); }
export async function exec(): Promise<never> { throw new Error("QA: unexpected exec call"); }
export async function withTransaction(): Promise<never> { throw new Error("QA: unexpected withTransaction call"); }
export async function withColumnFallback(): Promise<never> { throw new Error("QA: unexpected withColumnFallback call"); }
export async function ensureSourceColumns(): Promise<boolean> { return true; }
export function nowString(): string { return "2026-01-01 00:00:00"; }
export function isBadFieldError(): boolean { return false; }
export function isDuplicateKeyError(): boolean { return false; }
export function coerceSkillConfig(type: string, raw: unknown): Record<string, unknown> {
  const obj = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  if (type === "http") {
    const FLAT_KEYS = ["method", "url", "headers", "body", "timeout"] as const;
    const nested =
      obj.http && typeof obj.http === "object" ? ({ ...(obj.http as Record<string, unknown>) } as Record<string, unknown>) : {};
    let moved = false;
    for (const k of FLAT_KEYS) {
      if (nested[k] === undefined && obj[k] !== undefined) { nested[k] = obj[k]; moved = true; }
    }
    if (moved || (obj.http === undefined && nested.url !== undefined)) {
      for (const k of FLAT_KEYS) delete obj[k];
      obj.http = nested;
    }
  }
  return obj;
}
export default {};
