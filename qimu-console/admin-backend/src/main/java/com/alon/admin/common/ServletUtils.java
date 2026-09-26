package com.alon.admin.common;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Servlet 工具：从 RequestContextHolder 取当前请求，仿 RuoYi 风格。
 * 仅在 HTTP 请求线程内有效；定时任务等非 HTTP 线程返回 null。
 */
public final class ServletUtils {

    private ServletUtils() {}

    public static HttpServletRequest getRequest() {
        RequestAttributes ra = RequestContextHolder.getRequestAttributes();
        return ra instanceof ServletRequestAttributes sra ? sra.getRequest() : null;
    }

    /**
     * 获取客户端 IP。优先取 X-Forwarded-For 第一项（nginx 反代场景），
     * 其次 X-Real-IP，最后回退到 remoteAddr。空串/未知值兜底为 "unknown"。
     */
    public static String getClientIp() {
        HttpServletRequest req = getRequest();
        if (req == null) return "unknown";
        String ip = req.getHeader("X-Forwarded-For");
        if (ip != null && !ip.isBlank() && !"unknown".equalsIgnoreCase(ip)) {
            int comma = ip.indexOf(',');
            return (comma > 0 ? ip.substring(0, comma) : ip).trim();
        }
        ip = req.getHeader("X-Real-IP");
        if (ip != null && !ip.isBlank() && !"unknown".equalsIgnoreCase(ip)) return ip.trim();
        ip = req.getRemoteAddr();
        return ip == null || ip.isBlank() ? "unknown" : ip;
    }
}
