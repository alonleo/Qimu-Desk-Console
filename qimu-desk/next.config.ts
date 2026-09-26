import type { NextConfig } from "next";
import path from "node:path";

const ADMIN_BACKEND = process.env.ADMIN_BACKEND_URL || "http://localhost:8080";

// Windows/Git Bash 下构建时 cwd 驱动器号大小写可能不一致（C: vs c:），
// 导致 webpack 把同一模块识别成两份，React 被重复加载，useContext 返回 null。
// 该 resolver plugin 在 resolve 阶段把请求路径统一规范化为大写驱动器号。
class NormalizeDriveLetterPlugin {
  apply(compiler: any) {
    compiler.hooks.normalModuleFactory.tap("NormalizeDriveLetterPlugin", (factory: any) => {
      factory.hooks.beforeResolve.tap("NormalizeDriveLetterPlugin", (data: any) => {
        const fix = (p: string | undefined) =>
          p && /^[a-z]:\\/i.test(p) ? p[0].toUpperCase() + p.slice(1) : p;
        if (data.request) data.request = fix(data.request);
        if (data.context) data.context = fix(data.context);
        if (data.contextInfo && data.contextInfo.issuer) {
          data.contextInfo.issuer = fix(data.contextInfo.issuer);
        }
      });
    });
  }
}

const nextConfig: NextConfig = {
  // standalone 产物用于服务器容器部署（node server.js）；本地 dev 不受影响
  output: "standalone",
  serverExternalPackages: ["mysql2"],
  webpack: (config) => {
    config.resolve.modules = [path.resolve(__dirname, "node_modules")];
    // 注意：不要把 react/react-dom 别名指到 node_modules —— App Router 服务端
    // 必须用 Next 内置的 compiled react（canary），别名会混入 npm 版 React，
    // 导致 prerender 阶段 hooks 全 null（/_not-found Export error）。
    config.plugins = [...(config.plugins || []), new NormalizeDriveLetterPlugin()];
    return config;
  },
  // 管理联动：/hub/* 转发到后台管理平台后端（Spring Boot 8080）
  // 前台（工作台）承担「执行」类操作，后台承担「管理（增删改查）」
  async rewrites() {
    return [
      {
        source: "/hub/:path*",
        destination: `${ADMIN_BACKEND}/api/:path*`,
      },
    ];
  },
  // 后台管理平台跳转地址统一由 core/admin-url.ts 提供：
  // 部署时可通过 NEXT_PUBLIC_ADMIN_URL 覆盖（默认 https://admin.lordleo.top），
  // 本地开发在 .env.local 设置 NEXT_PUBLIC_ADMIN_URL=http://localhost:3011。
};

export default nextConfig;
