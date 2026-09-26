import { redirect } from "next/navigation";
import { currentUser } from "@/core/auth";
import { rows } from "@/core/db";
import { taskServer } from "@/core/task-api";
import TasksTabbed from "@/components/tasks/TasksTabbed";
import type { Task, Project, Member } from "@/components/tasks/task-model";
import type { ScheduledTaskRow } from "@/components/tasks/types";
export const dynamic = "force-dynamic";
export default async function TasksPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
 const user = await currentUser();
 if (!user) redirect("/login");
 const [tasks,projects,members,scheduledTasks] = await Promise.all([
   taskServer<Task[]>("/tasks"),taskServer<Project[]>("/projects"),taskServer<Member[]>("/tasks/members"),
   user.role === "admin" ? rows<ScheduledTaskRow>("SELECT * FROM scheduled_tasks ORDER BY enabled DESC, id DESC") : Promise.resolve([]),
 ]);
 return <TasksTabbed initialProjectId={projectId} tasks={tasks} projects={projects} members={members} actor={{id:user.id,role:user.role}} scheduledTasks={scheduledTasks}/>;
}
