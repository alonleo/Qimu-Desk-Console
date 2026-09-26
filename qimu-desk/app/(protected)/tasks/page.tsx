import { currentUser } from "@/core/auth";
import { rows } from "@/core/db";
import TasksTabbed from "@/components/tasks/TasksTabbed";
import type { TaskRow, ProjectRow, ScheduledTaskRow } from "@/components/tasks/types";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  await currentUser();

  const [tasks, projects, scheduledTasks] = await Promise.all([
    rows<TaskRow>(`
      SELECT t.*, p.name AS project_name, p.color AS project_color
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE p.status IS NULL OR p.status != 'archived'
      ORDER BY CASE t.priority
        WHEN 'urgent' THEN 0
        WHEN 'high' THEN 1
        WHEN 'normal' THEN 2
        ELSE 3
      END, t.id DESC
    `),
    rows<ProjectRow>(`
      SELECT p.*,
        COUNT(t.id) AS task_count,
        COUNT(CASE WHEN t.status = 'done' THEN 1 END) AS done_count,
        COUNT(CASE WHEN t.status IN ('todo','doing','waiting') THEN 1 END) AS open_count
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id
      WHERE p.status != 'archived'
      GROUP BY p.id
      ORDER BY p.id
    `),
    rows<ScheduledTaskRow>(`
      SELECT id, name, notes, cron, enabled, last_run_at, created_at, updated_at
      FROM scheduled_tasks
      ORDER BY enabled DESC, id DESC
    `),
  ]);

  return <TasksTabbed tasks={tasks} projects={projects} scheduledTasks={scheduledTasks} />;
}
