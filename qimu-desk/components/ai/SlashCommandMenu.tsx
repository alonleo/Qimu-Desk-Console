"use client";

/**
 * AI 输入框「/」内联命令面板 —— 受控纯展示组件。
 *
 *  - 桌面 / 中屏：绝对定位浮层，渲染在 composer 正上方（依赖父容器 position:relative）。
 *  - 移动端（isMobile）：改用 antd Drawer 从底部弹出，触控项最小高 44px。
 *  - 键盘高亮由父组件通过 activeToken 控制；本组件仅负责渲染与点击回调。
 *  - 技能 / 工作流项支持行内次级 action：＋引用 / ↵发送（或运行）。
 */

import { useEffect, useRef } from "react";
import type { ComponentType } from "react";
import { Drawer, Empty, Tag } from "antd";
import type { SlashGroup, SlashItem } from "@/core/ai/slashCommands";

export interface SlashCommandMenuProps {
  open: boolean;
  groups: SlashGroup[];
  /** 当前键盘高亮项的 token（与渲染顺序一致的扁平索引由父组件计算） */
  activeToken: string | null;
  isMobile: boolean;
  /** 超过 50 项时建议开启（此处用于适当放宽浮层高度，真正的虚拟滚动非必需） */
  enableVirtual?: boolean;
  onSelect: (item: SlashItem) => void;
  onClose: () => void;
  onSkillAction?: (item: SlashItem, action: "ref" | "send") => void;
  onWorkflowAction?: (item: SlashItem, action: "ref" | "run") => void;
}

function ItemIcon({ icon }: { icon?: ComponentType<any> }) {
  if (!icon) return null;
  const Icon = icon;
  return <Icon />;
}

export default function SlashCommandMenu(props: SlashCommandMenuProps) {
  const {
    open,
    groups,
    activeToken,
    isMobile,
    enableVirtual,
    onSelect,
    onClose,
    onSkillAction,
    onWorkflowAction,
  } = props;

  // 记录每个项的 DOM 节点，供键盘高亮时 scrollIntoView
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (activeToken) {
      itemRefs.current.get(activeToken)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeToken, open]);

  if (!open) return null;

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const maxHeight = enableVirtual ? 360 : 340;

  const renderActions = (it: SlashItem) => {
    if (it.type === "skill") {
      return (
        <span className="slash-item-actions" style={isMobile ? { visibility: "visible" } : undefined}>
          <button
            type="button"
            className="slash-action-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onSkillAction?.(it, "ref");
            }}
          >
            ＋引用
          </button>
          <button
            type="button"
            className="slash-action-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onSkillAction?.(it, "send");
            }}
          >
            ↵发送
          </button>
        </span>
      );
    }
    if (it.type === "workflow") {
      return (
        <span className="slash-item-actions" style={isMobile ? { visibility: "visible" } : undefined}>
          <button
            type="button"
            className="slash-action-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onWorkflowAction?.(it, "ref");
            }}
          >
            ＋引用
          </button>
          <button
            type="button"
            className="slash-action-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onWorkflowAction?.(it, "run");
            }}
          >
            ↵运行
          </button>
        </span>
      );
    }
    return null;
  };

  const renderItem = (it: SlashItem) => (
    <div
      key={it.token}
      ref={(el) => {
        if (el) itemRefs.current.set(it.token, el);
        else itemRefs.current.delete(it.token);
      }}
      className={`slash-item${it.token === activeToken ? " active" : ""}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onSelect(it)}
    >
      <span className="slash-item-icon">
        <ItemIcon icon={it.icon} />
      </span>
      <span className="slash-item-main">
        <span className="slash-item-label">
          {it.label}
          {it.recent ? (
            <Tag color="purple" style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: "16px" }}>
              最近
            </Tag>
          ) : null}
        </span>
        {it.description ? <span className="slash-item-desc">{it.description}</span> : null}
      </span>
      {renderActions(it)}
    </div>
  );

  // —— 移动端：底部 Drawer ——
  if (isMobile) {
    const height = Math.min(460, Math.max(240, total * 56 + 56));
    return (
      <Drawer
        placement="bottom"
        open={open}
        onClose={onClose}
        height={height}
        title="命令 / 技能 / 工作流"
        styles={{ body: { padding: 8 } }}
      >
        {total === 0 ? (
          <div style={{ padding: 24 }}>
            <Empty description="无匹配命令 / 技能 / 工作流" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          groups.map((g) => (
            <div className="slash-group" key={g.key}>
              <div className="slash-group-title">{g.title}</div>
              {g.items.map(renderItem)}
            </div>
          ))
        )}
      </Drawer>
    );
  }

  // —— 桌面 / 中屏：浮层 ——
  return (
    <div className="slash-menu" style={{ maxHeight }}>
      <div className="slash-scroll">
        {total === 0 ? (
          <div style={{ padding: 16 }}>
            <Empty description="无匹配命令 / 技能 / 工作流" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          groups.map((g) => (
            <div className="slash-group" key={g.key}>
              <div className="slash-group-title">{g.title}</div>
              {g.items.map(renderItem)}
            </div>
          ))
        )}
      </div>
      <div className="slash-hint">↑↓ 选择 · Tab/Enter 确认 · Esc 关闭</div>
    </div>
  );
}
