"use client";

import { useState } from "react";
import {
  Avatar,
  Card,
  Col,
  Form,
  Input,
  message,
  Row,
  Space,
  Typography,
  Divider,
  Button,
} from "antd";
import { KeyOutlined, UserOutlined, EditOutlined, SaveOutlined } from "@ant-design/icons";
import type { User } from "@/core/auth";

const AVATAR_COLORS = ["#1677ff", "#13c2c2", "#52c41a", "#fa8c16", "#0ea5e9", "#eb2f96"];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export default function ProfileView({ user }: { user: User }) {
  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  async function updateProfile(values: { displayName: string }) {
    setProfileBusy(true);
    setProfileSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: values.displayName }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!data.ok) {
        message.error(data.error || "更新失败");
        return;
      }
      message.success("资料已更新");
      setProfileSaved(true);
    } catch {
      message.error("网络错误，请重试");
    } finally {
      setProfileBusy(false);
    }
  }

  async function changePassword(values: { oldPassword: string; newPassword: string; confirmPassword: string }) {
    if (values.newPassword !== values.confirmPassword) {
      message.error("两次输入的密码不一致");
      return;
    }
    if (values.newPassword.length < 8) {
      message.error("新密码至少 8 位");
      return;
    }

    setPasswordBusy(true);
    try {
      const res = await fetch("/api/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldPassword: values.oldPassword,
          newPassword: values.newPassword,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!data.ok) {
        message.error(data.error || "密码修改失败");
        return;
      }
      message.success("密码修改成功");
      passwordForm.resetFields();
    } catch {
      message.error("网络错误，请重试");
    } finally {
      setPasswordBusy(false);
    }
  }

  const roleLabels: Record<string, string> = { admin: "管理员", member: "成员" };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        个人资料
      </Typography.Title>

      <Row gutter={[16, 16]}>
        {/* 个人信息卡片 */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <UserOutlined style={{ color: "#1677ff" }} />
                基本信息
              </Space>
            }
            style={{ borderRadius: 14 }}
          >
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <Avatar
                size={80}
                style={{
                  background: `linear-gradient(135deg, ${avatarColor(user.username)}, ${avatarColor(user.username)}99)`,
                  fontSize: 32,
                }}
              >
                {(user.displayName || user.username).slice(0, 1).toUpperCase()}
              </Avatar>
              <Typography.Title level={5} style={{ marginTop: 12, marginBottom: 4 }}>
                {user.username}
              </Typography.Title>
              <Typography.Text type="secondary">{user.displayName || "未设置显示名"}</Typography.Text>
            </div>

            <Divider style={{ margin: "16px 0" }} />

            <Form
              form={profileForm}
              layout="vertical"
              initialValues={{ displayName: user.displayName || "" }}
              onFinish={updateProfile}
            >
              <Form.Item name="displayName" label="显示名称">
                <Input placeholder="怎么称呼你" maxLength={50} />
              </Form.Item>
              <Form.Item label="用户名" style={{ marginBottom: 8 }}>
                <Input value={user.username} disabled />
              </Form.Item>
              <Form.Item label="角色" style={{ marginBottom: 0 }}>
                <Input value={roleLabels[user.role] || user.role} disabled />
              </Form.Item>
              <div style={{ marginTop: 20 }}>
                <Button
                  type="primary"
                  icon={profileSaved ? undefined : <SaveOutlined />}
                  loading={profileBusy}
                  onClick={() => profileForm.submit()}
                >
                  {profileSaved ? "已保存" : "保存修改"}
                </Button>
              </div>
            </Form>
          </Card>
        </Col>

        {/* 修改密码卡片 */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <KeyOutlined style={{ color: "#fa8c16" }} />
                修改密码
              </Space>
            }
            style={{ borderRadius: 14 }}
          >
            <Form form={passwordForm} layout="vertical" onFinish={changePassword}>
              <Form.Item
                name="oldPassword"
                label="原密码"
                rules={[{ required: true, message: "请输入原密码" }]}
              >
                <Input.Password placeholder="请输入当前密码" />
              </Form.Item>
              <Form.Item
                name="newPassword"
                label="新密码"
                rules={[
                  { required: true, message: "请输入新密码" },
                  { min: 8, message: "新密码至少 8 位" },
                ]}
              >
                <Input.Password placeholder="至少 8 位" />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                label="确认新密码"
                dependencies={["newPassword"]}
                rules={[
                  { required: true, message: "请确认新密码" },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("newPassword") === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error("两次输入的密码不一致"));
                    },
                  }),
                ]}
              >
                <Input.Password placeholder="再输一次新密码" />
              </Form.Item>
              <div style={{ marginTop: 8 }}>
                <Button type="primary" icon={<KeyOutlined />} loading={passwordBusy} htmlType="submit">
                  修改密码
                </Button>
              </div>
            </Form>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
