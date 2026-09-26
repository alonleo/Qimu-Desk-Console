import { NextResponse } from "next/server";
import { rows, row, exec } from "@/core/db";
import { requireUser, jsonError, readJson, assertOrigin } from "@/core/api";
import { taskCreateSchema, firstZodError } from "@/core/schemas";
import { memberScopeSql, normalizeVisibility, defaultVisibility } from "@/core/visibility";

export const dynamic = "force-dynamic";

const VALID_STATUS = ["todo", "doing", "waiting", "done"];

export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const status = url.searchParams.get("status");
  const visibility = url.searchParams.get("visibility");
  const mine = url.searchParams.get("mine");

  let sql = `
    SELECT t.*, p.name AS project_name, p.color AS project_color,
           u.display_name AS owner_name, u.username AS owner_username
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN users u ON u.id = t.owner_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (projectId && projectId !== "all") {
    sql += " AND t.project_id = ?";
    params.push(Number(projectId));
  }
  if (status && VALID_STATUS.includes(status)) {
    sql += " AND t.status = ?";
    params.push(status);
  }
  // 可见性筛选（admin 场景为主，member scope 已天然约束）
  if (visibility === "personal" || visibility === "public") {
    sql += " AND t.visibility = ?";
    params.push(visibility);
  }
  // P1 我的 / 通用 快速切换（叠加在 scope 之内）
  if (mine === "1") {
    sql += " AND t.owner_id = ?";
    params.push(user.id);
  } else if (mine === "public") {
    sql += " AND t.visibility = 'public'";
  } else {
    const scope = memberScopeSql(user, "t");
    if (scope.clause) {
      sql += scope.clause;
      params.push(...scope.params);
    }
  }

  sql += " ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.id DESC";

  try {
    const list = await rows(sql, params);
    return NextResponse.json({ tasks: list });
  } catch (e) {
    // 缺列降级：不带 owner_name JOIN（owner_name 字段缺省 null）
    if ((e as { errno?: number }).errno === 1054) {
      const sqlLegacy = sql
        .replace("LEFT JOIN users u ON u.id = t.owner_id", "")
        .replace("u.display_name AS owner_name, u.username AS owner_username,", "");
      const list = await rows(sqlLegacy, params);
      return NextResponse.json({ tasks: list });
    }
    throw e;
  }
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return jsonError("未登录", 401);
  if (!assertOrigin(req)) return jsonError("来源不合法", 403);

  const parsed = taskCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(firstZodError(parsed), 400);
  const { title, projectId = null, status, priority, notes = null, dueDate = null, startDate = null, period = null } =
    parsed.data;
  // 复用 zod 解析后的对象取 visibility（避免 body 被消费后再读）
  const visibility = normalizeVisibility((parsed.data as Record<string, unknown>).visibility) ?? defaultVisibility(user);
  const ownerId = user.id;

  const info = await exec(
    `INSERT INTO tasks (project_id, title, notes, status, priority, period, due_date, start_date, visibility, owner_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [projectId, title, notes, status, priority, period, dueDate, startDate, visibility, ownerId]
  );

  const task = await row(
    `SELECT t.*, p.name AS project_name, p.color AS project_color,
            u.display_name AS owner_name, u.username AS owner_username
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN users u ON u.id = t.owner_id
     WHERE t.id = ?`,
    [info.insertId]
  );

  return NextResponse.json({ task });
}
