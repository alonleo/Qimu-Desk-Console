import { NextResponse } from "next/server";
import { requireUser, jsonError, readJson, assertOrigin } from "@/core/api";
import { listDocs, createDoc, listCategories, listTags } from "@/core/knowledge";
import { normalizeVisibility, defaultVisibility } from "@/core/visibility";
import type { SourceValue } from "@/core/ai/artifacts";

export const dynamic = "force-dynamic";

/** 知识库列表与子串检索：?q= 关键词（LIKE，与后端口径一致）、?category=、?tag=、?limit=、?mine=1|public */
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);

  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return jsonError("无效的 limit", 400);
  }
  const mineParam = url.searchParams.get("mine");
  const mine = mineParam === "1" || mineParam === "public" ? mineParam : undefined;

  try {
    const [docs, categories, tags] = await Promise.all([
      listDocs({
        q: url.searchParams.get("q") ?? undefined,
        category: url.searchParams.get("category") ?? undefined,
        tag: url.searchParams.get("tag") ?? undefined,
        limit,
        user,
        mine,
      }),
      listCategories(user),
      listTags(user),
    ]);
    return NextResponse.json({ docs, categories, tags });
  } catch (e) {
    return jsonError(`检索失败：${(e as Error).message}`, 400);
  }
}

/** 新建文档：{ title, category?, tags?: string[], content?, visibility?, source?: 'manual'|'ai' } */
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (!assertOrigin(req)) return jsonError("来源不合法", 403);

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return jsonError("请求体为空", 400);

  const title = String(body.title ?? "").trim();
  if (!title) return jsonError("文档标题不能为空", 400);
  if (title.length > 200) return jsonError("标题过长", 400);

  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10)
    : [];

  // 可选来源标识：AI 产物调用传 ai；白名单 manual|ai
  const sourceRaw = body.source ?? "manual";
  if (sourceRaw !== "manual" && sourceRaw !== "ai") {
    return jsonError("source 只能是 manual 或 ai", 400);
  }

  const visibility = normalizeVisibility(body.visibility) ?? defaultVisibility(user);

  try {
    const doc = await createDoc(
      {
        title,
        category: String(body.category ?? "").trim() || "未分类",
        tags,
        content: body.content === undefined || body.content === null ? "" : String(body.content),
      },
      user.username,
      {
        source: sourceRaw as SourceValue,
        ownerId: user.id,
        visibility,
      }
    );
    // ok:true 保证与 skills/workflows 写接口契约一致（DraftCard 以 res.ok && data.ok 判定成功）
    return NextResponse.json({ ok: true, doc });
  } catch (e) {
    return jsonError(`保存文档失败：${(e as Error).message}`, 400);
  }
}
