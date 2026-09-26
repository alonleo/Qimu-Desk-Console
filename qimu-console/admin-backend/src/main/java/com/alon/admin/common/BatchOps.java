package com.alon.admin.common;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 批量操作通用工具：ids 解析 + 统一响应结构 {ok, created/updated/deleted, failed, errors} */
public final class BatchOps {

    private BatchOps() {}

    /** 解析前端传来的 ids 数组（元素可能为数字或字符串，容忍非法项） */
    public static List<Long> parseIds(Object v) {
        if (!(v instanceof List<?> list)) return List.of();
        return list.stream()
                .map(x -> {
                    try {
                        return Long.valueOf(String.valueOf(x));
                    } catch (NumberFormatException e) {
                        return null;
                    }
                })
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
    }

    /** 统一批量响应：key 为 created / updated / deleted */
    public static Map<String, Object> result(String key, int okCount, List<Map<String, Object>> errors) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", true);
        m.put(key, okCount);
        m.put("failed", errors.size());
        m.put("errors", errors);
        return m;
    }

    /** 单条失败明细（id 或 index） */
    public static Map<String, Object> itemError(String idKey, Object id, String error) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put(idKey, id);
        m.put("error", error);
        return m;
    }
}
