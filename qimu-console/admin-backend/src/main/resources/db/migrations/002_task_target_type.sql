-- 定时任务关联技能/工作流：target_type / target_id / params
-- target_type: 'skill' | 'workflow' | NULL（NULL = 无关联，仅保留 cron）
-- target_id:  对应 skills.id / workflows.id
-- params:     JSON，技能/工作流执行时的参数
ALTER TABLE scheduled_tasks
  ADD COLUMN target_type VARCHAR(16) DEFAULT NULL COMMENT '目标类型：skill | workflow | NULL',
  ADD COLUMN target_id BIGINT DEFAULT NULL COMMENT '技能或工作流的 id',
  ADD COLUMN params TEXT DEFAULT NULL COMMENT '执行参数 JSON',
  ADD INDEX idx_scheduled_tasks_target (target_type, target_id);
