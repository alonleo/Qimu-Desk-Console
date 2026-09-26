"use client";

import { useEffect } from "react";
import { Result, Button } from "antd";

/** 受保护区域的全局错误边界：任何 SSR/渲染异常都给出可操作的界面，而非裸错误页 */
export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] page error:", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Result
        status="warning"
        title="页面加载失败"
        subTitle="数据请求出现异常，请重试。若持续失败，请重新登录后再试。"
        extra={[
          <Button key="retry" type="primary" onClick={() => reset()}>
            重试
          </Button>,
          <Button
            key="login"
            onClick={() => {
              document.cookie = "token=; path=/; max-age=0";
              window.location.href = "/login";
            }}
          >
            重新登录
          </Button>,
        ]}
      />
    </div>
  );
}
