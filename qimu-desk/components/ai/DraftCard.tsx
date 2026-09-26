"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  CheckCircleFilled,
  DownOutlined,
  EditOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type {
  ArtifactKind,
  KnowledgeDraft,
  SaveResult,
  SkillDraft,
  WorkflowDraft,
} from "@/core/ai/artifacts";
import type { SkillType } from "@/core/skills";
import SourceTag from "@/components/SourceTag";

const { Text, Paragraph } = Typography;

const KIND_LABEL: Record<ArtifactKind, string> = {
  skill: "技能",
  workflow: "工作流",
  knowledge: "知识",
};

const SAVE_LABEL: Record<ArtifactKind, string> = {
  skill: "保存到技能中心",
  workflow: "保存为工作流",
  knowledge: "保存到知识库",
};

const SKILL_TYPE_LABEL: Record<SkillType, string> = {
  shell: "Shell",
  prompt: "Prompt",
  http: "HTTP",
};

type DraftPayload = SkillDraft | WorkflowDraft | KnowledgeDraft;

type EditorFields = {
  name: string; // skill/workflow: slug；knowledge: 标题
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  content: string;
  type: SkillType;
  json: string; // skill/workflow 的结构化 JSON（params+config / params+steps）
};

function payloadTitle(payload: DraftPayload): string {
  const p = payload as SkillDraft & WorkflowDraft & KnowledgeDraft;
  return p.displayName || p.name || p.title || "未命名";
}

function payloadSlug(payload: DraftPayload): string {
  const p = payload as SkillDraft & WorkflowDraft & KnowledgeDraft;
  // 仅技能/工作流展示英文 slug；知识文档直接以标题为名，不重复展示
  return p.name || "";
}

function initialJsonText(payload: DraftPayload, kind: ArtifactKind): string {
  if (kind === "skill") {
    const p = payload as SkillDraft;
    return JSON.stringify({ params: p.params ?? [], config: p.config ?? {} }, null, 2);
  }
  if (kind === "workflow") {
    const p = payload as WorkflowDraft;
    return JSON.stringify({ params: p.params ?? [], steps: p.steps ?? [] }, null, 2);
  }
  return "";
}

function previewConfigLine(payload: SkillDraft): string {
  const cfg = payload.config ?? {};
  if (payload.type === "shell") {
    const cmd = (cfg.shell as { command?: string } | undefined)?.command ?? "";
    return cmd ? `$ ${cmd}` : "shell：缺少 command";
  }
  if (payload.type === "prompt") {
    const tpl = (cfg.prompt as { template?: string } | undefined)?.template ?? "";
    return tpl ? `Prompt：${tpl.replace(/\s+/g, " ").trim().slice(0, 180)}` : "prompt：缺少 template";
  }
  const h = cfg.http as { method?: string; url?: string } | undefined;
  return `HTTP ${(h?.method || "GET").toUpperCase()} ${h?.url || "缺少 url"}`;
}

function editorFromPayload(kind: ArtifactKind, payload: DraftPayload): EditorFields {
  const p = payload as SkillDraft & WorkflowDraft & KnowledgeDraft;
  return {
    name: p.name || p.title || "",
    displayName: p.displayName ?? "",
    description: p.description ?? "",
    category: p.category ?? "",
    tags: Array.isArray(p.tags) ? [...p.tags] : [],
    content: p.content ?? "",
    type: (payload as SkillDraft).type ?? "shell",
    json: initialJsonText(payload, kind),
  };
}

/**
 * AI 草稿卡：预览 → 编辑 → 保存（技能/工作流/知识）。
 * - 折叠态紧凑预览；「编辑」展开字段表单（复杂结构用 JSON TextArea + 本地预检）；
 * - 保存调用 POST /api/skills|workflows|knowledge（source:'ai'）；
 * - 409 NAME_CONFLICT → 冲突态三选一：覆盖更新(mode:overwrite)/另存新名/放弃；
 * - 历史保存结果由 initialSaveResult 恢复为「已保存」态。
 *
 * P2-3 批量保存：通过可选 handleRef 把「以 create 模式保存一次」暴露给外层（如全部保存按钮）。
 */
export type DraftCardHandle = {
  /** 以 create 模式触发一次保存（内部已有 saving/jsonError/已保存守卫）；返回是否已发起成功流程 */
  saveNow: () => Promise<boolean>;
};

export default function DraftCard({
  kind,
  payload,
  issues,
  initialSaveResult,
  onSaved,
  handleRef,
}: {
  kind: ArtifactKind;
  payload: DraftPayload;
  issues?: string[];
  initialSaveResult?: SaveResult;
  onSaved?: (result: SaveResult) => void;
  handleRef?: (handle: DraftCardHandle | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [abandoned, setAbandoned] = useState(false);
  const [focusName, setFocusName] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult | null>(initialSaveResult ?? null);
  const [editor, setEditor] = useState<EditorFields>(() =>
    editorFromPayload(kind, payload)
  );

  const saved = !!result && result.ok === true;
  const duplicate = !!result && result.ok === false && result.status === "duplicate";
  const failed = !!result && result.ok === false && result.status !== "duplicate";

  function openEditor(focus = false) {
    setEditor(editorFromPayload(kind, payload));
    setJsonError(null);
    setFocusName(focus);
    setEditing(true);
  }

  function handleJsonChange(text: string) {
    setEditor((e) => ({ ...e, json: text }));
    let err: string | null = null;
    const trimmed = text.trim();
    if (trimmed) {
      try {
        const v: unknown = JSON.parse(trimmed);
        if (typeof v !== "object" || v === null || Array.isArray(v)) {
          err = "JSON 顶层必须是对象";
        }
      } catch {
        err = "JSON 格式有误";
      }
    }
    setJsonError(err);
  }

  async function doSave(mode: "create" | "overwrite") {
    if (saving || jsonError) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { source: "ai" };
      if (mode === "overwrite") body.mode = "overwrite";

      if (kind === "skill") {
        let params: unknown = [];
        let config: unknown = {};
        if (editor.json.trim()) {
          const parsed: unknown = JSON.parse(editor.json);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("JSON 顶层必须是对象");
          }
          const o = parsed as Record<string, unknown>;
          if (o.params !== undefined) params = o.params;
          if (o.config !== undefined) config = o.config;
        }
        Object.assign(body, {
          name: editor.name.trim(),
          type: editor.type,
          displayName: editor.displayName.trim() || undefined,
          description: editor.description.trim() || undefined,
          params,
          config,
        });
      } else if (kind === "workflow") {
        let params: unknown = [];
        let steps: unknown = [];
        if (editor.json.trim()) {
          const parsed: unknown = JSON.parse(editor.json);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("JSON 顶层必须是对象");
          }
          const o = parsed as Record<string, unknown>;
          if (o.params !== undefined) params = o.params;
          if (o.steps !== undefined) steps = o.steps;
        }
        Object.assign(body, {
          name: editor.name.trim(),
          displayName: editor.displayName.trim() || undefined,
          description: editor.description.trim() || undefined,
          params,
          steps,
        });
      } else {
        Object.assign(body, {
          title: editor.name.trim(),
          category: editor.category.trim() || "未分类",
          tags: editor.tags,
          content: editor.content,
        });
      }

      const url =
        kind === "skill" ? "/api/skills" : kind === "workflow" ? "/api/workflows" : "/api/knowledge";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        existing?: { id: number; name: string; source?: string };
        skill?: { id?: number; created?: boolean };
        workflow?: { id?: number; created?: boolean };
        doc?: { id?: number };
      };

      if (res.ok && data.ok) {
        const id = Number(data.skill?.id ?? data.workflow?.id ?? data.doc?.id ?? 0);
        const created =
          kind === "knowledge"
            ? true
            : Boolean(data.skill?.created ?? data.workflow?.created ?? true);
        const saveResult: SaveResult = created
          ? { ok: true, id, created: true, message: "已保存" }
          : { ok: true, id, created: false, message: "已覆盖更新" };
        setResult(saveResult);
        setEditing(false);
        setAbandoned(false);
        onSaved?.(saveResult);
      } else if (data.code === "NAME_CONFLICT") {
        const saveResult: SaveResult = {
          ok: false,
          status: "duplicate",
          message: data.error || "同名条目已存在",
          existing: data.existing,
        };
        setResult(saveResult);
        setEditing(false);
        onSaved?.(saveResult);
      } else if (!res.ok) {
        const saveResult: SaveResult = {
          ok: false,
          status: res.status === 400 ? "invalid" : "error",
          message: data.error || "保存失败",
        };
        setResult(saveResult);
        onSaved?.(saveResult);
      }
    } catch (e) {
      const saveResult: SaveResult = {
        ok: false,
        status: "error",
        message: (e as Error).message || "保存失败",
      };
      setResult(saveResult);
      onSaved?.(saveResult);
    } finally {
      setSaving(false);
    }
  }

  function abandonDraft() {
    setAbandoned(true);
    setEditing(false);
    setResult(null);
  }

  // P2-3 批量保存：把「create 模式保存一次」暴露给外层（全部保存按钮）。
  // 守卫：已有结果态(已保存/冲突/失败)、保存中、已放弃、JSON 有误 → 不重复触发。
  useEffect(() => {
    if (!handleRef) return;
    handleRef({
      saveNow: async () => {
        if (result || saving || abandoned || jsonError) return false;
        await doSave("create");
        return true;
      },
    });
    return () => handleRef(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, saving, abandoned, jsonError, handleRef]);

  // —— 折叠态预览 ——
  const preview = (() => {
    if (kind === "skill") {
      const p = payload as SkillDraft;
      return (
        <Space size={6} wrap style={{ fontSize: 12, color: "#595959" }}>
          <Tag
            color={p.type === "shell" ? "green" : p.type === "prompt" ? "purple" : "cyan"}
            style={{ margin: 0 }}
          >
            {SKILL_TYPE_LABEL[p.type] || p.type}
          </Tag>
          <Text type="secondary">{p.params?.length ? `${p.params.length} 个参数` : "无参数"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {previewConfigLine(p)}
          </Text>
        </Space>
      );
    }
    if (kind === "workflow") {
      const p = payload as WorkflowDraft;
      const steps = p.steps || [];
      return (
        <div style={{ display: "grid", gap: 2 }}>
          {steps.slice(0, 5).map((s, i) => (
            <div key={s.id || i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span style={{ color: "#bfbfbf" }}>#{i + 1}</span>
              <Text style={{ fontSize: 12 }}>{s.name || s.id}</Text>
              <Tag style={{ margin: 0, fontSize: 10, borderRadius: 4, padding: "0 5px", lineHeight: "16px" }}>
                {s.type}
              </Tag>
            </div>
          ))}
          {steps.length > 5 && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              其余 {steps.length - 5} 步折叠…
            </Text>
          )}
          {steps.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>（steps 为空）</Text>}
        </div>
      );
    }
    const p = payload as KnowledgeDraft;
    const content = p.content || "";
    const firstLines = content
      .split("\n")
      .map((l) => l.replace(/^#{1,6}\s*/, "").replace(/^>\s?/, "").trim())
      .filter(Boolean)
      .slice(0, 3);
    return (
      <div>
        {firstLines.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>（正文为空）</Text>
        ) : (
          firstLines.map((l, i) => (
            <Text key={i} type="secondary" style={{ fontSize: 12, display: "block" }}>
              {l.length > 60 ? `${l.slice(0, 60)}…` : l}
            </Text>
          ))
        )}
        {content.length > 0 && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            正文 {content.length} 字
          </Text>
        )}
      </div>
    );
  })();

  const editorForm = (
    <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
      {kind === "knowledge" ? (
        <>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>标题</Text>
            <Input
              autoFocus={focusName}
              value={editor.name}
              onChange={(e) => setEditor((s) => ({ ...s, name: e.target.value }))}
              placeholder="文档标题"
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>分类</Text>
              <Input
                value={editor.category}
                onChange={(e) => setEditor((s) => ({ ...s, category: e.target.value }))}
                placeholder="未分类"
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>标签</Text>
              <Select
                mode="tags"
                value={editor.tags}
                onChange={(v: string[]) => setEditor((s) => ({ ...s, tags: v.slice(0, 10) }))}
                placeholder="回车添加标签"
                style={{ width: "100%" }}
              />
            </div>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>正文（Markdown）</Text>
            <Input.TextArea
              rows={6}
              value={editor.content}
              onChange={(e) => setEditor((s) => ({ ...s, content: e.target.value }))}
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
            />
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: kind === "skill" ? "1fr 1fr 2fr" : "1fr 2fr",
              gap: 10,
            }}
          >
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>标识 name</Text>
              <Input
                autoFocus={focusName}
                value={editor.name}
                onChange={(e) => setEditor((s) => ({ ...s, name: e.target.value }))}
                placeholder={kind === "skill" ? "fetch-stats" : "daily-report"}
              />
              {focusName && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  修改为不重复的英文 slug 后保存
                </Text>
              )}
            </div>
            {kind === "skill" && (
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>类型</Text>
                <Select
                  value={editor.type}
                  onChange={(v: SkillType) => setEditor((s) => ({ ...s, type: v }))}
                  style={{ width: "100%" }}
                  options={(["shell", "prompt", "http"] as SkillType[]).map((t) => ({
                    value: t,
                    label: SKILL_TYPE_LABEL[t],
                  }))}
                />
              </div>
            )}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>显示名 displayName</Text>
              <Input
                value={editor.displayName}
                onChange={(e) => setEditor((s) => ({ ...s, displayName: e.target.value }))}
                placeholder="可选"
              />
            </div>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>描述 description</Text>
            <Input
              value={editor.description}
              onChange={(e) => setEditor((s) => ({ ...s, description: e.target.value }))}
              placeholder="可选"
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {kind === "skill" ? "高级：params 与 config（JSON）" : "高级：params 与 steps（JSON）"}
            </Text>
            <Input.TextArea
              rows={8}
              value={editor.json}
              onChange={(e) => handleJsonChange(e.target.value)}
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
            />
            {jsonError && (
              <Text type="danger" style={{ fontSize: 11 }}>
                {jsonError}
              </Text>
            )}
          </div>
        </>
      )}
    </div>
  );

  const actionButton = (() => {
    if (saved) {
      return (
        <Button
          type="primary"
          size="small"
          disabled
          icon={<CheckCircleFilled />}
          style={{ background: "#52c41a" }}
        >
          {result!.created ? `✓ 已保存 #${result!.id}` : `✓ 已覆盖更新 #${result!.id}`}
        </Button>
      );
    }
    if (editing) {
      return (
        <Space size={6}>
          <Button
            type="primary"
            size="small"
            loading={saving}
            disabled={!!jsonError}
            style={{ background: "#00c896" }}
            onClick={() => void doSave("create")}
          >
            保存
          </Button>
          <Button
            size="small"
            onClick={() => {
              setEditing(false);
              setFocusName(false);
            }}
          >
            取消
          </Button>
        </Space>
      );
    }
    if (duplicate) {
      return (
        <Space size={6}>
          <Button
            type="primary"
            size="small"
            style={{ background: "#00c896" }}
            loading={saving}
            onClick={() => void doSave("overwrite")}
          >
            覆盖更新
          </Button>
          <Button size="small" onClick={() => openEditor(true)}>
            另存新名
          </Button>
          <Button size="small" onClick={abandonDraft}>
            放弃
          </Button>
        </Space>
      );
    }
    if (abandoned) {
      return (
        <Button
          size="small"
          type="text"
          style={{ color: "#8c8c8c" }}
          onClick={() => {
            setAbandoned(false);
            setResult(null);
          }}
        >
          <ReloadOutlined /> 重新保存
        </Button>
      );
    }
    return (
      <Button
        type="primary"
        size="small"
        loading={saving}
        style={{ background: "#00c896" }}
        onClick={() => void doSave("create")}
      >
        {SAVE_LABEL[kind]}
      </Button>
    );
  })();

  return (
    <Card
      size="small"
      style={{
        borderRadius: 10,
        border: "1px solid #f0f0f0",
        boxShadow: "0 1px 2px rgba(0,0,0,.03)",
      }}
      styles={{ body: { padding: "10px 12px" } }}
    >
      {/* 头部 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Tag color="purple" style={{ margin: 0 }}>
          {KIND_LABEL[kind]}
        </Tag>
        <Text strong style={{ fontSize: 13 }}>
          {payloadTitle(payload)}
        </Text>
        {payloadSlug(payload) && payloadSlug(payload) !== payloadTitle(payload) && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {payloadSlug(payload)}
          </Text>
        )}
        <SourceTag source="ai" />
        {saved && <CheckCircleFilled style={{ color: "#52c41a" }} />}
        <span style={{ flex: 1 }} />
        {!saved && !abandoned && (
          <Button
            type="text"
            size="small"
            icon={editing ? <DownOutlined /> : <EditOutlined />}
            onClick={() => (editing ? setEditing(false) : openEditor(false))}
          >
            {editing ? "收起" : "编辑"}
          </Button>
        )}
      </div>

      {/* 轻量 issues（保存前提示，不阻断） */}
      {!saved && !editing && !abandoned && !!issues?.length && (
        <Alert type="warning" showIcon style={{ marginTop: 8 }} message={issues.join("；")} />
      )}

      {/* 放弃态提示 */}
      {abandoned && (
        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          已放弃保存该草稿。
        </Paragraph>
      )}

      {/* 预览 / 编辑表单 */}
      {!editing && !abandoned && <div style={{ marginTop: 8 }}>{preview}</div>}
      {editing && editorForm}

      {/* 失败/校验行内提示 */}
      {failed && (
        <Alert
          type={result!.status === "invalid" ? "warning" : "error"}
          showIcon
          style={{ marginTop: 8 }}
          message={result!.message}
        />
      )}
      {duplicate && !abandoned && (
        <Alert type="warning" showIcon style={{ marginTop: 8 }} message={result!.message} />
      )}
      {saved && (
        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          {result!.message}，可到对应中心查看。
        </Paragraph>
      )}

      {/* 底部操作 */}
      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
        {actionButton}
      </div>
    </Card>
  );
}
