package com.alon.admin.controller;

import com.alon.admin.common.BatchOps;
import com.alon.admin.entity.AiConfig;
import com.alon.admin.entity.Doc;
import com.alon.admin.mapper.AiConfigMapper;
import com.alon.admin.mapper.DocMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;

/** AI 网关：多网关增删改查 / 默认网关测试与对话（支持知识库 RAG） */
@RestController
@RequestMapping("/api/ai")
public class AiController {

    private final AiConfigMapper aiConfigMapper;
    private final DocMapper docMapper;
    private final ObjectMapper om = new ObjectMapper();

    public AiController(AiConfigMapper aiConfigMapper, DocMapper docMapper) {
        this.aiConfigMapper = aiConfigMapper;
        this.docMapper = docMapper;
    }

    // —— 多网关管理 ——

    @GetMapping("/gateways")
    public Map<String, Object> gateways() {
        List<Map<String, Object>> list = aiConfigMapper.selectList(Wrappers.<AiConfig>lambdaQuery()
                        .orderByAsc(AiConfig::getId))
                .stream().map(this::toConfigDto).toList();
        return Map.of("ok", true, "gateways", list);
    }

    @PostMapping("/gateways")
    public Map<String, Object> createGateway(@RequestBody Map<String, Object> body) {
        return createOne(body);
    }

    /** 单条创建（批量创建复用）；返回 {ok, gateway} 或 {ok:false, error} */
    private Map<String, Object> createOne(Map<String, Object> body) {
        String name = body.getOrDefault("name", "").toString().trim();
        if (name.isBlank()) return err("网关名称不能为空");
        if (name.length() > 32) return err("网关名称过长（最多 32 字）");
        long count = aiConfigMapper.selectCount(null);
        AiConfig cfg = new AiConfig();
        cfg.setName(name);
        cfg.setProvider(body.getOrDefault("provider", "openai-compatible").toString());
        cfg.setBaseUrl(body.getOrDefault("base_url", "").toString().trim());
        cfg.setApiKey(body.getOrDefault("api_key", "").toString().trim());
        cfg.setModel(body.getOrDefault("model", "").toString().trim());
        cfg.setTemperature(body.get("temperature") == null ? 0.7 : Double.parseDouble(body.get("temperature").toString()));
        cfg.setEnabled(Boolean.parseBoolean(body.getOrDefault("enabled", "false").toString()) ? 1 : 0);
        // 第一条自动成为默认网关
        boolean makeDefault = count == 0 || Boolean.parseBoolean(body.getOrDefault("is_default", "false").toString());
        cfg.setIsDefault(makeDefault ? 1 : 0);
        cfg.setUpdatedAt(LocalDateTime.now());
        aiConfigMapper.insert(cfg);
        if (makeDefault) clearOtherDefaults(cfg.getId());
        return Map.of("ok", true, "gateway", toConfigDto(cfg));
    }

    @PatchMapping("/gateways/{id}")
    public Map<String, Object> updateGateway(@PathVariable Integer id, @RequestBody Map<String, Object> body) {
        AiConfig cfg = aiConfigMapper.selectById(id);
        if (cfg == null) return err("网关不存在");
        if (body.get("name") != null) {
            String name = body.get("name").toString().trim();
            if (name.isBlank()) return err("网关名称不能为空");
            if (name.length() > 32) return err("网关名称过长（最多 32 字）");
            cfg.setName(name);
        }
        if (body.get("provider") != null) cfg.setProvider(body.get("provider").toString());
        if (body.get("base_url") != null) cfg.setBaseUrl(body.get("base_url").toString().trim());
        if (body.get("model") != null) cfg.setModel(body.get("model").toString().trim());
        if (body.get("temperature") != null) cfg.setTemperature(Double.parseDouble(body.get("temperature").toString()));
        if (body.get("enabled") != null) cfg.setEnabled(Boolean.parseBoolean(body.get("enabled").toString()) ? 1 : 0);
        if (body.get("api_key") != null) {
            String key = body.get("api_key").toString().trim();
            // 打码前缀（****）视为未修改
            if (!key.startsWith("****") && !key.isBlank()) cfg.setApiKey(key);
        }
        if (body.get("is_default") != null && Boolean.parseBoolean(body.get("is_default").toString())) {
            cfg.setIsDefault(1);
            clearOtherDefaults(cfg.getId());
        }
        cfg.setUpdatedAt(LocalDateTime.now());
        aiConfigMapper.updateById(cfg);
        return Map.of("ok", true, "gateway", toConfigDto(cfg));
    }

    @DeleteMapping("/gateways/{id}")
    public Map<String, Object> deleteGateway(@PathVariable Integer id) {
        return deleteOne(id.longValue());
    }

    /** 单条删除（批量删除复用）：至少保留一个网关 + 默认网关自动移交；返回 {ok} 或 {ok:false, error} */
    private Map<String, Object> deleteOne(Long id) {
        AiConfig cfg = aiConfigMapper.selectById(id);
        if (cfg == null) return err("网关不存在");
        long count = aiConfigMapper.selectCount(null);
        if (count <= 1) return err("至少保留一个 AI 网关");
        aiConfigMapper.deleteById(id);
        // 删除的是默认网关 → 自动把 id 最小的一条设为默认
        if (cfg.getIsDefault() != null && cfg.getIsDefault() == 1) {
            AiConfig next = aiConfigMapper.selectList(Wrappers.<AiConfig>lambdaQuery()
                            .orderByAsc(AiConfig::getId).last("LIMIT 1"))
                    .stream().findFirst().orElse(null);
            if (next != null) {
                next.setIsDefault(1);
                aiConfigMapper.updateById(next);
            }
        }
        return Map.of("ok", true);
    }

    // —— 网关批量操作 ——

    /** 批量创建：{items: [{name,provider,base_url,api_key,model,temperature,enabled,is_default}, ...]} */
    @PostMapping("/gateways/batch-create")
    public Map<String, Object> batchCreate(@RequestBody Map<String, Object> body) {
        if (!(body.get("items") instanceof List<?> items) || items.isEmpty()) return err("items 不能为空");
        List<Map<String, Object>> errors = new ArrayList<>();
        int created = 0;
        for (int i = 0; i < items.size(); i++) {
            if (!(items.get(i) instanceof Map<?, ?> im)) {
                errors.add(BatchOps.itemError("index", i, "条目必须是对象"));
                continue;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> resp = createOne((Map<String, Object>) im);
            if (Boolean.TRUE.equals(resp.get("ok"))) created++;
            else errors.add(BatchOps.itemError("index", i, String.valueOf(resp.get("error"))));
        }
        return BatchOps.result("created", created, errors);
    }

    /** 批量更新：{ids: [], data: {enabled / temperature / provider / base_url / model}} */
    @PostMapping("/gateways/batch-update")
    public Map<String, Object> batchUpdate(@RequestBody Map<String, Object> body) {
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) return err("ids 不能为空");
        if (!(body.get("data") instanceof Map<?, ?> data) || data.isEmpty()) {
            return err("data 不能为空（支持 enabled / temperature / provider / base_url / model）");
        }
        List<Map<String, Object>> errors = new ArrayList<>();
        int updated = 0;
        for (Long id : ids) {
            AiConfig cfg = aiConfigMapper.selectById(id.intValue());
            if (cfg == null) {
                errors.add(BatchOps.itemError("id", id, "网关不存在"));
                continue;
            }
            try {
                if (data.get("provider") != null) cfg.setProvider(data.get("provider").toString());
                if (data.get("base_url") != null) cfg.setBaseUrl(data.get("base_url").toString().trim());
                if (data.get("model") != null) cfg.setModel(data.get("model").toString().trim());
                if (data.get("temperature") != null) cfg.setTemperature(Double.parseDouble(data.get("temperature").toString()));
                if (data.get("enabled") != null) cfg.setEnabled(Boolean.parseBoolean(data.get("enabled").toString()) ? 1 : 0);
                cfg.setUpdatedAt(LocalDateTime.now());
                aiConfigMapper.updateById(cfg);
                updated++;
            } catch (Exception e) {
                errors.add(BatchOps.itemError("id", id, e.getMessage() == null ? "更新失败" : e.getMessage()));
            }
        }
        return BatchOps.result("updated", updated, errors);
    }

    /** 批量删除：{ids: []}（至少保留一个网关，逐条校验） */
    @PostMapping("/gateways/batch-delete")
    public Map<String, Object> batchDelete(@RequestBody Map<String, Object> body) {
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) return err("ids 不能为空");
        List<Map<String, Object>> errors = new ArrayList<>();
        int deleted = 0;
        for (Long id : ids) {
            Map<String, Object> resp = deleteOne(id);
            if (Boolean.TRUE.equals(resp.get("ok"))) deleted++;
            else errors.add(BatchOps.itemError("id", id, String.valueOf(resp.get("error"))));
        }
        return BatchOps.result("deleted", deleted, errors);
    }

    @PostMapping("/gateways/{id}/test")
    public Map<String, Object> testGateway(@PathVariable Integer id) {
        AiConfig cfg = aiConfigMapper.selectById(id);
        if (cfg == null) return Map.of("ok", false, "error", "网关不存在");
        Map<String, String> r = callLlm(cfg, List.of(Map.of("role", "user", "content", "ping")), 8);
        if (r.get("error") != null) return Map.of("ok", false, "error", r.get("error"));
        return Map.of("ok", true, "reply", r.get("output"));
    }

    // —— 默认网关（前台工作平台 / 对话 / 兼容接口） ——

    /** 取默认网关；没有则取任一启用网关；再没有则自动创建一条 */
    private AiConfig getDefaultConfig() {
        AiConfig cfg = aiConfigMapper.selectOne(Wrappers.<AiConfig>lambdaQuery()
                .eq(AiConfig::getIsDefault, 1).last("LIMIT 1"));
        if (cfg == null) {
            cfg = aiConfigMapper.selectOne(Wrappers.<AiConfig>lambdaQuery()
                    .eq(AiConfig::getEnabled, 1).orderByAsc(AiConfig::getId).last("LIMIT 1"));
        }
        if (cfg == null) {
            cfg = aiConfigMapper.selectOne(Wrappers.<AiConfig>lambdaQuery().orderByAsc(AiConfig::getId).last("LIMIT 1"));
        }
        if (cfg == null) {
            cfg = new AiConfig();
            cfg.setName("默认网关");
            cfg.setProvider("openai-compatible");
            cfg.setBaseUrl("");
            cfg.setApiKey("");
            cfg.setModel("");
            cfg.setTemperature(0.7);
            cfg.setEnabled(0);
            cfg.setIsDefault(1);
            cfg.setUpdatedAt(LocalDateTime.now());
            aiConfigMapper.insert(cfg);
        }
        return cfg;
    }

    private void clearOtherDefaults(Integer exceptId) {
        List<AiConfig> others = aiConfigMapper.selectList(Wrappers.<AiConfig>lambdaQuery()
                .eq(AiConfig::getIsDefault, 1).ne(AiConfig::getId, exceptId));
        for (AiConfig o : others) {
            o.setIsDefault(0);
            aiConfigMapper.updateById(o);
        }
    }

    @GetMapping("/config")
    public Map<String, Object> config() {
        return Map.of("ok", true, "config", toConfigDto(getDefaultConfig()));
    }

    @PutMapping("/config")
    public Map<String, Object> saveConfig(@RequestBody Map<String, Object> body) {
        AiConfig cfg = getDefaultConfig();
        if (body.get("name") != null) cfg.setName(body.get("name").toString().trim());
        if (body.get("base_url") != null) cfg.setBaseUrl(body.get("base_url").toString().trim());
        if (body.get("model") != null) cfg.setModel(body.get("model").toString().trim());
        if (body.get("provider") != null) cfg.setProvider(body.get("provider").toString());
        if (body.get("temperature") != null) cfg.setTemperature(Double.parseDouble(body.get("temperature").toString()));
        if (body.get("enabled") != null) cfg.setEnabled(Boolean.parseBoolean(body.get("enabled").toString()) ? 1 : 0);
        if (body.get("api_key") != null) {
            String key = body.get("api_key").toString().trim();
            // 打码前缀（****）视为未修改
            if (!key.startsWith("****")) cfg.setApiKey(key);
        }
        cfg.setUpdatedAt(LocalDateTime.now());
        aiConfigMapper.updateById(cfg);
        return Map.of("ok", true, "config", toConfigDto(cfg));
    }

    @PostMapping("/test")
    public Map<String, Object> test() {
        Map<String, String> r = callLlm(getDefaultConfig(), List.of(Map.of("role", "user", "content", "ping")), 8);
        if (r.get("error") != null) return Map.of("ok", false, "error", r.get("error"));
        return Map.of("ok", true, "reply", r.get("output"));
    }

    @PostMapping("/chat")
    public Map<String, Object> chat(@RequestBody Map<String, Object> body) {
        List<Map<String, Object>> raw = body.get("messages") instanceof List<?> l
                ? l.stream().filter(m -> m instanceof Map).map(m -> (Map<String, Object>) m).toList()
                : List.of();
        List<Map<String, String>> messages = new ArrayList<>();
        for (Map<String, Object> m : raw) {
            String role = m.get("role") == null ? "" : m.get("role").toString();
            String content = m.get("content") == null ? "" : m.get("content").toString();
            if (List.of("system", "user", "assistant").contains(role)) {
                messages.add(Map.of("role", role, "content", content));
            }
        }
        if (messages.isEmpty()) return Map.of("error", "messages 不能为空");

        boolean useKnowledge = body.get("useKnowledge") != null && Boolean.parseBoolean(body.get("useKnowledge").toString());
        List<Map<String, Object>> usedDocs = new ArrayList<>();
        if (useKnowledge) {
            String lastUser = "";
            for (int i = messages.size() - 1; i >= 0; i--) {
                if ("user".equals(messages.get(i).get("role"))) {
                    lastUser = messages.get(i).get("content");
                    break;
                }
            }
            if (!lastUser.isBlank()) {
                final String query = lastUser;
                List<Doc> hits = docMapper.selectList(new QueryWrapper<Doc>()
                        .and(w -> w.like("title", query).or().like("content", query))
                        .last("LIMIT 3"));
                if (!hits.isEmpty()) {
                    StringBuilder sb = new StringBuilder("你是工作台知识助手。请优先依据以下知识库资料回答；资料不足时如实说明，不要编造。\n\n===== 知识库资料 =====\n");
                    for (Doc d : hits) {
                        sb.append("【文档：").append(d.getTitle()).append("】\n")
                                .append(d.getContent() == null ? "" : d.getContent().replaceAll("\\s+", " ").trim().substring(0, Math.min(500, d.getContent().length()))).append("\n\n");
                        usedDocs.add(Map.of("id", d.getId(), "title", d.getTitle()));
                    }
                    sb.append("===== 资料结束 =====\n");
                    List<Map<String, String>> injected = new ArrayList<>();
                    injected.add(Map.of("role", "system", "content", sb.toString()));
                    injected.addAll(messages);
                    messages = injected;
                }
            }
        }
        Map<String, String> r = callLlm(getDefaultConfig(), messages, 2000);
        if (r.get("error") != null) return Map.of("ok", false, "error", r.get("error"));
        return Map.of("ok", true, "reply", r.get("output"), "usedDocs", usedDocs);
    }

    // —— 内部 ——

    private Map<String, Object> toConfigDto(AiConfig c) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", c.getId());
        m.put("name", c.getName() == null || c.getName().isBlank() ? "默认网关" : c.getName());
        m.put("provider", c.getProvider() == null ? "openai-compatible" : c.getProvider());
        m.put("base_url", c.getBaseUrl() == null ? "" : c.getBaseUrl());
        m.put("api_key", maskKey(c.getApiKey()));
        m.put("model", c.getModel() == null ? "" : c.getModel());
        m.put("temperature", c.getTemperature() == null ? 0.7 : c.getTemperature());
        m.put("enabled", c.getEnabled() != null && c.getEnabled() == 1);
        m.put("is_default", c.getIsDefault() != null && c.getIsDefault() == 1);
        m.put("updated_at", c.getUpdatedAt() == null ? null : c.getUpdatedAt().toString().replace("T", " "));
        return m;
    }

    private String maskKey(String key) {
        if (key == null || key.isBlank()) return "";
        return key.length() <= 4 ? "****" : "****" + key.substring(key.length() - 4);
    }

    private boolean ready(AiConfig c) {
        return c != null && c.getEnabled() != null && c.getEnabled() == 1
                && c.getBaseUrl() != null && !c.getBaseUrl().isBlank()
                && c.getApiKey() != null && !c.getApiKey().isBlank()
                && c.getModel() != null && !c.getModel().isBlank();
    }

    private Map<String, String> callLlm(AiConfig cfg, List<Map<String, String>> messages, int maxTokens) {
        if (!ready(cfg)) {
            return Map.of("error", "AI 网关「" + (cfg.getName() == null ? "默认网关" : cfg.getName())
                    + "」未启用或未完整配置：请填写 Base URL / API Key / 模型并启用");
        }
        String base = cfg.getBaseUrl().trim().replaceAll("/+$", "");
        String url = base.toLowerCase().endsWith("/chat/completions") ? base : base + "/chat/completions";
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("model", cfg.getModel());
            payload.put("messages", messages);
            payload.put("temperature", cfg.getTemperature() == null ? 0.7 : cfg.getTemperature());
            payload.put("max_tokens", maxTokens);
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(90))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + cfg.getApiKey())
                    .POST(HttpRequest.BodyPublishers.ofString(om.writeValueAsString(payload), StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> resp = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (resp.statusCode() >= 400) {
                String body = resp.body();
                return Map.of("error", "AI 网关返回 HTTP " + resp.statusCode() + "：" + (body.length() > 500 ? body.substring(0, 500) : body));
            }
            Map<String, Object> data = om.readValue(resp.body(), new TypeReference<Map<String, Object>>() {});
            if (data.get("error") != null) return Map.of("error", "AI 网关错误：" + data.get("error").toString());
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

    private Map<String, Object> err(String msg) {
        return Map.of("ok", false, "error", msg);
    }
}
