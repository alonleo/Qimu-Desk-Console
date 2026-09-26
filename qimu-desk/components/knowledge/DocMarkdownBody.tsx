"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Typography } from "antd";

/**
 * 知识库文档正文的 Markdown 渲染（实际渲染体，经懒加载引用）。
 * 样式与 antd 协调（Typography 标题/链接/段落），支持 GFM 表格/任务列表/删除线。
 */
export default function DocMarkdownBody({ content }: { content: string }) {
  return (
    <div style={{ fontSize: 14, lineHeight: 1.75, color: "#333" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <Typography.Title level={3} style={{ marginTop: 8 }}>{children}</Typography.Title>,
          h2: ({ children }) => <Typography.Title level={4} style={{ marginTop: 20 }}>{children}</Typography.Title>,
          h3: ({ children }) => <Typography.Title level={5} style={{ marginTop: 16 }}>{children}</Typography.Title>,
          p: ({ children }) => <Typography.Paragraph style={{ marginBottom: 10 }}>{children}</Typography.Paragraph>,
          a: ({ href, children }) => (
            <Typography.Link href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </Typography.Link>
          ),
          ul: ({ children }) => <ul style={{ paddingLeft: 22, margin: "8px 0" }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ paddingLeft: 22, margin: "8px 0" }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
          blockquote: ({ children }) => (
            <div
              style={{
                borderLeft: "3px solid #1677ff",
                background: "#f5f8ff",
                padding: "8px 14px",
                borderRadius: 6,
                margin: "10px 0",
                color: "#555",
              }}
            >
              {children}
            </div>
          ),
          pre: ({ children }) => (
            <pre
              style={{
                background: "#f6f8fa",
                border: "1px solid #e4e7ec",
                borderRadius: 8,
                padding: 14,
                fontSize: 12.5,
                overflowX: "auto",
                margin: "10px 0",
              }}
            >
              {children}
            </pre>
          ),
          code: ({ className, children }) => {
            const isBlock = typeof className === "string" && className.includes("language-");
            if (isBlock || String(children).includes("\n")) {
              return <code style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{children}</code>;
            }
            return (
              <code
                style={{
                  background: "#f0f2f5",
                  padding: "1px 6px",
                  borderRadius: 4,
                  fontSize: 12.5,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  color: "#c41d7f",
                }}
              >
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div style={{ overflowX: "auto", margin: "10px 0" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead style={{ background: "#fafafa" }}>{children}</thead>,
          th: ({ children }) => (
            <th style={{ border: "1px solid #e8e8e8", padding: "6px 12px", textAlign: "left", fontWeight: 600 }}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td style={{ border: "1px solid #e8e8e8", padding: "6px 12px" }}>{children}</td>
          ),
          img: ({ src, alt }) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} style={{ maxWidth: "100%", borderRadius: 8 }} />
          ),
          hr: () => <div style={{ borderTop: "1px solid #f0f0f0", margin: "16px 0" }} />,
          strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
        }}
      >
        {content || "（空文档）"}
      </ReactMarkdown>
    </div>
  );
}
