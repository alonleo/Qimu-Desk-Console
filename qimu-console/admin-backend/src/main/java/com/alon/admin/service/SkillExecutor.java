package com.alon.admin.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** 技能执行器：shell / http / prompt */
@Service
public class SkillExecutor {

    private final ObjectMapper om = new ObjectMapper();

    /**
     * 解包技能执行配置：兼容两种存法——
     * ① 嵌套（迁移格式）：{shell:{command,timeout}} / {http:{...}} / {prompt:{...}}
     * ② 平铺：{command,timeout} 等
     */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> unwrapConfig(String type, Object config) {
        Map<String, Object> out = new HashMap<>();
        if (config instanceof Map<?, ?> cm) {
            Object nested = cm.get(type);
            if (nested instanceof Map<?, ?> inner) {
                for (Map.Entry<?, ?> e : inner.entrySet()) out.put(e.getKey().toString(), e.getValue());
            } else {
                for (Map.Entry<?, ?> e : cm.entrySet()) out.put(e.getKey().toString(), e.getValue());
            }
        }
        return out;
    }

    /** 返回 {output?, error?} */
    public Map<String, String> execute(String type, Map<String, Object> config, Map<String, String> params) {
        try {
            return switch (type) {
                case "shell" -> runShell(config, params);
                case "http" -> runHttp(config, params);
                case "prompt" -> runPrompt(config, params);
                default -> Map.of("error", "未知技能类型：" + type);
            };
        } catch (Exception e) {
            return Map.of("error", "执行失败：" + e.getMessage());
        }
    }

    private Map<String, String> runShell(Map<String, Object> cfg, Map<String, String> params) throws Exception {
        String command = str(cfg.get("command"));
        if (command == null || command.isBlank()) return Map.of("error", "shell 技能缺少 command");
        command = render(command, params);
        long timeout = cfg.get("timeout") == null ? 30 : Long.parseLong(cfg.get("timeout").toString());
        // Windows cmd 默认 GBK：先切 UTF-8 代码页，保证中文参数/输出经管道不乱码
        if (System.getProperty("os.name", "").toLowerCase().contains("win")) {
            command = "chcp 65001 >nul && " + command;
        }
        ProcessBuilder pb = new ProcessBuilder("cmd", "/c", command);
        pb.redirectErrorStream(true);
        Process p = pb.start();
        StringBuilder out = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) out.append(line).append("\n");
        }
        if (!p.waitFor(timeout, TimeUnit.SECONDS)) {
            p.destroyForcibly();
            return Map.of("error", "命令执行超时（" + timeout + "s）");
        }
        return Map.of("output", out.toString().trim());
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> runHttp(Map<String, Object> cfg, Map<String, String> params) throws Exception {
        String url = render(str(cfg.get("url")), params);
        String method = cfg.get("method") == null ? "GET" : cfg.get("method").toString().toUpperCase();
        long timeout = cfg.get("timeout") == null ? 30 : Long.parseLong(cfg.get("timeout").toString());
        String body = cfg.get("body") == null ? null : render(cfg.get("body").toString(), params);

        HttpRequest.Builder rb = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(timeout));
        if (cfg.get("headers") instanceof Map<?, ?> headers) {
            for (Map.Entry<?, ?> e : headers.entrySet()) {
                rb.header(e.getKey().toString(), render(e.getValue().toString(), params));
            }
        }
        if (body != null) {
            rb.header("Content-Type", "application/json");
            rb.method(method, HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        } else {
            rb.method(method, HttpRequest.BodyPublishers.noBody());
        }
        HttpResponse<String> resp = HttpClient.newHttpClient()
                .send(rb.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (resp.statusCode() >= 400) {
            return Map.of("error", "HTTP " + resp.statusCode() + "：" + resp.body());
        }
        return Map.of("output", resp.body());
    }

    private Map<String, String> runPrompt(Map<String, Object> cfg, Map<String, String> params) {
        String template = str(cfg.get("template"));
        if (template == null || template.isBlank()) return Map.of("error", "prompt 技能缺少 template");
        return Map.of("output", render(template, params));
    }

    /** 模板渲染：{{key}} 替换（与工作台约定一致，仅支持一层 key） */
    public static String render(String text, Map<String, String> params) {
        if (text == null) return "";
        String out = text;
        for (Map.Entry<String, String> e : params.entrySet()) {
            out = out.replace("{{" + e.getKey() + "}}", e.getValue() == null ? "" : e.getValue());
        }
        return out;
    }

    private String str(Object o) {
        return o == null ? null : o.toString();
    }
}
