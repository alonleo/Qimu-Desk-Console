export type TaskStatus = "todo" | "doing" | "waiting" | "done";
export type Task = {
  id: number;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: "low" | "normal" | "high" | "urgent";
  project_id: number | null;
  project_name?: string | null;
  assignee_id?: number | null;
  assignee_name?: string | null;
  owner_id?: number | null;
  owner_name?: string | null;
  visibility?: string | null;
  period?: "daily" | "weekly" | null;
  start_date?: string | null;
  due_date: string | null;
  completed_at?: string | null;
  updated_at?: string;
};
export type Project = {
  id: number;
  name: string;
  status?: string;
  visibility?: string | null;
};
export type Member = { id: number; name: string };
export type Actor = { id: number; role: "admin" | "member" };
export const statuses: Record<TaskStatus, string> = {
  todo: "待开始",
  doing: "进行中",
  waiting: "等待处理",
  done: "已完成",
};
export const priorities = {
  urgent: "紧急",
  high: "高",
  normal: "普通",
  low: "低",
};
export function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function overdue(task: Task, now: Date) {
  if (task.status === "done" || !task.due_date) return false;
  return task.period === "daily"
    ? task.due_date <
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    : task.due_date < dateKey(now);
}
export function dueOn(task: Task, date: string, today: string) {
  return (
    !!task.due_date &&
    (task.period === "daily" ? date === today : task.due_date === date)
  );
}
export function canManage(actor: Actor, task: Task) {
  return actor.role === "admin" || actor.id === task.owner_id;
}
export function canStatus(actor: Actor, task: Task) {
  return (
    canManage(actor, task) ||
    (task.visibility === "public" && actor.id === task.assignee_id)
  );
}
export type Filters = {
  search: string;
  project: string;
  status: string;
  priority: string;
  assignee: string;
  due: string;
  scope: string;
  sort: string;
};
export const initialFilters: Filters = {
  search: "",
  project: "all",
  status: "all",
  priority: "all",
  assignee: "all",
  due: "all",
  scope: "all",
  sort: "priority",
};
export function filterTasks(
  tasks: Task[],
  f: Filters,
  actor: Actor,
  now: Date,
) {
  const today = dateKey(now),
    rank = { urgent: 0, high: 1, normal: 2, low: 3 };
  return tasks
    .filter(
      (t) =>
        (!f.search ||
          `${t.title} ${t.notes || ""}`
            .toLowerCase()
            .includes(f.search.trim().toLowerCase())) &&
        (f.project === "all" ||
          (f.project === "none"
            ? t.project_id == null
            : String(t.project_id) === f.project)) &&
        (f.status === "all" || t.status === f.status) &&
        (f.priority === "all" || t.priority === f.priority) &&
        (f.assignee === "all" ||
          (f.assignee === "none"
            ? t.assignee_id == null
            : String(t.assignee_id) === f.assignee)) &&
        (f.scope === "all" ||
          (f.scope === "assigned"
            ? t.assignee_id === actor.id
            : t.owner_id === actor.id)) &&
        (f.due === "all" ||
          (f.due === "overdue"
            ? overdue(t, now)
            : f.due === "today"
              ? dueOn(t, today, today)
              : !t.due_date)),
    )
    .sort((a, b) =>
      f.sort === "due"
        ? (a.due_date
            ? a.period === "daily"
              ? today
              : a.due_date
            : "9999"
          ).localeCompare(
            b.due_date ? (b.period === "daily" ? today : b.due_date) : "9999",
          ) || a.id - b.id
        : f.sort === "newest"
          ? b.id - a.id
          : rank[a.priority] - rank[b.priority] || b.id - a.id,
    );
}
