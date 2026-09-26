"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Segmented, Tag, Typography } from "antd";
import ChatMarkdown from "@/components/ai/ChatMarkdown";

/**
 * 技能 / 工作流运行结果的智能渲染器。
 *
 * 输出内容自动识别并分层渲染：
 * - JSON：优先提取其中有意义的文本内容（LLM 回复、message/content/text 等字段），
 *   以 Markdown 渲染为「内容」视图；提取不到时按 JSON 结构渲染（数组→数据表格，对象→键值表）
 * - Markdown：标题/代码块/表格/列表等特征命中 → Markdown 渲染
 * - 纯文本：等宽字体原样展示
 * 右上角提供视图切换（内容 / JSON / 原始），原始视图始终展示未经处理的输出原文。
 */

type Kind = "json" | "markdown" | "text";
type View = "content" | "render" | "raw";

function tryParseJson(s: string): unknown {
  const t = s.trim();
  if (!t || !/^[[{]/.test(t) || !/[\]}]$/.test(t)) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** Markdown 特征打分：>=2 分才按 Markdown 渲染，避免 shell 输出里的 # 注释被误判 */
function looksLikeMarkdown(s: string): boolean {
  if (s.length < 20) return false;
  let score = 0;
  if (/^#{1,6}\s+\S/m.test(s)) score += 2;
  if (/```/s.test(s)) score += 2;
  if (/^\s*[-*+]\s+\S/m.test(s)) score += 1;
  if (/^\s*\d+\.\s+\S/m.test(s)) score += 1;
  if (/^\|.*\|/m.test(s) && /^\|[\s:|-]+\|$/m.test(s)) score += 2;
  if (/\*\*[^*\n]+\*\*/.test(s)) score += 1;
  if (/\[[^\]\n]+\]\([^)\n]+\)/.test(s)) score += 1;
  return score >= 2;
}

const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** 轻量 JSON 语法高亮（浅色主题配色，无第三方依赖） */
function highlightJson(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        // 键名 + 冒号
        nodes.push(<span key={i++} style={{ color: "#0958a8" }}>{m[1]}</span>);
        nodes.push(<span key={i++} style={{ color: "#8c8c8c" }}>{m[2]}</span>);
      } else {
        // 字符串值
        nodes.push(<span key={i++} style={{ color: "#2b7d2b" }}>{m[1]}</span>);
      }
    } else if (m[0] === "true" || m[0] === "false" || m[0] === "null") {
      nodes.push(<span key={i++} style={{ color: "#c6410c" }}>{m[0]}</span>);
    } else {
      nodes.push(<span key={i++} style={{ color: "#b3540e" }}>{m[0]}</span>);
    }
    last = TOKEN_RE.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function JsonBlock({ value, maxHeight = 240 }: { value: unknown; maxHeight?: number | "none" }) {
  const text = useMemo(() => JSON.stringify(value, null, 2), [value]);
  return (
    <pre
      style={{
        margin: 0,
        padding: 10,
        background: "#fff",
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.6,
        maxHeight,
        overflowY: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
      }}
    >
      {highlightJson(text)}
    </pre>
  );
}

/** 截断展示嵌套值的单行 JSON */
function compact(v: unknown, max = 80): string {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 从 JSON 信封中提取有意义文本内容的候选字段（按优先级） */
const TEXT_KEYS = ["content", "text", "message", "output", "result", "answer", "response", "data"];

/** 判断字符串是否本身是 JSON（是则不再作为「内容」提取，避免套娃） */
function isJsonLike(s: string): boolean {
  const t = s.trim();
  return /^[[{]/.test(t) && /[\]}]$/.test(t) && tryParseJson(t) !== undefined;
}

/**
 * 从 JSON 值中递归提取可读的文本内容（LLM 回复、HTTP 响应正文等）。
 * 典型信封均能命中：
 * - OpenAI 风格：{choices:[{message:{content:"…"}}]}
 * - 通用信封：{ok:true, data:{content:"…"}} / {content:"…"} / {output:"…"}
 * 数组的多个可提取片段会以空行拼接（兼容分段输出）。
 * 提取不到（或片段太短/本身是 JSON）返回 undefined，调用方回退到结构化 JSON 渲染。
 */
function extractReadable(v: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  if (Array.isArray(v)) {
    const parts: string[] = [];
    for (const it of v) {
      const r = extractReadable(it, depth + 1);
      if (r) parts.push(r);
    }
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }
  if (!isPlainObject(v)) return undefined;

  // 1. 优先按已知字段名取（直接命中或继续下钻）
  for (const k of TEXT_KEYS) {
    if (!(k in v)) continue;
    const val = v[k];
    if (typeof val === "string") {
      const t = val.trim();
      if (t.length >= 20 && !isJsonLike(t)) return val;
    } else if (val !== null && typeof val === "object") {
      const r = extractReadable(val, depth + 1);
      if (r) return r;
    }
  }
  // 2. 兜底：下钻所有嵌套对象/数组（如 choices → message → content）
  for (const val of Object.values(v)) {
    if (val !== null && typeof val === "object") {
      const r = extractReadable(val, depth + 1);
      if (r) return r;
    }
  }
  return undefined;
}

/** JSON 数组（元素为对象）→ 数据表格 */
function JsonArrayTable({ items }: { items: unknown[] }) {
  const cols = useMemo(() => {
    const keys: string[] = [];
    for (const it of items.slice(0, 30)) {
      if (isPlainObject(it)) {
        for (const k of Object.keys(it)) if (!keys.includes(k) && keys.length < 12) keys.push(k);
      }
    }
    return keys;
  }, [items]);
  const rows = items.slice(0, 200);

  if (cols.length === 0) {
    // 元素不是对象（基础类型数组）→ 序号 / 值 两列
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead>
            <tr>
              <th style={cellTh("#", 48)}>#</th>
              <th style={cellTh("值")}>值</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, i) => (
              <tr key={i}>
                <td style={cellTd({ color: "#8c8c8c" })}>{i + 1}</td>
                <td style={cellTd({ fontFamily: "ui-monospace, monospace" })}>
                  {typeof it === "object" ? compact(it) : String(it)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
        <thead>
          <tr>
            <th style={cellTh("#", 48)}>#</th>
            {cols.map((c) => (
              <th key={c} style={cellTh(c)}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((it, i) => (
            <tr key={i}>
              <td style={cellTd({ color: "#8c8c8c" })}>{i + 1}</td>
              {cols.map((c) => {
                const v = isPlainObject(it) ? it[c] : undefined;
                return (
                  <td key={c} style={cellTd()}>
                    {v === undefined ? (
                      <span style={{ color: "#bfbfbf" }}>-</span>
                    ) : typeof v === "object" && v !== null ? (
                      <code style={{ fontSize: 11, color: "#8c8c8c", wordBreak: "break-all" }}>{compact(v)}</code>
                    ) : (
                      String(v)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > 200 && (
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          共 {items.length} 条，仅展示前 200 条（切「原始」查看全部）
        </Typography.Text>
      )}
    </div>
  );
}

/** JSON 对象 → 键值表（嵌套值以高亮 JSON 块内嵌） */
function JsonObjectTable({ obj }: { obj: Record<string, unknown> }) {
  return (
    <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
      <tbody>
        {Object.entries(obj).map(([k, v]) => (
          <tr key={k}>
            <td
              style={{
                ...cellTd({ fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top" }),
                background: "#fafafa",
                width: 140,
              }}
            >
              {k}
            </td>
            <td style={cellTd({ verticalAlign: "top" })}>
              {typeof v === "object" && v !== null ? (
                <JsonBlock value={v} maxHeight={200} />
              ) : (
                String(v)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function cellTh(label: string, width?: number): React.CSSProperties {
  return {
    border: "1px solid #f0f0f0",
    background: "#fafafa",
    padding: "6px 10px",
    textAlign: "left",
    fontWeight: 600,
    whiteSpace: "nowrap",
    width,
    position: "sticky",
    top: 0,
  };
}

function cellTd(extra?: React.CSSProperties): React.CSSProperties {
  return {
    border: "1px solid #f0f0f0",
    padding: "6px 10px",
    wordBreak: "break-word",
    ...extra,
  };
}

export default function RunOutput({
  output,
  maxHeight = 360,
  expanded = false,
}: {
  output: string;
  maxHeight?: number;
  expanded?: boolean;
}) {
  const contentHeight = expanded ? undefined : maxHeight;
  const parsed = useMemo(() => tryParseJson(output), [output]);
  const kind: Kind = useMemo(() => {
    if (parsed !== undefined) return "json";
    if (looksLikeMarkdown(output)) return "markdown";
    return "text";
  }, [parsed, output]);

  // JSON 信封内若能提取出有意义的文本内容（LLM 回复等），默认以「内容」视图展示
  const extracted = useMemo(
    () => (kind === "json" ? extractReadable(parsed) : undefined),
    [kind, parsed]
  );

  const [view, setView] = useState<View>(extracted ? "content" : "render");

  // 输出变化时重置视图（运行历史切换 / 重新执行）
  const outputRef = useRef(output);
  if (outputRef.current !== output) {
    outputRef.current = output;
    setView(extracted ? "content" : "render");
  }

  if (!output.trim()) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        （无输出）
      </Typography.Text>
    );
  }

  const kindLabel = kind === "json" ? "JSON" : kind === "markdown" ? "Markdown" : "文本";

  let body: ReactNode;
  if (view === "raw" || kind === "text") {
    body = (
      <pre
        style={{
          margin: 0,
          padding: 10,
          background: "#fff",
          borderRadius: 8,
          fontSize: expanded ? 14 : 12,
          lineHeight: 1.85,
          maxHeight: contentHeight,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {output}
      </pre>
    );
  } else if (view === "content" && extracted) {
    body = (
      <div
        style={{
          maxHeight: contentHeight,
          overflowY: "auto",
          background: "#fff",
          borderRadius: 8,
          padding: "4px 10px",
        }}
      >
        <ChatMarkdown content={extracted} size={expanded ? 15 : 13} />
      </div>
    );
  } else if (kind === "json") {
    const v = parsed;
    body =
      Array.isArray(v) ? (
        v.length > 0 && v.every(isPlainObject) ? (
          <div style={{ maxHeight: contentHeight, overflowY: "auto", borderRadius: 8 }}>
            <JsonArrayTable items={v} />
          </div>
        ) : (
          <JsonBlock value={v} maxHeight={expanded ? "none" : maxHeight} />
        )
      ) : isPlainObject(v) ? (
        <div style={{ maxHeight: contentHeight, overflowY: "auto", borderRadius: 8 }}>
          <JsonObjectTable obj={v} />
        </div>
      ) : (
        <JsonBlock value={v} maxHeight={expanded ? "none" : maxHeight} />
      );
  } else {
    body = (
      <div
        style={{
          maxHeight: contentHeight,
          overflowY: "auto",
          background: "#fff",
          borderRadius: 8,
          padding: "4px 10px",
        }}
      >
        <ChatMarkdown content={output} size={expanded ? 15 : 13} />
      </div>
    );
  }

  // 视图选项：JSON 且能提取内容 → 内容/JSON/原始；其他非文本 → 渲染/原始；文本 → 无切换
  const viewOptions: { label: string; value: View }[] =
    kind === "json" && extracted
      ? [
          { label: "内容", value: "content" },
          { label: "JSON", value: "render" },
          { label: "原始", value: "raw" },
        ]
      : [
          { label: "渲染", value: "render" },
          { label: "原始", value: "raw" },
        ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <Tag style={{ margin: 0, fontSize: 10, borderRadius: 4, color: "#8c8c8c" }}>
          {kind === "json" && view === "content" && extracted ? "JSON · 已提取内容" : kindLabel}
        </Tag>
        {kind !== "text" && (
          <Segmented
            size="small"
            value={view === "content" && !extracted ? "render" : view}
            onChange={(v) => setView(v as View)}
            options={viewOptions}
          />
        )}
      </div>
      {body}
    </div>
  );
}
