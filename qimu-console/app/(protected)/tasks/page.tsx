import { serverApi } from "@/utils/serverApi";
import TasksManager from "@/components/tasks/TasksManager";
import type {Task,Project,Member,Actor} from "@/components/tasks/task-model";
export const dynamic = "force-dynamic";
export default async function TasksPage() {
 const [tasks,projects,members,me]=await Promise.all([serverApi<Task[]>("/tasks"),serverApi<Project[]>("/projects"),serverApi<Member[]>("/tasks/members"),serverApi<{user:Actor}>("/auth/me")]);
 return <TasksManager tasks={tasks} projects={projects} members={members} actor={me.user}/>;
}
