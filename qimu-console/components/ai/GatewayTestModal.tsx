"use client";

import { Button, Modal, Tag, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

export type GatewayTestResult = { name: string; ok: boolean; reply?: string; error?: string };

/** 网关「测试连接」结果弹窗：含模型回复的 Markdown 渲染（懒加载，不进首屏包） */
export default function GatewayTestModal({
  result,
  onClose,
}: {
  result: GatewayTestResult | null;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`测试连接：${result?.name ?? ""}`}
      open={!!result}
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          关 闭
        </Button>
      }
    >
      {result ? (
        result.ok ? (
          <div>
            <Tag color="success">连通正常</Tag>
            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              模型回复：
            </Typography.Text>
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                background: "#fafafa",
                borderRadius: 8,
                maxHeight: 360,
                overflowY: "auto",
                fontSize: 13,
              }}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                  p: ({ children }) => <p style={{ margin: "4px 0", wordBreak: "break-word" }}>{children}</p>,
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#1677ff", wordBreak: "break-all" }}>
                      {children}
                    </a>
                  ),
                  ul: ({ children }) => <ul style={{ paddingLeft: 20, margin: "4px 0" }}>{children}</ul>,
                  ol: ({ children }) => <ol style={{ paddingLeft: 20, margin: "4px 0" }}>{children}</ol>,
                  li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
                  pre: ({ children }) => (
                    <pre
                      style={{
                        background: "#f6f8fa",
                        border: "1px solid #e4e7ec",
                        borderRadius: 6,
                        padding: 10,
                        overflowX: "auto",
                        fontSize: 12.5,
                        lineHeight: 1.6,
                      }}
                    >
                      {children}
                    </pre>
                  ),
                  code: ({ className, children }) => {
                    const isBlock = /language-/.test(className || "");
                    return isBlock ? (
                      <code style={{ display: "block", padding: 0, background: "transparent", fontSize: 12.5 }}>
                        {children}
                      </code>
                    ) : (
                      <code
                        style={{
                          background: "rgba(22, 119, 255, 0.08)",
                          color: "#0958d9",
                          padding: "1px 5px",
                          borderRadius: 4,
                          fontSize: 12.5,
                        }}
                      >
                        {children}
                      </code>
                    );
                  },
                  table: ({ children }) => (
                    <div style={{ overflowX: "auto", margin: "6px 0" }}>
                      <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>{children}</table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th style={{ border: "1px solid #e4e7ec", padding: "4px 10px", textAlign: "left", whiteSpace: "nowrap" }}>
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td style={{ border: "1px solid #e4e7ec", padding: "4px 10px", wordBreak: "break-word" }}>{children}</td>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote
                      style={{
                        borderLeft: "3px solid #1677ff",
                        background: "#f5f8ff",
                        padding: "4px 10px",
                        borderRadius: "0 4px 4px 0",
                        margin: "6px 0",
                        color: "#595959",
                      }}
                    >
                      {children}
                    </blockquote>
                  ),
                }}
              >
                {result.reply || "（空回复）"}
              </ReactMarkdown>
            </div>
          </div>
        ) : (
          <Typography.Paragraph type="danger" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
            {result.error}
          </Typography.Paragraph>
        )
      ) : null}
    </Modal>
  );
}
