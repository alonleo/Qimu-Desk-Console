"use client";

import { useCallback, useState } from "react";
import { Button, Card, Form, Input, Popconfirm, Select, Space, Table, Tag, Tooltip, message } from "antd";
import { DeleteOutlined, ReloadOutlined, SearchOutlined, UnlockOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

export type SysLogininforRow = {
  id: number;
  userName: string;
  ipaddr: string | null;
  loginLocation: string | null;
  browser: string | null;
  os: string | null;
  status: "0" | "1";
  msg: string | null;
  loginTime: string | null;
};

type Query = { userName: string; ipaddr: string; status: string };

const STATUS_META = {
  "0": { label: "失败", color: "error" },
  "1": { label: "成功", color: "success" },
} as const;

export default function LogininforManager({
  initialLogs,
  initialTotal,
  initialPage,
  initialPageSize,
}: {
  initialLogs: SysLogininforRow[];
  initialTotal: number;
  initialPage: number;
  initialPageSize: number;
}) {
  const [logs, setLogs] = useState<SysLogininforRow[]>(initialLogs);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [query, setQuery] = useState<Query>({ userName: "", ipaddr: "", status: "" });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [queryForm] = Form.useForm<Query>();

  const loadList = useCallback(async (p: number, ps: number, q: Query) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (q.userName.trim()) params.set("userName", q.userName.trim());
      if (q.ipaddr.trim()) params.set("ipaddr", q.ipaddr.trim());
      if (q.status) params.set("status", q.status);
      const res = await fetch(`/api/monitor/logininfor/list?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; total?: number; page?: number; pageSize?: number; items?: SysLogininforRow[]; error?: string };
      if (!res.ok || data.ok === false) {
        message.error(data.error ?? "加载登录日志失败");
        return;
      }
      setLogs(data.items ?? []);
      setTotal(data.total ?? 0);
      setPage(data.page ?? p);
      setPageSize(data.pageSize ?? ps);
    } catch {
      message.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }, []);

  async function call(url: string, method: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, { method });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; deleted?: number };
      if (!res.ok || data.ok === false) {
        message.error(data.error ?? "操作失败");
        return false;
      }
      message.success(`操作成功（${data.deleted ?? 0} 条）`);
      await loadList(page, pageSize, query);
      return true;
    } catch {
      message.error("网络错误，请重试");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onBatchDelete() {
    if (selectedRowKeys.length === 0) return;
    const ids = selectedRowKeys.map((k) => Number(k)).filter((n) => Number.isFinite(n));
    const ok = await call(`/api/monitor/logininfor/${ids.join(",")}`, "DELETE");
    if (ok) setSelectedRowKeys([]);
  }

  async function onClean() {
    const ok = await call("/api/monitor/logininfor/clean", "DELETE");
    if (ok) {
      setSelectedRowKeys([]);
      await loadList(1, pageSize, query);
    }
  }

  async function onUnlock(row: SysLogininforRow) {
    setBusy(true);
    try {
      const res = await fetch(`/api/monitor/logininfor/unlock/${encodeURIComponent(row.userName)}`, { method: "PUT" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || data.ok === false) {
        message.error(data.error ?? "解锁失败");
        return;
      }
      message.success(data.message ?? "解锁指令已下发");
    } catch {
      message.error("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  const columns: ColumnsType<SysLogininforRow> = [
    { title: "ID", dataIndex: "id", width: 70 },
    { title: "用户名", dataIndex: "userName", width: 130, render: (v: string) => <b>{v}</b> },
    { title: "IP", dataIndex: "ipaddr", width: 130, render: (v: string | null) => <span style={{ color: "#8c8c8c" }}>{v ?? "—"}</span> },
    { title: "归属地", dataIndex: "loginLocation", width: 140, render: (v: string | null) => <span style={{ color: "#8c8c8c" }}>{v ?? "—"}</span> },
    { title: "浏览器", dataIndex: "browser", width: 100 },
    { title: "操作系统", dataIndex: "os", width: 120 },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: "0" | "1") => <Tag color={STATUS_META[v].color}>{STATUS_META[v].label}</Tag>,
    },
    {
      title: "消息",
      dataIndex: "msg",
      ellipsis: true,
      render: (v: string | null) =>
        v ? (
          <Tooltip title={v}>
            <span style={{ color: "#8c8c8c" }}>{v}</span>
          </Tooltip>
        ) : <span style={{ color: "#bfbfbf" }}>—</span>,
    },
    {
      title: "登录时间",
      dataIndex: "loginTime",
      width: 170,
      render: (v: string | null) => <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v ?? "—"}</span>,
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      fixed: "right",
      render: (_, row) => (
        <Popconfirm title={`解锁 ${row.userName}？`} okText="解锁" cancelText="取消" onConfirm={() => onUnlock(row)}>
          <Button size="small" icon={<UnlockOutlined />}>解锁</Button>
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
            const q: Query = { userName: v.userName ?? "", ipaddr: v.ipaddr ?? "", status: v.status ?? "" };
            setQuery(q);
            loadList(1, pageSize, q);
          }}
        >
          <Form.Item name="userName" label="用户名" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="模糊匹配" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="ipaddr" label="IP" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="模糊匹配" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="status" label="状态" style={{ marginRight: 16 }}>
            <Select allowClear placeholder="全部" style={{ width: 130 }} options={[{ value: "1", label: "成功" }, { value: "0", label: "失败" }]} />
          </Form.Item>
          <Form.Item style={{ marginRight: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>搜索</Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  queryForm.resetFields();
                  const q: Query = { userName: "", ipaddr: "", status: "" };
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
            登录日志
            <Tag style={{ marginLeft: 10 }} color="blue">共 {total} 条</Tag>
          </span>
        }
        extra={
          <Space>
            <Popconfirm
              title={`批量删除 ${selectedRowKeys.length} 条？`}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              disabled={selectedRowKeys.length === 0}
              onConfirm={onBatchDelete}
            >
              <Button danger icon={<DeleteOutlined />} disabled={selectedRowKeys.length === 0}>
                批量删除 {selectedRowKeys.length > 0 ? `(${selectedRowKeys.length})` : ""}
              </Button>
            </Popconfirm>
            <Popconfirm title="清空全部日志？" description="清空后不可恢复。" okText="清空" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={onClean}>
              <Button danger icon={<DeleteOutlined />}>清空</Button>
            </Popconfirm>
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          scroll={{ x: 1300 }}
          columns={columns}
          dataSource={logs}
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
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
