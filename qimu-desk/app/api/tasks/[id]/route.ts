import { NextResponse } from "next/server";
import { row, exec } from "@/core/db";
import { requireUser, jsonError, readJson, assertOrigin } from "@/core/api";
import { taskUpdateSchema, firstZodError } from "@/core/schemas";
import { canEditRow } from "@/core/visibility";

export const dynamic = "force-dynamic";

/** 行级写权限校验（架构 §六.5 §六.6）：服务端读到的 owner_id 唯一权威 */
function canWriteCheck(user: { id: number; role: "admin" | "member" }, row: { visibility?: string | null; owner_id?: number | null } | null) {
  if (!row) return { allowed: false as const, status: 404, msg: "任务不存在" };
  if (!canEditRow(user, row)) return { allowed: false as const, status: 403, msg: "仅创建人可修改" };
  return { allowed: true as const };
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

  const parsed = taskUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(firstZodError(parsed), 400);
  const body = parsed.data;

  const existing = await row<{ id: number; visibility: string | null; owner_id: number | null }>(
    "SELECT id, visibility, owner_id FROM tasks WHERE id = ?",
    [id]
  );
  const check = canWriteCheck(user, existing);
  if (!check.allowed) return jsonError(check.msg, check.status);

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.title !== undefined) {
    fields.push("title = ?");
    values.push(body.title);
  }
  if (body.projectId !== undefined) {
    fields.push("project_id = ?");
    values.push(body.projectId);
  }
  if (body.status !== undefined) {
    fields.push("status = ?");
    values.push(body.status);
    if (body.status === "done") {
      fields.push("completed_at = NOW()");
    } else {
      fields.push("completed_at = NULL");
    }
  }
  if (body.priority !== undefined) {
    fields.push("priority = ?");
    values.push(body.priority);
  }
  if (body.notes !== undefined) {
    fields.push("notes = ?");
    values.push(body.notes ?? null);
  }
  if (body.period !== undefined) {
    fields.push("period = ?");
    values.push(body.period ?? null);
  }
  if (body.dueDate !== undefined) {
    fields.push("due_date = ?");
    values.push(body.dueDate ?? null);
  }
  if (body.startDate !== undefined) {
    fields.push("start_date = ?");
    values.push(body.startDate ?? null);
  }

  if (fields.length === 0) return jsonError("无更新字段", 400);

  fields.push("updated_at = NOW()");
  values.push(id);

  await exec(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`, values);

  const task = await row(
    `SELECT t.*, p.name AS project_name, p.color AS project_color,
            u.display_name AS owner_name, u.username AS owner_username
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN users u ON u.id = t.owner_id
     WHERE t.id = ?`,
    [id]
  );

  return NextResponse.json({ task });
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

  const existing = await row<{ id: number; visibility: string | null; owner_id: number | null }>(
    "SELECT id, visibility, owner_id FROM tasks WHERE id = ?",
    [id]
  );
  const check = canWriteCheck(user, existing);
  if (!check.allowed) return jsonError(check.msg, check.status);

  await exec("DELETE FROM tasks WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
}
