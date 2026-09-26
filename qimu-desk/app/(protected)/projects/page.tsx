import { currentUser } from "@/core/auth";
import { rows } from "@/core/db";
import ProjectManager from "@/components/tasks/ProjectManager";
import type { ProjectRow } from "@/components/tasks/types";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  await currentUser();

  const projects = await rows<ProjectRow>(`
    SELECT p.*,
      COUNT(t.id) AS task_count,
      COUNT(CASE WHEN t.status = 'done' THEN 1 END) AS done_count,
      COUNT(CASE WHEN t.status IN ('todo','doing','waiting') THEN 1 END) AS open_count
    FROM projects p
    LEFT JOIN tasks t ON t.project_id = p.id
    WHERE p.status != 'archived'
    GROUP BY p.id
    ORDER BY p.id
  `);

  return <ProjectManager projects={projects} />;
}
