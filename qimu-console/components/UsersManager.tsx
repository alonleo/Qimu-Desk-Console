"use client";

import { useMemo, useState, type Key } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  KeyOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RestOutlined,
  SearchOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { moduleGradient } from "./modules";
import BatchBar, { batchRequest } from "./batch/BatchBar";
import UserModals from "./UserModals";

export type UserRow = {
  id: number;
  username: string;
  display_name: string | null;
  role: "admin" | "member";
  disabled: number;
  created_at: string;
};

const AVATAR_COLORS = ["#1677ff", "#13c2c2", "#52c41a", "#fa8c16", "#722ed1", "#eb2f96"];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

type Query = { username: string; status: string[] };

export default function UsersManager({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [query, setQuery] = useState<Query>({ username: "", status: [] });
  const [queryForm] = Form.useForm<Query>();
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  const filtered = useMemo(() => {
    const kw = query.username.trim().toLowerCase();
    return users.filter((u) => {
      if (kw && !u.username.toLowerCase().includes(kw) && !(u.display_name ?? "").toLowerCase().includes(kw)) return false;
      if (query.status.length && !query.status.includes(u.disabled ? "disabled" : "normal")) return false;
      return true;
    });
  }, [users, query]);

  function clearSelection() {
    setSelectedRowKeys([]);
  }

  async function onBatchUpdate(patch: Record<string, unknown>) {
    const ok = await batchRequest("/api/admin/users/batch-update", { ids: selectedRowKeys, data: patch }, "updated", "批量修改");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchDelete() {
    const ok = await batchRequest("/api/admin/users/batch-delete", { ids: selectedRowKeys }, "deleted", "批量删除");
    if (ok) {
      clearSelection();
      router.refresh();
    }
    return ok;
  }

  async function onBatchCreate(items: Record<string, unknown>[]) {
    const ok = await batchRequest("/api/admin/users/batch-create", { items }, "created", "批量新增");
    if (ok) router.refresh();
    return ok;
  }

  async function call(url: string, method: string, body?: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        message.error(data.error ?? "操作失败");
        return false;
      }
      message.success("操作成功");
      router.refresh();
      return true;
    } catch {
      message.error("网络错误，请重试");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openEdit(u: UserRow) {
    setEditUser(u);
  }

  const columns: ColumnsType<UserRow> = [
    {
      title: "用户编号",
      dataIndex: "id",
      width: 90,
    },
    {
      title: "用户",
      key: "user",
      render: (_, u) => (
        <Space>
          <Avatar size={32} style={{ background: moduleGradient(avatarColor(u.username)) }}>
            {(u.display_name || u.username).slice(0, 1).toUpperCase()}
          </Avatar>
          <div>
            <div style={{ fontWeight: 500 }}>{u.username}</div>
            <div style={{ fontSize: 12, color: "#8c8c8c" }}>{u.display_name ?? "—"}</div>
          </div>
        </Space>
      ),
    },
    {
      title: "角色",
      key: "role",
      width: 100,
      render: (_, u) =>
        u.role === "admin" ? <Tag color="orange">管理员</Tag> : <Tag color="blue">成员</Tag>,
    },
    {
      title: "状态",
      key: "status",
      width: 90,
      render: (_, u) => (u.disabled ? <Tag color="red">停用</Tag> : <Tag color="green">正常</Tag>),
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      width: 170,
      render: (v: string) => <span style={{ color: "#8c8c8c", fontSize: 12 }}>{v}</span>,
    },
    {
      title: "操作",
      key: "actions",
      width: 320,
      render: (_, u) => (
        <Space>
          <Button type="primary" ghost size="small" icon={<KeyOutlined />} onClick={() => setResetUser(u)}>
            重置密码
          </Button>
          <Button type="primary" ghost size="small" icon={<EditOutlined />} onClick={() => openEdit(u)}>
            编辑
          </Button>
          <Popconfirm
            title="删除该账号？"
            description="不可恢复；内置管理员账号不可删除。"
            okText="确定"
            cancelText="取消"
            disabled={u.username === "admin"}
            onConfirm={() => call(`/api/admin/users/${u.id}`, "DELETE")}
          >
            <Button danger size="small" icon={<DeleteOutlined />} disabled={u.username === "admin"}>
              删除
            </Button>
          </Popconfirm>
          <Popconfirm
            title={u.disabled ? "启用该账号？" : "停用该账号？"}
            okText="确定"
            cancelText="取消"
            onConfirm={() => call(`/api/admin/users/${u.id}`, "PATCH", { disabled: !u.disabled })}
          >
            <Button type="primary" ghost danger={!u.disabled} size="small" icon={u.disabled ? <PlayCircleOutlined /> : <StopOutlined />}>
              {u.disabled ? "启用" : "停用"}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 查询表单（若依风格） */}
      <Card styles={{ body: { padding: "18px 16px 2px" } }}>
        <Form
          form={queryForm}
          layout="inline"
          initialValues={query}
          onFinish={(v) => setQuery({ username: v.username ?? "", status: v.status ?? [] })}
        >
          <Form.Item name="username" label="用户名" style={{ marginRight: 16 }}>
            <Input allowClear placeholder="请输入用户名" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="status" label="状态" style={{ marginRight: 16 }}>
            <Select
              allowClear
              mode="multiple"
              placeholder="账号状态（可多选）"
              style={{ minWidth: 160 }}
              options={[
                { value: "normal", label: "正常" },
                { value: "disabled", label: "停用" },
              ]}
            />
          </Form.Item>
          <Form.Item style={{ marginRight: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
                搜索
              </Button>
              <Button
                icon={<RestOutlined />}
                onClick={() => {
                  queryForm.resetFields();
                  setQuery({ username: "", status: [] });
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {/* 表格卡片 */}
      <Card
        title={
          <span>
            用户列表
            <Tag style={{ marginLeft: 10 }} color="blue">
              {filtered.length} / {users.length}
            </Tag>
          </span>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新增
          </Button>
        }
      >
        <BatchBar
          selectedCount={selectedRowKeys.length}
          onClearSelection={clearSelection}
          fields={[
            {
              key: "role",
              label: "角色",
              type: "select",
              options: [
                { value: "admin", label: "管理员" },
                { value: "member", label: "成员" },
              ],
            },
            { key: "disabled", label: "状态", type: "switch", checkedText: "停用", uncheckedText: "启用" },
          ]}
          onBatchUpdate={onBatchUpdate}
          onBatchDelete={onBatchDelete}
          deleteDescription="选中的账号将全部删除，不可恢复；内置管理员账号自动跳过。"
          onBatchCreate={onBatchCreate}
          createExample={`[
  { "username": "zhangsan", "password": "初始密码123", "role": "member", "displayName": "张三" },
  { "username": "lisi", "password": "初始密码123", "role": "member" }
]`}
        />
        <Table
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={filtered}
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条`, showSizeChanger: false }}
        />
      </Card>

      <UserModals
        createOpen={createOpen}
        onCloseCreate={() => setCreateOpen(false)}
        editUser={editUser}
        onCloseEdit={() => setEditUser(null)}
        resetUser={resetUser}
        onCloseReset={() => setResetUser(null)}
        busy={busy}
        call={call}
      />
    </div>
  );
}
