package com.alon.admin.service;

import com.alon.admin.common.JwtUtil;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.UserMapper;
import io.jsonwebtoken.Claims;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 在线用户注册表（系统监控-在线用户）。
 *
 * <p>基于无状态 JWT：登录时把会话登记进内存；每次通过 {@link com.alon.admin.auth.AuthInterceptor}
 * 的请求刷新活跃时间；强制下线/登出把对应 JWT 加入黑名单，使其立即失效。内存态重启即清空
 * （与 RuoYi Redis 版重启行为一致），对单机管理员后台足够。
 *
 * <p>同时把会话镜像写入 Redis {@code login_tokens:<tokenId>}（TTL 约 72h），供「缓存监控」
 * 页浏览真实键。Redis 全部容错：不可用时仅缓存页降级，在线会话仍走内存，不影响主流程。
 */
@Slf4j
@Component
public class OnlineSessionRegistry {

    public static final String LOGIN_TOKEN_PREFIX = "login_tokens:";
    /** 与 app.jwt.expire-hours 默认值一致；过期后 list() 自动剔除 */
    private static final long TOKEN_TTL_SECONDS = 72 * 3600L;

    private final JwtUtil jwtUtil;
    private final UserMapper userMapper;
    private final StringRedisTemplate redis;

    private final Map<String, OnlineSession> sessions = new ConcurrentHashMap<>(); // tokenId -> session
    private final Map<String, String> jwtToId = new ConcurrentHashMap<>();        // jwt -> tokenId
    private final Set<String> blacklist = ConcurrentHashMap.newKeySet();          // 已强制下线/登出的 jwt

    public OnlineSessionRegistry(JwtUtil jwtUtil, UserMapper userMapper, StringRedisTemplate redis) {
        this.jwtUtil = jwtUtil;
        this.userMapper = userMapper;
        this.redis = redis;
    }

    /** 登录成功登记会话；ip 可为空，UA 用于解析浏览器/操作系统 */
    public void register(String jwt, User user, String ip, String userAgent) {
        if (jwt == null || jwt.isBlank() || user == null) return;
        blacklist.remove(jwt);
        String tokenId = tokenIdOf(jwt);
        String browser = LogininforRecorder.parseBrowser(userAgent);
        String os = LogininforRecorder.parseOs(userAgent);
        OnlineSession s = new OnlineSession(tokenId, jwt, user.getId(), user.getUsername(),
                user.getRole(), ip == null || ip.isBlank() ? "unknown" : ip, browser, os, LocalDateTime.now(), System.currentTimeMillis());
        sessions.put(tokenId, s);
        jwtToId.put(jwt, tokenId);
        mirrorToRedis(tokenId, jwt);
    }

    /** 每次已校验请求刷新活跃时间；未知（重启后残留）则忽略 */
    public void touch(String jwt) {
        String tokenId = jwt == null ? null : jwtToId.get(jwt);
        if (tokenId == null) return;
        OnlineSession s = sessions.get(tokenId);
        if (s != null) s.lastActiveTime = System.currentTimeMillis();
    }

    public boolean isBlacklisted(String jwt) {
        return jwt != null && blacklist.contains(jwt);
    }

    /** 强制下线：把该 JWT 加入黑名单并移除会话，若账号已被禁用/删除则一起清掉 */
    public boolean forceLogout(String tokenId) {
        OnlineSession s = sessions.remove(tokenId);
        if (s == null) return false;
        blacklist.add(s.jwt);
        jwtToId.remove(s.jwt);
        removeFromRedis(tokenId);
        return true;
    }

    /** 主动登出：同样黑名单化使旧 token 失效 */
    public void logout(String jwt) {
        if (jwt == null || jwt.isBlank()) return;
        blacklist.add(jwt);
        String tokenId = jwtToId.remove(jwt);
        if (tokenId != null) {
            sessions.remove(tokenId);
            removeFromRedis(tokenId);
        }
    }

    /** 在线快照：剔除黑名单与已过期会话；按登录时间倒序 */
    public List<OnlineSession> list() {
        List<OnlineSession> result = new ArrayList<>();
        for (OnlineSession s : sessions.values()) {
            if (blacklist.contains(s.jwt)) {
                sessions.remove(s.tokenId);
                jwtToId.remove(s.jwt);
                continue;
            }
            if (isExpired(s.jwt)) {
                sessions.remove(s.tokenId);
                jwtToId.remove(s.jwt);
                removeFromRedis(s.tokenId);
                continue;
            }
            result.add(s);
        }
        result.sort((a, b) -> Long.compare(b.lastActiveTime, a.lastActiveTime));
        return result;
    }

    private boolean isExpired(String jwt) {
        Claims claims = jwtUtil.parse(jwt);
        // parse 返回 null 即签名非法或已过期
        return claims == null;
    }

    private static String tokenIdOf(String jwt) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(jwt.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 8; i++) {
                sb.append(String.format("%02x", digest[i]));
            }
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(jwt.hashCode());
        }
    }

    private void mirrorToRedis(String tokenId, String jwt) {
        try {
            redis.opsForValue().set(LOGIN_TOKEN_PREFIX + tokenId, jwt, Duration.ofSeconds(TOKEN_TTL_SECONDS));
        } catch (Exception e) {
            log.debug("在线会话镜像写 Redis 失败（缓存监控降级）：{}", e.getMessage());
        }
    }

    private void removeFromRedis(String tokenId) {
        try {
            redis.delete(LOGIN_TOKEN_PREFIX + tokenId);
        } catch (Exception e) {
            log.debug("在线会话镜像删除 Redis 失败：{}", e.getMessage());
        }
    }

    /** 会话快照（tokenId 即页面上展示的会话 ID） */
    @Getter
    public static class OnlineSession {
        private final String tokenId;
        private final String jwt;
        private final Long userId;
        private final String userName;
        private final String role;
        private final String ip;
        private final String browser;
        private final String os;
        private final LocalDateTime loginTime;
        private volatile long lastActiveTime;

        OnlineSession(String tokenId, String jwt, Long userId, String userName, String role,
                      String ip, String browser, String os, LocalDateTime loginTime, long lastActiveTime) {
            this.tokenId = tokenId;
            this.jwt = jwt;
            this.userId = userId;
            this.userName = userName;
            this.role = role;
            this.ip = ip;
            this.browser = browser;
            this.os = os;
            this.loginTime = loginTime;
            this.lastActiveTime = lastActiveTime;
        }

        public String loginTimeString() {
            return loginTime.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        }
    }
}