"use client";

import { useState } from "react";
import { Tabs, Badge } from "antd";
import {
  CheckSquareOutlined,
  ScheduleOutlined,
} from "@ant-design/icons";
import TasksView from "./TasksView";
import ScheduledTasksView from "./ScheduledTasksView";
import type { TaskRow, ProjectRow, ScheduledTaskRow } from "./types";

export default function TasksTabbed({
  tasks,
  projects,
  scheduledTasks,
}: {
  tasks: TaskRow[];
  projects: ProjectRow[];
  scheduledTasks: ScheduledTaskRow[];
}) {
  const [tab, setTab] = useState("daily");

  const openCount = tasks.filter((t) => t.status !== "done").length;
  const activeScheduled = scheduledTasks.filter((t) => t.enabled === 1).length;

  return (
    <Tabs
      activeKey={tab}
      onChange={setTab}
      items={[
        {
          key: "daily",
          label: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <CheckSquareOutlined style={{ color: "#52c41a" }} />
              日常任务
              {openCount > 0 && (
                <Badge
                  count={openCount}
                  color="#52c41a"
                  style={{ marginLeft: 2 }}
                />
              )}
            </span>
          ),
          children: <TasksView tasks={tasks} projects={projects} />,
        },
        {
          key: "scheduled",
          label: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ScheduleOutlined style={{ color: "#fa8c16" }} />
              定时任务
              {activeScheduled > 0 && (
                <Badge
                  count={activeScheduled}
                  color="#fa8c16"
                  style={{ marginLeft: 2 }}
                />
              )}
            </span>
          ),
          children: <ScheduledTasksView scheduledTasks={scheduledTasks} />,
        },
      ]}
    />
  );
}
