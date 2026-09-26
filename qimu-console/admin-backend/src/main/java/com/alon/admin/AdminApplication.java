package com.alon.admin;

import com.alon.admin.migration.SqliteMigrator;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

@SpringBootApplication
public class AdminApplication {

    public static void main(String[] args) {
        SpringApplication.run(AdminApplication.class, args);
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /** 首次启动：从工作台 SQLite 迁移数据（幂等，迁移完成后关闭开关） */
    @Bean
    public CommandLineRunner migrateRunner(
            @Value("${app.migration.enabled:false}") boolean enabled,
            @Value("${app.migration.sqlite-path:}") String sqlitePath,
            SqliteMigrator migrator) {
        return args -> {
            if (enabled && sqlitePath != null && !sqlitePath.isBlank()) {
                migrator.migrate(sqlitePath);
            }
        };
    }
}
