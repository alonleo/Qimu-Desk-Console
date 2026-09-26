package com.alon.admin.service;

import com.alon.admin.entity.AiConfig;
import java.math.BigDecimal;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.regex.Pattern;

/** 网关级预算：0 使用自动值，显式设置优先；输入为保守估算。 */
public final class AiGenerationPolicy {
    private AiGenerationPolicy() {}
    private static final Pattern MINIMAX = Pattern.compile("(?:^|/)minimax[- ]m[23](?:[.\\s-]|$)", Pattern.CASE_INSENSITIVE);
    public static boolean isMinimax(AiConfig cfg) { return MINIMAX.matcher(cfg.getModel() == null ? "" : cfg.getModel()).find(); }
    public static int value(Integer v) { return v == null ? 0 : v; }
    public static void apply(AiConfig cfg, Map<?, ?> body) {
        Integer input = parse(body, "max_input_tokens", 2000000);
        Integer output = parse(body, "max_output_tokens", 262144);
        Integer timeout = parse(body, "timeout_seconds", 600);
        if (input != null) cfg.setMaxInputTokens(input);
        if (output != null) cfg.setMaxOutputTokens(output);
        if (timeout != null) cfg.setTimeoutSeconds(timeout);
    }
    private static Integer parse(Map<?, ?> body, String key, int max) {
        if (!body.containsKey(key)) return null;
        try {
            Object raw = body.get(key);
            if (!(raw instanceof Number)) throw new IllegalArgumentException();
            int n = new BigDecimal(raw.toString()).intValueExact();
            if (n < 0 || n > max) throw new IllegalArgumentException();
            return n;
        } catch (RuntimeException e) { throw new IllegalArgumentException(key + " 必须是 0 到 " + max + " 之间的整数（0 表示自动）"); }
    }
    public static Map<String, Object> options(AiConfig cfg, int fallback) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (isMinimax(cfg)) result.put("reasoning_split", true);
        int output = value(cfg.getMaxOutputTokens());
        result.put("max_tokens", output > 0 ? output : isMinimax(cfg) ? Math.max(fallback, 16384) : fallback);
        return result;
    }
    public static int timeout(AiConfig cfg) { return value(cfg.getTimeoutSeconds()) > 0 ? cfg.getTimeoutSeconds() : isMinimax(cfg) ? 240 : 90; }
    public static void checkInput(AiConfig cfg, String serialized) {
        if (value(cfg.getMaxInputTokens()) == 0) return;
        long ascii = serialized.codePoints().filter(c -> c < 128).count();
        long nonAscii = serialized.codePointCount(0, serialized.length()) - ascii;
        long estimate = (ascii + 2) / 3 + nonAscii * 2;
        if (estimate > cfg.getMaxInputTokens()) throw new IllegalArgumentException("输入上下文预计 " + estimate + " tokens，超过此模型设置的 " + cfg.getMaxInputTokens() + " 上限。请减少历史消息或引用内容，或提高输入上限。");
    }
}
