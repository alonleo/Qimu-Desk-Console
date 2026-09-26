"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App, Avatar, Badge, Button, Empty, List, Modal, Popover, Tag, Tooltip, Typography } from "antd";
import { BellOutlined, NotificationOutlined, PushpinFilled } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { getWsToken } from "@/core/chat";

/**
 * 通知中心（notice 模块，挂在 AppShell 顶部标题栏）：
 * - 铃铛按钮：Badge 未读角标（60s 轮询 /api/notices/pending），Popover 展示待处理列表 + 查看全部入口；
 * - 公告（announcement）：强制阅读 Modal 队列——不可关闭、无遮罩点击/ESC 退出，点"我已阅读并知晓"写回执后弹下一条；
 * - 通知（notification）：AntD notification 顶部弹窗，弹出即视为已送达并写回执（点击弹窗可看详情）。
 *
 * 写路径约定（与 chat-module 一致）：阅读回执 POST 收口后端；
 * dev：NEXT_PUBLIC_NOTICE_API_BASE 直连 :8080；prod：不设 → 同源 /api/backend/notices 经 OpenResty 转发。
 */

export type NoticeItem = {
  id: number;
  type: "notification" | "announcement";
  title: string;
  content: string | null;
  is_pinned: number;
  publisher_name: string | null;
  publish_time: string | null;
};

const NOTICE_API_BASE = (process.env.NEXT_PUBLIC_NOTICE_API_BASE || "").replace(/\/+$/, "");
const NOTICE_API_PREFIX = NOTICE_API_BASE ? `${NOTICE_API_BASE}/api/notices` : "/api/backend/notices";

const TYPE_LABELS: Record<string, string> = { announcement: "公告", notification: "通知" };
const TYPE_COLORS: Record<string, string> = { announcement: "#fa541c", notification: "#1677ff" };
const PIN_COLOR = "#fa8c16";

/** 写阅读回执（幂等；失败由下一轮轮询兜底） */
async function markReadRemote(id: number): Promise<void> {
  const token = await getWsToken();
  const res = await fetch(`${NOTICE_API_PREFIX}/${id}/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  if (!res.ok || body?.ok !== true) throw new Error("回执写入失败");
}

export default function NoticeCenter() {
  // 独立 App 上下文：AppShell 全局未包 <App>，这里自建以使用 notification 受控 API
  return (
    <App component={false}>
      <NoticeCenterInner />
    </App>
  );
}

function NoticeCenterInner() {
  const { notification } = App.useApp();
  const router = useRouter();

  const [unreadTotal, setUnreadTotal] = useState(0);
  const [announcements, setAnnouncements] = useState<NoticeItem[]>([]);
  const [pendingNotifications, setPendingNotifications] = useState<NoticeItem[]>([]);
  const [detail, setDetail] = useState<NoticeItem | null>(null);
  const [ackLoading, setAckLoading] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // 本会话已弹过的通知 id：轮询中不重复弹窗
  const shownIds = useRef<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notices/pending", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; data?: { announcements: NoticeItem[]; notifications: NoticeItem[]; unreadTotal: number } }
        | null;
      if (!res.ok || body?.ok !== true || !body.data) return;

      const { announcements: anns, notifications: notis, unreadTotal: total } = body.data;
      setAnnouncements(anns ?? []);
      setPendingNotifications(notis ?? []);
      setUnreadTotal(Math.max(0, Number(total ?? 0)));

      // 通知：顶部弹窗推送，弹出即写回执（送达即消费；漏看可经铃铛/通知公告页回看）
      for (const n of notis ?? []) {
        if (shownIds.current.has(n.id)) continue;
        shownIds.current.add(n.id);
        notification.open({
          key: `notice-${n.id}`,
          placement: "topRight",
          message: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {n.is_pinned === 1 && <PushpinFilled style={{ color: PIN_COLOR }} />}
              <span style={{ fontWeight: 600 }}>{n.title}</span>
              <Tag color={TYPE_COLORS[n.type] ?? "#1677ff"} style={{ marginInlineEnd: 0 }}>
                {TYPE_LABELS[n.type] ?? n.type}
              </Tag>
            </span>
          ),
          description: (
            <span style={{ fontSize: 12, color: "#8c8c8c", display: "block" }}>
              {(n.content || "").slice(0, 80) || "点击查看详情"}
            </span>
          ),
          onClick: () => {
            notification.destroy(`notice-${n.id}`);
            setDetail(n);
          },
        });
        void markReadRemote(n.id).catch(() => {
          /* 回执失败由下一轮轮询修正角标 */
        });
      }
    } catch {
      /* 轮询失败静默忽略，下一轮重试 */
    }
  }, [notification]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  /** 确认公告：写回执 → 出队（队列由下一轮轮询/本地状态驱动） */
  const acknowledge = useCallback(async () => {
    const cur = announcements[0];
    if (!cur) return;
    setAckLoading(true);
    try {
      await markReadRemote(cur.id);
      setAnnouncements((prev) => prev.slice(1));
      setUnreadTotal((t) => Math.max(0, t - 1));
      setPendingNotifications((prev) => prev.filter((n) => n.id !== cur.id));
    } catch {
      /* 失败保留在队列，重试 */
    } finally {
      setAckLoading(false);
    }
  }, [announcements]);

  /** 点击待处理项：打开详情；未读则顺手写回执 */
  const openItem = useCallback((n: NoticeItem) => {
    setPopoverOpen(false);
    setDetail(n);
    void markReadRemote(n.id)
      .then(() => {
        setAnnouncements((prev) => prev.filter((a) => a.id !== n.id));
        setPendingNotifications((prev) => prev.filter((p) => p.id !== n.id));
        setUnreadTotal((t) => Math.max(0, t - 1));
      })
      .catch(() => {
        /* 角标由轮询兜底修正 */
      });
  }, []);

  const currentAnnouncement = announcements[0] ?? null;
  const pendingList = [...announcements, ...pendingNotifications].slice(0, 8);

  const popoverContent = (
    <div style={{ width: 320 }}>
      {pendingList.length === 0 ? (
        <Empty description="暂无未读通知" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: "16px 0" }} />
      ) : (
        <List
          size="small"
          dataSource={pendingList}
          rowKey={(n) => n.id}
          renderItem={(n) => (
            <List.Item
              onClick={() => openItem(n)}
              style={{ cursor: "pointer", borderRadius: 8, paddingInline: 8, transition: "background .2s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#fafafa")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <List.Item.Meta
                avatar={
                  <Avatar size={30} style={{ background: TYPE_COLORS[n.type] ?? "#fa541c", flexShrink: 0 }}>
                    <NotificationOutlined />
                  </Avatar>
                }
                title={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 220 }}>
                    {n.is_pinned === 1 && <PushpinFilled style={{ color: PIN_COLOR }} />}
                    <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {n.title}
                    </span>
                  </span>
                }
                description={
                  <span style={{ fontSize: 12, color: "#8c8c8c" }}>
                    <Tag
                      color={TYPE_COLORS[n.type] ?? "#fa541c"}
                      style={{ marginInlineEnd: 4, fontSize: 11, lineHeight: "16px", paddingInline: 4 }}
                    >
                      {TYPE_LABELS[n.type] ?? n.type}
                    </Tag>
                    {n.publisher_name ?? "系统"} · {n.publish_time ?? "—"}
                  </span>
                }
              />
            </List.Item>
          )}
        />
      )}
      <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 8, textAlign: "center" }}>
        <Button type="link" size="small" onClick={() => { setPopoverOpen(false); router.push("/notices"); }}>
          查看全部通知公告
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Popover
        content={popoverContent}
        trigger="click"
        placement="bottomRight"
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
      >
        <Tooltip title="通知公告">
          <Badge count={unreadTotal} size="small" overflowCount={99}>
            <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} style={{ width: 40, height: 40 }} />
          </Badge>
        </Tooltip>
      </Popover>

      {/* 公告强制阅读：无关闭按钮、禁遮罩点击与 ESC，唯一出口是"我已阅读并知晓" */}
      <Modal
        open={!!currentAnnouncement}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Tag color="#fa541c" style={{ marginInlineEnd: 0 }}>公告</Tag>
            <span>系统公告（强制阅读）</span>
            {announcements.length > 1 && (
              <span style={{ fontSize: 12, color: "#8c8c8c", fontWeight: 400 }}>
                共 {announcements.length} 条待阅读
              </span>
            )}
          </span>
        }
        closable={false}
        maskClosable={false}
        keyboard={false}
        width={560}
        footer={
          <Button type="primary" loading={ackLoading} onClick={acknowledge}>
            我已阅读并知晓
          </Button>
        }
      >
        {currentAnnouncement && (
          <div>
            <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
              {currentAnnouncement.is_pinned === 1 && <PushpinFilled style={{ color: PIN_COLOR }} title="置顶" />}
              <span style={{ fontSize: 15, fontWeight: 600, color: "#262626" }}>{currentAnnouncement.title}</span>
            </div>
            <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 12 }}>
              {currentAnnouncement.publisher_name ?? "系统"} 发布于 {currentAnnouncement.publish_time ?? "—"}
            </div>
            <Typography.Paragraph
              style={{ whiteSpace: "pre-wrap", marginBottom: 0, maxHeight: 320, overflowY: "auto", minHeight: 80 }}
            >
              {currentAnnouncement.content || "（无内容）"}
            </Typography.Paragraph>
          </div>
        )}
      </Modal>

      {/* 详情弹窗（铃铛/弹窗点击进入）：与通知公告页详情形态一致 */}
      <Modal
        title={
          detail ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {detail.is_pinned === 1 && <PushpinFilled style={{ color: PIN_COLOR }} title="置顶" />}
              <span>{detail.title}</span>
              <Tag color={TYPE_COLORS[detail.type] ?? "#fa541c"} style={{ marginInlineEnd: 0 }}>
                {TYPE_LABELS[detail.type] ?? detail.type}
              </Tag>
            </span>
          ) : (
            "通知详情"
          )
        }
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={560}
      >
        <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 12 }}>
          {detail?.publisher_name ?? "系统"} 发布于 {detail?.publish_time ?? "—"}
        </div>
        <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0, minHeight: 60 }}>
          {detail?.content || "（无内容）"}
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
