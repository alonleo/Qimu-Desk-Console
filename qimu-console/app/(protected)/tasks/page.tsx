import { serverApi } from "@/utils/serverApi";
import TasksManager, { type TaskRow, type ProjectRow } from "@/components/tasks/TasksManager";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const tasks = await serverApi<TaskRow[]>("/tasks");
  const projects = await serverApi<ProjectRow[]>("/projects");
  return <TasksManager tasks={tasks} projects={projects} />;
}
