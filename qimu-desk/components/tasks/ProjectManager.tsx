"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Space,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  FolderOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  type ProjectRow,
  PROJECT_COLORS,
} from "./types";
import { moduleGradient } from "../modules";
import VisibilityTag from "@/components/VisibilityTag";

const { Text, Paragraph } = Typography;

export default function ProjectManager({
  projects,
}: {
  projects: ProjectRow[];
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editProject, setEditProject] = useState<ProjectRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();

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

  function openCreate() {
    setEditProject(null);
    form.resetFields();
    form.setFieldsValue({ color: PROJECT_COLORS[0] });
    setFormOpen(true);
  }

  function openEdit(project: ProjectRow) {
    setEditProject(project);
    form.setFieldsValue({
      name: project.name,
      description: project.description ?? "",
      color: project.color || PROJECT_COLORS[0],
    });
    setFormOpen(true);
  }

  async function onSubmit(values: {
    name: string;
    description?: string;
    color: string;
  }) {
    const body = {
      name: values.name,
      description: values.description || null,
      color: values.color,
    };
    if (editProject) {
      await call(`/api/projects/${editProject.id}`, "PATCH", body);
    } else {
      await call("/api/projects", "POST", body);
    }
    setFormOpen(false);
  }

  async function onDelete(project: ProjectRow) {
    await call(`/api/projects/${project.id}`, "DELETE");
  }

  async function onArchive(project: ProjectRow) {
    await call(`/api/projects/${project.id}`, "PATCH", { status: "archived" });
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建项目
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        {projects.map((p) => {
          const color = p.color || "#1677ff";
          const total = p.task_count || 0;
          const done = p.done_count || 0;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;

          return (
            <Col key={p.id} xs={24} sm={12} lg={8} xl={6}>
              <Card
                hoverable
                style={{ borderRadius: 12, overflow: "hidden", borderColor: "#f0f0f0" }}
                styles={{ body: { padding: 0 } }}
              >
                {/* 彩色顶部条 */}
                <div
                  style={{
                    height: 6,
                    background: moduleGradient(color),
                  }}
                />
                <div style={{ padding: "14px 16px", display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <Space size={8} align="start">
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: moduleGradient(color),
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#fff",
                          fontSize: 16,
                        }}
                      >
                        <FolderOutlined />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                          <span>{p.name}</span>
                          <VisibilityTag value={p.visibility} />
                        </div>
                        {p.description && (
                          <Paragraph
                            type="secondary"
                            style={{ fontSize: 12, margin: 0, maxWidth: 180 }}
                            ellipsis={{ rows: 2 }}
                          >
                            {p.description}
                          </Paragraph>
                        )}
                      </div>
                    </Space>
                  </div>

                  {/* 任务进度 */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text style={{ fontSize: 11, color: "#8c8c8c" }}>
                        {done} / {total} 完成
                      </Text>
                      <Text style={{ fontSize: 11, color: color, fontWeight: 600 }}>
                        {pct}%
                      </Text>
                    </div>
                    <Progress
                      percent={pct}
                      showInfo={false}
                      strokeColor={color}
                      size="small"
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
                    <Tooltip title="编辑">
                      <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(p)} />
                    </Tooltip>
                    <Popconfirm title="归档此项目？" okText="归档" cancelText="取消" onConfirm={() => onArchive(p)}>
                      <Tooltip title="归档">
                        <Button type="text" size="small" icon={<FolderOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                    <Popconfirm title="删除项目？任务将取消关联。" okText="删除" cancelText="取消" onConfirm={() => onDelete(p)}>
                      <Tooltip title="删除">
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                  </div>
                </div>
              </Card>
            </Col>
          );
        })}

        {/* 空状态 */}
        {projects.length === 0 && (
          <Col span={24}>
            <div
              style={{
                textAlign: "center",
                padding: "48px 0",
                color: "#bfbfbf",
              }}
            >
              <FolderOutlined style={{ fontSize: 40, marginBottom: 12 }} />
              <div>还没有项目，点击右上角"新建项目"开始</div>
            </div>
          </Col>
        )}
      </Row>

      {/* 项目表单 */}
      <Modal
        title={editProject ? "编辑项目" : "新建项目"}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={onSubmit} requiredMark={false}>
          <Form.Item
            name="name"
            label="项目名称"
            rules={[{ required: true, message: "请输入项目名称" }]}
          >
            <Input placeholder="比如：产品迭代、读书计划…" />
          </Form.Item>
          <Form.Item name="description" label="描述（可选）">
            <Input.TextArea rows={2} placeholder="项目简述…" />
          </Form.Item>
          <Form.Item name="color" label="项目颜色">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PROJECT_COLORS.map((c) => (
                <Form.Item key={c} name="color" noStyle>
                  <div
                    onClick={() => form.setFieldValue("color", c)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      cursor: "pointer",
                      background: moduleGradient(c),
                      border: form.getFieldValue("color") === c ? "3px solid #595959" : "3px solid transparent",
                      transition: "border .2s",
                    }}
                  />
                </Form.Item>
              ))}
            </div>
          </Form.Item>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={() => setFormOpen(false)}>取消</Button>
            <Button type="primary" htmlType="submit" loading={busy}>
              {editProject ? "保存" : "创建"}
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
