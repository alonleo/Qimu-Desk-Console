"use client";

import { useCallback, useState } from "react";
import { Button, Card, Form, Input, Popconfirm, Space, Table, Tag, Tooltip, message } from "antd";
import { DeleteOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

export type OnlineRow = {
  tokenId: string;
  userId: number;
  userName: string;
  role: string;
  ipaddr: string;
  browser: string;
  os: string;
  loginTime: string;
};

type Query = { userName: string; ipaddr: string };

const ROLE_LABEL: Record<string, string> = { admin: "管理员", user: "普通用户" };

export default function OnlineManager({
  initialRows,
  initialTotal,
  initialPage,
  initialPageSize,
}: {
  initialRows: OnlineRow[];
  initialTotal: number;
  initialPage: number;
  initialPageSize: number;
}) {
  const [rows, setRows] = useState<OnlineRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [query, setQuery] = useState<Query>({ userName: "", ipaddr: "" });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queryForm] = Form.useForm<Query>();

  const loadList = useCallback(async (p: number, ps: number, q: Query) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (q.userName.trim()) params.set("userName", q.userName.trim());
      if (q.ipaddr.trim()) params.set("ipaddr", q.ipaddr.trim());
      const res = await fetch(`/api/monitor/online/list?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        total?: number;
        page?: number;
        pageSize?: number;
        items?: OnlineRow[];
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        message.error(data.error ?? "加载在线用户失败");
        return;
      }
      setRows(data.items ?? []);
      setTotal(data.total ?? 0);
      setPage(data.page ?? p);
      setPageSize(data.pageSize ?? ps);
    } catch {
      message.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }, []);

  async function onForceLogout(row: OnlineRow) {
    setBusy(true);
    try {
      const res = await fetch(`/api/monitor/online/${encodeURIComponent(row.tokenId)}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || data.ok === false) {
        message.error(data.error ?? "强制下线失败");
        return;
      }
      message.success(data.message ?? "强制下线成功");
      await loadList(page, pageSize, query);
    } catch {
      message.error("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  const columns: ColumnsType<OnlineRow> = [
    {
      title: "会话ID",
      dataIndex: "tokenId",
      width: 150,
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</span>
        </Tooltip>
      ),
    },
    { title: "登录用户", dataIndex: "userName", width: 120, render: (v: string) => <b>{v}</b> },
    { title: "主机", dataIndex: "ipaddr", width: 130, render: (v: string) => <span style={{ color: "#8c8c8c" }}>{v ?? "—"}</span> },
    { title: "浏览器", dataIndex: "browser", width: 110, render: (v: string) => <span style={{ color: "#8c8c8c" }}>{v ?? "—"}</span> },
    { title: "操作系统", dataIndex: "os", width: 120, render: (v: string) => <span style={{ color: "#8c8c8c" }}>{v ?? "—"}</span> },
    {
      title: "角色",
      dataIndex: "role",
      width: 100,
      render: (v: string) => <Tag color={v === "admin" ? "blue" : "default"}>{ROLE_LABEL[v] ?? v}</Tag>,
    },
    {
      title: "登录时间",
      dataIndex: "loginTime",
      width: 170,
      render: (v: string) => <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v ?? "—"}</span>,
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      fixed: "right",
      render: (_, row) => (
        <Popconfirm title={`强制下线 ${row.userName}（${row.tokenId}）？`} okText="强退" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => onForceLogout(row)}>
          <Button size="small" danger icon={<DeleteOutlined />}>强退</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card styles={{ body: { padding: "18px 16px 2px" } }}>
        <Form
          form={queryForm}
          layout="inline"
          initialValues={query}
          onFinish={(v) => {
            const q: Query = { userName: v.userName ?? "", ipaddr: v.ipaddr ?? "" };
            setQuery(q);
            loadList(1, pageSize, q);
          }}
        >
          <Form.Item name="userName" label="用户名称" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="模糊匹配" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="ipaddr" label="登录地址" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="模糊匹配" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item style={{ marginRight: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>搜索</Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  queryForm.resetFields();
                  const q: Query = { userName: "", ipaddr: "" };
                  setQuery(q);
                  loadList(1, pageSize, q);
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card
        title={
          <span>
            在线用户
            <Tag style={{ marginLeft: 10 }} color="blue">共 {total} 个会话</Tag>
            <span style={{ marginLeft: 12, color: "#8c8c8c", fontSize: 12 }}>会话在服务重启后清空；强制下线立即生效</span>
          </span>
        }
      >
        <Table
          rowKey="tokenId"
          size="middle"
          loading={loading}
          scroll={{ x: 1100 }}
          columns={columns}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize,
            total,
            showTotal: (t) => `共 ${t} 条`,
            showSizeChanger: true,
            onChange: (p, ps) => loadList(p, ps, query),
          }}
        />
      </Card>
    </div>
  );
}