package com.alon.admin.controller;

import com.alon.admin.auth.AuthInterceptor;
import com.alon.admin.common.JwtUtil;
import com.alon.admin.common.ServletUtils;
import com.alon.admin.dto.UserDtos;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.UserMapper;
import com.alon.admin.service.LogininforRecorder;
import com.alon.admin.service.OnlineSessionRegistry;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/** 认证：登录（JWT 签发）/ 登出 / 当前用户。所有登录事件落库 sys_logininfor */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserMapper userMapper;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;
    private final LogininforRecorder logininforRecorder;
    private final OnlineSessionRegistry onlineRegistry;

    public AuthController(UserMapper userMapper, PasswordEncoder passwordEncoder, JwtUtil jwtUtil,
                          LogininforRecorder logininforRecorder, OnlineSessionRegistry onlineRegistry) {
        this.userMapper = userMapper;
        this.passwordEncoder = passwordEncoder;
        this.jwtUtil = jwtUtil;
        this.logininforRecorder = logininforRecorder;
        this.onlineRegistry = onlineRegistry;
    }

    @PostMapping("/login")
    public Map<String, Object> login(@Valid @RequestBody UserDtos.Login body, HttpServletRequest req) {
        String username = body.username() == null ? "" : body.username().trim();
        String password = body.password();
        if (username.isBlank() || password == null || password.isBlank()) {
            logininforRecorder.recordFail(username, "用户名和密码不能为空");
            return err("用户名和密码不能为空");
        }
        User user = userMapper.selectOne(Wrappers.<User>lambdaQuery().eq(User::getUsername, username));
        if (user == null || !passwordEncoder.matches(password, user.getPasswordHash())) {
            logininforRecorder.recordFail(username, "用户名或密码错误");
            return err("用户名或密码错误");
        }
        if (user.getDisabled() != null && user.getDisabled() == 1) {
            logininforRecorder.recordFail(username, "账号已被禁用");
            return err("账号已被禁用");
        }
        String token = jwtUtil.generate(user.getId(), user.getUsername(), user.getRole());
        logininforRecorder.recordSuccess(username);
        onlineRegistry.register(token, user, ServletUtils.getClientIp(), req.getHeader("User-Agent"));
        Map<String, Object> resp = new HashMap<>();
        resp.put("ok", true);
        resp.put("token", token);
        resp.put("user", userInfo(user));
        return resp;
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(HttpServletRequest req) {
        String token = resolveToken(req);
        if (token != null) onlineRegistry.logout(token);
        return Map.of("ok", true);
    }

    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest req) {
        User user = (User) req.getAttribute(AuthInterceptor.ATTR_USER);
        Map<String, Object> resp = new HashMap<>();
        resp.put("ok", true);
        resp.put("user", userInfo(user));
        return resp;
    }

    private String resolveToken(HttpServletRequest req) {
        String auth = req.getHeader("Authorization");
        if (auth != null && auth.startsWith("Bearer ")) return auth.substring(7);
        Cookie[] cookies = req.getCookies();
        if (cookies != null) {
            for (Cookie c : cookies) {
                if ("token".equals(c.getName())) return c.getValue();
            }
        }
        return null;
    }

    private Map<String, Object> userInfo(User u) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", u.getId());
        m.put("username", u.getUsername());
        m.put("role", u.getRole());
        m.put("displayName", u.getDisplayName());
        return m;
    }

    private Map<String, Object> err(String msg) {
        Map<String, Object> m = new HashMap<>();
        m.put("ok", false);
        m.put("error", msg);
        return m;
    }
}
