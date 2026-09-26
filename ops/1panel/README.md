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

## 初次部署记录（2026-09-27）

已通过工作区中的 `workbuddy-1panel-deploy` 完成发布、切换与旧应用清理。
本次发布的应用源码版本：`cf3c96ff2c606f002218d0fb84cee834f5cd8cf4`。

| 服务 | 域名 | 容器 | 宿主机回环端口 |
| --- | --- | --- | --- |
| 工作台 | https://work.lordleo.top | `qimu-desk` | `13010 → 3000` |
| 管理台 | https://admin.lordleo.top | `qimu-console` | `13011 → 3000` |
| 共享后端 | 经两站点代理访问 | `qimu-backend` | `18080 → 8080` |

- 发布根目录：`/home/webuser/deploy/Qimu-Desk-Console`；子目录为 `qimu-desk`、`qimu-console`、`backend`、`config`。
- 独立 Docker 网络为 `qimu-network`；后端网络别名 `admin-backend` 与构建期 rewrite 地址一致。
- 共享 MySQL/Redis 实例保持原有服务；Qimu 使用独立数据库 `qimu_platform`、专用数据库用户及 Redis DB 1。
- 三个生产环境文件仅保存在服务器 `config` 目录，权限 600；禁止提交或复制到公开仓库。
- 工作台设置 `APP_URL=https://work.lordleo.top`，用于生产 Cookie 和来源校验。
- 旧应用、旧数据库 `workbench_admin` 和对应发布/初始化任务已移除；切换前备份单独保留。
- 已验证两域名登录页、真实登录、当前用户、受保护页面、数据库健康检查及预览入口返回 404。
- 本次采用本地生产构建后上传、校验 SHA-256 再切换的方式；未启用 Git 定时自动发布。

后续更新时先在子目录完成生产构建，将 standalone、static、public 和后端 JAR 一并打包；保留服务器配置，备份当前版本，替换产物后重建对应容器并验证上述检查。每个服务目录的 `.deploy-version` 必须记录实际构建的源码提交。


## 模块更新与数据同步验证（2026-09-27）

当前线上应用源码版本：`0fc4f1aa41d9808648ba2cb31354cdb28e48728b`，Desk、Console、Java 后端三份 `.deploy-version` 已核对一致。

- 已按任务、项目、知识库、工作流、技能、AI 助手、聊天、导航分别保存 8 个中文提交，并独立提交历史公共数据创建人为空的兼容修复。
- 生产 Desk 与 Java 后端共用 `qimu_platform`，数据库连接、数据库账号、JWT 密钥及前端后端地址已核对一致。
- 发布前备份应用、服务器配置与数据库；增量补齐 `tasks.assignee_id`，核验 `start_date`、`period`，建立 `ai_capabilities`。未重置业务数据。
- 先更新 Java 后端，再通过仅服务器回环可访问的新版前端验证，全部通过后才切换公网前端。
- 预上线发现旧 Java 知识库、技能、工作流、项目在历史数据 `owner_id=NULL` 时存在空指针风险，已修复；新增 4 项测试先复现失败、修复后通过。
- 验证：两个前端生产构建、17 项 Java 测试、14 项任务模型检查、项目/知识库/工作流回归、AI 能力与 MCP/流式响应/手动保存检查，以及 73 项 AI 产物解析测试通过。
- 正式域名验证：真实登录、当前用户、首页及任务/项目/知识库/技能/工作流页面成功；生产预览入口关闭。
- 双端任务、项目、文档、技能、工作流 ID 集合一致；知识库、技能与工作流详情可读取。项目、任务和知识文档均完成 Desk 创建 → Java/Console 读取更新 → Desk 回读验证，临时记录已删除。
- 发布后原有数量：任务 0、项目 0、文档 3、技能 4、工作流 5；三个容器运行正常、重启次数 0。
- 回滚备份：`/home/webuser/qimu-backups/modules-before-0fc4f1aa41d9808648ba2cb31354cdb28e48728b`，数据库压缩包和 SHA-256 校验通过。增量表结构与旧版本兼容，回滚应用不需要删除新增列或表。
- 本次仍为本地构建、校验上传与切换；GitHub 推送待用户明确授权，生产发布不依赖 Git 轮询。
