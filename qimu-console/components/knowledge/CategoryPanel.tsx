"use client";

import { useState, type Key } from "react";
import { Button, Card, Input, Modal, Popconfirm, Space, Table, Tag } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import BatchBar, { batchRequest } from "../batch/BatchBar";
import type { CategoryRow } from "./types";

type CallFn = (url: string, method: string, body?: Record<string, unknown>) => Promise<boolean>;

/** 「分类管理」卡片：新增 / 重命名 / 删除分类（含重命名弹窗，状态自持），支持批量新增 / 批量删除 */
export default function CategoryPanel({
  categories,
  busy,
  call,
}: {
  categories: CategoryRow[];
  busy: boolean;
  call: CallFn;
}) {
  const [newCategory, setNewCategory] = useState("");
  const [renaming, setRenaming] = useState<CategoryRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  async function addCategory() {
    if (newCategory.trim() && (await call("/api/knowledge/categories", "POST", { name: newCategory.trim() }))) {
      setNewCategory("");
    }
  }

  function clearSelection() {
    setSelectedRowKeys([]);
  }

  async function onBatchDelete() {
    const ok = await batchRequest(
      "/api/knowledge/categories/batch-delete",
      { ids: selectedRowKeys },
      "deleted",
      "批量删除"
    );
    if (ok) {
      clearSelection();
      // 刷新文档列表（分类归属变化）与分类面板
      await call("/api/knowledge/categories", "GET");
    }
    return ok;
  }

  async function onBatchCreate(items: Record<string, unknown>[]) {
    const ok = await batchRequest("/api/knowledge/categories/batch-create", { items }, "created", "批量新增");
    if (ok) await call("/api/knowledge/categories", "GET");
    return ok;
  }

  const catColumns: ColumnsType<CategoryRow> = [
    { title: "编号", dataIndex: "id", width: 70 },
    { title: "分类名称", dataIndex: "name" },
    { title: "文档数", dataIndex: "count", width: 100, render: (v: number) => <Tag color="geekblue">{v}</Tag> },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (_, c) => (
        <Space>
          <Button
            type="primary"
            ghost
            size="small"
            icon={<EditOutlined />}
            disabled={c.name === "未分类"}
            onClick={() => {
              setRenaming(c);
              setRenameValue(c.name);
            }}
          >
            重命名
          </Button>
          <Popconfirm
            title="删除该分类？"
            description="分类下的文档将自动移入「未分类」。"
            okText="确定"
            cancelText="取消"
            disabled={c.name === "未分类"}
            onConfirm={() => call(`/api/knowledge/categories/${c.id}`, "DELETE")}
          >
            <Button danger size="small" icon={<DeleteOutlined />} disabled={c.name === "未分类"}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card
        title={
          <span>
            分类管理
            <Tag style={{ marginLeft: 10 }} color="blue">
              {categories.length}
            </Tag>
          </span>
        }
        extra={
          <Space>
            <Input
              placeholder="新分类名称"
              style={{ width: 160 }}
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onPressEnter={addCategory}
            />
            <Button type="primary" icon={<PlusOutlined />} loading={busy} onClick={addCategory}>
              新增分类
            </Button>
          </Space>
        }
      >
        <BatchBar
          selectedCount={selectedRowKeys.length}
          onClearSelection={clearSelection}
          onBatchDelete={onBatchDelete}
          deleteDescription="选中的分类将全部删除（「未分类」自动跳过），分类下文档移入「未分类」。"
          onBatchCreate={onBatchCreate}
          createExample={`[
  { "name": "运维" },
  { "name": "产品" },
  { "name": "设计" }
]`}
        />
        <Table
          rowKey="id"
          size="middle"
          columns={catColumns}
          dataSource={categories}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
            // 「未分类」为系统默认分类，不可删除，禁止勾选
            getCheckboxProps: (c) => ({ disabled: c.name === "未分类" }),
          }}
          pagination={false}
        />
      </Card>

      <Modal
        title={renaming ? `重命名分类：${renaming.name}` : "重命名分类"}
        open={!!renaming}
        onCancel={() => setRenaming(null)}
        onOk={async () => {
          if (renaming && renameValue.trim() && (await call(`/api/knowledge/categories/${renaming.id}`, "PATCH", { name: renameValue.trim() }))) {
            setRenaming(null);
          }
        }}
        okText="确 定"
        cancelText="取 消"
        confirmLoading={busy}
      >
        <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="新分类名称" maxLength={30} />
      </Modal>
    </>
  );
}
