"use client";

import { useCallback, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

export type SysJobRow = {
  id: number;
  jobName: string;
  jobGroup: string;
  invokeTarget: string;
  cronExpression: string;
  misfirePolicy: string;
  concurrent: string;
  status: "0" | "1";
  remark: string | null;
  createBy: string | null;
  createTime: string | null;
  updateBy: string | null;
  updateTime: string | null;
};

type Query = { jobName: string; jobGroup: string; status: string };

const STATUS_META = {
  "0": { label: "暂停", color: "default" },
  "1": { label: "运行中", color: "success" },
} as const;

const CONCURRENT_META = {
  "0": { label: "允许", color: "#1677ff" },
  "1": { label: "禁止", color: "#fa8c16" },
} as const;

export default function JobsManager({
  initialJobs,
  initialTotal,
  initialPage,
  initialPageSize,
}: {
  initialJobs: SysJobRow[];
  initialTotal: number;
  initialPage: number;
  initialPageSize: number;
}) {
  const [jobs, setJobs] = useState<SysJobRow[]>(initialJobs);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [query, setQuery] = useState<Query>({ jobName: "", jobGroup: "", status: "" });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SysJobRow | null>(null);
  const [queryForm] = Form.useForm<Query>();
  const [editForm] = Form.useForm();

  const loadList = useCallback(async (p: number, ps: number, q: Query) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (q.jobName.trim()) params.set("jobName", q.jobName.trim());
      if (q.jobGroup.trim()) params.set("jobGroup", q.jobGroup.trim());
      if (q.status) params.set("status", q.status);
      const res = await fetch(`/api/monitor/job/list?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; total?: number; page?: number; pageSize?: number; items?: SysJobRow[]; error?: string };
      if (!res.ok || data.ok === false) {
        message.error(data.error ?? "加载任务列表失败");
        return;
      }
      setJobs(data.items ?? []);
      setTotal(data.total ?? 0);
      setPage(data.page ?? p);
      setPageSize(data.pageSize ?? ps);
    } catch {
      message.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }, []);

  async function call(url: string, method: string, body?: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok === false) {
        message.error(data.error ?? "操作失败");
        return false;
      }
      message.success("操作成功");
      await loadList(page, pageSize, query);
      return true;
    } catch {
      message.error("网络错误，请重试");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setEditing(null);
    editForm.resetFields();
    editForm.setFieldsValue({ jobGroup: "DEFAULT", status: "0", misfirePolicy: "3", concurrent: "1" });
    setModalOpen(true);
  }

  function openEdit(row: SysJobRow) {
    setEditing(row);
    editForm.setFieldsValue(row);
    setModalOpen(true);
  }

  async function onSubmit(values: Omit<SysJobRow, "id" | "createBy" | "createTime" | "updateBy" | "updateTime">) {
    const ok = editing
      ? await call(`/api/monitor/job`, "PUT", { ...values, id: editing.id })
      : await call(`/api/monitor/job`, "POST", values);
    if (ok) {
      setModalOpen(false);
      editForm.resetFields();
      setEditing(null);
    }
  }

  async function onChangeStatus(row: SysJobRow) {
    const next = row.status === "1" ? "0" : "1";
    await call(`/api/monitor/job/changeStatus`, "PUT", { id: row.id, status: next });
  }

  async function onRun(row: SysJobRow) {
    await call(`/api/monitor/job/run`, "PUT", { id: row.id });
  }

  async function onDelete(row: SysJobRow) {
    const ok = await call(`/api/monitor/job/${row.id}`, "DELETE");
    if (ok && jobs.length === 1 && page > 1) await loadList(page - 1, pageSize, query);
  }

  const columns: ColumnsType<SysJobRow> = [
    { title: "ID", dataIndex: "id", width: 70 },
    { title: "任务名称", dataIndex: "jobName", width: 160, render: (v: string) => <b>{v}</b> },
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
    { title: "cron 表达式", dataIndex: "cronExpression", width: 140, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: "并行",
      dataIndex: "concurrent",
      width: 80,
      render: (v: string) => <Tag color={CONCURRENT_META[v as "0" | "1"]?.color}>{CONCURRENT_META[v as "0" | "1"]?.label ?? v}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (v: "0" | "1") => <Tag color={STATUS_META[v].color}>{STATUS_META[v].label}</Tag>,
    },
    { title: "备注", dataIndex: "remark", ellipsis: true, render: (v: string | null) => <span style={{ color: "#8c8c8c" }}>{v ?? "—"}</span> },
    {
      title: "操作",
      key: "actions",
      width: 280,
      fixed: "right",
      render: (_, row) => (
        <Space size={4} wrap>
          <Button type="primary" ghost size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          {row.status === "1" ? (
            <Button size="small" icon={<PauseCircleOutlined />} onClick={() => onChangeStatus(row)}>
              暂停
            </Button>
          ) : (
            <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => onChangeStatus(row)}>
              启动
            </Button>
          )}
          <Popconfirm title="立即执行一次？" okText="执行" cancelText="取消" onConfirm={() => onRun(row)}>
            <Button size="small" icon={<ThunderboltOutlined />}>
              执行一次
            </Button>
          </Popconfirm>
          <Popconfirm title="删除该任务？" description="删除后不可恢复。" okText="确定" cancelText="取消" onConfirm={() => onDelete(row)}>
            <Button danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
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
            <Select allowClear placeholder="全部状态" style={{ width: 140 }} options={[{ value: "1", label: "运行中" }, { value: "0", label: "暂停" }]} />
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
            定时任务列表
            <Tag style={{ marginLeft: 10 }} color="blue">共 {total} 个</Tag>
          </span>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => loadList(page, pageSize, query)}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建任务</Button>
          </Space>
        }
      >
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message="调用目标格式"
          description={
            <span>
              <code>Bean.method('arg1','arg2')</code>，例：<code>jobDemo.runTask('hello','world')</code>。目标 Bean 必须在 Spring 容器中，参数当前仅支持字符串字面量。
            </span>
          }
        />
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          scroll={{ x: 1100 }}
          columns={columns}
          dataSource={jobs}
          pagination={{
            current: page,
            pageSize,
            total,
            showTotal: (t) => `共 ${t} 个`,
            showSizeChanger: true,
            onChange: (p, ps) => loadList(p, ps, query),
          }}
        />
      </Card>

      <Modal
        title={editing ? `编辑定时任务：${editing.jobName}` : "新建定时任务"}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          editForm.resetFields();
          setEditing(null);
        }}
        footer={null}
        width={680}
      >
        <Form form={editForm} layout="vertical" onFinish={onSubmit} requiredMark={false}>
          <Form.Item name="jobName" label="任务名称" rules={[{ required: true, message: "请输入任务名称" }, { max: 64 }]}>
            <Input placeholder="唯一任务名" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="jobGroup" label="任务组" rules={[{ required: true, max: 64 }]}>
            <Input placeholder="DEFAULT" />
          </Form.Item>
          <Form.Item name="invokeTarget" label="调用目标" rules={[{ required: true, message: "请输入调用目标" }, { max: 500 }]}>
            <Input placeholder="Bean.method('arg')" />
          </Form.Item>
          <Form.Item
            name="cronExpression"
            label="cron 表达式"
            extra="标准 6/7 段 Spring cron，例：0 0/5 * * * ?（每 5 分钟）"
            rules={[{ required: true, message: "请输入 cron 表达式" }]}
          >
            <Input placeholder="0 0/5 * * * ?" />
          </Form.Item>
          <Space size={16} style={{ display: "flex" }}>
            <Form.Item name="concurrent" label="是否允许并行" style={{ flex: 1 }}>
              <Radio.Group
                options={[
                  { value: "0", label: "允许" },
                  { value: "1", label: "禁止" },
                ]}
              />
            </Form.Item>
            <Form.Item name="status" label="初始状态" style={{ flex: 1 }}>
              <Radio.Group
                options={[
                  { value: "0", label: "暂停" },
                  { value: "1", label: "运行" },
                ]}
              />
            </Form.Item>
            <Form.Item name="misfirePolicy" label="错过策略" style={{ flex: 1 }}>
              <Select
                options={[
                  { value: "0", label: "默认" },
                  { value: "1", label: "立即触发" },
                  { value: "2", label: "丢弃" },
                  { value: "3", label: "不触发" },
                ]}
              />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              onClick={() => {
                setModalOpen(false);
                editForm.resetFields();
                setEditing(null);
              }}
            >
              取 消
            </Button>
            <Button type="primary" htmlType="submit" loading={busy}>
              确 定
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
