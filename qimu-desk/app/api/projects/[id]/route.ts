import { NextResponse } from "next/server";
import { row, exec } from "@/core/db";
import { requireUser, jsonError, readJson, assertOrigin } from "@/core/api";
import { projectUpdateSchema, firstZodError } from "@/core/schemas";
import { canEditRow } from "@/core/visibility";

export const dynamic = "force-dynamic";

/**
 * 行级写权限校验：member 只能编辑/删除自己创建的条目（含自己创建的通用条目）；
 * admin 全权。架构 §六.6：owner_id 不可信原则，此处只校验服务端读到的 owner_id。
 * 旧通用数据 owner_id=NULL → member 不可写（架构 §3.4）。
 */
function canWriteCheck(user: { id: number; role: "admin" | "member" }, row: { visibility?: string | null; owner_id?: number | null } | null) {
  if (!row) return { allowed: false as const, status: 404, msg: "项目不存在" };
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

  const parsed = projectUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(firstZodError(parsed), 400);
  const body = parsed.data;

  const existing = await row<{ id: number; visibility: string | null; owner_id: number | null }>(
    "SELECT id, visibility, owner_id FROM projects WHERE id = ?",
    [id]
  );
  const check = canWriteCheck(user, existing);
  if (!check.allowed) return jsonError(check.msg, check.status);

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.name !== undefined) {
    fields.push("name = ?");
    values.push(body.name);
  }
  if (body.description !== undefined) {
    fields.push("description = ?");
    values.push(body.description ?? null);
  }
  if (body.color !== undefined) {
    fields.push("color = ?");
    values.push(body.color ?? null);
  }
  if (body.status !== undefined) {
    fields.push("status = ?");
    values.push(body.status);
  }

  if (fields.length === 0) return jsonError("无更新字段", 400);

  fields.push("updated_at = NOW()");
  values.push(id);

  await exec(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`, values);

  const project = await row("SELECT * FROM projects WHERE id = ?", [id]);
  return NextResponse.json({ project });
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
    "SELECT id, visibility, owner_id FROM projects WHERE id = ?",
    [id]
  );
  const check = canWriteCheck(user, existing);
  if (!check.allowed) return jsonError(check.msg, check.status);

  await exec("DELETE FROM projects WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
}
