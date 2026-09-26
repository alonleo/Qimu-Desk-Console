package com.alon.admin.migration;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** 只增加预算列，旧网关使用自动策略；保留密钥、模型与业务数据。 */
@Component
public class AiLimitsMigrator implements ApplicationRunner {
    private final JdbcTemplate jdbc;
    public AiLimitsMigrator(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public void run(ApplicationArguments args) {
        for (String column : new String[]{"max_input_tokens", "max_output_tokens", "timeout_seconds"}) {
            Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ai_config' AND column_name=?", Integer.class, column);
            if (count != null && count == 0) jdbc.execute("ALTER TABLE ai_config ADD COLUMN " + column + " INT NOT NULL DEFAULT 0");
        }
    }
}
