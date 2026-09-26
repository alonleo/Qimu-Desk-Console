"use client";

import { useCallback, useState } from "react";
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, message } from "antd";
import { DeleteOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

export type SysOperLogRow = {
  id: number;
  title: string;
  businessType: string;
  method: string;
  requestMethod: string | null;
  operatorType: string;
  operName: string | null;
  deptName: string | null;
  operUrl: string | null;
  operIp: string | null;
  operParam: string | null;
  jsonResult: string | null;
  status: "0" | "1";
  errorMsg: string | null;
  costMs: number | null;
  operTime: string | null;
};

type Query = { title: string; operName: string; businessType: string; status: string; ip: string };

const BUSINESS_LABELS: Record<string, string> = {
  "0": "其它",
  "1": "新增",
  "2": "修改",
  "3": "删除",
  "4": "授权",
  "5": "导出",
  "6": "导入",
  "7": "强退",
  "8": "生成代码",
  "9": "清空数据",
};

const STATUS_META = {
  "0": { label: "正常", color: "success" },
  "1": { label: "异常", color: "error" },
} as const;

export default function OperLogsManager({
  initialLogs,
  initialTotal,
  initialPage,
  initialPageSize,
}: {
  initialLogs: SysOperLogRow[];
  initialTotal: number;
  initialPage: number;
  initialPageSize: number;
}) {
  const [logs, setLogs] = useState<SysOperLogRow[]>(initialLogs);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [query, setQuery] = useState<Query>({ title: "", operName: "", businessType: "", status: "", ip: "" });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<SysOperLogRow | null>(null);
  const [queryForm] = Form.useForm<Query>();

  const loadList = useCallback(async (p: number, ps: number, q: Query) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (q.title.trim()) params.set("title", q.title.trim());
      if (q.operName.trim()) params.set("operName", q.operName.trim());
      if (q.businessType) params.set("businessType", q.businessType);
      if (q.status) params.set("status", q.status);
      if (q.ip.trim()) params.set("ip", q.ip.trim());
      const res = await fetch(`/api/monitor/operlog/list?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; total?: number; page?: number; pageSize?: number; items?: SysOperLogRow[]; error?: string };
      if (!res.ok || data.ok === false) {
        message.error(data.error ?? "加载操作日志失败");
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
    const ok = await call(`/api/monitor/operlog/${ids.join(",")}`, "DELETE");
    if (ok) setSelectedRowKeys([]);
  }

  async function onClean() {
    const ok = await call("/api/monitor/operlog/clean", "DELETE");
    if (ok) {
      setSelectedRowKeys([]);
      await loadList(1, pageSize, query);
    }
  }

  const columns: ColumnsType<SysOperLogRow> = [
    { title: "ID", dataIndex: "id", width: 70 },
    { title: "模块", dataIndex: "title", width: 110 },
    {
      title: "业务类型",
      dataIndex: "businessType",
      width: 90,
      render: (v: string) => <Tag>{BUSINESS_LABELS[v] ?? v}</Tag>,
    },
    {
      title: "操作人",
      dataIndex: "operName",
      width: 100,
      render: (v: string | null) => <span style={{ color: "#8c8c8c" }}>{v ?? "—"}</span>,
    },
    {
      title: "请求",
      dataIndex: "requestMethod",
      width: 70,
      render: (v: string | null) => <Tag color="blue">{v ?? "—"}</Tag>,
    },
    {
      title: "方法",
      dataIndex: "method",
      width: 220,
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <code style={{ fontSize: 12 }}>{v}</code>
        </Tooltip>
      ),
    },
    {
      title: "URL",
      dataIndex: "operUrl",
      width: 200,
      ellipsis: true,
      render: (v: string | null) => <span style={{ color: "#8c8c8c" }}>{v ?? "—"}</span>,
    },
    {
      title: "IP",
      dataIndex: "operIp",
      width: 120,
      render: (v: string | null) => <span style={{ color: "#8c8c8c" }}>{v ?? "—"}</span>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 80,
      render: (v: "0" | "1") => <Tag color={STATUS_META[v].color}>{STATUS_META[v].label}</Tag>,
    },
    {
      title: "耗时",
      dataIndex: "costMs",
      width: 80,
      render: (v: number | null) => <span style={{ color: "#8c8c8c" }}>{v == null ? "—" : `${v} ms`}</span>,
    },
    {
      title: "时间",
      dataIndex: "operTime",
      width: 170,
      render: (v: string | null) => <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v ?? "—"}</span>,
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      fixed: "right",
      render: (_, row) => (
        <Button size="small" type="primary" ghost onClick={() => { setDetailRow(row); setDetailOpen(true); }}>
          详情
        </Button>
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
            const q: Query = {
              title: v.title ?? "",
              operName: v.operName ?? "",
              businessType: v.businessType ?? "",
              status: v.status ?? "",
              ip: v.ip ?? "",
            };
            setQuery(q);
            loadList(1, pageSize, q);
          }}
        >
          <Form.Item name="title" label="模块" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="模糊匹配" style={{ width: 150 }} />
          </Form.Item>
          <Form.Item name="operName" label="操作人" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="用户名" style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="businessType" label="业务类型" style={{ marginRight: 16 }}>
            <Select allowClear placeholder="全部" style={{ width: 130 }} options={Object.entries(BUSINESS_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
          </Form.Item>
          <Form.Item name="status" label="状态" style={{ marginRight: 16 }}>
            <Select allowClear placeholder="全部" style={{ width: 110 }} options={[{ value: "0", label: "正常" }, { value: "1", label: "异常" }]} />
          </Form.Item>
          <Form.Item name="ip" label="IP" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="模糊匹配" style={{ width: 140 }} />
          </Form.Item>
          <Form.Item style={{ marginRight: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>搜索</Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  queryForm.resetFields();
                  const q: Query = { title: "", operName: "", businessType: "", status: "", ip: "" };
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
            操作日志
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
          scroll={{ x: 1400 }}
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
        title={`操作日志详情 #${detailRow?.id ?? ""}`}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={<Button onClick={() => setDetailOpen(false)}>关闭</Button>}
        width={780}
      >
        {detailRow ? (
          <div style={{ display: "grid", gap: 12 }}>
            <Field k="模块" v={detailRow.title} />
            <Field k="业务类型" v={BUSINESS_LABELS[detailRow.businessType] ?? detailRow.businessType} />
            <Field k="请求方法" v={`${detailRow.requestMethod ?? "—"} ${detailRow.operUrl ?? ""}`} />
            <Field k="方法签名" v={<code style={{ fontSize: 12 }}>{detailRow.method}</code>} />
            <Field k="操作人" v={`${detailRow.operName ?? "—"}  (${detailRow.operIp ?? "—"})`} />
            <Field k="耗时 / 时间" v={`${detailRow.costMs ?? "—"} ms · ${detailRow.operTime ?? "—"}`} />
            <Field k="状态" v={<Tag color={STATUS_META[detailRow.status].color}>{STATUS_META[detailRow.status].label}</Tag>} />
            <Field k="请求参数" v={<pre style={PRE_STYLE}>{detailRow.operParam ?? "（无）"}</pre>} />
            <Field k="响应结果" v={<pre style={PRE_STYLE}>{detailRow.jsonResult ?? "（未保存）"}</pre>} />
            {detailRow.errorMsg ? <Field k="错误信息" v={<pre style={{ ...PRE_STYLE, color: "#ff4d4f" }}>{detailRow.errorMsg}</pre>} /> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

const PRE_STYLE: React.CSSProperties = {
  background: "#fafafa",
  padding: 10,
  borderRadius: 4,
  maxHeight: 240,
  overflow: "auto",
  fontSize: 12,
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 12, fontSize: 13 }}>
      <span style={{ color: "#8c8c8c" }}>{k}</span>
      <span>{v}</span>
    </div>
  );
}
