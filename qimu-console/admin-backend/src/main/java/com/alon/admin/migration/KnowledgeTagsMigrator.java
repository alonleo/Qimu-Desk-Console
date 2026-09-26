package com.alon.admin.migration;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** 保存尚未被文档使用的共享标签；已有文档标签继续直接参与列表统计。 */
@Component
public class KnowledgeTagsMigrator implements ApplicationRunner {
    private final JdbcTemplate jdbc;
    public KnowledgeTagsMigrator(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    @Override public void run(ApplicationArguments args) {
        jdbc.execute("CREATE TABLE IF NOT EXISTS knowledge_tags (" +
                "name VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY," +
                "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    }
}
