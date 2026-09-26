/** 任务与项目模块共享类型 */

export type TaskStatus = "todo" | "doing" | "waiting" | "done";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
/** 任务周期标记：天任务 / 周任务 */
export type TaskPeriod = "daily" | "weekly";

export type TaskRow = {
  id: number;
  project_id: number | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  period: TaskPeriod | null;
  due_date: string | null;
  start_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  project_name: string | null;
  project_color: string | null;
  /** 可见性：personal | public（缺列按 public） */
  visibility?: string | null;
  /** 创建人 users.id */
  owner_id?: number | null;
  /** 创建人展示名 */
  owner_name?: string | null;
};

export type ProjectRow = {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  task_count: number;
  done_count: number;
  open_count: number;
  /** 可见性：personal | public */
  visibility?: string | null;
  /** 创建人 users.id */
  owner_id?: number | null;
  /** 创建人展示名 */
  owner_name?: string | null;
};

/** 定时任务目标类型 */
export type ScheduledTargetType = "skill" | "workflow";

/** 定时任务（周期执行模板）：cron 为标准 5 段表达式 */
export type ScheduledTaskRow = {
  id: number;
  name: string;
  notes: string | null;
  cron: string;
  /** MySQL TINYINT：1 启用 / 0 停用 */
  enabled: number;
  last_run_at: string | null;
  /** 目标类型 */
  target_type: ScheduledTargetType | null;
  /** 目标 ID */
  target_id: number | null;
  /** 执行参数 JSON */
  params: string | null;
  created_at: string;
  updated_at: string;
};

/** 状态元数据：标签、颜色、图标色 */
export const STATUS_META: Record<
  TaskStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  todo: { label: "待办", color: "#1677ff", bg: "#e6f4ff", border: "#91caff" },
  doing: { label: "进行中", color: "#fa8c16", bg: "#fff7e6", border: "#ffd591" },
  waiting: { label: "等待", color: "#0ea5e9", bg: "#e0f2fe", border: "#bae6fd" },
  done: { label: "已完成", color: "#52c41a", bg: "#f6ffed", border: "#b7eb8f" },
};

export const STATUS_ORDER: TaskStatus[] = ["todo", "doing", "waiting", "done"];

/** 优先级元数据 */
export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; color: string }
> = {
  low: { label: "低", color: "#8c8c8c" },
  normal: { label: "普通", color: "#1677ff" },
  high: { label: "高", color: "#fa8c16" },
  urgent: { label: "紧急", color: "#ff4d4f" },
};

/** 任务周期元数据 */
export const PERIOD_META: Record<
  TaskPeriod,
  { label: string; color: string }
> = {
  daily: { label: "天任务", color: "#13c2c2" },
  weekly: { label: "周任务", color: "#0ea5e9" },
};

export const PERIOD_ORDER: TaskPeriod[] = ["daily", "weekly"];

/** 项目颜色预设 */
export const PROJECT_COLORS = [
  "#1677ff", "#52c41a", "#fa8c16", "#eb2f96",
  "#0ea5e9", "#13c2c2", "#faad14", "#f5222d",
];
