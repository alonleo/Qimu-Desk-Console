"use client";
/**
 * 可见性选择控件（个人 / 通用）
 *
 * 创建/编辑弹窗内嵌。默认值：member → personal（个人工作台心智，§六默认决策 1），
 * admin → public（与旧数据一致，§六默认决策 3）。
 * 入参 visibility 不在白名单时回退到默认。
 */
import { Segmented } from "antd";
import {
  VISIBILITY_LABEL,
  VISIBILITY_PERSONAL,
  VISIBILITY_PUBLIC,
  defaultVisibility,
  normalizeVisibility,
  type VisibilityValue,
} from "@/core/visibility";

export type VisibilitySelectProps = {
  value?: VisibilityValue | string | null;
  onChange?: (v: VisibilityValue) => void;
  user: { id: number; role: "admin" | "member" } | null;
  disabled?: boolean;
};

export default function VisibilitySelect({ value, onChange, user, disabled }: VisibilitySelectProps) {
  const current = normalizeVisibility(value) ?? defaultVisibility(user);
  return (
    <Segmented
      value={current}
      onChange={(v) => onChange?.(v as VisibilityValue)}
      disabled={disabled}
      options={[
        { label: VISIBILITY_LABEL.personal, value: VISIBILITY_PERSONAL },
        { label: VISIBILITY_LABEL.public, value: VISIBILITY_PUBLIC },
      ]}
    />
  );
}
