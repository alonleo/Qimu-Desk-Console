package com.alon.admin.common;

import com.baomidou.mybatisplus.core.metadata.IPage;
import jakarta.servlet.http.HttpServletRequest;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 分页工具：startPage 读 page/pageSize 参数，getDataTable 转 admin 风格响应 {ok, total, page, pageSize, items}。
 *
 * <p>兼容旧 controller 风格：原 NoticeController 等手写分页仍可继续使用；新 controller 可通过
 * BaseController.startPage + getDataTable 复用此工具。
 */
public final class PageUtils {

    private PageUtils() {}

    /** 从当前请求读 page / pageSize（兼容 pageNum / current / size），默认 1 / 10，上限 100 */
    public static <T> com.baomidou.mybatisplus.extension.plugins.pagination.Page<T> startPage() {
        return startPage(ServletUtils.getRequest());
    }

    public static <T> com.baomidou.mybatisplus.extension.plugins.pagination.Page<T> startPage(HttpServletRequest req) {
        int p = 1;
        int s = 10;
        if (req != null) {
            String pn = firstNonBlank(req.getParameter("page"), req.getParameter("pageNum"), req.getParameter("current"));
            String ps = firstNonBlank(req.getParameter("pageSize"), req.getParameter("size"));
            if (pn != null) {
                try { p = Math.max(1, Integer.parseInt(pn.trim())); } catch (NumberFormatException ignored) {}
            }
            if (ps != null) {
                try { s = Math.min(100, Math.max(1, Integer.parseInt(ps.trim()))); } catch (NumberFormatException ignored) {}
            }
        }
        return com.baomidou.mybatisplus.extension.plugins.pagination.Page.of(p, s);
    }

    /** admin 风格分页响应：{ok, total, page, pageSize, items}。items 来自 IPage.records。 */
    public static Map<String, Object> getDataTable(IPage<?> page) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", true);
        m.put("total", page.getTotal());
        m.put("page", page.getCurrent());
        m.put("pageSize", page.getSize());
        m.put("items", page.getRecords());
        return m;
    }

    private static String firstNonBlank(String... vs) {
        if (vs == null) return null;
        for (String v : vs) {
            if (v != null && !v.isBlank()) return v;
        }
        return null;
    }
}
