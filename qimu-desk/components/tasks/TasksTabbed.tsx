"use client";
import { Tabs } from "antd";
import TaskWorkspace from "./TaskWorkspace";
import ScheduledTasksView from "./ScheduledTasksView";
import type { Task,Project,Member,Actor } from "./task-model";
import type { ScheduledTaskRow } from "./types";
export default function TasksTabbed(props:{initialProjectId?:string;tasks:Task[];projects:Project[];members:Member[];actor:Actor;scheduledTasks:ScheduledTaskRow[]}) {
 const workspace=<TaskWorkspace key={props.initialProjectId || "all"} {...props}/>;
 if(props.actor.role!=="admin") return workspace;
 return <Tabs items={[{key:"daily",label:"日常任务",children:workspace},{key:"scheduled",label:"定时任务",children:<ScheduledTasksView scheduledTasks={props.scheduledTasks}/>}]} />;
}
