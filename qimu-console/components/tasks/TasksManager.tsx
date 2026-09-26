"use client";
import TaskWorkspace from "./TaskWorkspace";
import type {Task,Project,Member,Actor} from "./task-model";
export type {Task as TaskRow,Project as ProjectRow} from "./task-model";
export default function TasksManager(props:{tasks:Task[];projects:Project[];members:Member[];actor:Actor}){return <TaskWorkspace {...props} mode="console"/>;}
