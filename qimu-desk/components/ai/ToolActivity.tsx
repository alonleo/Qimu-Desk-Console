"use client";
import { Tag } from "antd";
import type { ToolRun } from "@/core/ai/capability-schema";
export default function ToolActivity({ runs }: { runs?: ToolRun[] }) {
  if (!runs?.length) return null;
  return <div aria-live="polite" style={{ margin: "8px 0", display: "grid", gap: 6 }}>
    {runs.map((run) => <details key={run.id} style={{ border: "1px solid #e5e5e7", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
      <summary style={{ cursor: "pointer" }}>
        <Tag color={run.status === "running" ? "processing" : run.status === "success" ? "success" : "error"}>
          {run.status === "running" ? "调用中" : run.status === "success" ? "已完成" : "失败"}
        </Tag>{run.name}
      </summary>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 240, overflow: "auto", marginBottom: 0 }}>
        {run.output || "正在等待工具返回…"}
      </pre>
    </details>)}
  </div>;
}
