// 后台管理平台（admin-platform）前端入口地址。
// 部署构建时通过 NEXT_PUBLIC_ADMIN_URL 注入公网地址（https://admin.lordleo.top），
// 未注入时回退公网地址；本地开发如需指向本地实例，在 .env.local 中设置
// NEXT_PUBLIC_ADMIN_URL=http://localhost:3011 即可。
export function adminUrl(): string {
  return (process.env.NEXT_PUBLIC_ADMIN_URL || "https://admin.lordleo.top").replace(/\/+$/, "");
}
