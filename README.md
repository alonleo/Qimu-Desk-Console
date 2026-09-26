# Qimu Desk & Console · 栖木

两个 Web 平台及共享后端的统一代码仓库。

| 项目 | 目录 | 本地端口 |
| --- | --- | --- |
| Qimu Desk · 栖木工作台 | `qimu-desk/` | 3010 |
| Qimu Console · 栖木管理台 | `qimu-console/` | 3011 |
| Spring Boot 共享后端 | `qimu-console/admin-backend/` | 8080 |

## 本地开发

分别在两个前端目录执行 `npm install` 和 `npm run dev`。
环境配置参见各目录的 `.env.example`；真实业务功能依赖共享后端和 MySQL，共享数据库名称为 `qimu_platform`。

## 本地首页预览

临时预览仅在 `next dev`、本机地址和显式配置同时满足时启用。
预览账号不具备真实业务权限；不要将 `.env.local`、临时密码或会话密钥提交到仓库。

## 部署

使用外部工具 `workbuddy-1panel-deploy` 管理 1Panel 部署。
前端分别以各自子目录作为构建上下文，后端构建上下文为 `qimu-console/admin-backend`。
发布时关闭本地预览功能，后端地址和数据库密钥由服务器环境注入。
生产数据库内容、站点证书及部署工具凭据均不属于本仓库。

## 原仓库归并

本仓库导入了两个项目的当前代码及未提交的界面改版。
原仓库历史保留在本机的私有备份中，没有作为嵌套 Git 仓库或子模块发布。
