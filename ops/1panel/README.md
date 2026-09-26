# Qimu 的 1Panel 部署映射

部署操作使用工作区外的 `workbuddy-1panel-deploy` 工具；不要将其 `secrets/`、登录脚本或会话文件复制到本仓库。

## 代码与构建

仓库：`https://github.com/alonleo/Qimu-Desk-Console.git`

| 服务 | Git 仓库内构建目录 | 构建 | 产物 |
| --- | --- | --- | --- |
| Qimu Desk | `qimu-desk` | `npm ci && npm run build` | `.next/standalone`、`.next/static`、`public` |
| Qimu Console | `qimu-console` | `npm ci && npm run build` | `.next/standalone`、`.next/static`、`public` |
| 共享后端 | `qimu-console/admin-backend` | `mvn package` | `target/*.jar` |

前端单独在各自目录构建，不把整个仓库作为 Next.js 的项目根。
Git 自动发布器需要按上表选择子目录，不能继续使用旧版“双独立仓库”的源目录映射。

## 环境

- 共享 MySQL 数据库：`qimu_platform`；前端工作台与 Java 后端的 `DB_NAME` 必须一致。
- 后端账号用 `DB_USERNAME`，工作台用 `DB_USER`；密钥仅由服务器配置注入。
- 生产后端必须设置 `APP_ENV=production` 与非默认 `JWT_SECRET`。
- `ADMIN_BACKEND_URL` / `BACKEND_URL` 在前端构建时注入实际后端地址。
- `NEXT_PUBLIC_ADMIN_URL` 在工作台构建时注入管理台公网地址。
- 禁止将本地 `.env.local` 带入发布包；`LOCAL_PREVIEW_ENABLED` 应关闭。
- 容器内部端口及反向代理由部署配置确定，本地开发端口 3010/3011 不等于生产容器端口。

## 清理与迁移顺序

1. 在现有面板中核对站点、容器、计划任务、部署路径及旧数据库实际名称。
2. 明确保留数据还是全新初始化；删除旧库前取得明确的范围确认。
3. 备份站点配置和数据库，并验证备份可读。
4. 建立 `qimu_platform`，按确认结果迁移数据或执行 `src/main/resources/db/schema.sql` 初始化。
5. 发布后端与两个前端，检查版本标识、登录页、鉴权接口及数据库连接。
6. 停用旧仓库轮询任务，防止旧代码覆盖新版本。
7. 验证成功后，仅清理已明确指定的旧应用及旧库，不影响其他站点、共享 MySQL/Redis 或备份。

本文为部署准备说明，不代表远程迁移或清理已执行。
