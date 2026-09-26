package com.alon.admin.controller;

import com.alon.admin.common.BatchOps;
import com.alon.admin.common.VisibilityPolicy;
import com.alon.admin.entity.Skill;
import com.alon.admin.entity.SkillRun;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.SkillMapper;
import com.alon.admin.mapper.SkillRunMapper;
import com.alon.admin.mapper.UserMapper;
import com.alon.admin.service.SkillExecutor;
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

/** 技能管理：列表 / 详情 / 执行 / 运行历史（含可见性过滤与写权限，见 VisibilityPolicy） */
@RestController
@RequestMapping("/api")
public class SkillController {

    private static final Map<String, String> TYPE_COLORS = Map.of(
            "shell", "#52c41a", "prompt", "#722ed1", "http", "#13c2c2");

    private final SkillMapper skillMapper;
    private final SkillRunMapper skillRunMapper;
    private final SkillExecutor executor;
    private final UserMapper userMapper;
    private final JdbcTemplate jdbc;
    private final ObjectMapper om = new ObjectMapper();

    public SkillController(SkillMapper skillMapper, SkillRunMapper skillRunMapper, SkillExecutor executor,
                           UserMapper userMapper, JdbcTemplate jdbc) {
        this.skillMapper = skillMapper;
        this.skillRunMapper = skillRunMapper;
        this.executor = executor;
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

    /** 列表：member 追加可见性 scope（自己创建的 + 通用）；可选 visibility / ownerId 筛选（admin 场景为主） */
    @GetMapping("/skills")
    public Map<String, Object> list(HttpServletRequest req,
                                    @RequestParam(required = false) String visibility,
                                    @RequestParam(required = false) Long ownerId) {
        User user = VisibilityPolicy.currentUser(req);
        var q = Wrappers.<Skill>lambdaQuery().orderByAsc(Skill::getName);
        VisibilityPolicy.applyScope(user, q);
        String vis = VisibilityPolicy.parseVisibility(visibility);
        if (vis != null) q.eq(Skill::getVisibility, vis);
        if (ownerId != null) q.eq(Skill::getOwnerId, ownerId);
        List<Skill> all = skillMapper.selectList(q);

        // 批量组装创建人展示名（一次 selectBatchIds，避免 N+1）
        Map<Long, String> ownerNames = VisibilityPolicy.ownerNames(
                userMapper, all.stream().map(Skill::getOwnerId).toList());

        // 批量聚合：一次取出全部技能的运行次数与最近一次状态，避免列表 N+1
        Map<Long, Long> countMap = skillRunMapper.countGroupBySkill().stream()
                .collect(Collectors.toMap(
                        m -> ((Number) m.get("skillId")).longValue(),
                        m -> ((Number) m.get("cnt")).longValue()));
        Map<Long, String> lastStatusMap = skillRunMapper.lastStatusBySkill().stream()
                .collect(Collectors.toMap(
                        m -> ((Number) m.get("skillId")).longValue(),
                        m -> String.valueOf(m.get("status"))));

        List<Map<String, Object>> skills = all.stream()
                .map(s -> toSkillItem(s, countMap, lastStatusMap, ownerNames))
                .toList();
        return Map.of("skills", skills);
    }

    /** 详情：member 访问他人 personal 条目 → 403 + {"error":"无权访问"} */
    @GetMapping("/skills/{id}")
    public ResponseEntity<Map<String, Object>> detail(@PathVariable Long id, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        Skill s = skillMapper.selectById(id);
        if (s == null) return ResponseEntity.ok(Map.of("error", "技能不存在"));
        if (!VisibilityPolicy.canRead(user, s.getVisibility(), s.getOwnerId())) {
            return ResponseEntity.status(403).body(Map.of("error", "无权访问"));
        }
        IPage<SkillRun> page = skillRunMapper.selectPage(
                Page.of(1, 10),
                Wrappers.<SkillRun>lambdaQuery()
                        .eq(SkillRun::getSkillId, id)
                        .orderByDesc(SkillRun::getId));
        List<Map<String, Object>> runs = page.getRecords().stream()
                .map(r -> runItem(r, null))
                .toList();

        // 单技能详情：run_count 一次 count；last_run_status 直接取最近一条已查结果，避免额外 LIMIT 查询
        long count = skillRunMapper.selectCount(Wrappers.<SkillRun>lambdaQuery().eq(SkillRun::getSkillId, id));
        String lastStatus = page.getRecords().isEmpty() ? null : page.getRecords().get(0).getStatus();
        Map<Long, Long> countMap = Map.of(id, count);
        Map<Long, String> lastStatusMap = lastStatus == null ? Map.of() : Map.of(id, lastStatus);
        return ResponseEntity.ok(Map.of(
                "skill", toSkillItem(s, countMap, lastStatusMap, Map.of()), "runs", runs));
    }

    // —— 技能 CRUD ——

    /** 组装 config JSON：displayName/description/color/params/config(执行配置)/dir */
    private String buildConfig(Map<String, Object> body, String type, String name) {
        Map<String, Object> def = new HashMap<>();
        def.put("displayName", body.getOrDefault("displayName", name));
        def.put("description", body.get("description") == null ? "" : body.get("description").toString());
        def.put("color", body.getOrDefault("color", TYPE_COLORS.getOrDefault(type, "#8c8c8c")));
        def.put("params", body.get("params") == null ? List.of() : body.get("params"));
        def.put("config", body.get("config") == null ? Map.of() : body.get("config"));
        def.put("dir", name);
        try {
            return om.writeValueAsString(def);
        } catch (Exception e) {
            return "{}";
        }
    }

    @PostMapping("/skills")
    public Map<String, Object> create(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        return createOne(body, VisibilityPolicy.currentUser(req));
    }

    /** 单条创建（批量创建复用）；返回 {ok, skill} 或 {ok:false, error}；owner_id 服务端注入、visibility 归一化 */
    private Map<String, Object> createOne(Map<String, Object> body, User user) {
        String name = body.getOrDefault("name", "").toString().trim();
        String type = body.getOrDefault("type", "").toString();
        if (name.isBlank()) return err("技能标识不能为空");
        if (!name.matches("[a-z0-9][a-z0-9-]*")) return err("技能标识需为小写字母、数字或短横线");
        if (!TYPE_COLORS.containsKey(type)) return err("技能类型需为 shell / prompt / http");
        if (skillMapper.selectCount(Wrappers.<Skill>lambdaQuery().eq(Skill::getName, name)) > 0) {
            return err("技能「" + name + "」已存在");
        }
        Object cfg = body.get("config");
        if (cfg == null || (cfg instanceof Map<?, ?> cm && cm.isEmpty())) return err("请填写技能执行配置");
        Skill s = new Skill();
        s.setName(name);
        s.setType(type);
        s.setDescription(body.get("description") == null ? "" : body.get("description").toString());
        s.setConfig(buildConfig(body, type, name));
        // 可见性注入：owner_id 一律服务端取当前用户（不信任前端）；visibility 非法值回落默认
        s.setOwnerId(user == null ? null : user.getId());
        s.setVisibility(VisibilityPolicy.resolveVisibility(user, body.get("visibility")));
        s.setCreatedAt(LocalDateTime.now());
        s.setUpdatedAt(LocalDateTime.now());
        skillMapper.insert(s);
        untombstone("skill", name);
        return Map.of("ok", true, "skill", toSkillItem(s, Map.of(), Map.of(), Map.of()));
    }

    @PatchMapping("/skills/{id}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable Long id, @RequestBody Map<String, Object> body,
                                                      HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        Skill s = skillMapper.selectById(id);
        if (s == null) return ResponseEntity.ok(err("技能不存在"));
        // 写权限边界（P1）：member 不能修改他人条目（含他人创建的通用条目）
        if (!VisibilityPolicy.canWrite(user, s.getOwnerId())) {
            return ResponseEntity.status(403).body(err(VisibilityPolicy.FORBIDDEN_MSG));
        }
        String name = s.getName();
        if (body.get("name") != null) {
            String nn = body.get("name").toString().trim();
            if (!nn.matches("[a-z0-9][a-z0-9-]*")) return ResponseEntity.ok(err("技能标识需为小写字母、数字或短横线"));
            if (!nn.equals(s.getName())
                    && skillMapper.selectCount(Wrappers.<Skill>lambdaQuery().eq(Skill::getName, nn)) > 0) {
                return ResponseEntity.ok(err("技能「" + nn + "」已存在"));
            }
            name = nn;
            s.setName(nn);
        }
        String type = s.getType();
        if (body.get("type") != null) {
            String nt = body.get("type").toString();
            if (!TYPE_COLORS.containsKey(nt)) return ResponseEntity.ok(err("技能类型需为 shell / prompt / http"));
            type = nt;
            s.setType(nt);
        }
        if (body.get("description") != null) s.setDescription(body.get("description").toString());
        Object cfg = body.get("config");
        if (cfg != null && (cfg instanceof Map<?, ?> cm && cm.isEmpty())) return ResponseEntity.ok(err("技能执行配置不能为空"));
        Map<String, Object> def = parseConfig(s.getConfig());
        def.put("displayName", body.getOrDefault("displayName", def.get("displayName") == null ? name : def.get("displayName")));
        def.put("description", body.getOrDefault("description", def.get("description") == null ? "" : def.get("description")));
        def.put("color", body.getOrDefault("color", def.get("color") == null ? TYPE_COLORS.getOrDefault(type, "#8c8c8c") : def.get("color")));
        def.put("params", body.getOrDefault("params", def.get("params") == null ? List.of() : def.get("params")));
        def.put("config", cfg == null ? (def.get("config") == null ? Map.of() : def.get("config")) : cfg);
        def.put("dir", name);
        s.setConfig(safeJson(def));
        s.setUpdatedAt(LocalDateTime.now());
        skillMapper.updateById(s);
        untombstone("skill", name);
        return ResponseEntity.ok(Map.of("ok", true, "skill", toSkillItem(s, Map.of(), Map.of(), Map.of())));
    }

    @DeleteMapping("/skills/{id}")
    public ResponseEntity<Map<String, Object>> delete(@PathVariable Long id, HttpServletRequest req) {
        return toResponse(deleteOne(id, VisibilityPolicy.currentUser(req)));
    }

    /** 单条删除（批量删除复用）：级联删除运行记录 + 墓碑；返回 {ok} 或 {ok:false, error, forbidden?} */
    private Map<String, Object> deleteOne(Long id, User user) {
        Skill s = skillMapper.selectById(id);
        if (s == null) return err("技能不存在");
        // 写权限边界（P1）：member 不能删除他人条目
        if (!VisibilityPolicy.canWrite(user, s.getOwnerId())) {
            return forbidden();
        }
        skillRunMapper.delete(Wrappers.<SkillRun>lambdaQuery().eq(SkillRun::getSkillId, id));
        skillMapper.deleteById(id);
        tombstone("skill", s.getName());
        return Map.of("ok", true);
    }

    // —— 技能批量操作 ——

    /** 批量创建：{items: [{name,type,displayName,description,color,params,config}, ...]} */
    @PostMapping("/skills/batch-create")
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

    /** 批量更新：{ids: [], data: {displayName / description / color / visibility}}（visibility 写列，其余写 config JSON） */
    @PostMapping("/skills/batch-update")
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
            Skill s = skillMapper.selectById(id);
            if (s == null) {
                errors.add(BatchOps.itemError("id", id, "技能不存在"));
                continue;
            }
            // 批量越权逐条拦截：计入 itemError，保留部分成功语义
            if (!VisibilityPolicy.canWrite(user, s.getOwnerId())) {
                errors.add(BatchOps.itemError("id", id, VisibilityPolicy.BATCH_FORBIDDEN_MSG));
                continue;
            }
            try {
                Map<String, Object> def = parseConfig(s.getConfig());
                if (data.get("displayName") != null) def.put("displayName", data.get("displayName").toString());
                if (data.get("description") != null) def.put("description", data.get("description").toString());
                if (data.get("color") != null) def.put("color", data.get("color").toString());
                s.setConfig(safeJson(def));
                if (vis != null) s.setVisibility(vis);
                s.setUpdatedAt(LocalDateTime.now());
                skillMapper.updateById(s);
                updated++;
            } catch (Exception e) {
                errors.add(BatchOps.itemError("id", id, e.getMessage() == null ? "更新失败" : e.getMessage()));
            }
        }
        return BatchOps.result("updated", updated, errors);
    }

    /** 批量删除：{ids: []}（级联删除运行记录；逐条 canWrite 越权拦截） */
    @PostMapping("/skills/batch-delete")
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

    @PostMapping("/skills/{id}/run")
    public Map<String, Object> run(@PathVariable Long id, @RequestBody(required = false) Map<String, Object> body) {
        Skill s = skillMapper.selectById(id);
        if (s == null) return Map.of("error", "技能不存在");
        Map<String, String> params = new HashMap<>();
        if (body != null && body.get("params") instanceof Map<?, ?> p) {
            for (Map.Entry<?, ?> e : p.entrySet()) params.put(e.getKey().toString(), e.getValue() == null ? "" : e.getValue().toString());
        }
        Map<String, Object> def = parseConfig(s.getConfig());
        Map<String, Object> execCfg = SkillExecutor.unwrapConfig(s.getType(), def.get("config"));

        long t0 = System.currentTimeMillis();
        Map<String, String> result = executor.execute(s.getType(), execCfg, params);
        long duration = System.currentTimeMillis() - t0;

        SkillRun run = new SkillRun();
        run.setSkillId(id);
        run.setStatus(result.get("error") == null ? "success" : "failed");
        run.setInput(safeJson(params));
        run.setOutput(result.get("output"));
        run.setError(result.get("error"));
        run.setTriggeredBy("admin");
        run.setStartedAt(LocalDateTime.now());
        run.setFinishedAt(LocalDateTime.now());
        run.setDurationMs(duration);
        skillRunMapper.insert(run);

        s.setLastRunAt(LocalDateTime.now());
        skillMapper.updateById(s);

        Map<String, Object> resp = new HashMap<>();
        resp.put("runId", run.getId());
        resp.put("status", run.getStatus());
        resp.put("durationMs", duration);
        if (result.get("output") != null) resp.put("output", result.get("output"));
        if (result.get("error") != null) resp.put("error", result.get("error"));
        return resp;
    }

    @GetMapping("/skill-runs")
    public Map<String, Object> runs(@RequestParam(defaultValue = "10") int limit) {
        int lim = Math.min(Math.max(limit, 1), 50);
        IPage<SkillRun> page = skillRunMapper.selectPage(
                Page.of(1, lim),
                Wrappers.<SkillRun>lambdaQuery().orderByDesc(SkillRun::getId));

        // 批量取出涉及的技能名，避免逐行 selectById 的 N+1；空列表会生成非法 IN ()，必须先判空
        List<Long> skillIds = page.getRecords().stream().map(SkillRun::getSkillId).distinct().toList();
        Map<Long, String> nameMap = skillIds.isEmpty() ? Map.of()
                : skillMapper.selectBatchIds(skillIds).stream()
                        .collect(Collectors.toMap(Skill::getId, Skill::getName, (a, b) -> a));

        List<Map<String, Object>> items = page.getRecords().stream()
                .map(r -> runItem(r, nameMap))
                .toList();
        return Map.of("runs", items);
    }

    // —— 组装 ——

    private Map<String, Object> runItem(SkillRun r, Map<Long, String> nameMap) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", r.getId());
        m.put("skill_id", r.getSkillId());
        if (nameMap != null) {
            String name = nameMap.get(r.getSkillId());
            m.put("skill_name", name == null ? "-" : name);
        } else {
            Skill sk = skillMapper.selectById(r.getSkillId());
            m.put("skill_name", sk == null ? "-" : sk.getName());
        }
        m.put("status", r.getStatus());
        m.put("input", r.getInput());
        m.put("output", r.getOutput());
        m.put("error", r.getError());
        m.put("duration_ms", r.getDurationMs());
        m.put("triggered_by", r.getTriggeredBy());
        m.put("started_at", dt(r.getStartedAt()));
        m.put("finished_at", dt(r.getFinishedAt()));
        return m;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseConfig(String config) {
        if (config == null || config.isBlank()) return new HashMap<>();
        try {
            return om.readValue(config, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return new HashMap<>();
        }
    }

    private Map<String, Object> toSkillItem(Skill s, Map<Long, Long> countMap, Map<Long, String> lastStatusMap,
                                           Map<Long, String> ownerNames) {
        Map<String, Object> def = parseConfig(s.getConfig());
        Map<String, Object> item = new HashMap<>();
        item.put("id", s.getId());
        item.put("name", s.getName());
        item.put("type", s.getType());
        item.put("displayName", def.get("displayName") != null ? def.get("displayName").toString() : s.getName());
        item.put("description", def.get("description") != null ? def.get("description").toString() : (s.getDescription() == null ? "" : s.getDescription()));
        item.put("color", def.get("color") != null ? def.get("color").toString() : TYPE_COLORS.getOrDefault(s.getType(), "#8c8c8c"));
        item.put("params", def.get("params") instanceof List<?> lp ? lp : List.of());
        item.put("config", def.get("config") != null ? def.get("config") : Map.of());
        item.put("dir", def.get("dir") != null ? def.get("dir") : s.getName());
        // 来源标识透出：source 列优先；JSON（config.source）兜底仅认标记值（admin→manual）
        item.put("source", resolveSource(s.getSource(), def.get("source")));
        // 可见性透出：visibility 缺省按 public（旧数据/降级），owner_name 由 users 批量组装
        item.put("visibility", s.getVisibility() == null ? VisibilityPolicy.PUBLIC : s.getVisibility());
        item.put("owner_id", s.getOwnerId());
        item.put("owner_name", ownerNames == null ? null : ownerNames.get(s.getOwnerId()));
        item.put("run_count", countMap.getOrDefault(s.getId(), 0L));
        item.put("last_run_status", lastStatusMap.get(s.getId()));
        item.put("last_run_at", dt(s.getLastRunAt()));
        return item;
    }

    private String safeJson(Object o) {
        try {
            return om.writeValueAsString(o);
        } catch (Exception e) {
            return "{}";
        }
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
}
