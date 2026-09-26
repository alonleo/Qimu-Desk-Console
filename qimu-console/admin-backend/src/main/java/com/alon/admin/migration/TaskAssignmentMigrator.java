package com.alon.admin.migration;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
/** Additive migration. Never changes existing tasks or owners. */
@Component
public class TaskAssignmentMigrator implements ApplicationRunner {
    private final JdbcTemplate jdbc;
    public TaskAssignmentMigrator(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public void run(ApplicationArguments args) {
        for (String[] column : new String[][] {{"assignee_id", "BIGINT NULL"}, {"start_date", "VARCHAR(32) NULL"}, {"period", "VARCHAR(16) NULL"}}) {
            Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='tasks' AND column_name=?", Integer.class, column[0]);
            if (count != null && count == 0) jdbc.execute("ALTER TABLE tasks ADD COLUMN " + column[0] + " " + column[1]);
        }
    }
}
