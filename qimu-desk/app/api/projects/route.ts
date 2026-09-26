import { NextResponse } from "next/server";
import { rows, row, exec } from "@/core/db";
import { requireUser, jsonError, readJson, assertOrigin } from "@/core/api";
import { projectCreateSchema, firstZodError } from "@/core/schemas";
import { memberScopeSql, normalizeVisibility, defaultVisibility } from "@/core/visibility";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);

  const scope = memberScopeSql(user, "p");
  // 任务统计也按可见性过滤（member 不把他人 personal 任务计入项目进度）
  const memberUser = user;
  try {
    const list = await rows(
      `SELECT p.*,
         (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id
          ${memberUser.role === "admin" ? "" : "AND (t.visibility = 'public' OR t.owner_id = ?)"} ) AS task_count,
         (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done'
          ${memberUser.role === "admin" ? "" : "AND (t.visibility = 'public' OR t.owner_id = ?)"} ) AS done_count,
         (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status IN ('todo','doing','waiting')
          ${memberUser.role === "admin" ? "" : "AND (t.visibility = 'public' OR t.owner_id = ?)"} ) AS open_count
       FROM projects p
       WHERE p.status != 'archived'${scope.clause ? " AND " + scope.clause.replace(/^\s*AND\s*/, "") : ""}
       GROUP BY p.id
       ORDER BY p.id`,
      memberUser.role === "admin" ? [] : [memberUser.id, memberUser.id, memberUser.id, ...scope.params]
    );
    return NextResponse.json({ projects: list });
  } catch (e) {
    // 缺列降级：去掉 owner_name JOIN、scope 过滤
    if ((e as { errno?: number }).errno === 1054) {
      const list = await rows(
        `SELECT p.*,
          COUNT(t.id) AS task_count,
          SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_count,
          SUM(CASE WHEN t.status IN ('todo','doing','waiting') THEN 1 ELSE 0 END) AS open_count
         FROM projects p
         LEFT JOIN tasks t ON t.project_id = p.id
         WHERE p.status != 'archived'
         GROUP BY p.id
         ORDER BY p.id`
      );
      return NextResponse.json({ projects: list });
    }
    throw e;
  }
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
