import { rows } from "./db";
import { memberScopeSql, type VisibilityUser } from "./visibility";
import type { ProjectRow } from "@/components/tasks/types";

/** 项目列表与统计使用相同的可见性规则，页面/API 共用。 */
export async function listProjects(user: VisibilityUser, includeArchived = false) {
  const projects = memberScopeSql(user, "p");
  const tasks = memberScopeSql(user, "t");
  return rows<ProjectRow>(`
    SELECT p.*, u.display_name AS owner_name,
      COUNT(t.id) AS task_count,
      COUNT(CASE WHEN t.status = 'done' THEN 1 END) AS done_count,
      COUNT(CASE WHEN t.status IN ('todo','doing','waiting') THEN 1 END) AS open_count
    FROM projects p
    LEFT JOIN users u ON u.id = p.owner_id
    LEFT JOIN tasks t ON t.project_id = p.id ${tasks.clause}
    WHERE 1=1 ${includeArchived ? "" : "AND p.status != 'archived'"} ${projects.clause}
    GROUP BY p.id, u.display_name
    ORDER BY p.updated_at DESC, p.id DESC
  `, [...tasks.params, ...projects.params]);
}
