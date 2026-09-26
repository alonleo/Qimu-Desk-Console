import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/core/api";
import { listCategories } from "@/core/knowledge";

import { taxonomyProxy } from "@/core/knowledge-taxonomy";

export const dynamic = "force-dynamic";

/** 分类及当前用户可见文档数；共享目录写操作交给 Java 后端。 */
export async function GET() {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const categories = await listCategories(user);
  return NextResponse.json({ categories });
}

export async function POST(req: Request) { return taxonomyProxy(req, "categories"); }
export async function DELETE(req: Request) { return taxonomyProxy(req, "categories"); }
