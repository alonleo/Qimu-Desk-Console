"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Space, Tag, Typography, message, Dropdown, Badge } from "antd";
import {
  CloudServerOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  EnterOutlined,
  GlobalOutlined,
  HomeOutlined,
} from "@ant-design/icons";
import { adminUrl } from "@/core/admin-url";

type ConnectionStatus = "checking" | "online" | "offline";

export default function HubPanel() {
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [accessMode, setAccessMode] = useState<"public" | "local">("public");

  const checkConnection = useCallback(async () => {
    setStatus("checking");
    try {
      // 使用公网域名或本地地址检测
      const baseUrl = accessMode === "public" ? adminUrl() : "http://localhost:3011";
      const res = await fetch(`${baseUrl}/api/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      setStatus(res.ok ? "online" : "offline");
      setLastCheck(new Date());
    } catch {
      setStatus("offline");
      setLastCheck(new Date());
    }
  }, [accessMode]);

  // 页面加载时自动检测
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // 每 30 秒自动检测一次
  useEffect(() => {
    const timer = setInterval(checkConnection, 30_000);
    return () => clearInterval(timer);
  }, [checkConnection]);

  const handleOpenAdmin = () => {
    const url = accessMode === "public" ? adminUrl() : "http://localhost:3011";
    window.open(url, "_blank");
  };

  const statusConfig = {
    checking: { color: "default", icon: <LoadingOutlined spin />, text: "检测中" },
    online: { color: "success", icon: <CheckCircleFilled />, text: "在线" },
    offline: { color: "error", icon: <CloseCircleFilled />, text: "离线" },
  };

  const currentStatus = statusConfig[status];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 页头说明 */}
      <Card style={{ borderRadius: 14 }}>
        <Space align="start" size={16}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "linear-gradient(135deg, #08979c, #08979c99)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <CloudServerOutlined style={{ fontSize: 22, color: "#fff" }} />
          </div>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              管理联动
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              快速访问后台管理平台，进行用户管理、监控看板、系统配置等操作。
            </Typography.Text>
          </div>
        </Space>
      </Card>

      {/* 连接状态卡片 */}
      <Card style={{ borderRadius: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <Badge status={status === "online" ? "success" : status === "offline" ? "error" : "default"} />
          <Typography.Text strong>后台连接状态</Typography.Text>
          <Tag color={currentStatus.color} icon={currentStatus.icon}>
            {currentStatus.text}
          </Tag>
          {lastCheck && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {lastCheck.toLocaleTimeString()} 检测
            </Typography.Text>
          )}
        </div>

        <Space size={12} wrap>
          {/* 访问方式切换 */}
          <Dropdown
            menu={{
              items: [
                {
                  key: "public",
                  icon: <GlobalOutlined />,
                  label: "公网域名",
                  onClick: () => setAccessMode("public"),
                },
                {
                  key: "local",
                  icon: <HomeOutlined />,
                  label: "本地地址",
                  onClick: () => setAccessMode("local"),
                },
              ],
            }}
            trigger={["click"]}
          >
            <Button icon={accessMode === "public" ? <GlobalOutlined /> : <HomeOutlined />}>
              {accessMode === "public" ? "公网域名" : "本地地址"}
            </Button>
          </Dropdown>

          {/* 快速检测 */}
          <Button icon={<CloudServerOutlined />} onClick={checkConnection}>
            快速检测
          </Button>

          {/* 进入后台 */}
          <Button
            type="primary"
            icon={<EnterOutlined />}
            onClick={handleOpenAdmin}
            disabled={status === "offline"}
          >
            进入后台管理
          </Button>
        </Space>

        {status === "offline" && (
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 12, fontSize: 12 }}>
            {accessMode === "public"
              ? "公网地址无法访问，请检查后台服务是否运行或网络是否正常"
              : "本地地址无法访问，请确保后台服务已在 localhost:3011 启动"}
          </Typography.Text>
        )}
      </Card>
    </div>
  );
}
