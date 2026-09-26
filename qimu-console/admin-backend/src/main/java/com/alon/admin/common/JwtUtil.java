package com.alon.admin.common;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Locale;
import java.util.Set;

/** JWT 签发与解析 */
@Component
public class JwtUtil {

    /** 与 alon-workbench/core/auth.ts 的 DEV_JWT_SECRET 保持一致，仅本地开发使用 */
    static final String DEV_SECRET = "alon-workbench-dev-only-secret-0123456789abcdef";
    private static final Set<String> PROD_ENVS = Set.of("production", "prod");

    private final SecretKey key;
    private final long expireMillis;

    public JwtUtil(
            @Value("${app.jwt.secret}") String secret,
            @Value("${app.jwt.expire-hours:72}") long expireHours,
            @Value("${app.env:development}") String appEnv) {
        if (isProdLike(appEnv)) {
            if (secret == null || secret.isBlank()) {
                throw new IllegalStateException(
                        "JWT_SECRET 未配置：生产环境（APP_ENV=" + appEnv + "）必须通过环境变量注入 JWT_SECRET");
            }
            if (secret.equals(DEV_SECRET)) {
                throw new IllegalStateException(
                        "JWT_SECRET 仍是开发默认值：生产环境禁止使用可预测密钥，请设置随机 JWT_SECRET（≥32 位）");
            }
        }
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("app.jwt.secret 为空，无法初始化 JWT");
        }
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expireMillis = expireHours * 3600_000L;
    }

    private static boolean isProdLike(String env) {
        return env != null && PROD_ENVS.contains(env.trim().toLowerCase(Locale.ROOT));
    }

    public String generate(Long userId, String username, String role) {
        Date now = new Date();
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .claim("username", username)
                .claim("role", role)
                .issuedAt(now)
                .expiration(new Date(now.getTime() + expireMillis))
                .signWith(key)
                .compact();
    }

    /** 解析并校验；非法或过期返回 null */
    public Claims parse(String token) {
        try {
            return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
        } catch (Exception e) {
            return null;
        }
    }

    public Long userId(Claims c) {
        return Long.valueOf(c.getSubject());
    }

    public String username(Claims c) {
        return c.get("username", String.class);
    }

    public String role(Claims c) {
        return c.get("role", String.class);
    }
}
