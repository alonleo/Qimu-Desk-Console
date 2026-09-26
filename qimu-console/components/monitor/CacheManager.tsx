"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Col, Descriptions, Popconfirm, Row, Space, Table, Tag, Typography, message } from "antd";
import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

export type CacheInfo = { ok: boolean; info: Record<string, string>; dbSize: number; commandStats: unknown[]; error?: string };
export type CacheNamesResp = { ok: boolean; items?: string[]; error?: string };
export type CacheKeysResp = { ok: boolean; cacheName?: string; items?: string[]; error?: string };
export type CacheValueResp = { ok: boolean; cacheName?: string; cacheKey?: string; cacheValue?: string; remark?: string };

export default function CacheManager({
  initialInfo,
  initialNames,
  initialError,
}: {
  initialInfo: CacheInfo;
  initialNames: string[];
  initialError: string | null;
}) {
  const [info, setInfo] = useState<CacheInfo>(initialInfo);
  const [names, setNames] = useState<string[]>(initialNames);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [value, setValue] = useState<CacheValueResp | null>(null);
  const [error, setError] = useState<string | null>(initialError);

  async function getJson<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url);
      const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
      if (!res.ok || data.ok === false) {
        message.error((data as { error?: string }).error ?? "操作失败");
        return null;
      }
      return data as T;
    } catch {
      message.error("网络错误，请重试");
      return null;
    }
  }

  const loadInfo = useCallback(async () => {
    const data = await getJson<CacheInfo>("/api/monitor/cache");
    if (data) setInfo(data);
  }, []);

  const loadNames = useCallback(async () => {
    const data = await getJson<CacheNamesResp>("/api/monitor/cache/getNames");
    if (data) setNames(data.items ?? []);
  }, []);

  const loadKeys = useCallback(async (name: string) => {
    setSelectedKey(null);
    setValue(null);
    const data = await getJson<CacheKeysResp>(`/api/monitor/cache/getKeys/${encodeURIComponent(name)}`);
    if (data) setKeys(data.items ?? []);
  }, []);

  const loadValue = useCallback(async (name: string, key: string) => {
    const data = await getJson<CacheValueResp>(`/api/monitor/cache/getValue/${encodeURIComponent(name)}/${encodeURIComponent(key)}`);
    if (data) setValue(data);
  }, []);

  async function onClearAll() {
    const data = await getJson<{ message?: string }>("/api/monitor/cache/clearCacheAll");
    if (!data) return;
    message.success(data.message ?? "已清空全部缓存");
    setSelectedName(null);
    setSelectedKey(null);
    setKeys([]);
    setValue(null);
    await Promise.all([loadNames(), loadInfo()]);
  }

  async function onClearName(name: string) {
    const data = await getJson<{ deleted?: number }>(`/api/monitor/cache/clearCacheName/${encodeURIComponent(name)}`);
    if (!data) return;
    message.success(`已清空缓存 ${name}（${data.deleted ?? 0} 个键）`);
    setSelectedKey(null);
    setValue(null);
    await loadKeys(name);
  }

  async function onDeleteKey(key: string) {
    const data = await getJson<{ deleted?: number }>(`/api/monitor/cache/clearCacheKey/${encodeURIComponent(key)}`);
    if (!data) return;
    message.success(`已删除缓存键（${data.deleted ?? 0} 个）`);
    if (selectedKey === key) {
      setSelectedKey(null);
      setValue(null);
    }
    if (selectedName) await loadKeys(selectedName);
  }

  async function refreshAll() {
    await Promise.all([loadNames(), loadInfo()]);
  }

  useEffect(() => {
    // 首屏选中第一个缓存名称加载键列表，提升可用性
    if (names.length > 0 && !selectedName) {
      setSelectedName(names[0]);
      loadKeys(names[0]);
    }
  }, [names, selectedName, loadKeys]);

  const nameColumns: ColumnsType<{ name: string }> = [
    {
      title: "缓存名称",
      dataIndex: "name",
      render: (v: string) => (
        <Space>
          <span style={{ color: "#1677ff" }}>#</span>
          <b>{v}</b>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && (
        <Alert
          type="error"
          showIcon
          message="缓存监控不可用"
          description={`${error}。请确认 Redis 已启动（REDIS_HOST/REDIS_PORT 可配），在线会话功能不受影响。`}
        />
      )}

      <Row gutter={16}>
        <Col span={10}>
          <Card
            title="缓存名称"
            size="small"
            extra={
              <Space>
                <Button size="small" icon={<ReloadOutlined />} onClick={refreshAll}>刷新</Button>
                <Popconfirm title="清空全部缓存？" description="将 flush Redis 当前库。" okText="清空" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={onClearAll}>
                  <Button size="small" danger icon={<DeleteOutlined />}>清空全部</Button>
                </Popconfirm>
              </Space>
            }
          >
            <Table
              rowKey="name"
              size="middle"
              dataSource={names.map((n) => ({ name: n }))}
              columns={nameColumns}
              pagination={false}
              locale={{ emptyText: "暂无缓存名称" }}
              rowClassName={(r) => (r.name === selectedName ? "ant-table-row-selected" : "")}
              onRow={(r) => ({
                onClick: () => {
                  setSelectedName(r.name);
                  loadKeys(r.name);
                },
                style: { cursor: "pointer" },
              })}
            />
          </Card>
        </Col>

        <Col span={14}>
          <Card
            title={
              <span>
                缓存键
                {selectedName && <Tag style={{ marginLeft: 10 }} color="geekblue">{selectedName}</Tag>}
              </span>
            }
            size="small"
            extra={
              <Button size="small" danger icon={<DeleteOutlined />} disabled={!selectedName} onClick={() => selectedName && onClearName(selectedName)}>
                清空该缓存
              </Button>
            }
          >
            <Table
              rowKey="key"
              size="middle"
              dataSource={keys.map((k) => ({ key: k }))}
              columns={[
                {
                  title: "缓存键",
                  dataIndex: "key",
                  ellipsis: true,
                  render: (v: string) => <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</span>,
                },
                {
                  title: "操作",
                  key: "actions",
                  width: 80,
                  render: (_, r) => (
                    <Popconfirm title={`删除缓存键 ${r.key}？`} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => onDeleteKey(r.key)}>
                      <Button size="small" danger type="text" icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  ),
                },
              ]}
              pagination={false}
              locale={{ emptyText: "点击左侧缓存名称查看键" }}
              rowClassName={(r) => (r.key === selectedKey ? "ant-table-row-selected" : "")}
              onRow={(r) => ({
                onClick: () => {
                  setSelectedKey(r.key);
                  if (selectedName) loadValue(selectedName, r.key);
                },
                style: { cursor: "pointer" },
              })}
            />
          </Card>

          {selectedKey && value && (
            <Card size="small" title={<span style={{ fontFamily: "monospace", fontSize: 12 }}>{value.cacheKey}</span>} style={{ marginTop: 16 }}>
              <Typography.Paragraph style={{ marginBottom: 4 }}>缓存值</Typography.Paragraph>
              <pre style={{ margin: 0, padding: 12, background: "#f5f5f5", borderRadius: 6, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {value.cacheValue}
              </pre>
              {value.remark && <Tag style={{ marginTop: 8 }} color="purple">{value.remark}</Tag>}
            </Card>
          )}
        </Col>
      </Row>

      <Card
        size="small"
        title={
          <span>
            Redis 概览
            <Tag style={{ marginLeft: 10 }} color="green">键总数 {info.dbSize}</Tag>
          </span>
        }
        extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadInfo}>刷新</Button>}
      >
        <Descriptions column={4} size="middle">
          <Descriptions.Item label="键总数">{info.dbSize}</Descriptions.Item>
          <Descriptions.Item label="Redis 版本">{info.info.redis_version ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="运行模式">{info.info.redis_mode ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="端口">{info.info.tcp_port ?? "—"}</Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}