package com.alon.admin.auth;

import com.alon.admin.common.JwtUtil;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.UserMapper;
import com.alon.admin.service.LogininforRecorder;
import com.alon.admin.service.OnlineSessionRegistry;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import io.jsonwebtoken.Claims;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/** JWT 鉴权拦截器：从 Authorization: Bearer 或 Cookie: token 读取，校验后注入当前用户 */
@Component
public class AuthInterceptor implements HandlerInterceptor {

    public static final String ATTR_USER = "currentUser";

    private final JwtUtil jwtUtil;
    private final UserMapper userMapper;
    private final LogininforRecorder logininforRecorder;
    private final OnlineSessionRegistry onlineRegistry;

    public AuthInterceptor(JwtUtil jwtUtil, UserMapper userMapper, LogininforRecorder logininforRecorder,
                           OnlineSessionRegistry onlineRegistry) {
        this.jwtUtil = jwtUtil;
        this.userMapper = userMapper;
        this.logininforRecorder = logininforRecorder;
        this.onlineRegistry = onlineRegistry;
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse resp, Object handler) throws Exception {
        if ("OPTIONS".equalsIgnoreCase(req.getMethod())) {
            resp.setStatus(200);
            return false;
        }
        String token = null;
        String auth = req.getHeader("Authorization");
        if (auth != null && auth.startsWith("Bearer ")) {
            token = auth.substring(7);
        }
        if (token == null) {
            Cookie[] cookies = req.getCookies();
            if (cookies != null) {
                for (Cookie c : cookies) {
                    if ("token".equals(c.getName())) {
                        token = c.getValue();
                        break;
                    }
                }
            }
        }
        Claims claims = token == null ? null : jwtUtil.parse(token);
        if (claims == null) {
            // 登录日志：拿不到 token / token 无效时尝试用 username claim 记录
            String name = (claims == null) ? null : jwtUtil.username(claims);
            logininforRecorder.recordFail(name, "未登录或登录已过期");
            resp.setStatus(401);
            resp.setContentType("application/json;charset=UTF-8");
            resp.getWriter().write("{\"ok\":false,\"error\":\"未登录或登录已过期\"}");
            return false;
        }
        Long uid = jwtUtil.userId(claims);
        User user = userMapper.selectById(uid);
        if (user == null || (user.getDisabled() != null && user.getDisabled() == 1)) {
            logininforRecorder.recordFail(jwtUtil.username(claims), user == null ? "账号不存在" : "账号已被禁用");
            resp.setStatus(401);
            resp.setContentType("application/json;charset=UTF-8");
            resp.getWriter().write("{\"ok\":false,\"error\":\"账号不存在或已被禁用\"}");
            return false;
        }
        if (onlineRegistry.isBlacklisted(token)) {
            resp.setStatus(401);
            resp.setContentType("application/json;charset=UTF-8");
            resp.getWriter().write("{\"ok\":false,\"error\":\"账号已被强制下线\"}");
            return false;
        }
        onlineRegistry.touch(token);
        req.setAttribute(ATTR_USER, user);
        return true;
    }
}
