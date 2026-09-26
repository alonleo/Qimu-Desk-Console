package com.alon.admin.controller.monitor;

import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;

/**
 * 缓存监控（系统监控）：Redis 信息 / 缓存名称 / 键 / 值 / 清理。
 *
 * <p>本系统写入 Redis 的仅为在线会话镜像 {@code login_tokens:<tokenId>}
 * （见 {@link com.alon.admin.service.OnlineSessionRegistry}），因此支持浏览的命名空间
 * 固定为 login_tokens，与参考项目只扫 login_tokens:* 的语义一致。
 * Redis 不可用时统一返回 { ok:false, error }，前端做友好提示。
 */
@RestController
@RequestMapping("/api/monitor/cache")
public class MonitorCacheController {

    private static final String LOGIN_TOKEN_PREFIX = "login_tokens:";
    private static final Set<String> KNOWN_NAMESPACES = Set.of("login_tokens");
    private static final int SCAN_CAP = 2000;

    private final RedisConnectionFactory connectionFactory;
    private final StringRedisTemplate redis;

    public MonitorCacheController(RedisConnectionFactory connectionFactory, StringRedisTemplate redis) {
        this.connectionFactory = connectionFactory;
        this.redis = redis;
    }

    @GetMapping
    public Map<String, Object> info() {
        try (RedisConnection conn = connectionFactory.getConnection()) {
            Properties props = conn.serverCommands().info();
            Map<String, Object> info = new LinkedHashMap<>();
            if (props != null) {
                for (String name : props.stringPropertyNames()) info.put(name, props.getProperty(name));
            }
            Long dbSize = conn.serverCommands().dbSize();
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ok", true);
            resp.put("info", info);
            resp.put("dbSize", dbSize == null ? 0L : dbSize);
            resp.put("commandStats", new ArrayList<>());
            return resp;
        } catch (DataAccessException e) {
            return err("Redis 连接失败：" + e.getMessage());
        }
    }

    @GetMapping("/getNames")
    public Map<String, Object> getNames() {
        try {
            // 仅扫描本系统写入的 login_tokens 命名空间；返回去重名称（不带冒号）
            Set<String> names = new LinkedHashSet<>();
            for (String key : scanKeys(LOGIN_TOKEN_PREFIX + "*")) {
                int idx = key.indexOf(':');
                if (idx > 0) names.add(key.substring(0, idx));
            }
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ok", true);
            resp.put("items", names);
            return resp;
        } catch (DataAccessException e) {
            return err("Redis 连接失败：" + e.getMessage());
        }
    }

    @GetMapping("/getKeys/{cacheName}")
    public Map<String, Object> getKeys(@PathVariable String cacheName) {
        if (!KNOWN_NAMESPACES.contains(cacheName)) return err("未知缓存名称：" + cacheName);
        try {
            List<String> keys = scanKeys(cacheName + ":*");
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ok", true);
            resp.put("cacheName", cacheName);
            resp.put("items", keys);
            return resp;
        } catch (DataAccessException e) {
            return err("Redis 连接失败：" + e.getMessage());
        }
    }

    @GetMapping("/getValue/{cacheName}/{cacheKey}")
    public Map<String, Object> getValue(@PathVariable String cacheName, @PathVariable String cacheKey) {
        if (!KNOWN_NAMESPACES.contains(cacheName)) return err("未知缓存名称：" + cacheName);
        try {
            String redisKey = cacheKey.startsWith(cacheName + ":") ? cacheKey : cacheName + ":" + cacheKey;
            String value = redis.opsForValue().get(redisKey);
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ok", true);
            resp.put("cacheName", cacheName);
            resp.put("cacheKey", cacheKey);
            resp.put("cacheValue", value == null ? "（缓存键不存在或已过期）" : value);
            resp.put("remark", value == null ? "" : "TOKEN");
            return resp;
        } catch (DataAccessException e) {
            return err("Redis 连接失败：" + e.getMessage());
        }
    }

    @DeleteMapping("/clearCacheKey/{cacheKey}")
    public Map<String, Object> clearCacheKey(@PathVariable String cacheKey) {
        try {
            // If key was returned by getKeys it has prefix "login_tokens:"; strip it to get bare key
            String redisKey = cacheKey.contains(":") ? cacheKey : LOGIN_TOKEN_PREFIX + cacheKey;
            Boolean deleted = redis.delete(redisKey);
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ok", true);
            resp.put("deleted", Boolean.TRUE.equals(deleted) ? 1 : 0);
            return resp;
        } catch (DataAccessException e) {
            return err("Redis 连接失败：" + e.getMessage());
        }
    }

    @DeleteMapping("/clearCacheName/{cacheName}")
    public Map<String, Object> clearCacheName(@PathVariable String cacheName) {
        if (!KNOWN_NAMESPACES.contains(cacheName)) return err("未知缓存名称：" + cacheName);
        try {
            List<String> keys = scanKeys(cacheName + ":*");
            long deleted = 0;
            if (!keys.isEmpty()) {
                try (RedisConnection conn = connectionFactory.getConnection()) {
                    byte[][] bs = keys.stream().map(k -> k.getBytes(StandardCharsets.UTF_8)).toArray(byte[][]::new);
                    Long d = conn.keyCommands().del(bs);
                    deleted = d == null ? 0 : d;
                }
            }
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ok", true);
            resp.put("deleted", deleted);
            return resp;
        } catch (DataAccessException e) {
            return err("Redis 连接失败：" + e.getMessage());
        }
    }

    @DeleteMapping("/clearCacheAll")
    public Map<String, Object> clearCacheAll() {
        try (RedisConnection conn = connectionFactory.getConnection()) {
            conn.serverCommands().flushDb();
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ok", true);
            resp.put("message", "已清空全部缓存");
            return resp;
        } catch (DataAccessException e) {
            return err("Redis 连接失败：" + e.getMessage());
        }
    }

    /** SCAN 游标遍历全部匹配键（上限 SCAN_CAP 防止误扫海量异构键） */
    private List<String> scanKeys(String pattern) {
        List<String> keys = new ArrayList<>();
        try (RedisConnection conn = connectionFactory.getConnection();
             Cursor<byte[]> cursor = conn.scan(ScanOptions.scanOptions().match(pattern).count(100).build())) {
            while (cursor.hasNext()) {
                keys.add(new String(cursor.next(), StandardCharsets.UTF_8));
                if (keys.size() >= SCAN_CAP) break;
            }
        }
        return keys;
    }

    private Map<String, Object> err(String msg) {
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", false);
        resp.put("error", msg);
        return resp;
    }
}