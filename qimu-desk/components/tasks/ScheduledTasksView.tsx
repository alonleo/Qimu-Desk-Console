"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  ApiOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  FieldTimeOutlined,
  PlusOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { ScheduledTaskRow, ScheduledTargetType } from "./types";
import {
  type CronFreq,
  type ScheduleRule,
  WEEKDAY_OPTIONS,
  CRON_FREQ_LABEL,
  ruleToCron,
  cronToRule,
  cronDescription,
  cronNext,
  formatCronDate,
} from "./schedule";

const { Text } = Typography;

type SkillOption = { id: number; name: string; displayName: string; type: string };
type WorkflowOption = { id: number; name: string; displayName: string };

/** 表单值（Form store 结构） */
type ScheduleFormValues = {
  name: string;
  freq: CronFreq;
  time: string;
  weekdays?: number[];
  monthDay?: number;
  notes?: string;
  enabled: boolean;
  target_type: ScheduledTargetType | null;
  target_id: number | null;
  params: string;
};

const DEFAULT_RULE: ScheduleRule = { freq: "daily", time: "08:00", weekdays: [1], monthDay: 1 };
const MONTH_DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({
  value: i + 1,
  label: `${i + 1} 号`,
}));

export default function ScheduledTasksView({
  scheduledTasks,
}: {
  scheduledTasks: ScheduledTaskRow[];
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editTask, setEditTask] = useState<ScheduledTaskRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<ScheduleFormValues>();
  // 技能和工作流列表
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  // 用于 Modal 内实时预览下次执行时间
  const [preview, setPreview] = useState<{
    rule: ScheduleRule;
    cron: string | null;
    desc: string;
    next: Date | null;
    error: string | null;
  } | null>(null);

  // 获取技能和工作流列表
  useEffect(() => {
    async function fetchTargets() {
      try {
        const res = await fetch("/api/scheduled-tasks/targets");
        if (res.ok) {
          const data = (await res.json()) as { skills: SkillOption[]; workflows: WorkflowOption[] };
          setSkills(data.skills || []);
          setWorkflows(data.workflows || []);
        }
      } catch {
        // ignore
      }
    }
    fetchTargets();
  }, []);

  const targetType = Form.useWatch("target_type", form);

  const call = useCallback(
    async (url: string, method: string, body?: Record<string, unknown>) => {
      setBusy(true);
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          message.error(data.error ?? "操作失败");
          return false;
        }
        router.refresh();
        return true;
      } catch {
        message.error("网络错误");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [router]
  );

  function buildPreview(values: ScheduleFormValues) {
    const rule: ScheduleRule = {
      freq: values.freq,
      time: values.time,
      weekdays: Array.isArray(values.weekdays) ? values.weekdays : [],
      monthDay: Number(values.monthDay ?? 1),
    };
    if (rule.freq === "weekly" && rule.weekdays.length === 0) {
      setPreview({ rule, cron: null, desc: "", next: null, error: "请至少选择一个星期" });
      return;
    }
    const cron = ruleToCron(rule);
    if (!cron) {
      setPreview({ rule, cron: null, desc: "", next: null, error: "时间或日期设置有误" });
      return;
    }
    const next = cronNext(cron);
    setPreview({
      rule,
      cron,
      desc: cronDescription(cron),
      next,
      error: null,
    });
  }

  function openCreate() {
    setEditTask(null);
    form.resetFields();
    form.setFieldsValue({
      name: "",
      freq: "daily",
      time: "08:00",
      weekdays: [1],
      monthDay: 1,
      notes: "",
      enabled: true,
      target_type: null,
      target_id: null,
      params: "",
    });
    buildPreview(form.getFieldsValue(true) as ScheduleFormValues);
    setFormOpen(true);
  }

  function openEdit(task: ScheduledTaskRow) {
    setEditTask(task);
    form.resetFields();
    const rule = cronToRule(task.cron) ?? DEFAULT_RULE;
    // 解析 params JSON
    let parsedParams = "";
    if (task.params) {
      try {
        parsedParams = JSON.stringify(JSON.parse(task.params), null, 2);
      } catch {
        parsedParams = task.params;
      }
    }
    form.setFieldsValue({
      name: task.name,
      freq: rule.freq,
      time: rule.time,
      weekdays: rule.freq === "weekly" ? rule.weekdays : [1],
      monthDay: rule.freq === "monthly" ? rule.monthDay : 1,
      notes: task.notes ?? "",
      enabled: task.enabled === 1,
      target_type: task.target_type,
      target_id: task.target_id,
      params: parsedParams,
    });
    buildPreview(form.getFieldsValue(true) as ScheduleFormValues);
    setFormOpen(true);
  }

  async function onSubmit(values: ScheduleFormValues) {
    const rule: ScheduleRule = {
      freq: values.freq,
      time: values.time,
      weekdays: Array.isArray(values.weekdays) ? values.weekdays : [],
      monthDay: Number(values.monthDay ?? 1),
    };
    if (rule.freq === "weekly" && rule.weekdays.length === 0) {
      message.error("请至少选择一个执行星期");
      return;
    }
    const cron = ruleToCron(rule);
    if (!cron) {
      message.error("时间格式有误，请检查");
      return;
    }

    // 解析 params JSON
    let paramsObj: Record<string, unknown> | null = null;
    if (values.params?.trim()) {
      try {
        paramsObj = JSON.parse(values.params);
      } catch {
        message.error("参数 JSON 格式有误");
        return;
      }
    }

    const body: Record<string, unknown> = {
      name: values.name,
      cron,
      notes: values.notes || null,
      enabled: values.enabled,
      target_type: values.target_type,
      target_id: values.target_id,
      params: paramsObj,
    };
    if (editTask) {
      await call(`/api/scheduled-tasks/${editTask.id}`, "PATCH", body);
    } else {
      await call("/api/scheduled-tasks", "POST", body);
    }
    setFormOpen(false);
  }

  async function toggleEnabled(task: ScheduledTaskRow, checked: boolean) {
    await call(`/api/scheduled-tasks/${task.id}`, "PATCH", { enabled: checked });
  }

  async function onDelete(task: ScheduledTaskRow) {
    await call(`/api/scheduled-tasks/${task.id}`, "DELETE");
  }

  const freq = Form.useWatch("freq", form) ?? "daily";

  const columns: ColumnsType<ScheduledTaskRow> = [
    {
      title: "名称",
      key: "name",
      render: (_, t) => (
        <div>
          <div style={{ fontWeight: 500 }}>{t.name}</div>
          {t.notes && (
            <div
              style={{
                fontSize: 12,
                color: "#8c8c8c",
                marginTop: 2,
                maxWidth: 320,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {t.notes}
            </div>
          )}
        </div>
      ),
    },
    {
      title: "执行目标",
      key: "target",
      width: 150,
      render: (_, t) => {
        if (!t.target_type || !t.target_id) {
          return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        }
        const icon = t.target_type === "skill" ? <RocketOutlined /> : <ApiOutlined />;
        const color = t.target_type === "skill" ? "#00c896" : "#13c2c2";
        return (
          <Tag icon={icon} color={color} style={{ margin: 0 }}>
            {t.target_type === "skill" ? "技能" : "工作流"} #{t.target_id}
          </Tag>
        );
      },
    },
    {
      title: "周期",
      key: "desc",
      width: 150,
      render: (_, t) => (
        <Space size={4}>
          <CalendarOutlined style={{ color: "#8c8c8c" }} />
          <Text style={{ fontSize: 13 }}>{cronDescription(t.cron)}</Text>
        </Space>
      ),
    },
    {
      title: "下次执行",
      key: "next",
      width: 140,
      render: (_, t) => {
        if (t.enabled !== 1) {
          return <Text type="secondary" style={{ fontSize: 12 }}>已停用</Text>;
        }
        const next = cronNext(t.cron);
        return next ? (
          <Space size={4}>
            <ClockCircleOutlined style={{ color: "#fa8c16" }} />
            <Text style={{ fontSize: 12 }}>{formatCronDate(next)}</Text>
          </Space>
        ) : (
          <Tooltip title="三年内没有匹配时间，请检查 cron 表达式">
            <Text type="secondary" style={{ fontSize: 12 }}>无法计算</Text>
          </Tooltip>
        );
      },
    },
    {
      title: "启用",
      key: "enabled",
      width: 60,
      render: (_, t) => (
        <Switch
          size="small"
          checked={t.enabled === 1}
          onChange={(checked) => toggleEnabled(t, checked)}
          disabled={busy}
        />
      ),
    },
    {
      title: "操作",
      key: "actions",
      align: "right" as const,
      width: 100,
      render: (_, t) => (
        <Space size={4}>
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(t)} />
          </Tooltip>
          <Popconfirm
            title="删除此定时任务？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => onDelete(t)}
          >
            <Tooltip title="删除">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          <FieldTimeOutlined style={{ marginRight: 6 }} />
          按 cron 周期循环的例行事项，共 {scheduledTasks.length} 条
        </Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建定时任务
        </Button>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={scheduledTasks}
        pagination={false}
        size="middle"
        locale={{ emptyText: "暂无定时任务，点击右上角「新建定时任务」添加" }}
        style={{ borderRadius: 12, overflow: "hidden" }}
      />

      <Modal
        title={editTask ? "编辑定时任务" : "新建定时任务"}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        footer={null}
        width={560}
      >
        <Form<ScheduleFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={onSubmit}
          onValuesChange={(_, all) => buildPreview(all)}
        >
          <Form.Item
            name="name"
            label="任务名称"
            rules={[{ required: true, message: "请输入任务名称" }]}
          >
            <Input placeholder="例如：每日巡检、每周周报…" maxLength={200} />
          </Form.Item>
          <Form.Item name="freq" label="周期类型">
            <Segmented
              options={Object.keys(CRON_FREQ_LABEL).map((k) => ({
                label: CRON_FREQ_LABEL[k as CronFreq],
                value: k,
              }))}
            />
          </Form.Item>
          <Space style={{ width: "100%" }} size={12} align="start">
            <Form.Item
              name="time"
              label="执行时间"
              rules={[{ required: true, message: "请选择执行时间" }]}
            >
              <Input type="time" style={{ width: 130 }} />
            </Form.Item>
            {freq === "weekly" && (
              <Form.Item
                name="weekdays"
                label="执行星期"
                style={{ flex: 1, minWidth: 240 }}
                rules={[{ required: true, message: "请选择执行星期" }]}
              >
                <Select
                  mode="multiple"
                  placeholder="选择要执行的星期"
                  options={WEEKDAY_OPTIONS}
                  maxTagCount={4}
                  allowClear
                />
              </Form.Item>
            )}
            {freq === "monthly" && (
              <Form.Item
                name="monthDay"
                label="执行日期"
                rules={[{ required: true, message: "请选择执行日期" }]}
              >
                <Select placeholder="每月几号执行" options={MONTH_DAY_OPTIONS} style={{ width: 130 }} />
              </Form.Item>
            )}
          </Space>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="执行内容或说明…" />
          </Form.Item>

          {/* 执行目标选择 */}
          <Form.Item label="执行目标" tooltip="定时任务触发时执行的技能或工作流">
            <Space direction="vertical" style={{ width: "100%" }} size={4}>
              <Form.Item name="target_type" noStyle>
                <Select
                  allowClear
                  placeholder="选择类型（可选）"
                  options={[
                    { value: "skill", label: "技能" },
                    { value: "workflow", label: "工作流" },
                  ]}
                  onChange={() => form.setFieldValue("target_id", null)}
                  style={{ width: 140 }}
                />
              </Form.Item>
              {targetType === "skill" && (
                <Form.Item name="target_id" noStyle rules={[{ required: true, message: "请选择技能" }]}>
                  <Select
                    placeholder="选择技能"
                    options={skills.map((s) => ({
                      value: s.id,
                      label: `${s.displayName || s.name} (${s.name})`,
                    }))}
                    showSearch
                    filterOption={(input, option) =>
                      (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                    }
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              )}
              {targetType === "workflow" && (
                <Form.Item name="target_id" noStyle rules={[{ required: true, message: "请选择工作流" }]}>
                  <Select
                    placeholder="选择工作流"
                    options={workflows.map((w) => ({
                      value: w.id,
                      label: `${w.displayName || w.name} (${w.name})`,
                    }))}
                    showSearch
                    filterOption={(input, option) =>
                      (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                    }
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              )}
            </Space>
          </Form.Item>

          {/* 参数配置（仅在选择目标后显示） */}
          {targetType && (
            <Form.Item
              name="params"
              label="执行参数"
              tooltip="以 JSON 格式传入技能/工作流的参数，如 {&quot;arg1&quot;: &quot;value1&quot;}"
            >
              <Input.TextArea
                rows={3}
                placeholder={'{"arg1": "value1"}'}
                style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}
              />
            </Form.Item>
          )}

          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>

          {/* 实时预览 */}
          {preview && (
            <div
              style={{
                background: "#fafafa",
                border: "1px solid #f0f0f0",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 13,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                marginBottom: 16,
              }}
            >
              <Text type="secondary">预览：</Text>
              {preview.error ? (
                <Text type="warning">{preview.error}</Text>
              ) : (
                <>
                  <Tag style={{ margin: 0 }} color="cyan">{preview.desc}</Tag>
                  {preview.cron && (
                    <Tag style={{ margin: 0, fontFamily: "ui-monospace, Menlo, monospace" }}>
                      {preview.cron}
                    </Tag>
                  )}
                  <Text style={{ color: "#fa8c16" }}>
                    <ClockCircleOutlined style={{ marginRight: 4 }} />
                    下次执行：{preview.next ? formatCronDate(preview.next) : "无法计算"}
                  </Text>
                </>
              )}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={() => setFormOpen(false)}>取消</Button>
            <Button type="primary" htmlType="submit" loading={busy}>
              {editTask ? "保存" : "创建"}
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
