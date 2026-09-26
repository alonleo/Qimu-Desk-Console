import { memberScopeSql } from "@/core/visibility";
import { currentUser } from "@/core/auth";
import { row, rows } from "@/core/db";
import { getAiConfig } from "@/core/llm";
import { syncSkills } from "@/core/skills";
import { syncWorkflows } from "@/core/workflows";
import DashboardView from "@/components/DashboardView";

export const dynamic = "force-dynamic";

type RecentTask = {
  id: number;
  title: string;
  status: string;
  priority: string;
  project_name: string | null;
  project_color: string | null;
};

type ProjectProgress = {
  id: number;
  name: string;
  color: string | null;
  total: number;
  done: number;
};

/** 任务聚合计数（COUNT 返回数值，避免 SUM 的 DECIMAL 形态差异） */
type TaskCounts = {
  total: number;
  todo: number;
  doing: number;
  waiting: number;
  done: number;
};

type RecentNotice = {
  id: number;
  type: "notification" | "announcement";
  title: string;
  is_pinned: number;
  publisher_name: string | null;
  publish_time: string | null;
};

export default async function DashboardPage() {
  const user = await currentUser();
  const taskScope = memberScopeSql(user, "t");
  const projectScope = memberScopeSql(user, "p");
  // 技能与工作流以文件目录为准播种到共享库（缺失才插入，不覆盖后台维护的行）
  await Promise.all([syncSkills(), syncWorkflows()]);

  const counts =
    (await row<TaskCounts>(`
      SELECT COUNT(*) AS total,
             COUNT(CASE WHEN status = 'todo' THEN 1 END) AS todo,
             COUNT(CASE WHEN status = 'doing' THEN 1 END) AS doing,
             COUNT(CASE WHEN status = 'waiting' THEN 1 END) AS waiting,
             COUNT(CASE WHEN status = 'done' THEN 1 END) AS done
      FROM tasks t WHERE 1=1 ${taskScope.clause}
    `, taskScope.params)) ?? { total: 0, todo: 0, doing: 0, waiting: 0, done: 0 };

  const [recentTasks, projectProgress, recentNotices, skillCount, workflowCount, docCount, aiCfg] =
    await Promise.all([
      rows<RecentTask>(`
        SELECT t.id, t.title, t.status, t.priority,
               p.name AS project_name, p.color AS project_color
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.status != 'done' ${taskScope.clause}
        ORDER BY CASE t.priority
          WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
          WHEN 'normal' THEN 2 ELSE 3
        END, t.id DESC
        LIMIT 6
      `, taskScope.params),
      rows<ProjectProgress>(`
        SELECT p.id, p.name, p.color,
          COUNT(t.id) AS total,
          COUNT(CASE WHEN t.status = 'done' THEN 1 END) AS done
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id ${taskScope.clause}
        WHERE p.status = 'active' ${projectScope.clause}
        GROUP BY p.id
        ORDER BY p.id
        LIMIT 5
      `, [...taskScope.params, ...projectScope.params]),
      rows<RecentNotice>(`
        SELECT n.id, n.type, n.title, n.is_pinned, u.display_name AS publisher_name, n.publish_time
        FROM notice n
        LEFT JOIN users u ON u.id = n.publisher_id
        WHERE n.status = 'published'
        ORDER BY n.is_pinned DESC, n.publish_time DESC, n.id DESC
        LIMIT 5
      `),
      row<{ c: number }>("SELECT COUNT(*) AS c FROM skills"),
      row<{ c: number }>("SELECT COUNT(*) AS c FROM workflows"),
      row<{ c: number }>("SELECT COUNT(*) AS c FROM docs"),
      getAiConfig(),
    ]);

  return (
    <DashboardView
      userName={user?.displayName || user?.username || "朋友"}
      userRole={user?.role}
      stats={{
        tasks: counts.total,
        skills: skillCount?.c ?? 0,
        workflows: workflowCount?.c ?? 0,
        docs: docCount?.c ?? 0,
        aiEnabled: aiCfg.enabled,
      }}
      taskSummary={{
        todo: counts.todo,
        doing: counts.doing,
        waiting: counts.waiting,
        done: counts.done,
      }}
      recentTasks={recentTasks}
      projectProgress={projectProgress}
      recentNotices={recentNotices}
    />
  );
}
