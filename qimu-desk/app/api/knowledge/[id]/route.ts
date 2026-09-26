import { NextResponse } from "next/server";
import { requireUser, jsonError, readJson, assertOrigin } from "@/core/api";
import { getDoc, updateDoc, deleteDoc } from "@/core/knowledge";
import { canReadRow, canEditRow, normalizeVisibility } from "@/core/visibility";
import { row } from "@/core/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function parseId(ctx: Ctx): Promise<number | null> {
  const { id } = await ctx.params;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 文档详情（含 Markdown 正文）。member 访问他人 personal 条目 → 404 防探测 */
export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);

  const id = await parseId(ctx);
  if (id === null) return jsonError("无效的文档 ID", 400);

  const doc = await getDoc(id);
  if (!doc) return jsonError("文档不存在", 404);
  if (!canReadRow(user, doc)) return jsonError("文档不存在", 404);
  return NextResponse.json({ doc });
}

/** 更新文档：{ title?, category?, tags?, content?, pinned?, visibility? } */
export async function PATCH(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (!assertOrigin(req)) return jsonError("来源不合法", 403);

  const id = await parseId(ctx);
  if (id === null) return jsonError("无效的文档 ID", 400);

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return jsonError("请求体为空", 400);

  // 行级写权限校验（owner_id 服务端读，不可信原则）
  const existing = await row<{ visibility: string | null; owner_id: number | null }>(
    "SELECT visibility, owner_id FROM docs WHERE id = ?",
    [id]
  );
  if (!existing) return jsonError("文档不存在", 404);
  if (!canEditRow(user, existing)) return jsonError("仅创建人可修改", 403);

  const patch: Parameters<typeof updateDoc>[1] = {};
  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) return jsonError("标题不能为空", 400);
    if (title.length > 200) return jsonError("标题过长", 400);
    patch.title = title;
  }
  if (body.category !== undefined) {
    patch.category = String(body.category).trim() || "未分类";
  }
  if (body.tags !== undefined) {
    patch.tags = Array.isArray(body.tags)
      ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10)
      : [];
  }
  if (body.content !== undefined) {
    patch.content = String(body.content);
  }
  if (body.pinned !== undefined) {
    patch.pinned = Boolean(body.pinned);
  }
  // 可见性更新：仅接受 personal/public
  const vis = normalizeVisibility(body.visibility);
  if (vis) patch.visibility = vis;

  const doc = await updateDoc(id, patch);
  if (!doc) return jsonError("文档不存在", 404);
  return NextResponse.json({ doc });
}

/** 删除文档 */
export async function DELETE(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (!assertOrigin(req)) return jsonError("来源不合法", 403);

  const id = await parseId(ctx);
  if (id === null) return jsonError("无效的文档 ID", 400);

  const existing = await row<{ visibility: string | null; owner_id: number | null }>(
    "SELECT visibility, owner_id FROM docs WHERE id = ?",
    [id]
  );
  if (!existing) return jsonError("文档不存在", 404);
  if (!canEditRow(user, existing)) return jsonError("仅创建人可修改", 403);

  const ok = await deleteDoc(id);
  if (!ok) return jsonError("文档不存在", 404);
  return NextResponse.json({ ok: true });
}
