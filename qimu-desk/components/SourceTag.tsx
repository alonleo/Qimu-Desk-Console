"use client";

import { Tag } from "antd";
import { RobotOutlined } from "@ant-design/icons";
import type { SourceValue } from "@/core/ai/artifacts";

/**
 * 共享来源 Tag：仅 AI 生成条目显示「AI 生成」；
 * manual/file 与未知来源一律不打扰手动条目（渲染 null）。
 */
export default function SourceTag({
  source,
}: {
  source?: SourceValue | string | null;
}) {
  if (source !== "ai") return null;
  return (
    <Tag color="geekblue" icon={<RobotOutlined />} style={{ margin: 0 }}>
      AI 生成
    </Tag>
  );
}
