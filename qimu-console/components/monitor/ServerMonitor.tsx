"use client";

import { useEffect, useState } from "react";
import { Card, Col, Descriptions, Progress, Row, Space, Statistic, Table, Tag, Tooltip } from "antd";
import { ApiOutlined, ClockCircleOutlined, DesktopOutlined, HddOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

type CpuInfo = { cpuNum: number; total: number; used: number; sys: number; free: number };
type MemInfo = { total: number; used: number; free: number; usage: number };
type JvmInfo = {
  total: number; max: number; used: number; free: number; usage: number;
  name: string; version: string; vendor: string;
  startTime: number; runTime: number;
  home: string; inputArgs: string;
  nonheapTotal: number; nonheapUsed: number; nonheapMax: number;
};
type SysInfo = { computerName: string; computerIp: string; userName: string; osName: string; osArch: string; osVersion: string; userDir: string; userHome: string };
type SysFile = { dirName: string; sysTypeName: string; typeName: string; total: number; free: number; used: number; usage: number };
type ServerSnapshot = { ok: boolean; cpu: CpuInfo; mem: MemInfo; jvm: JvmInfo; sys: SysInfo; sysFiles: SysFile[] };

const REFRESH_MS = 5000;

/** 字节（GB）→ 字符串 */
function fmtGb(v: number): string {
  if (!Number.isFinite(v)) return "0";
  if (v >= 1024) return `${(v / 1024).toFixed(2)} TB`;
  return `${v.toFixed(2)} GB`;
}

/** 毫秒 → 可读时长 */
function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}天${h}小时`;
  if (h > 0) return `${h}小时${m}分`;
  if (m > 0) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

function colorByUsage(p: number): string {
  if (p >= 90) return "#ff4d4f";
  if (p >= 70) return "#faad14";
  return "#1677ff";
}

export default function ServerMonitor({ initial }: { initial: ServerSnapshot | null }) {
  const [snap, setSnap] = useState<ServerSnapshot | null>(initial);
  const [updatedAt, setUpdatedAt] = useState<string>("—");
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/monitor/server", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as ServerSnapshot | null;
      if (data?.ok) {
        setSnap(data);
        setUpdatedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      }
    } catch {
      /* 静默失败，避免日志噪音 */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  const cpuUsed = snap?.cpu.used ?? 0;
  const memUsage = snap?.mem.usage ?? 0;
  const jvmUsage = snap?.jvm.usage ?? 0;

  const fileColumns: ColumnsType<SysFile> = [
    { title: "挂载点", dataIndex: "dirName", key: "dirName", ellipsis: true },
    { title: "文件系统", dataIndex: "sysTypeName", key: "sysTypeName", width: 100, render: (v) => <Tag>{v || "—"}</Tag> },
    { title: "类型", dataIndex: "typeName", key: "typeName", width: 120, ellipsis: true },
    { title: "总大小", dataIndex: "total", key: "total", width: 110, render: fmtGb },
    { title: "已用", dataIndex: "used", key: "used", width: 110, render: fmtGb },
    { title: "可用", dataIndex: "free", key: "free", width: 110, render: fmtGb },
    {
      title: "使用率",
      dataIndex: "usage",
      key: "usage",
      width: 200,
      render: (v: number) => <Progress percent={Number(v) || 0} size="small" strokeColor={colorByUsage(v)} format={(p) => `${p}%`} />,
    },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 工具栏 */}
      <Card styles={{ body: { padding: "12px 16px" } }}>
        <Space size={16}>
          <ClockCircleOutlined style={{ color: "#1677ff" }} />
          <span style={{ color: "rgba(0,0,0,.65)" }}>上次更新：{updatedAt}</span>
          <span style={{ color: "rgba(0,0,0,.45)", fontSize: 12 }}>每 {REFRESH_MS / 1000} 秒自动刷新</span>
          <a onClick={() => setAutoRefresh((v) => !v)} style={{ fontSize: 12 }}>
            {autoRefresh ? "停止自动刷新" : "开启自动刷新"}
          </a>
          <a onClick={refresh} style={{ fontSize: 12 }}>
            <ReloadOutlined /> 立即刷新
          </a>
          {loading ? <Tag color="processing">刷新中…</Tag> : null}
        </Space>
      </Card>

      {/* 三大指标卡 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic
              title="CPU 使用率"
              prefix={<DesktopOutlined style={{ color: colorByUsage(cpuUsed) }} />}
              value={cpuUsed}
              precision={2}
              suffix="%"
              valueStyle={{ color: colorByUsage(cpuUsed) }}
            />
            <Progress percent={Number(cpuUsed) || 0} strokeColor={colorByUsage(cpuUsed)} showInfo={false} />
            <div style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,.45)" }}>
              核心数：<b>{snap?.cpu.cpuNum ?? "—"}</b>
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic
              title="内存使用率"
              value={memUsage}
              precision={2}
              suffix="%"
              valueStyle={{ color: colorByUsage(memUsage) }}
            />
            <Progress percent={Number(memUsage) || 0} strokeColor={colorByUsage(memUsage)} showInfo={false} />
            <div style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,.45)" }}>
              已用 <b>{fmtGb(snap?.mem.used ?? 0)}</b> / 共 <b>{fmtGb(snap?.mem.total ?? 0)}</b>
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic
              title="JVM 堆使用率"
              value={jvmUsage}
              precision={2}
              suffix="%"
              valueStyle={{ color: colorByUsage(jvmUsage) }}
            />
            <Progress percent={Number(jvmUsage) || 0} strokeColor={colorByUsage(jvmUsage)} showInfo={false} />
            <div style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,.45)" }}>
              已用 <b>{snap?.jvm.used ?? 0} MB</b> / 最大 <b>{snap?.jvm.max ?? 0} MB</b>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 系统信息 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title={<Space><DesktopOutlined />系统信息</Space>}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="主机名">{snap?.sys.computerName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="本机 IP">
                <Space><ApiOutlined />{snap?.sys.computerIp ?? "—"}</Space>
              </Descriptions.Item>
              <Descriptions.Item label="操作系统">{snap?.sys.osName ?? "—"} {snap?.sys.osArch ?? ""}</Descriptions.Item>
              <Descriptions.Item label="系统版本">{snap?.sys.osVersion ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="JVM 名称">{snap?.jvm.name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="JVM 版本">{snap?.jvm.version ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="JVM 厂商">{snap?.jvm.vendor ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="运行用户">{snap?.sys.userName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="已运行时长" span={2}>
                <Tooltip title={`启动时间戳：${snap?.jvm.startTime ?? 0}`}>{fmtDuration(snap?.jvm.runTime ?? 0)}</Tooltip>
              </Descriptions.Item>
              <Descriptions.Item label="Java Home" span={2}><span style={{ wordBreak: "break-all", fontFamily: "monospace" }}>{snap?.jvm.home ?? "—"}</span></Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title={<Space><HddOutlined />JVM 非堆</Space>}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="非堆初始化">{snap?.jvm.nonheapTotal ?? 0} MB</Descriptions.Item>
              <Descriptions.Item label="非堆已用">{snap?.jvm.nonheapUsed ?? 0} MB</Descriptions.Item>
              <Descriptions.Item label="非堆最大">{snap?.jvm.nonheapMax ?? 0} MB</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {/* 磁盘 */}
      <Card title={<Space><HddOutlined />磁盘使用</Space>}>
        <Table
          rowKey={(r) => `${r.dirName}-${r.typeName}`}
          size="middle"
          columns={fileColumns}
          dataSource={snap?.sysFiles ?? []}
          pagination={false}
          locale={{ emptyText: "暂无磁盘信息" }}
        />
      </Card>
    </div>
  );
}
