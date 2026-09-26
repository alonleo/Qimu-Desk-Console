"use client";

import { Avatar, Card, Space, Tag, Typography } from "antd";
import { CheckCircleFilled, RocketOutlined } from "@ant-design/icons";
import { MODULE_META, moduleGradient, type ModuleKey } from "./modules";

export default function ModuleComingSoon({
  module,
  milestone,
  description,
  features = [],
}: {
  module: ModuleKey;
  milestone: string;
  description: string;
  features?: string[];
}) {
  const meta = MODULE_META[module];

  return (
    <Card style={{ borderRadius: 14 }}>
      <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        <Avatar size={68} style={{ background: moduleGradient(meta.color), fontSize: 30, flexShrink: 0 }}>
          {meta.icon}
        </Avatar>
        <div style={{ flex: 1, minWidth: 240 }}>
          <Space align="center" wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {meta.label}
            </Typography.Title>
            <Tag icon={<RocketOutlined />} color={meta.color}>
              {milestone} 建设中
            </Tag>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, maxWidth: 640 }}>
            {description}
          </Typography.Paragraph>
        </div>
      </div>

      {features.length > 0 && (
        <>
          <div style={{ height: 1, background: "#f0f0f0", margin: "20px 0" }} />
          <Typography.Text type="secondary">规划能力</Typography.Text>
          <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {features.map((f) => (
              <li
                key={f}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#595959" }}
              >
                <CheckCircleFilled style={{ color: meta.color }} />
                {f}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
