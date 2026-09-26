import type { NextConfig } from "next";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8080";

const nextConfig: NextConfig = {
  output: "standalone",
  // 前端所有 /api/* 请求代理到 Spring Boot 后端（浏览器同源请求自动携带 token cookie）
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
