package com.alon.admin.controller;

import com.alon.admin.common.BatchOps;
import com.alon.admin.dto.UserDtos;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.UserMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import jakarta.validation.Valid;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 用户管理（管理平台全员为管理员） */
@RestController
@RequestMapping("/api/admin/users")
public class UserController {

    private final UserMapper userMapper;
    private final PasswordEncoder passwordEncoder;

    public UserController(UserMapper userMapper, PasswordEncoder passwordEncoder) {
        this.userMapper = userMapper;
        this.passwordEncoder = passwordEncoder;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return userMapper.selectList(Wrappers.<User>lambdaQuery().orderByAsc(User::getId)).stream()
                .map(UserController::toRow)
                .toList();
    }

    @PostMapping
    public Map<String, Object> create(@Valid @RequestBody UserDtos.CreateUser body) {
        String username = body.username().trim();
        if (userMapper.selectCount(Wrappers.<User>lambdaQuery().eq(User::getUsername, username)) > 0) {
            return err("用户名已存在");
        }
        User u = new User();
        u.setUsername(username);
        u.setPasswordHash(passwordEncoder.encode(body.password()));
        u.setRole("member".equals(body.role()) ? "member" : "admin");
        String dn = body.displayName();
        u.setDisplayName(dn == null || dn.isBlank() ? null : dn.trim());
        u.setDisabled(0);
        u.setCreatedAt(LocalDateTime.now());
        u.setUpdatedAt(LocalDateTime.now());
        userMapper.insert(u);
        Map<String, Object> resp = new HashMap<>();
        resp.put("ok", true);
        resp.put("user", toRow(u));
        return resp;
    }

    @PatchMapping("/{id}")
    public Map<String, Object> update(@PathVariable Long id, @Valid @RequestBody UserDtos.UpdateUser body) {
        User u = userMapper.selectById(id);
        if (u == null) return err("用户不存在");
        if (body.password() != null && !body.password().isBlank()) {
            u.setPasswordHash(passwordEncoder.encode(body.password()));
        }
        if (body.displayName() != null) {
            u.setDisplayName(body.displayName().isBlank() ? null : body.displayName().trim());
        }
        if (body.role() != null) {
            u.setRole("member".equals(body.role()) ? "member" : "admin");
        }
        if (body.disabled() != null) {
            u.setDisabled(Boolean.TRUE.equals(body.disabled()) ? 1 : 0);
        }
        u.setUpdatedAt(LocalDateTime.now());
        userMapper.updateById(u);
        Map<String, Object> resp = new HashMap<>();
        resp.put("ok", true);
        resp.put("user", toRow(u));
        return resp;
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        return deleteOne(id);
    }

    /** 单条删除（批量删除复用）；返回 {ok} 或 {ok:false, error} */
    private Map<String, Object> deleteOne(Long id) {
        User u = userMapper.selectById(id);
        if (u == null) return err("用户不存在");
        if ("admin".equals(u.getUsername())) return err("内置管理员账号不可删除");
        userMapper.deleteById(id);
        return Map.of("ok", true);
    }

    // —— 批量操作 ——

    /** 批量创建：{items: [{username,password,role,displayName}, ...]} */
    @PostMapping("/batch-create")
    public Map<String, Object> batchCreate(@RequestBody Map<String, Object> body) {
        if (!(body.get("items") instanceof List<?> items) || items.isEmpty()) return err("items 不能为空");
        List<Map<String, Object>> errors = new ArrayList<>();
        int created = 0;
        for (int i = 0; i < items.size(); i++) {
            if (!(items.get(i) instanceof Map<?, ?> im)) {
                errors.add(BatchOps.itemError("index", i, "条目必须是对象"));
                continue;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> it = (Map<String, Object>) im;
            String username = it.getOrDefault("username", "").toString().trim();
            String password = it.getOrDefault("password", "").toString();
            if (username.isBlank()) {
                errors.add(BatchOps.itemError("index", i, "用户名不能为空"));
                continue;
            }
            if (password.isBlank()) {
                errors.add(BatchOps.itemError("index", i, "用户「" + username + "」缺少密码"));
                continue;
            }
            if (userMapper.selectCount(Wrappers.<User>lambdaQuery().eq(User::getUsername, username)) > 0) {
                errors.add(BatchOps.itemError("index", i, "用户名「" + username + "」已存在"));
                continue;
            }
            User u = new User();
            u.setUsername(username);
            u.setPasswordHash(passwordEncoder.encode(password));
            u.setRole("member".equals(it.getOrDefault("role", "member").toString()) ? "member" : "admin");
            Object dn = it.get("displayName");
            u.setDisplayName(dn == null || dn.toString().isBlank() ? null : dn.toString().trim());
            u.setDisabled(0);
            u.setCreatedAt(LocalDateTime.now());
            u.setUpdatedAt(LocalDateTime.now());
            userMapper.insert(u);
            created++;
        }
        return BatchOps.result("created", created, errors);
    }

    /** 批量更新：{ids: [], data: {role / disabled}} */
    @PostMapping("/batch-update")
    public Map<String, Object> batchUpdate(@RequestBody Map<String, Object> body) {
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) return err("ids 不能为空");
        if (!(body.get("data") instanceof Map<?, ?> data) || data.isEmpty()) return err("data 不能为空");
        String role = data.get("role") == null ? null : ("member".equals(data.get("role").toString()) ? "member" : "admin");
        Integer disabled = data.get("disabled") == null ? null : (Boolean.parseBoolean(data.get("disabled").toString()) ? 1 : 0);
        if (role == null && disabled == null) return err("仅支持批量修改角色（role）或状态（disabled）");
        List<Map<String, Object>> errors = new ArrayList<>();
        int updated = 0;
        for (Long id : ids) {
            User u = userMapper.selectById(id);
            if (u == null) {
                errors.add(BatchOps.itemError("id", id, "用户不存在"));
                continue;
            }
            if (role != null) u.setRole(role);
            if (disabled != null) u.setDisabled(disabled);
            u.setUpdatedAt(LocalDateTime.now());
            userMapper.updateById(u);
            updated++;
        }
        return BatchOps.result("updated", updated, errors);
    }

    /** 批量删除：{ids: []}（内置管理员自动跳过） */
    @PostMapping("/batch-delete")
    public Map<String, Object> batchDelete(@RequestBody Map<String, Object> body) {
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) return err("ids 不能为空");
        List<Map<String, Object>> errors = new ArrayList<>();
        int deleted = 0;
        for (Long id : ids) {
            Map<String, Object> resp = deleteOne(id);
            if (Boolean.TRUE.equals(resp.get("ok"))) deleted++;
            else errors.add(BatchOps.itemError("id", id, String.valueOf(resp.get("error"))));
        }
        return BatchOps.result("deleted", deleted, errors);
    }

    static Map<String, Object> toRow(User u) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", u.getId());
        m.put("username", u.getUsername());
        m.put("display_name", u.getDisplayName());
        m.put("role", u.getRole());
        m.put("disabled", u.getDisabled());
        m.put("created_at", u.getCreatedAt() == null ? null : u.getCreatedAt().toString().replace("T", " "));
        return m;
    }

    private Map<String, Object> err(String msg) {
        return Map.of("ok", false, "error", msg);
    }
}
