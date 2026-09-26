package com.alon.admin.controller;

import com.alon.admin.common.BatchOps;
import com.alon.admin.common.VisibilityPolicy;
import com.alon.admin.entity.Project;
import com.alon.admin.entity.Task;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.ProjectMapper;
import com.alon.admin.mapper.TaskMapper;
import com.alon.admin.mapper.UserMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 项目管理（含任务统计；含可见性过滤与写权限，见 VisibilityPolicy） */
@RestController
@RequestMapping("/api/projects")
public class ProjectController {

    private final ProjectMapper projectMapper;
    private final TaskMapper taskMapper;
    private final UserMapper userMapper;

    public ProjectController(ProjectMapper projectMapper, TaskMapper taskMapper, UserMapper userMapper) {
        this.projectMapper = projectMapper;
        this.taskMapper = taskMapper;
        this.userMapper = userMapper;
    }

    /** 列表：member 追加可见性 scope（任务统计同步按 scope 过滤，不泄漏他人任务数）；可选 visibility / ownerId 筛选 */
    @GetMapping
    public List<Map<String, Object>> list(HttpServletRequest req,
                                          @RequestParam(required = false) String all,
                                          @RequestParam(required = false) String visibility,
                                          @RequestParam(required = false) Long ownerId) {
        User user = VisibilityPolicy.currentUser(req);
        boolean includeArchived = "1".equals(all);
        boolean memberScoped = !VisibilityPolicy.isAdmin(user);
        var q = Wrappers.<Project>lambdaQuery()
                .ne(!includeArchived, Project::getStatus, "archived")
                .orderByAsc(Project::getId);
        VisibilityPolicy.applyScope(user, q);
        String vis = VisibilityPolicy.parseVisibility(visibility);
        if (vis != null) q.eq(Project::getVisibility, vis);
        if (ownerId != null) q.eq(Project::getOwnerId, ownerId);
        List<Project> projects = projectMapper.selectList(q);
        Map<Long, String> ownerNames = VisibilityPolicy.ownerNames(
                userMapper, projects.stream().map(Project::getOwnerId).toList());

        Map<Long, int[]> stats = new HashMap<>();
        for (Task t : taskMapper.selectList(null)) {
            if (t.getProjectId() == null) continue;
            // member 场景任务统计同步过滤：不把他人个人任务计入项目进度
            if (memberScoped && !VisibilityPolicy.canRead(user, t.getVisibility(), t.getOwnerId())) continue;
            int[] s = stats.computeIfAbsent(t.getProjectId(), k -> new int[2]);
            s[0]++; // total
            if ("done".equals(t.getStatus())) s[1]++; // done
        }
        return projects.stream().map(p -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", p.getId());
            m.put("name", p.getName());
            m.put("description", p.getDescription());
            m.put("color", p.getColor());
            m.put("status", p.getStatus());
            m.put("created_at", dt(p.getCreatedAt()));
            m.put("updated_at", dt(p.getUpdatedAt()));
            // 可见性透出：visibility 缺省按 public（旧数据/降级），owner_name 由 users 批量组装
            m.put("visibility", p.getVisibility() == null ? VisibilityPolicy.PUBLIC : p.getVisibility());
            m.put("owner_id", p.getOwnerId());
            m.put("owner_name", ownerNames.get(p.getOwnerId()));
            int[] s = stats.getOrDefault(p.getId(), new int[0]);
            m.put("task_count", s.length == 2 ? s[0] : 0);
            m.put("done_count", s.length == 2 ? s[1] : 0);
            m.put("open_count", s.length == 2 ? s[0] - s[1] : 0);
            return m;
        }).toList();
    }

    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        return createOne(body, VisibilityPolicy.currentUser(req));
    }

    /** 单条创建（批量创建复用）；返回 {ok, project} 或 {ok:false, error}；owner_id 服务端注入、visibility 归一化 */
    private Map<String, Object> createOne(Map<String, Object> item, User user) {
        String name = item.getOrDefault("name", "").toString().trim();
        if (name.isBlank()) return err("项目名称不能为空");
        Project p = new Project();
        p.setName(name);
        p.setDescription(item.get("description") == null ? null : item.get("description").toString());
        p.setColor(item.get("color") == null ? null : item.get("color").toString());
        p.setStatus("active");
        // 可见性注入：owner_id 一律服务端取当前用户（不信任前端）；visibility 非法值回落默认
        p.setOwnerId(user == null ? null : user.getId());
        p.setVisibility(VisibilityPolicy.resolveVisibility(user, item.get("visibility")));
        p.setCreatedAt(LocalDateTime.now());
        p.setUpdatedAt(LocalDateTime.now());
        projectMapper.insert(p);
        return Map.of("ok", true, "project", Map.of("id", p.getId(), "name", p.getName()));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable Long id, @RequestBody Map<String, Object> body,
                                                      HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        Project p = projectMapper.selectById(id);
        if (p == null) return ResponseEntity.ok(err("项目不存在"));
        // 写权限边界（P1）：member 不能修改他人条目（含他人创建的通用条目）
        if (!VisibilityPolicy.canWrite(user, p.getOwnerId())) {
            return ResponseEntity.status(403).body(err(VisibilityPolicy.FORBIDDEN_MSG));
        }
        applyPatch(p, body);
        p.setUpdatedAt(LocalDateTime.now());
        projectMapper.updateById(p);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> delete(@PathVariable Long id, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        Project p = projectMapper.selectById(id);
        if (p == null) return ResponseEntity.ok(err("项目不存在"));
        // 写权限边界（P1）：member 不能删除他人条目
        if (!VisibilityPolicy.canWrite(user, p.getOwnerId())) {
            return ResponseEntity.status(403).body(err(VisibilityPolicy.FORBIDDEN_MSG));
        }
        if (projectMapper.deleteById(id) > 0) return ResponseEntity.ok(Map.of("ok", true));
        return ResponseEntity.ok(err("项目不存在"));
    }

    /** 批量新增：{items: [{name, description?, color?}]} */
    @PostMapping("/batch-create")
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

    /** 批量更新：{ids: [], data: {name/description/color/status/visibility}}（逐条 canWrite 越权拦截） */
    @PostMapping("/batch-update")
    public Map<String, Object> batchUpdate(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) return err("ids 不能为空");
        if (!(body.get("data") instanceof Map<?, ?> data) || data.isEmpty()) return err("data 不能为空");
        @SuppressWarnings("unchecked")
        Map<String, Object> patch = new HashMap<>((Map<String, Object>) data);
        List<Map<String, Object>> errors = new ArrayList<>();
        int updated = 0;
        for (Long id : ids) {
            Project p = projectMapper.selectById(id);
            if (p == null) {
                errors.add(BatchOps.itemError("id", id, "项目不存在"));
                continue;
            }
            // 批量越权逐条拦截：计入 itemError，保留部分成功语义
            if (!VisibilityPolicy.canWrite(user, p.getOwnerId())) {
                errors.add(BatchOps.itemError("id", id, VisibilityPolicy.BATCH_FORBIDDEN_MSG));
                continue;
            }
            applyPatch(p, patch);
            p.setUpdatedAt(LocalDateTime.now());
            projectMapper.updateById(p);
            updated++;
        }
        return BatchOps.result("updated", updated, errors);
    }

    /** 批量删除：{ids: []}（逐条 canWrite 越权拦截） */
    @PostMapping("/batch-delete")
    public Map<String, Object> batchDelete(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) return err("ids 不能为空");
        List<Map<String, Object>> errors = new ArrayList<>();
        int deleted = 0;
        for (Long id : ids) {
            Project p = projectMapper.selectById(id);
            if (p == null) {
                errors.add(BatchOps.itemError("id", id, "项目不存在"));
                continue;
            }
            if (!VisibilityPolicy.canWrite(user, p.getOwnerId())) {
                errors.add(BatchOps.itemError("id", id, VisibilityPolicy.BATCH_FORBIDDEN_MSG));
                continue;
            }
            if (projectMapper.deleteById(id) > 0) deleted++;
        }
        return BatchOps.result("deleted", deleted, errors);
    }

    private void applyPatch(Project p, Map<String, Object> patch) {
        if (patch.get("name") != null) p.setName(patch.get("name").toString());
        if (patch.get("description") != null) p.setDescription(patch.get("description").toString());
        if (patch.get("color") != null) p.setColor(patch.get("color").toString());
        if (patch.get("status") != null) p.setStatus(patch.get("status").toString());
        // 可见性更新（可选）：仅接受 personal/public，非法值忽略
        String vis = VisibilityPolicy.parseVisibility(patch.get("visibility"));
        if (vis != null) p.setVisibility(vis);
    }

    private String dt(LocalDateTime v) {
        return v == null ? null : v.toString().replace("T", " ");
    }

    private Map<String, Object> err(String msg) {
        return Map.of("ok", false, "error", msg);
    }
}
