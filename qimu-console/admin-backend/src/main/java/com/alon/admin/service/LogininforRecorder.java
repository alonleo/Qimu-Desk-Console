package com.alon.admin.service;

import com.alon.admin.common.ServletUtils;
import com.alon.admin.entity.SysLogininfor;
import com.alon.admin.mapper.SysLogininforMapper;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * 登录日志记录器：AuthInterceptor / AuthController 共用。
 *
 * <p>所有异常吞掉，不影响主登录流程。Status：0 失败 / 1 成功。
 * Browser / OS 通过简单 UA 关键字匹配得到常见枚举值，未知时统一回 "Unknown"。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LogininforRecorder {

    private final SysLogininforMapper logininforMapper;

    public void recordSuccess(String username) {
        save(username, "1", "登录成功", currentRequest());
    }

    public void recordFail(String username, String reason) {
        save(username, "0", reason, currentRequest());
    }

    private void save(String username, String status, String msg, HttpServletRequest req) {
        try {
            SysLogininfor row = new SysLogininfor();
            row.setUserName(username == null || username.isBlank() ? "anonymous" : username);
            row.setStatus(status);
            row.setMsg(msg);
            row.setLoginTime(LocalDateTime.now());
            if (req != null) {
                row.setIpaddr(ServletUtils.getClientIp());
                row.setBrowser(parseBrowser(req.getHeader("User-Agent")));
                row.setOs(parseOs(req.getHeader("User-Agent")));
                // loginLocation 留空：依赖外部 IP 库，本期不引入
            }
            logininforMapper.insert(row);
        } catch (Exception ex) {
            log.warn("写入登录日志失败：{}", ex.getMessage());
        }
    }

    private static HttpServletRequest currentRequest() {
        return ServletUtils.getRequest();
    }

    /** 简单 UA 解析：命中首个关键字即返回；都未命中返回 "Unknown" */
    static String parseBrowser(String ua) {
        if (ua == null) return "Unknown";
        String s = ua;
        if (s.contains("Edg/")) return "Edge";
        if (s.contains("OPR/") || s.contains("Opera")) return "Opera";
        if (s.contains("Chrome/")) return "Chrome";
        if (s.contains("Firefox/")) return "Firefox";
        if (s.contains("Safari/")) return "Safari";
        return "Unknown";
    }

    static String parseOs(String ua) {
        if (ua == null) return "Unknown";
        if (ua.contains("Windows NT 10")) return "Windows 10";
        if (ua.contains("Windows NT 11")) return "Windows 11";
        if (ua.contains("Windows NT 6.1")) return "Windows 7";
        if (ua.contains("Mac OS X")) return "macOS";
        if (ua.contains("Android")) return "Android";
        if (ua.contains("iPhone") || ua.contains("iPad")) return "iOS";
        if (ua.contains("Linux")) return "Linux";
        return "Unknown";
    }
}
