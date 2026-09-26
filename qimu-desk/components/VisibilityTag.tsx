"use client";
/**
 * 可见性 Tag（个人 / 通用）
 *
 * 渲染唯一出处（架构 §六.2）。管理后台 Manager 内联用了相同 color/icon 字面量，
 * 修改此处需同步检查 components/{skills,workflows,tasks,knowledge}/*Manager.tsx。
 *
 * - 个人 = gold + UserOutlined
 * - 通用 = purple + TeamOutlined（与 prompt 技能品牌绿 #00c896 同源）
 */
import { Tag } from "antd";
import { UserOutlined, TeamOutlined } from "@ant-design/icons";
import {
  VISIBILITY_LABEL,
  type VisibilityValue,
} from "@/core/visibility";

export type VisibilityTagProps = {
  value: VisibilityValue | string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
};

export default function VisibilityTag({ value, className, style }: VisibilityTagProps) {
  // 缺列/NULL/未知值按 public（架构 §六.4 宁多见不误伤）
  const isPersonal = value === "personal";
  return (
    <Tag
      color={isPersonal ? "gold" : "purple"}
      icon={isPersonal ? <UserOutlined /> : <TeamOutlined />}
      className={className}
      style={style}
    >
      {isPersonal ? VISIBILITY_LABEL.personal : VISIBILITY_LABEL.public}
    </Tag>
  );
}
