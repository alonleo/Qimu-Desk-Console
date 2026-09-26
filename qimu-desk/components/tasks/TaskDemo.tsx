"use client";
import { useState } from "react";
import TaskWorkspace from "./TaskWorkspace";
import { type Task, dateKey } from "./task-model";
export default function TaskDemo({
  mode = "desk",
}: {
  mode?: "desk" | "console";
}) {
  const [tasks] = useState<Task[]>(() => {
    const now = new Date();
    const today = dateKey(now);
    const yesterday = dateKey(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
    );
    return [
      {
        id: 1,
        title: "完成工作台交互评审",
        notes: "检查任务筛选、表单和状态流转",
        status: "doing",
        priority: "high",
        project_id: 1,
        project_name: "工作台改版",
        assignee_id: 1,
        assignee_name: "Alon Leo",
        owner_id: 1,
        owner_name: "Alon Leo",
        visibility: "public",
        start_date: yesterday,
        due_date: today,
      },
      {
        id: 2,
        title: "整理项目交付清单",
        notes: "确认验收范围与截止时间",
        status: "todo",
        priority: "urgent",
        project_id: 1,
        project_name: "工作台改版",
        assignee_id: 2,
        assignee_name: "林然",
        owner_id: 1,
        owner_name: "Alon Leo",
        visibility: "public",
        due_date: yesterday,
      },
      {
        id: 3,
        title: "同步接口联调结果",
        notes: "等待联调环境更新",
        status: "waiting",
        priority: "normal",
        project_id: 2,
        project_name: "团队协作",
        assignee_id: 1,
        assignee_name: "Alon Leo",
        owner_id: 2,
        owner_name: "林然",
        visibility: "public",
        due_date: today,
      },
      {
        id: 4,
        title: "归档会议记录",
        notes: null,
        status: "done",
        priority: "low",
        project_id: 2,
        project_name: "团队协作",
        assignee_id: 2,
        assignee_name: "林然",
        owner_id: 1,
        owner_name: "Alon Leo",
        visibility: "public",
        due_date: yesterday,
      },
      {
        id: 5,
        title: "安排下周工作",
        notes: null,
        status: "todo",
        priority: "normal",
        project_id: null,
        assignee_id: null,
        owner_id: 1,
        owner_name: "Alon Leo",
        visibility: "personal",
        due_date: null,
      },
    ];
  });
  return (
    <TaskWorkspace
      demo
      mode={mode}
      tasks={tasks}
      projects={[
        { id: 1, name: "工作台改版", status: "active" },
        { id: 2, name: "团队协作", status: "active" },
      ]}
      members={[
        { id: 1, name: "Alon Leo" },
        { id: 2, name: "林然" },
      ]}
      actor={{ id: 1, role: mode === "desk" ? "member" : "admin" }}
    />
  );
}
