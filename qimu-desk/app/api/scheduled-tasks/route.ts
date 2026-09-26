import { NextResponse } from "next/server";
import { rows, row, exec } from "@/core/db";
import { requireUser, jsonError, readJson, assertOrigin } from "@/core/api";
import { parseCron } from "@/components/tasks/schedule";

export const dynamic = "force-dynamic";

/** 判断 cron 是否合法（标准 5 段，字段值域正确） */
function isValidCron(cron: unknown): cron is string {
  if (typeof cron !== "string") return false;
  const t = cron.trim();
  return t.length > 0 && t.length <= 64 && parseCron(t) !== null;
}

function cleanName(name: unknown): string | null {
  const s = typeof name === "string" ? name.trim() : "";
  if (!s) return null;
  return s.length > 200 ? null : s;
}

export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);

  const list = await rows(`
    SELECT id, name, notes, cron, enabled, last_run_at, target_type, target_id, params, created_at, updated_at
    FROM scheduled_tasks
    ORDER BY enabled DESC, id DESC
  `);
  return NextResponse.json({ scheduledTasks: list });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (!assertOrigin(req)) return jsonError("来源不合法", 403);

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return jsonError("请求体为空", 400);

  const name = cleanName(body.name);
  if (!name) return jsonError("名称不能为空或过长（≤200 字）", 400);

  const cron = typeof body.cron === "string" ? body.cron.trim() : "";
  if (!isValidCron(cron)) return jsonError("cron 表达式不合法（标准 5 段：分 时 日 月 周）", 400);

  const notes = body.notes ? String(body.notes).trim() : null;
  const enabled = body.enabled === false || body.enabled === 0 ? 0 : 1;

  // 目标类型校验
  const targetType = body.target_type as string | undefined;
  const targetId = body.target_id as number | undefined;
  const params = body.params !== undefined ? JSON.stringify(body.params) : null;

  if (targetType !== undefined && targetType !== null) {
    if (!["skill", "workflow"].includes(targetType)) {
      return jsonError("target_type 必须是 skill 或 workflow", 400);
    }
    if (!Number.isInteger(targetId) || (targetId ?? 0) < 1) {
      return jsonError("target_id 必须为正整数", 400);
    }
  }

  const info = await exec(
    `INSERT INTO scheduled_tasks (name, notes, cron, enabled, target_type, target_id, params)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, notes, cron, enabled, targetType || null, targetId || null, params]
  );

  const task = await row(
    `SELECT id, name, notes, cron, enabled, last_run_at, target_type, target_id, params, created_at, updated_at
     FROM scheduled_tasks WHERE id = ?`,
    [info.insertId]
  );

  return NextResponse.json({ scheduledTask: task });
}
