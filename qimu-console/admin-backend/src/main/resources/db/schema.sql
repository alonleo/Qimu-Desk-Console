CREATE DATABASE IF NOT EXISTS qimu_platform DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE qimu_platform;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'member',
  display_name VARCHAR(64),
  disabled TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  color VARCHAR(32),
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  visibility VARCHAR(16) NOT NULL DEFAULT 'public' COMMENT '可见性：personal=个人 public=通用',
  owner_id BIGINT NULL DEFAULT NULL COMMENT '创建人 users.id；NULL 视同系统通用数据',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  assignee_id BIGINT NULL,
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT,
  title VARCHAR(255) NOT NULL,
  notes TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'todo',
  priority VARCHAR(16) NOT NULL DEFAULT 'normal',
  period VARCHAR(16),
  due_date VARCHAR(32),
  start_date VARCHAR(32),
  visibility VARCHAR(16) NOT NULL DEFAULT 'public' COMMENT '可见性：personal=个人 public=通用',
  owner_id BIGINT NULL DEFAULT NULL COMMENT '创建人 users.id；NULL 视同系统通用数据',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME,
  INDEX idx_tasks_project (project_id),
  INDEX idx_tasks_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 定时任务（周期执行模板，支持关联技能/工作流）
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  notes TEXT,
  cron VARCHAR(64) NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  last_run_at DATETIME,
  target_type VARCHAR(16) DEFAULT NULL COMMENT '目标类型：skill | workflow | NULL',
  target_id BIGINT DEFAULT NULL COMMENT '技能或工作流的 id',
  params TEXT DEFAULT NULL COMMENT '执行参数 JSON',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_scheduled_tasks_enabled (enabled),
  INDEX idx_scheduled_tasks_target (target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS skills (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  type VARCHAR(16) NOT NULL,
  description TEXT,
  config TEXT,
  source VARCHAR(16) NOT NULL DEFAULT 'manual',
  last_run_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS skill_runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  skill_id BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  input TEXT,
  output TEXT,
  error TEXT,
  triggered_by VARCHAR(64),
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  duration_ms BIGINT,
  INDEX idx_skill_runs_skill (skill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS workflows (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  description TEXT,
  definition MEDIUMTEXT,
  source VARCHAR(16) NOT NULL DEFAULT 'manual',
  visibility VARCHAR(16) NOT NULL DEFAULT 'public' COMMENT '可见性：personal=个人 public=通用',
  owner_id BIGINT NULL DEFAULT NULL COMMENT '创建人 users.id；NULL 视同系统通用数据',
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  workflow_id BIGINT,
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  `trigger` VARCHAR(32),
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  duration_ms BIGINT,
  logs MEDIUMTEXT,
  triggered_by VARCHAR(64),
  INDEX idx_runs_workflow (workflow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS docs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(64) NOT NULL DEFAULT '未分类',
  tags VARCHAR(255) NOT NULL DEFAULT '',
  content LONGTEXT NOT NULL,
  pinned TINYINT NOT NULL DEFAULT 0,
  created_by VARCHAR(64),
  source VARCHAR(16) NOT NULL DEFAULT 'manual',
  visibility VARCHAR(16) NOT NULL DEFAULT 'public' COMMENT '可见性：personal=个人 public=通用',
  owner_id BIGINT NULL DEFAULT NULL COMMENT '创建人 users.id；NULL 视同系统通用数据',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FULLTEXT INDEX ft_docs (title, tags, content)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS categories (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL DEFAULT '默认网关',
  provider VARCHAR(32) NOT NULL DEFAULT 'openai-compatible',
  base_url VARCHAR(255) NOT NULL DEFAULT '',
  api_key VARCHAR(255) NOT NULL DEFAULT '',
  model VARCHAR(64) NOT NULL DEFAULT '',
  temperature DOUBLE NOT NULL DEFAULT 0.7,
  enabled TINYINT NOT NULL DEFAULT 0,
  is_default TINYINT NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 通知公告（管理后台 admin 发布，工作台全员可读）
CREATE TABLE IF NOT EXISTS notice (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(16) NOT NULL DEFAULT 'notification' COMMENT 'notification=通知 / announcement=公告',
  title VARCHAR(255) NOT NULL,
  content MEDIUMTEXT,
  is_pinned TINYINT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'published' COMMENT 'draft=草稿(预留) / published=已发布',
  publisher_id BIGINT COMMENT '发布人 users.id',
  publish_time DATETIME COMMENT '发布时间（首次发布时写入）',
  expire_time DATETIME NULL COMMENT '过期时间（预留，可空）',
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_notice_type_status (type, status),
  INDEX idx_notice_publish_time (publish_time),
  INDEX idx_notice_pinned (is_pinned)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 阅读回执表（notice 阅读状态）：公告强制阅读 / 通知弹窗已读的落点，
-- (notice_id, user_id) 联合唯一保证幂等；无外键（与既有表风格一致）。
CREATE TABLE IF NOT EXISTS notice_read (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  notice_id BIGINT NOT NULL COMMENT 'notice.id',
  user_id BIGINT NOT NULL COMMENT 'users.id 阅读人',
  read_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_notice_read (notice_id, user_id),
  INDEX idx_notice_read_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 在线聊天（chat-module）：单聊会话 + 消息，无外键（与既有表风格一致）
-- ============================================================

-- 会话表：单聊两人会话固定 user_a_id = 较小用户 id、user_b_id = 较大用户 id，
-- 保证同一对用户只会产生一行（应用层写前做 min/max 归一化）。
-- v2 增量：type 区分单聊/群聊（存量行默认 'single'）；群会话行 user_a_id/user_b_id 固定填 0，
-- 故单聊配对唯一键改为普通索引 idx_chat_conv_ab（防重由应用层先查后插 + 冲突查回保证）。
CREATE TABLE IF NOT EXISTS chat_conversations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_a_id BIGINT NOT NULL,
  user_b_id BIGINT NOT NULL,
  type VARCHAR(16) NOT NULL DEFAULT 'single' COMMENT 'single | group',
  group_name VARCHAR(64) NULL DEFAULT NULL COMMENT '群名（type=group 时非空，1~30 字符）',
  owner_id BIGINT NULL DEFAULT NULL COMMENT '群主 users.id（type=group 时非空）',
  last_message_id BIGINT,
  last_message_preview VARCHAR(128),
  last_message_at DATETIME,
  user_a_deleted_at DATETIME NULL DEFAULT NULL COMMENT '该侧用户从列表移除时间，新消息时清空恢复',
  user_b_deleted_at DATETIME NULL DEFAULT NULL COMMENT '该侧用户从列表移除时间，新消息时清空恢复',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_chat_conv_ab (user_a_id, user_b_id),
  INDEX idx_chat_conv_a (user_a_id, last_message_at),
  INDEX idx_chat_conv_b (user_b_id, last_message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 消息表：is_read 表示"已被对方阅读"（对发送者视角为已读）。
-- 未读数 = 会话内 sender_id <> 当前用户 且 is_read = 0 的行数。
-- client_id：发送端生成的幂等键（断线重发不产生重复消息）。
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT NOT NULL,
  sender_id BIGINT NOT NULL,
  content VARCHAR(2000) NOT NULL,
  is_read TINYINT NOT NULL DEFAULT 0,
  client_id VARCHAR(64),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_chat_msg_conv (conversation_id, id),
  INDEX idx_chat_msg_unread (conversation_id, sender_id, is_read),
  UNIQUE KEY uk_chat_msg_client (conversation_id, sender_id, client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- chat-module v2：群聊成员表（无外键，与既有表风格一致）
-- ============================================================

-- 群成员关系：群会话(type='group')的成员行；单聊会话不写本表。
-- last_read_message_id：该成员在该群的已读游标（已读至的消息 id），
-- 群未读数 = 会话内 id > 游标 且 sender_id <> 该成员 的消息条数。
CREATE TABLE IF NOT EXISTS chat_conversation_members (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT NOT NULL COMMENT 'chat_conversations.id (type=group)',
  user_id BIGINT NOT NULL COMMENT 'users.id 成员',
  role VARCHAR(16) NOT NULL DEFAULT 'member' COMMENT 'owner | member（本期仅记录）',
  last_read_message_id BIGINT NOT NULL DEFAULT 0 COMMENT '已读游标',
  deleted_at DATETIME NULL DEFAULT NULL COMMENT '该成员从列表移除时间，新消息时清空恢复',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_chat_member (conversation_id, user_id),
  INDEX idx_chat_member_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 删除墓碑：管理后台删除技能/工作流时记录 name，alon-workbench 文件播种据此跳过，
-- 避免「后台删除 → skills/、workflows/ 目录播种又复活」。同名重新创建时应用层会删除墓碑。
CREATE TABLE IF NOT EXISTS deleted_seeds (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(16) NOT NULL COMMENT 'skill | workflow',
  name VARCHAR(191) NOT NULL,
  deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_deleted_seeds (kind, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 系统监控（monitor）：服务监控/定时任务/操作日志/登录日志
-- 复刻 ZlinksPackageSystem 的 monitor 模块核心表，按 admin-platform 风格精简
-- （不引入 Quartz，用 Spring Scheduling 替代）。
-- ============================================================

-- 定时任务表（sys_job）。
-- invoke_target：Bean.method('arg') 字符串，由 SysJobRunner 反射执行；
-- cron_expression：标准 6/7 段 cron，Spring CronExpression 解析；
-- misfire_policy：0 默认 / 1 立即执行一次 / 2 丢弃；
-- concurrent：0 允许 / 1 禁止（同一任务并行执行）。
-- status：0 暂停 / 1 运行；status 切换时由 SysJobRunner 同步调度器。
CREATE TABLE IF NOT EXISTS sys_job (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_name VARCHAR(64) NOT NULL COMMENT '任务名称',
  job_group VARCHAR(64) NOT NULL DEFAULT 'DEFAULT' COMMENT '任务组名',
  invoke_target VARCHAR(500) NOT NULL COMMENT '调用目标字符串：Bean.method(''arg'')',
  cron_expression VARCHAR(255) NOT NULL COMMENT 'cron 表达式',
  misfire_policy VARCHAR(16) NOT NULL DEFAULT '3' COMMENT '0=默认 1=立即触发恢复 2=丢弃 3=不触发',
  concurrent VARCHAR(16) NOT NULL DEFAULT '1' COMMENT '0=允许 1=禁止',
  status VARCHAR(16) NOT NULL DEFAULT '0' COMMENT '0=暂停 1=运行',
  remark VARCHAR(500) DEFAULT NULL,
  create_by VARCHAR(64) DEFAULT NULL,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  update_by VARCHAR(64) DEFAULT NULL,
  update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sys_job_name_group (job_name, job_group)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 任务执行日志（sys_job_log）：每次 run / 调度触发落一行。
CREATE TABLE IF NOT EXISTS sys_job_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id BIGINT NOT NULL COMMENT 'sys_job.id',
  job_name VARCHAR(64) NOT NULL,
  job_group VARCHAR(64) NOT NULL,
  invoke_target VARCHAR(500) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT '0' COMMENT '0=失败 1=成功',
  exception_message MEDIUMTEXT COMMENT '异常堆栈',
  start_time DATETIME NOT NULL,
  stop_time DATETIME DEFAULT NULL,
  cost_ms BIGINT DEFAULT NULL,
  INDEX idx_sys_job_log_job (job_id, start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 操作日志（sys_oper_log）：@Log 注解 + LogAspect 环绕通知落库。
-- title：模块名（@Log.title）；business_type：0 其它 1 新增 2 修改 3 删除 4 授权 5 导出 6 导入 7 强退 8 生成代码 9 清空数据；
-- operator_type：0 其它 1 后台用户 2 手机端用户；
-- req_param 保存完整 JSON（限长 2000），error_msg 限长 2000。
CREATE TABLE IF NOT EXISTS sys_oper_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(64) NOT NULL COMMENT '模块标题',
  business_type VARCHAR(16) NOT NULL DEFAULT '0',
  method VARCHAR(255) NOT NULL COMMENT '方法名（Class.method）',
  request_method VARCHAR(16) DEFAULT NULL COMMENT 'HTTP 方法',
  operator_type VARCHAR(16) NOT NULL DEFAULT '1',
  oper_name VARCHAR(64) DEFAULT NULL COMMENT '操作人 username',
  dept_name VARCHAR(64) DEFAULT NULL,
  oper_url VARCHAR(255) DEFAULT NULL,
  oper_ip VARCHAR(64) DEFAULT NULL,
  oper_param VARCHAR(2000) DEFAULT NULL,
  json_result VARCHAR(2000) DEFAULT NULL,
  status VARCHAR(16) NOT NULL DEFAULT '0' COMMENT '0=正常 1=异常',
  error_msg VARCHAR(2000) DEFAULT NULL,
  cost_ms BIGINT DEFAULT NULL,
  oper_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sys_oper_log_time (oper_time),
  INDEX idx_sys_oper_log_user (oper_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 登录日志（sys_logininfor）：AuthInterceptor 与 AuthController 钩子落库。
-- status：0 失败 1 成功；msg：错误原因 / 提示。
CREATE TABLE IF NOT EXISTS sys_logininfor (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_name VARCHAR(64) NOT NULL,
  ipaddr VARCHAR(64) DEFAULT NULL,
  login_location VARCHAR(64) DEFAULT NULL,
  browser VARCHAR(64) DEFAULT NULL,
  os VARCHAR(64) DEFAULT NULL,
  status VARCHAR(16) NOT NULL DEFAULT '0' COMMENT '0=失败 1=成功',
  msg VARCHAR(255) DEFAULT NULL,
  login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sys_logininfor_time (login_time),
  INDEX idx_sys_logininfor_user (user_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 共享知识标签目录：未关联文档的新标签也持久保留。
CREATE TABLE IF NOT EXISTS knowledge_tags (
  name VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
