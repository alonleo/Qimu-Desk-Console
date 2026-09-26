import { NextResponse } from "next/server";
import { row, exec } from "@/core/db";
import { requireUser, jsonError, readJson, assertOrigin } from "@/core/api";
import { parseCron } from "@/components/tasks/schedule";

export const dynamic = "force-dynamic";

function cleanName(name: unknown): string | null {
  const s = typeof name === "string" ? name.trim() : "";
  if (!s) return null;
  return s.length > 200 ? null : s;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (!assertOrigin(req)) return jsonError("来源不合法", 403);

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 1) return jsonError("无效 ID", 400);

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return jsonError("请求体为空", 400);

  const existing = await row("SELECT id FROM scheduled_tasks WHERE id = ?", [id]);
  if (!existing) return jsonError("定时任务不存在", 404);

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return jsonError("名称不能为空或过长（≤200 字）", 400);
    fields.push("name = ?");
    values.push(name);
  }
  if (body.cron !== undefined) {
    const cron = typeof body.cron === "string" ? body.cron.trim() : "";
    if (!cron || cron.length > 64 || parseCron(cron) === null) {
      return jsonError("cron 表达式不合法（标准 5 段：分 时 日 月 周）", 400);
    }
    fields.push("cron = ?");
    values.push(cron);
  }
  if (body.notes !== undefined) {
    fields.push("notes = ?");
    values.push(body.notes ? String(body.notes).trim() : null);
  }
  if (body.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(body.enabled === false || body.enabled === 0 ? 0 : 1);
  }
  if (body.target_type !== undefined) {
    const tt = body.target_type as string | null;
    if (tt !== null && !["skill", "workflow"].includes(tt)) {
      return jsonError("target_type 必须是 skill 或 workflow", 400);
    }
    fields.push("target_type = ?");
    values.push(tt || null);
  }
  if (body.target_id !== undefined) {
    const tid = body.target_id as number | null;
    if (tid !== null && (!Number.isInteger(tid) || tid < 1)) {
      return jsonError("target_id 必须为正整数", 400);
    }
    fields.push("target_id = ?");
    values.push(tid);
  }
  if (body.params !== undefined) {
    const p = body.params;
    if (p === null || p === undefined) {
      fields.push("params = ?");
      values.push(null);
    } else if (typeof p === "object") {
      fields.push("params = ?");
      values.push(JSON.stringify(p));
    }
  }

  if (fields.length === 0) return jsonError("无更新字段", 400);

  fields.push("updated_at = NOW()");
  values.push(id);

  await exec(`UPDATE scheduled_tasks SET ${fields.join(", ")} WHERE id = ?`, values);

  const task = await row(
    `SELECT id, name, notes, cron, enabled, last_run_at, target_type, target_id, params, created_at, updated_at
     FROM scheduled_tasks WHERE id = ?`,
    [id]
  );

  return NextResponse.json({ scheduledTask: task });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (!assertOrigin(req)) return jsonError("来源不合法", 403);

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 1) return jsonError("无效 ID", 400);

  const existing = await row("SELECT id FROM scheduled_tasks WHERE id = ?", [id]);
  if (!existing) return jsonError("定时任务不存在", 404);

  await exec("DELETE FROM scheduled_tasks WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
}
