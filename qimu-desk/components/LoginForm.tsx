"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Form, Input } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";

export default function LoginForm({
  previewEnabled = false,
}: {
  previewEnabled?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        previewEnabled && values.username === "preview"
          ? "/api/local-preview"
          : "/api/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        preview?: boolean;
      };
      if (!res.ok) {
        setError(data.error || "登录失败，请重试");
        return;
      }
      if (data.preview) {
        router.replace("/preview");
        router.refresh();
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form
      layout="vertical"
      size="large"
      onFinish={onFinish}
      requiredMark={false}
    >
      {previewEnabled && (
        <Alert
          type="info"
          showIcon
          message="本地首页预览"
          description="使用临时账号 preview 登录。演示数据不连接真实业务。"
          style={{ marginBottom: 20 }}
        />
      )}
      <Form.Item
        name="username"
        label="用户名"
        rules={[{ required: true, message: "请输入用户名" }]}
      >
        <Input
          prefix={<UserOutlined style={{ color: "#bfbfbf" }} />}
          placeholder="用户名"
          autoComplete="username"
        />
      </Form.Item>
      <Form.Item
        name="password"
        label="密码"
        rules={[{ required: true, message: "请输入密码" }]}
      >
        <Input.Password
          prefix={<LockOutlined style={{ color: "#bfbfbf" }} />}
          placeholder="密码"
          autoComplete="current-password"
        />
      </Form.Item>
      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      <Button type="primary" htmlType="submit" block loading={loading}>
        登录
      </Button>
    </Form>
  );
}
