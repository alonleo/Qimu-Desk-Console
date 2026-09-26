package com.alon.admin.controller.monitor;

import com.alon.admin.service.OnlineSessionRegistry;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 在线用户（系统监控）：列表 / 强制下线。
 *
 * <p>数据源为 {@link OnlineSessionRegistry}（内存会话注册表 + Redis 镜像），非 DB。
 * 列表响应与其它 monitor 列表一致：{ ok, total, page, pageSize, items }。
 */
@RestController
@RequestMapping("/api/monitor/online")
public class MonitorOnlineController {

    private final OnlineSessionRegistry registry;

    public MonitorOnlineController(OnlineSessionRegistry registry) {
        this.registry = registry;
    }

    @GetMapping("/list")
    public Map<String, Object> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int pageSize,
            @RequestParam(required = false) String ipaddr,
            @RequestParam(required = false) String userName) {
        List<OnlineSessionRegistry.OnlineSession> all = registry.list();
        if (ipaddr != null && !ipaddr.isBlank()) {
            String q = ipaddr.trim().toLowerCase();
            all = all.stream().filter(s -> s.getIp() != null && s.getIp().toLowerCase().contains(q)).collect(Collectors.toList());
        }
        if (userName != null && !userName.isBlank()) {
            String q = userName.trim().toLowerCase();
            all = all.stream().filter(s -> s.getUserName().toLowerCase().contains(q)).collect(Collectors.toList());
        }
        int size = Math.min(Math.max(pageSize, 1), 100);
        int total = all.size();
        int from = Math.min((page - 1) * size, total);
        int to = Math.min(from + size, total);
        List<Map<String, Object>> items = new ArrayList<>();
        for (int i = from; i < to; i++) {
            OnlineSessionRegistry.OnlineSession s = all.get(i);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("tokenId", s.getTokenId());
            row.put("userId", s.getUserId());
            row.put("userName", s.getUserName());
            row.put("role", s.getRole());
            row.put("ipaddr", s.getIp());
            row.put("browser", s.getBrowser());
            row.put("os", s.getOs());
            row.put("loginTime", s.loginTimeString());
            items.add(row);
        }
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("total", total);
        resp.put("page", page);
        resp.put("pageSize", size);
        resp.put("items", items);
        return resp;
    }

    @DeleteMapping("/{tokenId}")
    public Map<String, Object> forceLogout(@PathVariable String tokenId) {
        boolean ok = registry.forceLogout(tokenId);
        Map<String, Object> resp = new LinkedHashMap<>();
        if (ok) {
            resp.put("ok", true);
            resp.put("message", "强制下线成功");
        } else {
            resp.put("ok", false);
            resp.put("error", "会话不存在或已离线");
        }
        return resp;
    }
}