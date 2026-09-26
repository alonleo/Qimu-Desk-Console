package com.alon.admin.controller;

import com.alon.admin.common.BatchOps;
import com.alon.admin.common.TaskRules;
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

/** 任务管理（snake_case 输出对齐前端组件；含可见性过滤与写权限，见 VisibilityPolicy） */
@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskMapper taskMapper;
    private final ProjectMapper projectMapper;
    private final UserMapper userMapper;

    public TaskController(TaskMapper taskMapper, ProjectMapper projectMapper, UserMapper userMapper) {
        this.taskMapper = taskMapper;
        this.projectMapper = projectMapper;
        this.userMapper = userMapper;
    }

    @GetMapping("/members")
    public List<Map<String, Object>> members() {
        return userMapper.selectList(Wrappers.<User>lambdaQuery().eq(User::getDisabled, 0)).stream().map(u -> {
            Map<String, Object> m = new HashMap<>(); m.put("id", u.getId());
            m.put("name", u.getDisplayName() == null || u.getDisplayName().isBlank() ? u.getUsername() : u.getDisplayName());
            return m;
        }).toList();
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> invalid(IllegalArgumentException e) { return ResponseEntity.badRequest().body(err(e.getMessage())); }

    /** 列表：member 追加可见性 scope（自己创建的 + 通用）；可选 visibility / ownerId 筛选（admin 场景为主） */
    @GetMapping
    public List<Map<String, Object>> list(HttpServletRequest req,
                                          @RequestParam(required = false) String visibility,
                                          @RequestParam(required = false) Long ownerId,
                                          @RequestParam(required = false) String projectId,
                                          @RequestParam(required = false) String status,
                                          @RequestParam(required = false) String mine) {
        User user = VisibilityPolicy.currentUser(req);
        var q = Wrappers.<Task>lambdaQuery();
        VisibilityPolicy.applyScope(user, q);
        String vis = VisibilityPolicy.parseVisibility(visibility);
        if (vis != null) q.eq(Task::getVisibility, vis);
        if (ownerId != null) q.eq(Task::getOwnerId, ownerId);
        if (projectId != null && !"all".equals(projectId)) q.eq(Task::getProjectId, id(projectId));
        if (status != null && java.util.Set.of("todo","doing","waiting","done").contains(status)) q.eq(Task::getStatus, status);
        if ("1".equals(mine)) q.eq(Task::getOwnerId, user.getId());
        if ("public".equals(mine)) q.eq(Task::getVisibility, "public");
        q.last("ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, id DESC");
        List<Task> tasks = taskMapper.selectList(q);
        Map<Long, Project> projectMap = new HashMap<>();
        for (Project p : projectMapper.selectList(null)) if (VisibilityPolicy.canRead(user, p.getVisibility(), p.getOwnerId())) projectMap.put(p.getId(), p);
        Map<Long, String> ownerNames = VisibilityPolicy.ownerNames(
                userMapper, tasks.stream().flatMap(t -> java.util.stream.Stream.of(t.getOwnerId(), t.getAssigneeId())).toList());
        return tasks.stream().map(t -> {
            Project p = t.getProjectId() == null ? null : projectMap.get(t.getProjectId());
            if (p != null) {
                t.setProjectName(p.getName());
                t.setProjectColor(p.getColor());
            }
            return toRow(t, ownerNames);
        }).toList();
    }

    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        return createOne(body, VisibilityPolicy.currentUser(req));
    }

    /** 单条创建（批量创建复用）；返回 {ok, task} 或 {ok:false, error}；owner_id 服务端注入、visibility 归一化 */
    private Map<String, Object> createOne(Map<String, Object> body, User user) {
        Task t = new Task();
        t.setTitle(""); t.setStatus("todo"); t.setPriority("normal");
        t.setOwnerId(user.getId());
        t.setVisibility(VisibilityPolicy.resolveVisibility(user, body.get("visibility")));
        applyUpdate(t, body);
        validateReferences(t, user);
        t.setCreatedAt(LocalDateTime.now());
        taskMapper.insert(t);
        return Map.of("ok", true, "task", toRow(t, Map.of()));
    }

    private void validateReferences(Task t, User user) {
        TaskRules.validate(t);
        if (t.getProjectId() != null) {
            Project p = projectMapper.selectById(t.getProjectId());
            if (p == null || "archived".equals(p.getStatus()) || !VisibilityPolicy.canRead(user, p.getVisibility(), p.getOwnerId())) throw new IllegalArgumentException("项目不存在、已归档或无权访问");
            if ("public".equals(t.getVisibility()) && "personal".equals(p.getVisibility())) throw new IllegalArgumentException("个人项目中的任务不能设为团队可见");
        }
        if (t.getAssigneeId() != null) {
            User assignee = userMapper.selectById(t.getAssigneeId());
            if (assignee == null || Integer.valueOf(1).equals(assignee.getDisabled())) throw new IllegalArgumentException("负责人不存在或已停用");
        }
    }

    private boolean statusOnly(Map<String, Object> body) { return body.size() == 1 && body.containsKey("status"); }

    @PatchMapping("/{id}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable Long id, @RequestBody Map<String, Object> body,
                                                      HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        Task t = taskMapper.selectById(id);
        if (t == null) return ResponseEntity.ok(err("任务不存在"));
        // 写权限边界（P1）：member 不能修改他人条目（含他人创建的通用条目）
        if (!(TaskRules.canManage(user, t) || (statusOnly(body) && TaskRules.canChangeStatus(user, t)))) {
            return ResponseEntity.status(403).body(err(VisibilityPolicy.FORBIDDEN_MSG));
        }
        applyUpdate(t, body);
        validateReferences(t, user);
        taskMapper.updateById(t);
        return ResponseEntity.ok(Map.of("ok", true, "task", toRow(t, Map.of())));
    }

    /** 单条更新字段应用（批量更新复用） */
    private static String text(Object value) { return value == null || value.toString().trim().isEmpty() ? null : value.toString().trim(); }
    private static Long id(Object value) {
        if (value == null) return null;
        try { long id = Long.parseLong(value.toString()); if (id < 1) throw new NumberFormatException(); return id; }
        catch (NumberFormatException e) { throw new IllegalArgumentException("无效关联 ID"); }
    }
    private void applyUpdate(Task t, Map<String, Object> body) {
        if (body.containsKey("title")) t.setTitle(text(body.get("title")));
        if (body.containsKey("status")) {
            String status = text(body.get("status"));
            if (!java.util.Objects.equals(status, t.getStatus()) || ("done".equals(status) && t.getCompletedAt() == null)) t.setCompletedAt("done".equals(status) ? LocalDateTime.now() : null);
            t.setStatus(status);
        }
        if (body.containsKey("priority")) t.setPriority(text(body.get("priority")));
        if (body.containsKey("notes")) t.setNotes(text(body.get("notes")));
        if (body.containsKey("dueDate")) t.setDueDate(text(body.get("dueDate")));
        if (body.containsKey("startDate")) t.setStartDate(text(body.get("startDate")));
        if (body.containsKey("period")) t.setPeriod(text(body.get("period")));
        if (body.containsKey("projectId")) t.setProjectId(id(body.get("projectId")));
        if (body.containsKey("assigneeId")) t.setAssigneeId(id(body.get("assigneeId")));
        if (body.containsKey("visibility")) t.setVisibility(text(body.get("visibility")));
        TaskRules.validate(t);
        t.setUpdatedAt(LocalDateTime.now());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> delete(@PathVariable Long id, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        Task t = taskMapper.selectById(id);
        if (t == null) return ResponseEntity.ok(err("任务不存在"));
        // 写权限边界（P1）：member 不能删除他人条目
        if (!VisibilityPolicy.canWrite(user, t.getOwnerId())) {
            return ResponseEntity.status(403).body(err(VisibilityPolicy.FORBIDDEN_MSG));
        }
        taskMapper.deleteById(id);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    // —— 批量操作 ——

    /** 批量创建：{items: [{title,status,priority,...}, ...]} */
    @PostMapping("/batch-create")
    public Map<String, Object> batchCreate(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        if (!(body.get("items") instanceof List<?> items) || items.isEmpty() || items.size() > 100) return err("items 不能为空");
        List<Map<String, Object>> errors = new ArrayList<>();
        int created = 0;
        for (int i = 0; i < items.size(); i++) {
            if (!(items.get(i) instanceof Map<?, ?> im)) {
                errors.add(BatchOps.itemError("index", i, "条目必须是对象"));
                continue;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> resp;
            try { resp = createOne((Map<String, Object>) im, user); }
            catch (IllegalArgumentException e) { resp = err(e.getMessage()); }
            if (Boolean.TRUE.equals(resp.get("ok"))) created++;
            else errors.add(BatchOps.itemError("index", i, String.valueOf(resp.get("error"))));
        }
        return BatchOps.result("created", created, errors);
    }

    /** 批量更新：{ids: [], data: {status/priority/projectId/dueDate/visibility}}（逐条 canWrite 越权拦截） */
    @PostMapping("/batch-update")
    public Map<String, Object> batchUpdate(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty() || ids.size() > 100) return err("每次请选择 1–100 项任务");
        if (!(body.get("data") instanceof Map<?, ?> data) || data.isEmpty()) return err("data 不能为空");
        @SuppressWarnings("unchecked")
        Map<String, Object> patch = new HashMap<>((Map<String, Object>) data);
        List<Map<String, Object>> errors = new ArrayList<>();
        int updated = 0;
        for (Long id : ids) {
            Task t = taskMapper.selectById(id);
            if (t == null) {
                errors.add(BatchOps.itemError("id", id, "任务不存在"));
                continue;
            }
            // 批量越权逐条拦截：计入 itemError，保留部分成功语义
            if (!(TaskRules.canManage(user, t) || (statusOnly(patch) && TaskRules.canChangeStatus(user, t)))) {
                errors.add(BatchOps.itemError("id", id, VisibilityPolicy.BATCH_FORBIDDEN_MSG));
                continue;
            }
            try {
                applyUpdate(t, patch);
                validateReferences(t, user);
                taskMapper.updateById(t);
                updated++;
            } catch (Exception e) {
                errors.add(BatchOps.itemError("id", id, e.getMessage() == null ? "更新失败" : e.getMessage()));
            }
        }
        return BatchOps.result("updated", updated, errors);
    }

    /** 批量删除：{ids: []}（逐条 canWrite 越权拦截，替代整批 deleteBatchIds） */
    @PostMapping("/batch-delete")
    public Map<String, Object> batchDelete(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty() || ids.size() > 100) return err("每次请选择 1–100 项任务");
        List<Map<String, Object>> errors = new ArrayList<>();
        int deleted = 0;
        for (Long id : ids) {
            Task t = taskMapper.selectById(id);
            if (t == null) {
                errors.add(BatchOps.itemError("id", id, "任务不存在"));
                continue;
            }
            if (!VisibilityPolicy.canWrite(user, t.getOwnerId())) {
                errors.add(BatchOps.itemError("id", id, VisibilityPolicy.BATCH_FORBIDDEN_MSG));
                continue;
            }
            if (taskMapper.deleteById(id) > 0) deleted++;
        }
        return BatchOps.result("deleted", deleted, errors);
    }

    static Map<String, Object> toRow(Task t, Map<Long, String> ownerNames) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", t.getId());
        m.put("project_id", t.getProjectId());
        m.put("title", t.getTitle());
        m.put("notes", t.getNotes());
        m.put("status", t.getStatus());
        m.put("priority", t.getPriority());
        m.put("due_date", t.getDueDate());
        m.put("start_date", t.getStartDate());
        m.put("period", t.getPeriod());
        m.put("assignee_id", t.getAssigneeId());
        m.put("assignee_name", t.getAssigneeId() == null ? null : ownerNames.get(t.getAssigneeId()));
        m.put("created_at", dt(t.getCreatedAt()));
        m.put("updated_at", dt(t.getUpdatedAt()));
        m.put("completed_at", dt(t.getCompletedAt()));
        m.put("project_name", t.getProjectName());
        m.put("project_color", t.getProjectColor());
        // 可见性透出：visibility 缺省按 public（旧数据/降级），owner_name 由 users 批量组装
        m.put("visibility", t.getVisibility() == null ? VisibilityPolicy.PUBLIC : t.getVisibility());
        m.put("owner_id", t.getOwnerId());
        m.put("owner_name", t.getOwnerId() == null ? null : ownerNames.get(t.getOwnerId()));
        return m;
    }

    static String dt(LocalDateTime v) {
        return v == null ? null : v.toString().replace("T", " ");
    }

    private Map<String, Object> err(String msg) {
        return Map.of("ok", false, "error", msg);
    }
}
