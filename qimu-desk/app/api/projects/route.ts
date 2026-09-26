import { NextResponse } from "next/server";
import { row, exec } from "@/core/db";
import { requireUser, jsonError, readJson, assertOrigin } from "@/core/api";
import { projectCreateSchema, firstZodError } from "@/core/schemas";
import { normalizeVisibility, defaultVisibility } from "@/core/visibility";

import { listProjects } from "@/core/projects";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "1";
  return NextResponse.json({ projects: await listProjects(user, includeArchived) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (!assertOrigin(req)) return jsonError("来源不合法", 403);

  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body) return jsonError("请求体为空", 400);
  const parsed = projectCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed), 400);
  const { name, description = null, color = null } = parsed.data;

  const visibility = normalizeVisibility(body.visibility) ?? defaultVisibility(user);

  const info = await exec(
    "INSERT INTO projects (name, description, color, visibility, owner_id) VALUES (?, ?, ?, ?, ?)",
    [name, description, color, visibility, user.id]
  );

  const project = await row("SELECT * FROM projects WHERE id = ?", [info.insertId]);
  return NextResponse.json({ project });
}
