package com.alon.admin.controller;

import com.alon.admin.auth.AuthInterceptor;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.UserMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/** 密码修改：用户修改自己的密码 */
@RestController
@RequestMapping("/api/user")
public class UserPasswordController {

    private final UserMapper userMapper;
    private final PasswordEncoder passwordEncoder;

    public UserPasswordController(UserMapper userMapper, PasswordEncoder passwordEncoder) {
        this.userMapper = userMapper;
        this.passwordEncoder = passwordEncoder;
    }

    /** 修改当前用户密码 */
    @PostMapping("/password")
    public Map<String, Object> changePassword(
            HttpServletRequest req,
            @RequestBody Map<String, String> body) {
        User currentUser = (User) req.getAttribute(AuthInterceptor.ATTR_USER);
        if (currentUser == null) {
            return Map.of("ok", false, "error", "未登录");
        }

        String oldPassword = body.get("oldPassword");
        String newPassword = body.get("newPassword");

        if (oldPassword == null || oldPassword.isBlank()) {
            return Map.of("ok", false, "error", "请输入原密码");
        }
        if (newPassword == null || newPassword.length() < 8) {
            return Map.of("ok", false, "error", "新密码至少 8 位");
        }

        // 重新从数据库获取最新用户信息（确保密码是最新的）
        User user = userMapper.selectById(currentUser.getId());
        if (user == null) {
            return Map.of("ok", false, "error", "用户不存在");
        }

        // 验证原密码
        if (!passwordEncoder.matches(oldPassword, user.getPasswordHash())) {
            return Map.of("ok", false, "error", "原密码错误");
        }

        // 更新新密码
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        user.setUpdatedAt(java.time.LocalDateTime.now());
        userMapper.updateById(user);

        return Map.of("ok", true);
    }
}
