"use client";

import { useCallback, useState } from "react";
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, message } from "antd";
import { DeleteOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

export type SysJobLogRow = {
  id: number;
  jobId: number;
  jobName: string;
  jobGroup: string;
  invokeTarget: string;
  status: "0" | "1";
  exceptionMessage: string | null;
  startTime: string;
  stopTime: string | null;
  costMs: number | null;
};

type Query = { jobName: string; jobGroup: string; status: string };

const STATUS_META = {
  "0": { label: "失败", color: "error" },
  "1": { label: "成功", color: "success" },
} as const;

export default function JobLogsManager({
  initialLogs,
  initialTotal,
  initialPage,
  initialPageSize,
}: {
  initialLogs: SysJobLogRow[];
  initialTotal: number;
  initialPage: number;
  initialPageSize: number;
}) {
  const [logs, setLogs] = useState<SysJobLogRow[]>(initialLogs);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [query, setQuery] = useState<Query>({ jobName: "", jobGroup: "", status: "" });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<SysJobLogRow | null>(null);
  const [queryForm] = Form.useForm<Query>();

  const loadList = useCallback(async (p: number, ps: number, q: Query) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (q.jobName.trim()) params.set("jobName", q.jobName.trim());
      if (q.jobGroup.trim()) params.set("jobGroup", q.jobGroup.trim());
      if (q.status) params.set("status", q.status);
      const res = await fetch(`/api/monitor/jobLog/list?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; total?: number; page?: number; pageSize?: number; items?: SysJobLogRow[]; error?: string };
      if (!res.ok || data.ok === false) {
        message.error(data.error ?? "加载日志失败");
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
    const ok = await call(`/api/monitor/jobLog/${ids.join(",")}`, "DELETE");
    if (ok) setSelectedRowKeys([]);
  }

  async function onClean() {
    const ok = await call("/api/monitor/jobLog/clean", "DELETE");
    if (ok) {
      setSelectedRowKeys([]);
      await loadList(1, pageSize, query);
    }
  }

  const columns: ColumnsType<SysJobLogRow> = [
    { title: "ID", dataIndex: "id", width: 70 },
    { title: "任务 ID", dataIndex: "jobId", width: 80 },
    { title: "任务名称", dataIndex: "jobName", width: 140 },
    { title: "任务组", dataIndex: "jobGroup", width: 100 },
    {
      title: "调用目标",
      dataIndex: "invokeTarget",
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <code style={{ fontSize: 12 }}>{v}</code>
        </Tooltip>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: "0" | "1") => <Tag color={STATUS_META[v].color}>{STATUS_META[v].label}</Tag>,
    },
    {
      title: "开始时间",
      dataIndex: "startTime",
      width: 170,
      render: (v: string) => <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v ?? "—"}</span>,
    },
    {
      title: "耗时",
      dataIndex: "costMs",
      width: 90,
      render: (v: number | null) => <span style={{ color: "#8c8c8c" }}>{v == null ? "—" : `${v} ms`}</span>,
    },
    {
      title: "异常信息",
      dataIndex: "exceptionMessage",
      ellipsis: true,
      render: (v: string | null) =>
        v ? (
          <Tooltip title="点击查看完整堆栈">
            <a onClick={() => {
              const target = logs.find((r) => r.exceptionMessage === v);
              if (target) { setDetailRow(target); setDetailOpen(true); }
            }} style={{ color: "#ff4d4f" }}>{v.split("\n")[0].slice(0, 80)}</a>
          </Tooltip>
        ) : <span style={{ color: "#bfbfbf" }}>—</span>,
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
            const q: Query = { jobName: v.jobName ?? "", jobGroup: v.jobGroup ?? "", status: v.status ?? "" };
            setQuery(q);
            loadList(1, pageSize, q);
          }}
        >
          <Form.Item name="jobName" label="任务名称" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="模糊匹配" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="jobGroup" label="任务组" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="例如 DEFAULT" style={{ width: 160 }} />
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
                  const q: Query = { jobName: "", jobGroup: "", status: "" };
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
            调度日志
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
          scroll={{ x: 1100 }}
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

      <Modal
        title="异常堆栈"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={<Button onClick={() => setDetailOpen(false)}>关闭</Button>}
        width={780}
      >
        <pre style={{ background: "#fafafa", padding: 12, borderRadius: 4, maxHeight: 480, overflow: "auto", fontSize: 12, margin: 0 }}>
          {detailRow?.exceptionMessage ?? ""}
        </pre>
      </Modal>
    </div>
  );
}
