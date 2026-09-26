"use client";
import { Button, Result } from "antd";
export default function TaskError({reset}:{reset:()=>void}) {
 return <Result status="warning" title="任务暂时无法加载" subTitle="请检查任务服务连接后重试。已有任务不会丢失。" extra={<Button onClick={reset}>重新加载</Button>}/>;
}
