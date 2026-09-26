"use client";

import { useEffect } from "react";
import { Form, Input, Modal, Select, Button } from "antd";
import { KeyOutlined, UserOutlined } from "@ant-design/icons";
import type { UserRow } from "./UsersManager";

type CallFn = (url: string, method: string, body?: Record<string, unknown>) => Promise<boolean>;

/** 用户管理三个表单弹窗（新增 / 编辑 / 重置密码），表单实例与提交逻辑自持 */
export default function UserModals({
  createOpen,
  onCloseCreate,
  editUser,
  onCloseEdit,
  resetUser,
  onCloseReset,
  busy,
  call,
}: {
  createOpen: boolean;
  onCloseCreate: () => void;
  editUser: UserRow | null;
  onCloseEdit: () => void;
  resetUser: UserRow | null;
  onCloseReset: () => void;
  busy: boolean;
  call: CallFn;
}) {
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [resetForm] = Form.useForm();

  // 编辑弹窗打开时回填表单（表单实例在子组件内，由 effect 监听目标用户变化）
  useEffect(() => {
    if (editUser) editForm.setFieldsValue({ displayName: editUser.display_name ?? "", role: editUser.role });
  }, [editUser, editForm]);

  async function onCreate(values: {
    username: string;
    displayName?: string;
    password: string;
    role: "admin" | "member";
  }) {
    const ok = await call("/api/admin/users", "POST", {
      username: values.username,
      password: values.password,
      displayName: values.displayName || undefined,
      role: values.role,
    });
    if (ok) {
      onCloseCreate();
      createForm.resetFields();
    }
  }

  async function onReset(values: { password: string }) {
    if (!resetUser) return;
    const ok = await call(`/api/admin/users/${resetUser.id}`, "PATCH", { password: values.password });
    if (ok) {
      onCloseReset();
      resetForm.resetFields();
    }
  }

  async function onEdit(values: { displayName?: string; role: "admin" | "member" }) {
    if (!editUser) return;
    const ok = await call(`/api/admin/users/${editUser.id}`, "PATCH", {
      displayName: values.displayName || undefined,
      role: values.role,
    });
    if (ok) {
      onCloseEdit();
      editForm.resetFields();
    }
  }

  return (
    <>
      <Modal
        title="新增用户"
        open={createOpen}
        onCancel={() => {
          onCloseCreate();
          createForm.resetFields();
        }}
        footer={null}
      >
        <Form form={createForm} layout="vertical" onFinish={onCreate} requiredMark={false}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: "请输入用户名" },
              { pattern: /^[a-zA-Z0-9_-]{3,32}$/, message: "3-32 位字母、数字、下划线或短横线" },
            ]}
          >
            <Input prefix={<UserOutlined style={{ color: "#bfbfbf" }} />} placeholder="字母、数字、下划线" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名（可选）">
            <Input placeholder="怎么称呼" />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[
              { required: true, message: "请输入密码" },
              { min: 8, message: "至少 8 位" },
            ]}
          >
            <Input.Password placeholder="至少 8 位，可让成员之后自行保管" />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="member">
            <Select
              options={[
                { value: "member", label: "成员（日常使用）" },
                { value: "admin", label: "管理员（可管理用户）" },
              ]}
            />
          </Form.Item>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={onCloseCreate}>取 消</Button>
            <Button type="primary" htmlType="submit" loading={busy}>
              确 定
            </Button>
          </div>
        </Form>
      </Modal>

      <Modal
        title={editUser ? `编辑用户：${editUser.username}` : "编辑用户"}
        open={!!editUser}
        onCancel={() => {
          onCloseEdit();
          editForm.resetFields();
        }}
        footer={null}
      >
        <Form form={editForm} layout="vertical" onFinish={onEdit} requiredMark={false}>
          <Form.Item name="displayName" label="显示名">
            <Input placeholder="怎么称呼" />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select
              options={[
                { value: "member", label: "成员（日常使用）" },
                { value: "admin", label: "管理员（可管理用户）" },
              ]}
            />
          </Form.Item>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={onCloseEdit}>取 消</Button>
            <Button type="primary" htmlType="submit" loading={busy}>
              确 定
            </Button>
          </div>
        </Form>
      </Modal>

      <Modal
        title={resetUser ? `重置密码：${resetUser.username}` : "重置密码"}
        open={!!resetUser}
        onCancel={() => {
          onCloseReset();
          resetForm.resetFields();
        }}
        footer={null}
      >
        <Form form={resetForm} layout="vertical" onFinish={onReset} requiredMark={false}>
          <Form.Item
            name="password"
            label="新密码"
            rules={[
              { required: true, message: "请输入新密码" },
              { min: 8, message: "至少 8 位" },
            ]}
          >
            <Input.Password prefix={<KeyOutlined style={{ color: "#bfbfbf" }} />} placeholder="至少 8 位" />
          </Form.Item>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={onCloseReset}>取 消</Button>
            <Button type="primary" htmlType="submit" loading={busy}>
              确 定
            </Button>
          </div>
        </Form>
      </Modal>
    </>
  );
}
