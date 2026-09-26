import { NextResponse } from "next/server";
import { requireUser, jsonError } from "@/core/api";
import { listTags } from "@/core/knowledge";
import { taxonomyProxy } from "@/core/knowledge-taxonomy";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  return NextResponse.json({ tags: await listTags(user) });
}
export async function POST(req: Request) { return taxonomyProxy(req, "tags"); }
export async function DELETE(req: Request) { return taxonomyProxy(req, "tags"); }
