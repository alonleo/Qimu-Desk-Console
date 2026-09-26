package com.alon.admin.migration;

import com.alon.admin.entity.AiConfig;
import com.alon.admin.mapper.AiConfigMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.sql.*;
import java.util.*;

/** 首次启动：把工作台 SQLite 数据迁移到 MySQL（幂等：users 已有数据则跳过） */
@Component
public class SqliteMigrator {

    private static final Logger log = LoggerFactory.getLogger(SqliteMigrator.class);

    private final JdbcTemplate jdbc;
    private final AiConfigMapper aiConfigMapper;
    private final PasswordEncoder passwordEncoder;
    /** 迁移初始密码（可选）。为空时按用户生成随机一次性密码。 */
    private final String migrateDefaultPassword;
    private final SecureRandom random = new SecureRandom();
    private static final String PWD_CHARS =
            "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

    public SqliteMigrator(
            JdbcTemplate jdbc,
            AiConfigMapper aiConfigMapper,
            PasswordEncoder passwordEncoder,
            @org.springframework.beans.factory.annotation.Value("${app.migration.default-password:}") String migrateDefaultPassword) {
        this.jdbc = jdbc;
        this.aiConfigMapper = aiConfigMapper;
        this.passwordEncoder = passwordEncoder;
        this.migrateDefaultPassword = migrateDefaultPassword == null ? "" : migrateDefaultPassword.trim();
    }

    @Transactional
    public void migrate(String sqlitePath) {
        try {
            // 1. 执行 DDL（幂等）
            String ddl = new String(new ClassPathResource("db/schema.sql").getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            // schema.sql 含建库语句，只执行表部分（jdbc 已连库）
            String tablePart = ddl.substring(ddl.indexOf("CREATE TABLE"));
            for (String stmt : tablePart.split(";")) {
                String s = stmt.trim();
                if (!s.isBlank()) {
                    try {
                        jdbc.execute(s);
                    } catch (Exception e) {
                        log.warn("DDL 跳过（可能已存在）：{}", e.getMessage());
                    }
                }
            }

            // 2. 幂等检查
            Long userCount = jdbc.queryForObject("SELECT COUNT(*) FROM users", Long.class);
            if (userCount != null && userCount > 0) {
                log.info("users 表已有 {} 条记录，跳过数据迁移", userCount);
                return;
            }

            Path dbPath = Path.of(sqlitePath);
            if (!Files.exists(dbPath)) {
                log.warn("SQLite 文件不存在（{}），跳过迁移", sqlitePath);
                return;
            }

            Class.forName("org.sqlite.JDBC");
            try (Connection sqlite = DriverManager.getConnection("jdbc:sqlite:" + dbPath.toAbsolutePath())) {
                migrateUsers(sqlite);
                migrateProjects(sqlite);
                migrateTasks(sqlite);
                migrateSkills(sqlite);
                migrateWorkflows(sqlite);
                migrateDocs(sqlite);
                migrateCategories(sqlite);
                migrateAiConfig(sqlite);
                migrateRuns(sqlite);
            }
            log.info("✅ 数据迁移完成：users/tasks/skills/workflows/docs/categories 已从 SQLite 导入 MySQL");
        } catch (Exception e) {
            throw new RuntimeException("数据迁移失败：" + e.getMessage(), e);
        }
    }

    private void migrateUsers(Connection sqlite) throws SQLException {
        // 一次性凭据收集：仅当走“随机密码”分支时输出，避免在常规日志中打印明文
        StringBuilder once = new StringBuilder();
        int migrated = 0;
        try (Statement st = sqlite.createStatement(); ResultSet rs = st.executeQuery(
                "SELECT username, role, display_name, disabled, created_at FROM users ORDER BY id")) {
            while (rs.next()) {
                String username = rs.getString("username");
                // 原 SQLite 为 scrypt 哈希，与后端 BCrypt 不兼容，迁移时统一重置为 BCrypt。
                // 优先使用 MIGRATE_DEFAULT_PASSWORD 环境变量；未设置则按用户生成随机一次性密码。
                String rawPwd = !migrateDefaultPassword.isEmpty()
                        ? migrateDefaultPassword
                        : randomPassword(16);
                String bcrypt = passwordEncoder.encode(rawPwd);
                jdbc.update("INSERT INTO users (username, password_hash, role, display_name, disabled, created_at) VALUES (?,?,?,?,?,?)",
                        username, bcrypt, rs.getString("role") == null ? "member" : rs.getString("role"),
                        rs.getString("display_name"),
                        rs.getInt("disabled"),
                        toLocal(rs.getString("created_at")));
                migrated++;
                if (migrateDefaultPassword.isEmpty()) {
                    once.append("  - ").append(username).append(" / ").append(rawPwd).append('\n');
                }
            }
        }
        log.info("  - users 已导入 {} 条（密码已重置为 BCrypt）", migrated);
        if (migrateDefaultPassword.isEmpty()) {
            log.warn("  本次迁移为每个用户生成了随机初始密码（一次性凭据，仅本次启动可见，请立即保存并登录后修改）：\n{}", once);
        } else {
            log.warn("  迁移初始密码来自 MIGRATE_DEFAULT_PASSWORD 环境变量，请勿在生产长期使用，并尽快为账号改密。");
        }
    }

    /** 生成 16 位随机密码（排除易混淆字符 0/O/1/l/I），仅迁移场景使用 */
    private String randomPassword(int len) {
        StringBuilder sb = new StringBuilder(len);
        for (int i = 0; i < len; i++) {
            sb.append(PWD_CHARS.charAt(random.nextInt(PWD_CHARS.length())));
        }
        return sb.toString();
    }

    private void migrateProjects(Connection sqlite) throws SQLException {
        try (Statement st = sqlite.createStatement(); ResultSet rs = st.executeQuery(
                "SELECT id, name, description, color, status, created_at, updated_at FROM projects ORDER BY id")) {
            while (rs.next()) {
                jdbc.update("INSERT INTO projects (id, name, description, color, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                        rs.getLong("id"), rs.getString("name"), rs.getString("description"), rs.getString("color"),
                        rs.getString("status") == null ? "active" : rs.getString("status"),
                        toLocal(rs.getString("created_at")), toLocal(rs.getString("updated_at")));
            }
        }
    }

    private void migrateTasks(Connection sqlite) throws SQLException {
        try (Statement st = sqlite.createStatement(); ResultSet rs = st.executeQuery(
                "SELECT id, project_id, title, notes, status, priority, due_date, created_at, updated_at, completed_at FROM tasks ORDER BY id")) {
            while (rs.next()) {
                jdbc.update("INSERT INTO tasks (id, project_id, title, notes, status, priority, due_date, created_at, updated_at, completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        rs.getLong("id"), rs.getObject("project_id") == null ? null : rs.getLong("project_id"),
                        rs.getString("title"), rs.getString("notes"),
                        rs.getString("status") == null ? "todo" : rs.getString("status"),
                        rs.getString("priority") == null ? "normal" : rs.getString("priority"),
                        rs.getString("due_date"),
                        toLocal(rs.getString("created_at")), toLocal(rs.getString("updated_at")),
                        toLocal(rs.getString("completed_at")));
            }
        }
    }

    private void migrateSkills(Connection sqlite) throws SQLException {
        try (Statement st = sqlite.createStatement(); ResultSet rs = st.executeQuery(
                "SELECT id, name, type, description, config, last_run_at, created_at, updated_at FROM skills ORDER BY id")) {
            while (rs.next()) {
                jdbc.update("INSERT INTO skills (id, name, type, description, config, last_run_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                        rs.getLong("id"), rs.getString("name"), rs.getString("type"), rs.getString("description"),
                        rs.getString("config"), toLocal(rs.getString("last_run_at")),
                        toLocal(rs.getString("created_at")), toLocal(rs.getString("updated_at")));
            }
        }
    }

    private void migrateWorkflows(Connection sqlite) throws SQLException {
        try (Statement st = sqlite.createStatement(); ResultSet rs = st.executeQuery(
                "SELECT id, name, description, definition, version, created_at, updated_at FROM workflows ORDER BY id")) {
            while (rs.next()) {
                jdbc.update("INSERT INTO workflows (id, name, description, definition, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                        rs.getLong("id"), rs.getString("name"), rs.getString("description"), rs.getString("definition"),
                        rs.getInt("version"), toLocal(rs.getString("created_at")), toLocal(rs.getString("updated_at")));
            }
        }
    }

    private void migrateDocs(Connection sqlite) throws SQLException {
        try (Statement st = sqlite.createStatement(); ResultSet rs = st.executeQuery(
                "SELECT id, title, category, tags, content, pinned, created_by, created_at, updated_at FROM docs ORDER BY id")) {
            while (rs.next()) {
                jdbc.update("INSERT INTO docs (id, title, category, tags, content, pinned, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                        rs.getLong("id"), rs.getString("title"), rs.getString("category"), rs.getString("tags"),
                        rs.getString("content") == null ? "" : rs.getString("content"),
                        rs.getInt("pinned"), rs.getString("created_by"),
                        toLocal(rs.getString("created_at")), toLocal(rs.getString("updated_at")));
            }
        }
    }

    private void migrateCategories(Connection sqlite) throws SQLException {
        Set<String> names = new LinkedHashSet<>();
        try (Statement st = sqlite.createStatement(); ResultSet rs = st.executeQuery("SELECT name FROM categories ORDER BY id")) {
            while (rs.next()) names.add(rs.getString("name"));
        }
        // 兜底：docs 里出现过的分类
        try (Statement st = sqlite.createStatement(); ResultSet rs = st.executeQuery("SELECT DISTINCT category FROM docs WHERE category IS NOT NULL AND category != ''")) {
            while (rs.next()) names.add(rs.getString("category"));
        }
        names.add("未分类");
        for (String n : names) {
            jdbc.update("INSERT IGNORE INTO categories (name) VALUES (?)", n);
        }
    }

    private void migrateAiConfig(Connection sqlite) throws SQLException {
        AiConfig cfg = aiConfigMapper.selectById(1);
        if (cfg != null) return;
        String provider = "openai-compatible", baseUrl = "", apiKey = "", model = "";
        double temperature = 0.7;
        int enabled = 0;
        try (Statement st = sqlite.createStatement(); ResultSet rs = st.executeQuery(
                "SELECT provider, base_url, api_key, model, temperature, enabled FROM ai_config WHERE id = 1")) {
            if (rs.next()) {
                provider = nz(rs.getString("provider"), provider);
                baseUrl = nz(rs.getString("base_url"), "");
                apiKey = nz(rs.getString("api_key"), "");
                model = nz(rs.getString("model"), "");
                temperature = rs.getObject("temperature") == null ? 0.7 : rs.getDouble("temperature");
                enabled = rs.getInt("enabled");
            }
        } catch (Exception e) {
            log.warn("SQLite ai_config 读取失败（忽略）：{}", e.getMessage());
        }
        jdbc.update("INSERT INTO ai_config (id, name, provider, base_url, api_key, model, temperature, enabled, is_default) VALUES (1,'默认网关',?,?,?,?,?,?,1)",
                provider, baseUrl, apiKey, model, temperature, enabled);
    }

    private void migrateRuns(Connection sqlite) throws SQLException {
        try (Statement st = sqlite.createStatement(); ResultSet rs = st.executeQuery(
                "SELECT id, workflow_id, status, \"trigger\", started_at, finished_at, duration_ms, logs, triggered_by FROM runs ORDER BY id")) {
            while (rs.next()) {
                jdbc.update("INSERT INTO runs (id, workflow_id, status, `trigger`, started_at, finished_at, duration_ms, logs, triggered_by) VALUES (?,?,?,?,?,?,?,?,?)",
                        rs.getLong("id"), rs.getObject("workflow_id") == null ? null : rs.getLong("workflow_id"),
                        rs.getString("status") == null ? "success" : rs.getString("status"),
                        rs.getString("trigger"), toLocal(rs.getString("started_at")), toLocal(rs.getString("finished_at")),
                        rs.getObject("duration_ms") == null ? null : rs.getLong("duration_ms"),
                        rs.getString("logs"), rs.getString("triggered_by"));
            }
        } catch (Exception e) {
            log.warn("runs 迁移跳过：{}", e.getMessage());
        }
    }

    private java.sql.Timestamp toLocal(String v) {
        if (v == null || v.isBlank()) return null;
        try {
            String s = v.trim();
            if (s.length() == 19) s = s.replace(" ", "T");
            return java.sql.Timestamp.valueOf(s.replace("T", " ").substring(0, 19));
        } catch (Exception e) {
            return null;
        }
    }

    private String nz(String v, String def) {
        return v == null || v.isBlank() ? def : v;
    }
}
