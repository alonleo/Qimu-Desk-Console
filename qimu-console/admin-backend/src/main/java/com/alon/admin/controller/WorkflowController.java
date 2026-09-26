package com.alon.admin.controller;

import com.alon.admin.common.BatchOps;
import com.alon.admin.common.VisibilityPolicy;
import com.alon.admin.entity.Run;
import com.alon.admin.entity.User;
import com.alon.admin.entity.Workflow;
import com.alon.admin.mapper.RunMapper;
import com.alon.admin.mapper.UserMapper;
import com.alon.admin.mapper.WorkflowMapper;
import com.alon.admin.service.WorkflowEngine;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/** 工作流管理：列表 / 详情 / 执行 / 运行历史（含可见性过滤与写权限，见 VisibilityPolicy） */
@RestController
@RequestMapping("/api")
public class WorkflowController {

    private final WorkflowMapper workflowMapper;
    private final RunMapper runMapper;
    private final WorkflowEngine engine;
    private final UserMapper userMapper;
    private final JdbcTemplate jdbc;
    private final ObjectMapper om = new ObjectMapper();

    public WorkflowController(WorkflowMapper workflowMapper, RunMapper runMapper, WorkflowEngine engine,
                              UserMapper userMapper, JdbcTemplate jdbc) {
        this.workflowMapper = workflowMapper;
        this.runMapper = runMapper;
        this.engine = engine;
        this.userMapper = userMapper;
        this.jdbc = jdbc;
    }

    /**
     * 墓碑：删除时记录 name，供 alon-workbench 文件播种跳过，避免「后台删除 → 播种复活」。
     * 表首次使用时自动创建；墓碑失败不阻塞删除主流程。
     */
    private void tombstone(String kind, String name) {
        try {
            jdbc.execute("CREATE TABLE IF NOT EXISTS deleted_seeds (" +
                    "id BIGINT AUTO_INCREMENT PRIMARY KEY," +
                    "kind VARCHAR(16) NOT NULL," +
                    "name VARCHAR(191) NOT NULL," +
                    "deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP," +
                    "UNIQUE KEY uk_deleted_seeds (kind, name))");
            jdbc.update("INSERT IGNORE INTO deleted_seeds (kind, name) VALUES (?, ?)", kind, name);
        } catch (Exception ignored) {
        }
    }

    /** 同名重新创建时撤销墓碑（恢复文件播种能力） */
    private void untombstone(String kind, String name) {
        try {
            jdbc.update("DELETE FROM deleted_seeds WHERE kind = ? AND name = ?", kind, name);
        } catch (Exception ignored) {
        }
    }

    @GetMapping("/workflows")
    public Map<String, Object> list(HttpServletRequest req,
                                    @RequestParam(required = false) String visibility,
                                    @RequestParam(required = false) Long ownerId) {
        User user = VisibilityPolicy.currentUser(req);
        var q = Wrappers.<Workflow>lambdaQuery().orderByAsc(Workflow::getId);
        VisibilityPolicy.applyScope(user, q);
        String vis = VisibilityPolicy.parseVisibility(visibility);
        if (vis != null) q.eq(Workflow::getVisibility, vis);
        if (ownerId != null) q.eq(Workflow::getOwnerId, ownerId);
        List<Workflow> all = workflowMapper.selectList(q);
        Map<Long, String> ownerNames = VisibilityPolicy.ownerNames(
                userMapper, all.stream().map(Workflow::getOwnerId).toList());
        List<Map<String, Object>> workflows = all.stream()
                .map(w -> toWorkflowItem(w, ownerNames))
                .toList();
        return Map.of("workflows", workflows);
    }

    @GetMapping("/workflows/{id}")
    public Map<String, Object> detail(@PathVariable Long id, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        Workflow w = workflowMapper.selectById(id);
        if (w == null) return Map.of("error", "工作流不存在");
        if (!VisibilityPolicy.canRead(user, w.getVisibility(), w.getOwnerId())) {
            return Map.of("error", "无权访问");
        }
        IPage<Run> page = runMapper.selectPage(Page.of(1, 10),
                Wrappers.<Run>lambdaQuery()
                        .eq(Run::getWorkflowId, id)
                        .orderByDesc(Run::getId));
        List<Map<String, Object>> runs = page.getRecords().stream().map(r -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", r.getId());
            m.put("workflow_name", w.getName());
            m.put("status", r.getStatus());
            m.put("duration_ms", r.getDurationMs());
            m.put("triggered_by", r.getTriggeredBy());
            m.put("started_at", dt(r.getStartedAt()));
            m.put("steps", parseSteps(r.getLogs()));
            return m;
        }).toList();
        Map<Long, String> ownerNames = VisibilityPolicy.ownerNames(userMapper, List.of(w.getOwnerId()));
        return Map.of("workflow", toWorkflowItem(w, ownerNames), "runs", runs);
    }

    // —— 工作流 CRUD ——

    private static final Set<String> DEF_KEYS = Set.of("displayName", "description", "color", "params", "steps", "file", "source", "version");

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseDef(String definition) {
        if (definition == null || definition.isBlank()) return new HashMap<>();
        try {
            return om.readValue(definition, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return new HashMap<>();
        }
    }

    /** 组装 definition JSON：白名单字段 + 必填默认值 */
    private String buildDefinition(Map<String, Object> def, String name, int version) {
        if (def.get("displayName") == null) def.put("displayName", name);
        if (def.get("description") == null) def.put("description", "");
        if (def.get("color") == null) def.put("color", "#fa8c16");
        if (def.get("params") == null) def.put("params", List.of());
        if (def.get("steps") == null) def.put("steps", List.of());
        if (def.get("source") == null) def.put("source", "admin");
        def.put("file", name + ".yml");
        def.put("version", version);
        try {
            return om.writeValueAsString(def);
        } catch (Exception e) {
            return "{}";
        }
    }

    /** 从请求体提取白名单字段（避免未知键污染） */
    private Map<String, Object> pickDefFields(Map<String, Object> body) {
        Map<String, Object> def = new HashMap<>();
        for (String k : DEF_KEYS) {
            if (body.get(k) != null) def.put(k, body.get(k));
        }
        return def;
    }

    @PostMapping("/workflows")
    public Map<String, Object> create(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        return createOne(body, VisibilityPolicy.currentUser(req));
    }

    /** 单条创建（批量创建复用）；返回 {ok, workflow} 或 {ok:false, error}；owner_id 服务端注入、visibility 归一化 */
    private Map<String, Object> createOne(Map<String, Object> body, User user) {
        String name = body.getOrDefault("name", "").toString().trim();
        if (name.isBlank()) return err("工作流标识不能为空");
        if (!name.matches("[a-z0-9][a-z0-9-]*")) return err("工作流标识需为小写字母、数字或短横线");
        if (workflowMapper.selectCount(Wrappers.<Workflow>lambdaQuery().eq(Workflow::getName, name)) > 0) {
            return err("工作流「" + name + "」已存在");
        }
        Object steps = body.get("steps");
        if (steps == null || (steps instanceof List<?> l && l.isEmpty())) return err("至少需要定义一个步骤");
        Workflow w = new Workflow();
        w.setName(name);
        w.setDescription(body.get("description") == null ? "" : body.get("description").toString());
        w.setDefinition(buildDefinition(pickDefFields(body), name, 1));
        w.setVersion(1);
        // 可见性注入：owner_id 一律服务端取当前用户（不信任前端）；visibility 非法值回落默认
        w.setOwnerId(user == null ? null : user.getId());
        w.setVisibility(VisibilityPolicy.resolveVisibility(user, body.get("visibility")));
        w.setCreatedAt(LocalDateTime.now());
        w.setUpdatedAt(LocalDateTime.now());
        workflowMapper.insert(w);
        untombstone("workflow", name);
        return Map.of("ok", true, "workflow", toWorkflowItem(w, Map.of()));
    }

    @PatchMapping("/workflows/{id}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable Long id, @RequestBody Map<String, Object> body,
                                                      HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        Workflow w = workflowMapper.selectById(id);
        if (w == null) return ResponseEntity.ok(err("工作流不存在"));
        // 写权限边界（P1）：member 不能修改他人条目（含他人创建的通用条目）
        if (!VisibilityPolicy.canWrite(user, w.getOwnerId())) {
            return ResponseEntity.status(403).body(err(VisibilityPolicy.FORBIDDEN_MSG));
        }
        String name = w.getName();
        if (body.get("name") != null) {
            String nn = body.get("name").toString().trim();
            if (!nn.matches("[a-z0-9][a-z0-9-]*")) {
                return ResponseEntity.ok(err("工作流标识需为小写字母、数字或短横线"));
            }
            if (!nn.equals(w.getName())
                    && workflowMapper.selectCount(Wrappers.<Workflow>lambdaQuery().eq(Workflow::getName, nn)) > 0) {
                return ResponseEntity.ok(err("工作流「" + nn + "」已存在"));
            }
            name = nn;
            w.setName(nn);
        }
        Object steps = body.get("steps");
        if (steps != null && (steps instanceof List<?> l && l.isEmpty())) {
            return ResponseEntity.ok(err("至少需要定义一个步骤"));
        }
        if (body.get("description") != null) w.setDescription(body.get("description").toString());
        // 可见性更新（可选）：仅接受 personal/public，非法值忽略
        String vis = VisibilityPolicy.parseVisibility(body.get("visibility"));
        if (vis != null) w.setVisibility(vis);
        int nextVersion = (w.getVersion() == null ? 0 : w.getVersion()) + 1;
        Map<String, Object> def = parseDef(w.getDefinition());
        def.putAll(pickDefFields(body));
        w.setDefinition(buildDefinition(def, name, nextVersion));
        w.setVersion(nextVersion);
        w.setUpdatedAt(LocalDateTime.now());
        workflowMapper.updateById(w);
        untombstone("workflow", name);
        return ResponseEntity.ok(Map.of("ok", true, "workflow", toWorkflowItem(w, Map.of())));
    }

    @DeleteMapping("/workflows/{id}")
    public ResponseEntity<Map<String, Object>> delete(@PathVariable Long id, HttpServletRequest req) {
        return toResponse(deleteOne(id, VisibilityPolicy.currentUser(req)));
    }

    /** 单条删除（批量删除复用）：级联删除运行记录 + 墓碑；返回 {ok} 或 {ok:false, error, forbidden?} */
    private Map<String, Object> deleteOne(Long id, User user) {
        Workflow w = workflowMapper.selectById(id);
        if (w == null) return err("工作流不存在");
        // 写权限边界（P1）：member 不能删除他人条目
        if (!VisibilityPolicy.canWrite(user, w.getOwnerId())) {
            return forbidden();
        }
        runMapper.delete(Wrappers.<Run>lambdaQuery().eq(Run::getWorkflowId, id));
        workflowMapper.deleteById(id);
        tombstone("workflow", w.getName());
        return Map.of("ok", true);
    }

    // —— 工作流批量操作 ——

    /** 批量创建：{items: [{name,displayName,description,color,params,steps}, ...]} */
    @PostMapping("/workflows/batch-create")
    public Map<String, Object> batchCreate(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        if (!(body.get("items") instanceof List<?> items) || items.isEmpty()) return err("items 不能为空");
        List<Map<String, Object>> errors = new ArrayList<>();
        int created = 0;
        for (int i = 0; i < items.size(); i++) {
            if (!(items.get(i) instanceof Map<?, ?> im)) {
                errors.add(BatchOps.itemError("index", i, "条目必须是对象"));
                continue;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> resp = createOne((Map<String, Object>) im, user);
            if (Boolean.TRUE.equals(resp.get("ok"))) created++;
            else errors.add(BatchOps.itemError("index", i, String.valueOf(resp.get("error"))));
        }
        return BatchOps.result("created", created, errors);
    }

    /** 批量更新：{ids: [], data: {displayName / description / color / visibility}} */
    @PostMapping("/workflows/batch-update")
    public Map<String, Object> batchUpdate(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) return err("ids 不能为空");
        if (!(body.get("data") instanceof Map<?, ?> data) || data.isEmpty()) {
            return err("data 不能为空（支持 displayName / description / color / visibility）");
        }
        String vis = VisibilityPolicy.parseVisibility(data.get("visibility"));
        List<Map<String, Object>> errors = new ArrayList<>();
        int updated = 0;
        for (Long id : ids) {
            Workflow w = workflowMapper.selectById(id);
            if (w == null) {
                errors.add(BatchOps.itemError("id", id, "工作流不存在"));
                continue;
            }
            // 批量越权逐条拦截：计入 itemError，保留部分成功语义
            if (!VisibilityPolicy.canWrite(user, w.getOwnerId())) {
                errors.add(BatchOps.itemError("id", id, VisibilityPolicy.BATCH_FORBIDDEN_MSG));
                continue;
            }
            try {
                Map<String, Object> def = parseDef(w.getDefinition());
                Map<String, Object> patch = new HashMap<>();
                for (Map.Entry<?, ?> e : data.entrySet()) patch.put(String.valueOf(e.getKey()), e.getValue());
                def.putAll(pickDefFields(patch));
                int nextVersion = (w.getVersion() == null ? 0 : w.getVersion()) + 1;
                w.setDefinition(buildDefinition(def, w.getName(), nextVersion));
                w.setVersion(nextVersion);
                if (vis != null) w.setVisibility(vis);
                w.setUpdatedAt(LocalDateTime.now());
                workflowMapper.updateById(w);
                updated++;
            } catch (Exception e) {
                errors.add(BatchOps.itemError("id", id, e.getMessage() == null ? "更新失败" : e.getMessage()));
            }
        }
        return BatchOps.result("updated", updated, errors);
    }

    /** 批量删除：{ids: []}（级联删除运行记录；逐条 canWrite 越权拦截） */
    @PostMapping("/workflows/batch-delete")
    public Map<String, Object> batchDelete(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) return err("ids 不能为空");
        List<Map<String, Object>> errors = new ArrayList<>();
        int deleted = 0;
        for (Long id : ids) {
            Map<String, Object> resp = deleteOne(id, user);
            if (Boolean.TRUE.equals(resp.get("ok"))) deleted++;
            else errors.add(BatchOps.itemError("id", id, String.valueOf(resp.get("error"))));
        }
        return BatchOps.result("deleted", deleted, errors);
    }

    @PostMapping("/workflows/{id}/run")
    public Map<String, Object> run(@PathVariable Long id, @RequestBody(required = false) Map<String, Object> body) {        Workflow w = workflowMapper.selectById(id);
        if (w == null) return Map.of("error", "工作流不存在");
        Map<String, String> params = new HashMap<>();
        if (body != null && body.get("params") instanceof Map<?, ?> p) {
            for (Map.Entry<?, ?> e : p.entrySet()) params.put(e.getKey().toString(), e.getValue() == null ? "" : e.getValue().toString());
        }
        long t0 = System.currentTimeMillis();
        List<Map<String, Object>> steps = engine.execute(w, params, "admin");
        long duration = System.currentTimeMillis() - t0;
        boolean success = steps.stream().noneMatch(s -> "failed".equals(s.get("status")));

        Run run = new Run();
        run.setWorkflowId(id);
        run.setStatus(success ? "success" : "failed");
        run.setTrigger("manual");
        run.setStartedAt(LocalDateTime.now());
        run.setFinishedAt(LocalDateTime.now());
        run.setDurationMs(duration);
        run.setTriggeredBy("admin");
        try {
            run.setLogs(om.writeValueAsString(steps));
        } catch (Exception e) {
            run.setLogs("[]");
        }
        runMapper.insert(run);

        Map<String, Object> resp = new HashMap<>();
        resp.put("runId", run.getId());
        resp.put("status", run.getStatus());
        resp.put("durationMs", duration);
        resp.put("steps", steps);
        return resp;
    }

    @GetMapping("/workflow-runs")
    public Map<String, Object> runs(@RequestParam(required = false) Long workflowId,
                                    @RequestParam(defaultValue = "10") int limit) {
        int lim = Math.min(Math.max(limit, 1), 50);
        var q = Wrappers.<Run>lambdaQuery()
                .orderByDesc(Run::getId);
        if (workflowId != null) q.eq(Run::getWorkflowId, workflowId);
        IPage<Run> page = runMapper.selectPage(Page.of(1, lim), q);

        // 批量取出涉及的 workflow 名，避免逐行 selectById 的 N+1；空列表会生成非法 IN ()，必须先判空
        List<Long> wfIds = page.getRecords().stream().map(Run::getWorkflowId)
                .filter(java.util.Objects::nonNull).distinct().toList();
        Map<Long, String> nameMap = wfIds.isEmpty() ? Map.of()
                : workflowMapper.selectBatchIds(wfIds).stream()
                        .collect(Collectors.toMap(Workflow::getId, Workflow::getName, (a, b) -> a));

        List<Map<String, Object>> runs = page.getRecords().stream().map(r -> {
            String wfName = r.getWorkflowId() == null ? null : nameMap.get(r.getWorkflowId());
            Map<String, Object> m = new HashMap<>();
            m.put("id", r.getId());
            m.put("workflow_name", wfName == null ? "-" : wfName);
            m.put("status", r.getStatus());
            m.put("duration_ms", r.getDurationMs());
            m.put("triggered_by", r.getTriggeredBy());
            m.put("started_at", dt(r.getStartedAt()));
            return m;
        }).toList();
        return Map.of("runs", runs);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> parseSteps(String logs) {
        if (logs == null || logs.isBlank()) return List.of();
        try {
            return om.readValue(logs, new TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private Map<String, Object> toWorkflowItem(Workflow w, Map<Long, String> ownerNames) {
        Map<String, Object> item = new HashMap<>();
        Map<String, Object> def;
        try {
            def = om.readValue(w.getDefinition(), new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            def = new HashMap<>();
        }
        item.put("id", w.getId());
        item.put("name", w.getName());
        item.put("displayName", def.get("displayName") != null ? def.get("displayName").toString() : w.getName());
        item.put("description", def.get("description") != null ? def.get("description").toString() : (w.getDescription() == null ? "" : w.getDescription()));
        item.put("color", def.get("color") != null ? def.get("color").toString() : "#fa8c16");
        item.put("params", def.get("params") instanceof List<?> lp ? lp : List.of());
        item.put("steps", def.get("steps") instanceof List<?> ls ? ls : List.of());
        item.put("version", w.getVersion());
        item.put("file", def.get("file") != null ? def.get("file") : w.getName() + ".yml");
        // 来源标识透出：source 列优先；definition JSON 兜底仅认标记值（admin→manual）
        item.put("source", resolveSource(w.getSource(), def.get("source")));
        // 可见性透出：visibility 缺省按 public（旧数据/降级），owner_name 由 users 批量组装
        item.put("visibility", w.getVisibility() == null ? VisibilityPolicy.PUBLIC : w.getVisibility());
        item.put("owner_id", w.getOwnerId());
        item.put("owner_name", ownerNames == null ? null : ownerNames.get(w.getOwnerId()));
        item.put("created_at", dt(w.getCreatedAt()));
        item.put("updated_at", dt(w.getUpdatedAt()));
        return item;
    }

    /**
     * 来源标识归一化（§3.4）：DB 列优先；JSON 兜底只认标记值 manual/file/ai/admin（admin→manual），
     * 非标记长文本（历史原始 YAML）与未知值一律归为 manual。
     */
    private static String resolveSource(String column, Object jsonSource) {
        if (column != null && !column.isBlank()) return column;
        if (jsonSource instanceof String s && Set.of("manual", "file", "ai", "admin").contains(s)) {
            if ("ai".equals(s)) return "ai";
            if ("file".equals(s)) return "file";
            return "manual";
        }
        return "manual";
    }

    private String dt(LocalDateTime v) {
        return v == null ? null : v.toString().replace("T", " ");
    }

    private Map<String, Object> err(String msg) {
        return Map.of("ok", false, "error", msg);
    }

    /** 单条写越权响应体：{ok:false, error, forbidden:true}（forbidden 标记供 403 分流用） */
    private Map<String, Object> forbidden() {
        Map<String, Object> m = new HashMap<>();
        m.put("ok", false);
        m.put("error", VisibilityPolicy.FORBIDDEN_MSG);
        m.put("forbidden", true);
        return m;
    }

    /** 单条写响应：越权 → HTTP 403，其余统一 200（与既有 err() 契约一致） */
    private ResponseEntity<Map<String, Object>> toResponse(Map<String, Object> resp) {
        return Boolean.TRUE.equals(resp.get("forbidden"))
                ? ResponseEntity.status(403).body(resp)
                : ResponseEntity.ok(resp);
    }
}
