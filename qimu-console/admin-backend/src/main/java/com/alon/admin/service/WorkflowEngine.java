package com.alon.admin.service;

import com.alon.admin.entity.AiConfig;
import com.alon.admin.entity.Skill;
import com.alon.admin.entity.Workflow;
import com.alon.admin.mapper.AiConfigMapper;
import com.alon.admin.mapper.SkillMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;

/** 工作流执行引擎：顺序执行 shell/http/template/skill/llm 步骤，失败即停 */
@Service
public class WorkflowEngine {

    private final SkillMapper skillMapper;
    private final SkillExecutor skillExecutor;
    private final AiConfigMapper aiConfigMapper;
    private final ObjectMapper om = new ObjectMapper();

    public WorkflowEngine(SkillMapper skillMapper, SkillExecutor skillExecutor, AiConfigMapper aiConfigMapper) {
        this.skillMapper = skillMapper;
        this.skillExecutor = skillExecutor;
        this.aiConfigMapper = aiConfigMapper;
    }

    /** 执行工作流；返回步骤日志 */
    public List<Map<String, Object>> execute(Workflow wf, Map<String, String> params, String triggeredBy) {
        List<Map<String, Object>> steps = new ArrayList<>();
        Map<String, Object> def;
        try {
            def = om.readValue(wf.getDefinition(), new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            Map<String, Object> errStep = new HashMap<>();
            errStep.put("stepId", "parse");
            errStep.put("name", "解析工作流");
            errStep.put("type", "error");
            errStep.put("status", "failed");
            errStep.put("output", "");
            errStep.put("error", "工作流定义解析失败：" + e.getMessage());
            errStep.put("durationMs", 0);
            return List.of(errStep);
        }
        Object rawSteps = def.get("steps");
        if (!(rawSteps instanceof List<?> stepList) || stepList.isEmpty()) {
            Map<String, Object> errStep = new HashMap<>();
            errStep.put("stepId", "empty");
            errStep.put("name", "空工作流");
            errStep.put("type", "error");
            errStep.put("status", "failed");
            errStep.put("output", "");
            errStep.put("error", "工作流没有定义任何步骤");
            errStep.put("durationMs", 0);
            return List.of(errStep);
        }

        Map<String, String> outputs = new HashMap<>();
        boolean failed = false;
        for (Object o : stepList) {
            Map<String, Object> step = new HashMap<>((Map<String, Object>) o);
            String stepId = String.valueOf(step.get("id"));
            String name = step.get("name") == null ? stepId : step.get("name").toString();
            String type = step.get("type") == null ? "" : step.get("type").toString();
            Map<String, Object> log = new HashMap<>();
            log.put("stepId", stepId);
            log.put("name", name);
            log.put("type", type);
            log.put("output", "");
            log.put("error", "");
            long t0 = System.currentTimeMillis();
            if (failed) {
                log.put("status", "skipped");
                log.put("durationMs", 0);
                steps.add(log);
                continue;
            }
            try {
                Map<String, String> ctx = mergedCtx(params, outputs);
                Map<String, String> result = runStep(type, step, ctx);
                log.put("status", result.get("error") == null ? "success" : "failed");
                log.put("output", result.getOrDefault("output", ""));
                log.put("error", result.getOrDefault("error", ""));
                if (result.get("error") != null) {
                    failed = true;
                } else {
                    outputs.put(stepId, result.getOrDefault("output", ""));
                }
            } catch (Exception e) {
                log.put("status", "failed");
                log.put("error", "执行异常：" + e.getMessage());
                failed = true;
            }
            log.put("durationMs", System.currentTimeMillis() - t0);
            steps.add(log);
        }
        return steps;
    }

    private Map<String, String> mergedCtx(Map<String, String> params, Map<String, String> outputs) {
        Map<String, String> ctx = new HashMap<>(params);
        outputs.forEach((k, v) -> ctx.put("steps." + k + ".output", v));
        return ctx;
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> runStep(String type, Map<String, Object> step, Map<String, String> ctx) throws Exception {
        return switch (type) {
            case "shell" -> {
                Map<String, Object> cfg = step.get("shell") instanceof Map<?, ?> m ? new HashMap<>((Map<String, Object>) m) : new HashMap<>();
                yield skillExecutor.execute("shell", cfg, ctx);
            }
            case "http" -> {
                Map<String, Object> cfg = step.get("http") instanceof Map<?, ?> m ? new HashMap<>((Map<String, Object>) m) : new HashMap<>();
                yield skillExecutor.execute("http", cfg, ctx);
            }
            case "template" -> {
                String content = step.get("template") instanceof Map<?, ?> tm && tm.get("content") != null
                        ? tm.get("content").toString() : "";
                yield Map.of("output", SkillExecutor.render(content, ctx));
            }
            case "skill" -> {
                Map<String, Object> sk = step.get("skill") instanceof Map<?, ?> m ? new HashMap<>((Map<String, Object>) m) : new HashMap<>();
                String skillName = sk.get("name") == null ? "" : sk.get("name").toString();
                Skill s = skillMapper.selectOne(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<Skill>()
                        .eq("name", skillName).last("LIMIT 1"));
                if (s == null) yield Map.of("error", "技能「" + skillName + "」未注册");
                Map<String, Object> def = om.readValue(s.getConfig(), new TypeReference<Map<String, Object>>() {});
                Map<String, Object> execCfg = SkillExecutor.unwrapConfig(s.getType(), def.get("config"));
                Map<String, String> params = new HashMap<>();
                if (sk.get("params") instanceof Map<?, ?> pm) {
                    for (Map.Entry<?, ?> e : pm.entrySet()) {
                        params.put(e.getKey().toString(), SkillExecutor.render(e.getValue() == null ? "" : e.getValue().toString(), ctx));
                    }
                }
                yield skillExecutor.execute(s.getType(), execCfg, params);
            }
            case "llm" -> {
                Map<String, Object> llm = step.get("llm") instanceof Map<?, ?> m ? new HashMap<>((Map<String, Object>) m) : new HashMap<>();
                // 优先默认网关，其次任一启用网关
                AiConfig cfg = aiConfigMapper.selectOne(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<AiConfig>()
                        .eq("is_default", 1).last("LIMIT 1"));
                if (cfg == null) {
                    cfg = aiConfigMapper.selectOne(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<AiConfig>()
                            .eq("enabled", 1).orderByAsc("id").last("LIMIT 1"));
                }
                if (cfg == null || cfg.getEnabled() == null || cfg.getEnabled() != 1
                        || cfg.getBaseUrl() == null || cfg.getBaseUrl().isBlank()
                        || cfg.getApiKey() == null || cfg.getApiKey().isBlank()
                        || cfg.getModel() == null || cfg.getModel().isBlank()) {
                    yield Map.of("error", "AI 网关未配置：请先在「AI 网关」中填写 Base URL / API Key / 模型并启用");
                }
                String prompt = SkillExecutor.render(llm.get("prompt") == null ? "" : llm.get("prompt").toString(), ctx);
                String system = llm.get("system") == null ? null : SkillExecutor.render(llm.get("system").toString(), ctx);
                yield callLlm(cfg, prompt, system);
            }
            default -> Map.of("error", "未知步骤类型：" + type);
        };
    }

    private Map<String, String> callLlm(AiConfig cfg, String prompt, String system) {
        String base = cfg.getBaseUrl().trim().replaceAll("/+$", "");
        String url = base.toLowerCase().endsWith("/chat/completions") ? base : base + "/chat/completions";
        try {
            List<Map<String, String>> messages = new ArrayList<>();
            if (system != null && !system.isBlank()) messages.add(Map.of("role", "system", "content", system));
            messages.add(Map.of("role", "user", "content", prompt));
            Map<String, Object> payload = new HashMap<>();
            payload.put("model", cfg.getModel());
            payload.put("messages", messages);
            payload.put("temperature", cfg.getTemperature() == null ? 0.7 : cfg.getTemperature());
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(90))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + cfg.getApiKey())
                    .POST(HttpRequest.BodyPublishers.ofString(om.writeValueAsString(payload), StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> resp = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (resp.statusCode() >= 400) {
                return Map.of("error", "AI 网关返回 HTTP " + resp.statusCode() + "：" + resp.body());
            }
            Map<String, Object> data = om.readValue(resp.body(), new TypeReference<Map<String, Object>>() {});
            if (data.get("error") != null) {
                return Map.of("error", "AI 网关错误：" + data.get("error").toString());
            }
            Object choices = data.get("choices");
            String content = null;
            if (choices instanceof List<?> cs && !cs.isEmpty() && cs.get(0) instanceof Map<?, ?> c0) {
                Object msg = c0.get("message");
                if (msg instanceof Map<?, ?> mm) content = mm.get("content") == null ? null : mm.get("content").toString();
            }
            if (content == null || content.isBlank()) return Map.of("error", "AI 网关返回空内容");
            return Map.of("output", content);
        } catch (Exception e) {
            return Map.of("error", "AI 请求失败：" + e.getMessage());
        }
    }
}
