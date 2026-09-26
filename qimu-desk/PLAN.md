# 个人工作台（Personal Workbench）规划 v3

> 形态：自部署 Web 应用（Docker + 公网 HTTPS） · 技术栈：Node/TS（工作台）+ Spring Boot（管理后台）
> 目标：统一集成 技能 / 工作流 / 知识库 / 任务与项目，随时随地可用
> v3 变更：与 admin-platform 管理后台共享同一 MySQL 库 `qimu_platform`；账号/认证以后端 JWT 为准；用户由后台开户

---

## 1. 定位与原则

- **自部署**：跑在自己的服务器上（Docker），数据归自己，公网 HTTPS 访问，电脑手机都能用
- **声明式优先**：技能和工作流都用 YAML 定义，改配置不改代码
- **AI 是工具不是骨架**：工作流确定式执行，只在生成、总结、检索等具体环节调用 LLM
- **安全内建**：多账号认证（管理员/成员角色）+ HTTPS + 容器隔离，公网暴露面最小化
- **渐进式建设**：每个里程碑结束都有可用的东西；升级应用不动数据（配置与数据全部外置）

## 2. 技术选型

| 层 | 选型 | 理由 |
|----|------|------|
| 前端/后端 | 工作台 Next.js (App Router) + React + Tailwind；后台 admin-platform Spring Boot | 前后端同构；standalone 产物小，适配容器 |
| 结构化存储 | MySQL `qimu_platform`（与 admin-platform 共享） | 单库双端读写；表结构由后台 schema.sql 统一管理 |
| 文件存储 | Markdown / YAML 目录约定（Docker volume 持久化） | 对人友好、可 git 版本化 |
| 检索 | MySQL LIKE 子串匹配（FULLTEXT 分词器不切中文） | 与后台 KnowledgeController 检索口径一致 |
| 认证 | 统一后端 JWT（HS256，72h）：工作台代理登录 + 本地验签，用户表在后端 `users`（BCrypt） | 后台开户、双端同账号互登；工作台不再自建账号 |
| 反向代理 | Caddy | 自动申请/续期 HTTPS 证书，配置两行搞定 |
| 容器编排 | docker-compose（app + caddy 两个服务） | 一条命令启动整栈 |
| 定时任务 | node-cron（应用内） | 服务器常驻，调度天然可靠；不依赖 WorkBuddy |
| 备份 | `mysqldump qimu_platform` 冷备份 + 打包 skills/workflows/knowledge volume | 本地保留 N 份，可选 rclone 推对象存储 |
| LLM | 统一 AI 网关模块（OpenAI 兼容协议） | 工具化调用，可换模型 |

## 3. 部署架构

```
你的设备（电脑/手机浏览器）
        │ HTTPS
        ▼
┌─ 你的服务器（Docker Compose）─────────────┐
│  Caddy 反代（域名 · 自动证书）              │
│      │                                     │
│  工作台容器                                │
│  Next.js · API · 执行引擎 · 定时调度 · 备份  │
│      │                                     │
│  Docker Volume ──► 定时备份（本地+可选云端） │
└────────────────────────────────────────────┘
```

- **部署流程**：服务器上 `git pull` → `docker compose up -d --build`，即完成升级
- **数据持久化**：业务数据统一在 MySQL `qimu_platform`（后台 schema.sql 建表，容器重建不丢数据）；`skills/`、`workflows/`、`knowledge/`（配置与文档）挂载 volume
- **安全边界**：
  - Caddy 只暴露 443（80 仅跳转 HTTPS）
  - 统一认证：登录代理后台 `/api/auth/login` 签发 JWT（HS256，72h），工作台本地验签 + 回表取权威角色/禁用态；密码 BCrypt（`$2a$10$`，与 Spring 互认）
  - 会话：`wb_token` cookie httpOnly + SameSite=Lax + 生产 Secure；未登录一律 401/跳转登录
  - 角色权限：管理员负责开户/禁用/重置密码/分配角色；技能与工作流由后台 CRUD 维护，工作台目录仅「缺失播种」不覆盖
  - 工作流的 shell 步骤只在容器内执行，天然与宿主机隔离；镜像内不装多余工具
  - 敏感配置（LLM key、JWT secret、DB 密码）全部走 `.env`，不进 git
  - 登录接口加简单限速，防爆破

## 4. 核心模块设计

### 4.1 技能中心（Skills）
- 目录约定：`skills/<skill-name>/skill.yaml` + 可选脚本/模板文件
- 技能类型三种：`shell`（容器内脚本）、`prompt`（LLM 提示词模板）、`http`（外部 API 封装）
- 启动时自动扫描注册进 SQLite，界面可浏览/搜索/手动触发
- 每个技能声明：名称、描述、触发方式、输入参数 schema、输出格式

### 4.2 工作流引擎（Workflows）
- 目录约定：`workflows/<name>.yaml`，声明式步骤链
- 步骤类型：`shell` / `http` / `llm` / `template` / `skill`（复用已注册技能）
- 步骤间通过上下文变量传递数据（`{{steps.x.output}}`）
- 每次运行落库：状态、耗时、每步日志，失败可定位到具体步骤
- 触发方式：手动 / 定时（node-cron）/ 任务状态变更触发
- 注意：shell 步骤在容器内跑，涉及宿主机操作的能力后续按需通过 SSH 白名单技能单独放行

### 4.3 知识库（Knowledge）
- 目录约定：`knowledge/` 下全是 Markdown，支持子目录分类
- 元数据：front-matter（标签、日期、关联项目）
- 检索：一期 SQLite FTS5 全文检索；二期可选 embedding 语义检索
- 快速捕获入口：手机/网页一键记录，自动落成带日期的 md 文件（公网部署后这是高频场景）

### 4.4 任务与项目（Tasks & Projects）
- 数据模型：`projects` → `tasks`（状态：待办/进行中/等待/完成）
- 视图：列表 + 看板；项目页聚合该项目下的任务、文档、相关技能
- 联动：任务完成可自动触发工作流（如"周报生成"、"归档整理"）

### 4.5 Dashboard 总览
- 今日待办 + 进行中项目进度
- 最近工作流运行状态（成功/失败）
- 快捷入口：高频技能一键触发、快速捕获笔记、全局搜索（跨任务+知识库）

## 5. 数据模型（核心表）

- `users`：账号（BCrypt 密码、角色、禁用状态）；无 sessions 表——统一走后端 JWT（无状态验签）
- `skills`：注册表（name, type, description, config, last_run_at）——后台 CRUD + 工作台缺失播种
- `workflows`：定义镜像 + 版本
- `runs`：工作流运行记录（workflow_id, status, started_at, duration, trigger, logs）
- `projects` / `tasks`：项目与任务
- `docs`：知识库文档（title, category, tags, content）；检索走 LIKE 子串，摘要高亮由前端生成

## 6. 目录结构

```
alon-workbench/
├── PLAN.md                # 本规划
├── app/                   # Next.js 应用（前端 + API）
├── core/                  # 引擎层：执行器 / 注册表 / 检索 / AI 网关（连 MySQL）
├── skills/                # 技能定义（YAML + 脚本）—— volume 挂载
├── workflows/             # 工作流定义（YAML）—— volume 挂载
├── knowledge/             # 知识库（Markdown）—— volume 挂载
├── data/                  # （遗留）旧 SQLite 库；已统一到 MySQL，可删除
├── Dockerfile
├── docker-compose.yml     # app + caddy
├── Caddyfile
└── .env.example           # 环境变量模板（真实 .env 不进 git）
```

## 7. 路线图（里程碑）

| 里程碑 | 内容 | 交付物 |
|--------|------|--------|
| M1 骨架 + 部署底座 | Next.js + SQLite + 基础布局 + 多账号认证（首次初始化/登录/用户管理）+ Dockerfile/compose/Caddy | 可从公网访问、多账号登录的空工作台 |
| M2 任务与项目 | 项目/任务 CRUD + 列表/看板视图 | 能管日常任务 |
| M3 技能中心 | 目录扫描注册 + 技能页 + 手动触发 | 技能统一入口 |
| M4 工作流引擎 | YAML 解析 + 执行器 + 运行历史页 | 流程一键化 |
| M5 知识库 | md 索引 + FTS5 搜索 + 快速捕获 | 知识可检索 |
| M6 AI + 运维打磨 | AI 网关接入 + 定时调度 + 自动备份 + 监控告警 | 完整自托管工作台 |

M1 完成即完成全链路部署验证（域名、证书、登录一次打通），之后每个里程碑只是"往运行的系统里加功能"，不再碰部署。

## 8. AI 工具化集成原则

- 所有 LLM 调用收口到 `core/ai` 网关：统一模型配置、超时、重试、成本记录
- 只在明确环节用：文档摘要、周报生成、检索改写、文本处理
- 工作流编排本身**不依赖** LLM，保证确定性

## 9. 待定决策点

1. **域名**：是否已有域名和一台可公网访问的服务器？（M1 前需要确认，影响 Caddy 配置）
2. **备份目的地**：仅服务器本地保留，还是同步到对象存储/另一台机器（rclone）？
3. **知识库检索**二期是否上 embedding（涉及容器内模型体积）
4. **服务器配置**：CPU/内存/磁盘规格（影响 embedding 方案的可行性）
