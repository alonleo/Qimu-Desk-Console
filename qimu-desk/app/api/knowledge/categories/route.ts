import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/core/api";
import { listCategories } from "@/core/knowledge";

export const dynamic = "force-dynamic";

/** 分类列表（登录用户，只读）。分类的新增/重命名/删除统一在管理后台维护。 */
export async function GET() {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const categories = await listCategories();
  return NextResponse.json({ categories });
}
