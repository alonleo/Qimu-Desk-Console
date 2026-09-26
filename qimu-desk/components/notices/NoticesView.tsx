"use client";

import { useCallback, useState } from "react";
import {
  Avatar,
  Empty,
  Input,
  List,
  Modal,
  Pagination,
  Spin,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import {
  NotificationOutlined,
  PushpinFilled,
  SearchOutlined,
} from "@ant-design/icons";
import { moduleGradient } from "../modules";

/** notice 行结构（snake_case，与 API 输出一致） */
export type NoticeRow = {
  id: number;
  type: "notification" | "announcement";
  title: string;
  content: string | null;
  is_pinned: number;
  status: "draft" | "published";
  publisher_id: number | null;
  publisher_name: string | null;
  publish_time: string | null;
  expire_time: string | null;
  create_time: string;
  update_time: string;
};

type TabKey = "all" | "announcement" | "notification";

const MODULE_COLOR = "#fa541c";
const PIN_COLOR = "#fa8c16";

const TYPE_LABELS: Record<string, string> = { announcement: "公告", notification: "通知" };
const TYPE_COLORS: Record<string, string> = { announcement: "#fa541c", notification: "#1677ff" };

const PAGE_SIZE = 10;

/** 通知公告模块：全部/公告/通知 Tab + 列表 + 详情弹窗（只读） */
export default function NoticesView({
  initialNotices,
  initialTotal,
}: {
  initialNotices: NoticeRow[];
  initialTotal: number;
}) {
  const [tab, setTab] = useState<TabKey>("all");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(initialTotal);
  const [notices, setNotices] = useState<NoticeRow[]>(initialNotices);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<NoticeRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /** 按当前 Tab / 关键字 / 页码拉取列表（仅 published，服务端排序） */
  const load = useCallback(
    async (nextTab: TabKey, kw: string, p: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ tab: nextTab, page: String(p), pageSize: String(PAGE_SIZE) });
        if (kw.trim()) params.set("title", kw.trim());
        const res = await fetch(`/api/notices?${params.toString()}`);
        if (!res.ok) {
          message.error("加载通知列表失败");
          return;
        }
        const data = (await res.json()) as { total: number; notices: NoticeRow[] };
        setNotices(data.notices ?? []);
        setTotal(data.total ?? 0);
        setPage(p);
      } catch {
        message.error("网络错误，请重试");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  async function openDetail(n: NoticeRow) {
    setDetailLoading(true);
    setDetail(n); // 先展示列表摘要，再用详情接口覆盖
    try {
      const res = await fetch(`/api/notices/${n.id}`);
      if (!res.ok) {
        message.error("加载通知详情失败");
        return;
      }
      const data = (await res.json()) as { notice: NoticeRow };
      setDetail(data.notice);
    } catch {
      message.error("网络错误，请重试");
    } finally {
      setDetailLoading(false);
    }
  }

  const tabBarExtra = (
    <Input
      allowClear
      placeholder="搜索标题"
      prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
      style={{ width: 220 }}
      value={keyword}
      onChange={(e) => setKeyword(e.target.value)}
      onPressEnter={() => load(tab, keyword, 1)}
      onClear={() => {
        setKeyword("");
        load(tab, "", 1);
      }}
    />
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Tabs
        activeKey={tab}
        onChange={(k) => {
          const nextTab = k as TabKey;
          setTab(nextTab);
          load(nextTab, keyword, 1);
        }}
        tabBarExtraContent={tabBarExtra}
        items={[
          { key: "all", label: "全部" },
          { key: "announcement", label: "公告" },
          { key: "notification", label: "通知" },
        ]}
      />

      <Spin spinning={loading}>
        {notices.length === 0 ? (
          <Empty description="暂无通知公告" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: "48px 0" }} />
        ) : (
          <List
            dataSource={notices}
            rowKey={(n) => n.id}
            renderItem={(n) => (
              <List.Item
                onClick={() => openDetail(n)}
                style={{ cursor: "pointer", borderRadius: 10, padding: "14px 16px", transition: "background .2s" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#fafafa")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar size={38} style={{ background: moduleGradient(MODULE_COLOR), flexShrink: 0 }}>
                      <NotificationOutlined />
                    </Avatar>
                  }
                  title={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {n.is_pinned === 1 && <PushpinFilled style={{ color: PIN_COLOR }} title="置顶" />}
                      <span style={{ fontWeight: 600 }}>{n.title}</span>
                      <Tag color={TYPE_COLORS[n.type] || MODULE_COLOR} style={{ marginInlineEnd: 0 }}>
                        {TYPE_LABELS[n.type] ?? n.type}
                      </Tag>
                    </span>
                  }
                  description={
                    <span style={{ fontSize: 12, color: "#8c8c8c" }}>
                      {n.publisher_name ?? "系统"} 发布于 {n.publish_time ?? "—"}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Spin>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Pagination
          current={page}
          pageSize={PAGE_SIZE}
          total={total}
          showSizeChanger={false}
          showTotal={(t) => `共 ${t} 条`}
          onChange={(p) => load(tab, keyword, p)}
        />
      </div>

      {/* 详情弹窗：content 按纯文本多行渲染 */}
      <Modal
        title={
          detail ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {detail.is_pinned === 1 && <PushpinFilled style={{ color: PIN_COLOR }} title="置顶" />}
              <span>{detail.title}</span>
              <Tag color={TYPE_COLORS[detail.type] || MODULE_COLOR} style={{ marginInlineEnd: 0 }}>
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
        width={640}
      >
        <Spin spinning={detailLoading && !detail?.content}>
          <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 12 }}>
            {detail?.publisher_name ?? "系统"} 发布于 {detail?.publish_time ?? "—"}
          </div>
          <Typography.Paragraph
            style={{ whiteSpace: "pre-wrap", marginBottom: 0, minHeight: 60 }}
          >
            {detail?.content || "（无内容）"}
          </Typography.Paragraph>
        </Spin>
      </Modal>
    </div>
  );
}
