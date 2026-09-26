package com.alon.admin.aspect;

import com.alon.admin.annotation.Log;
import com.alon.admin.auth.AuthInterceptor;
import com.alon.admin.common.ServletUtils;
import com.alon.admin.entity.SysOperLog;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.SysOperLogMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;

import java.lang.reflect.Method;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * 操作日志切面：环绕 @Log 注解方法，自动落库到 sys_oper_log。
 *
 * <p>实现要点：
 * <ul>
 *   <li>采用 @Around 同时捕获正常返回与异常，性能与一致性优于 @AfterReturning + @AfterThrowing</li>
 *   <li>切面内部用 try/catch 吞掉所有日志写入异常，绝不污染主业务返回值</li>
 *   <li>请求参数截取 2000 字符防爆库；excludeParamNames 用于剔除 password / token 等敏感字段</li>
 *   <li>响应参数默认不记录（isSaveResponseData=false），避免大列表污染日志</li>
 * </ul>
 */
@Slf4j
@Aspect
@Component
@RequiredArgsConstructor
public class LogAspect {

    private static final int MAX_FIELD_LEN = 2000;

    private final SysOperLogMapper operLogMapper;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Around("@annotation(logAnno)")
    public Object around(ProceedingJoinPoint pjp, Log logAnno) throws Throwable {
        long t0 = System.currentTimeMillis();
        Object result = null;
        Throwable error = null;
        try {
            result = pjp.proceed();
            return result;
        } catch (Throwable ex) {
            error = ex;
            throw ex;
        } finally {
            try {
                saveLog(pjp, logAnno, result, error, System.currentTimeMillis() - t0);
            } catch (Exception ex) {
                LogAspect.log.warn("LogAspect 记录操作日志失败：{}", ex.getMessage());
            }
        }
    }

    private void saveLog(ProceedingJoinPoint pjp, Log logAnno, Object result, Throwable error, long costMs) {
        SysOperLog row = new SysOperLog();
        row.setTitle(safe(logAnno.title(), ""));
        row.setBusinessType(safe(logAnno.businessType(), "0"));
        row.setStatus(error == null ? "0" : "1");
        row.setCostMs(costMs);
        row.setOperTime(LocalDateTime.now());

        MethodSignature sig = (MethodSignature) pjp.getSignature();
        Method method = sig.getMethod();
        row.setMethod(method.getDeclaringClass().getName() + "." + method.getName());

        HttpServletRequest req = ServletUtils.getRequest();
        if (req != null) {
            row.setRequestMethod(req.getMethod());
            row.setOperUrl(req.getRequestURI());
            row.setOperIp(ServletUtils.getClientIp());
            row.setOperName(currentUserName(req));
        }

        if (logAnno.isSaveRequestData()) {
            row.setOperParam(serialize(filterParams(req, logAnno.excludeParamNames())));
        }
        if (logAnno.isSaveResponseData() && result != null) {
            row.setJsonResult(truncate(serialize(result)));
        }
        if (error != null) {
            row.setErrorMsg(truncate(error.getMessage()));
        }

        try {
            operLogMapper.insert(row);
        } catch (Exception ex) {
            // 写入失败不抛，仅记录告警
            log.warn("sys_oper_log 写入失败：{}", ex.getMessage());
        }
    }

    /** 从 AuthInterceptor 注入的 request 属性取用户名（无登录态时填 anonymous） */
    private static String currentUserName(HttpServletRequest req) {
        Object attr = req.getAttribute(AuthInterceptor.ATTR_USER);
        if (attr instanceof User u) {
            return u.getDisplayName() != null && !u.getDisplayName().isBlank() ? u.getDisplayName() : u.getUsername();
        }
        return "anonymous";
    }

    /** 把 request 参数 Map JSON 化，按 excludeParamNames 剔除敏感字段 */
    private String filterParams(HttpServletRequest req, String[] exclude) {
        if (req == null) return null;
        Set<String> banned = new HashSet<>(Arrays.asList(exclude == null ? new String[0] : exclude));
        Map<String, String> flat = new HashMap<>();
        Map<String, String[]> raw = req.getParameterMap();
        for (Map.Entry<String, String[]> e : raw.entrySet()) {
            if (banned.contains(e.getKey())) {
                flat.put(e.getKey(), "******");
                continue;
            }
            String[] v = e.getValue();
            flat.put(e.getKey(), v == null ? null : (v.length == 1 ? v[0] : Arrays.toString(v)));
        }
        return truncate(serialize(flat));
    }

    private String serialize(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception ex) {
            return String.valueOf(o);
        }
    }

    private static String truncate(String s) {
        if (s == null) return null;
        return s.length() <= MAX_FIELD_LEN ? s : s.substring(0, MAX_FIELD_LEN);
    }

    private static String safe(String v, String def) {
        return v == null ? def : v;
    }
}
