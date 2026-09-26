package com.alon.admin.migration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * 幂等补列迁移：为 skills / workflows / tasks / projects / docs 五表补齐
 * 可见性体系两列 {@code visibility}（personal|public，默认 public）与 {@code owner_id}（users.id）。
 *
 * <p>背景：MySQL 8 没有 {@code ADD COLUMN IF NOT EXISTS}，schema.sql 只负责"新装即含列"，
 * 对已存在的旧库需要启动时自动补列。实现为 ApplicationRunner，随 admin 后端每次启动执行：
 * <ol>
 *   <li>通过 information_schema.columns 逐表逐列探测，缺列才执行对应 ALTER，重复启动无副作用；</li>
 *   <li>回填兜底：{@code UPDATE <t> SET visibility='public' WHERE visibility IS NULL}
 *       （防止历史上被手工改动过）；owner_id 不做回填（NULL = 系统通用数据）；</li>
 *   <li>每步独立 try/catch 记 WARN，任何一步失败都不阻断应用启动。</li>
 * </ol>
 * 兜底：前台 alon-workbench 读端用 withColumnFallback 对缺列 SELECT 自动降级（降级期不过滤），
 * 写端遇 1054 走 ensureVisibilityColumns() 自愈重试，与本次迁移构成三保险（详见 ARCHITECTURE §1.2）。
 */
@Component
public class VisibilityColumnMigrator implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(VisibilityColumnMigrator.class);

    /** 需要补列的五张表：表名 + visibility/owner_id 列放置于哪一列之后 */
    private static final List<Map<String, String>> TABLES = List.of(
            Map.of("table", "skills", "after", "source"),
            Map.of("table", "workflows", "after", "source"),
            Map.of("table", "tasks", "after", "completed_at"),
            Map.of("table", "projects", "after", "status"),
            Map.of("table", "docs", "after", "source"));

    private static final String VISIBILITY_COLUMN = "visibility";
    private static final String OWNER_COLUMN = "owner_id";
    private static final String VISIBILITY_DDL =
            "visibility VARCHAR(16) NOT NULL DEFAULT 'public' COMMENT '可见性：personal=个人 public=通用'";
    private static final String OWNER_DDL =
            "owner_id BIGINT NULL DEFAULT NULL COMMENT '创建人 users.id；NULL 视同系统通用数据'";

    private final JdbcTemplate jdbc;

    public VisibilityColumnMigrator(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        String schema;
        try {
            schema = jdbc.queryForObject("SELECT DATABASE()", String.class);
        } catch (Exception e) {
            log.warn("visibility 列迁移跳过：无法获取当前数据库（{}）", e.getMessage());
            return;
        }
        if (schema == null || schema.isBlank()) {
            log.warn("visibility 列迁移跳过：当前连接未选择数据库");
            return;
        }
        for (Map<String, String> t : TABLES) {
            String table = t.get("table");
            ensureColumn(schema, table, VISIBILITY_COLUMN, VISIBILITY_DDL, t.get("after"));
            ensureColumn(schema, table, OWNER_COLUMN, OWNER_DDL, t.get("after"));
            backfillVisibility(table);
        }
    }

    /** 单表单列幂等补列：information_schema 缺列才 ALTER，异常记 WARN 不抛出 */
    private void ensureColumn(String schema, String table, String column, String ddl, String after) {
        try {
            Integer count = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM information_schema.columns "
                            + "WHERE table_schema = ? AND table_name = ? AND column_name = ?",
                    Integer.class, schema, table, column);
            if (count != null && count > 0) {
                log.info("表 {} 已包含 {} 列，跳过补列", table, column);
                return;
            }
            jdbc.execute("ALTER TABLE `" + table + "` ADD COLUMN " + ddl + " AFTER `" + after + "`");
            log.info("表 {} 补列完成：{}", table, ddl);
        } catch (Exception e) {
            log.warn("表 {} {} 补列失败（不阻断启动）：{}", table, column, e.getMessage());
        }
    }

    /** visibility 回填兜底：NULL 刷为 public（owner_id 保持 NULL = 系统通用数据），失败记 WARN 不抛出 */
    private void backfillVisibility(String table) {
        try {
            int updated = jdbc.update(
                    "UPDATE `" + table + "` SET visibility = 'public' WHERE visibility IS NULL");
            if (updated > 0) {
                log.info("表 {} visibility 回填 public：{} 行", table, updated);
            }
        } catch (Exception e) {
            log.warn("表 {} visibility 回填失败（不阻断启动）：{}", table, e.getMessage());
        }
    }
}
