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
 * 幂等补列迁移：为 skills / workflows / docs 三表补齐统一来源列 source（manual|file|ai）。
 *
 * <p>背景：MySQL 8 没有 {@code ADD COLUMN IF NOT EXISTS}，schema.sql 只负责"新装即含列"，
 * 对已存在的旧库需要启动时自动补列。实现为 ApplicationRunner，随 admin 后端每次启动执行：
 * <ol>
 *   <li>通过 information_schema.columns 检查当前库内三表是否已含 source 列；</li>
 *   <li>缺列才执行对应 ALTER，重复启动无副作用；</li>
 *   <li>每步独立 try/catch 记 WARN，任何一步失败都不阻断应用启动。</li>
 * </ol>
 * 兜底：前台 alon-workbench 读端用 withColumnFallback 对缺列 SELECT 自动降级，
 * 与本次迁移构成双保险（详见 ARCHITECTURE §3.1）。
 */
@Component
public class SourceColumnMigrator implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SourceColumnMigrator.class);

    /** 需要补列的三张表：表名 + ALTER 时 source 列放置于哪一列之后 */
    private static final List<Map<String, String>> TABLES = List.of(
            Map.of("table", "skills", "after", "config"),
            Map.of("table", "workflows", "after", "definition"),
            Map.of("table", "docs", "after", "created_by"));

    private static final String COLUMN_DDL = "source VARCHAR(16) NOT NULL DEFAULT 'manual'";

    private final JdbcTemplate jdbc;

    public SourceColumnMigrator(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        String schema;
        try {
            schema = jdbc.queryForObject("SELECT DATABASE()", String.class);
        } catch (Exception e) {
            log.warn("source 列迁移跳过：无法获取当前数据库（{}）", e.getMessage());
            return;
        }
        if (schema == null || schema.isBlank()) {
            log.warn("source 列迁移跳过：当前连接未选择数据库");
            return;
        }
        for (Map<String, String> t : TABLES) {
            ensureSourceColumn(schema, t.get("table"), t.get("after"));
        }
    }

    /** 单表幂等补列：information_schema 缺列才 ALTER，异常记 WARN 不抛出 */
    private void ensureSourceColumn(String schema, String table, String after) {
        try {
            Integer count = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM information_schema.columns "
                            + "WHERE table_schema = ? AND table_name = ? AND column_name = 'source'",
                    Integer.class, schema, table);
            if (count != null && count > 0) {
                log.info("表 {} 已包含 source 列，跳过补列", table);
                return;
            }
            jdbc.execute("ALTER TABLE `" + table + "` ADD COLUMN " + COLUMN_DDL + " AFTER `" + after + "`");
            log.info("表 {} 补列完成：{}", table, COLUMN_DDL);
        } catch (Exception e) {
            log.warn("表 {} source 补列失败（不阻断启动）：{}", table, e.getMessage());
        }
    }
}
