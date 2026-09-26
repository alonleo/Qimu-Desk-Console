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

    /** 列表：member 追加可见性 scope（自己创建的 + 通用）；可选 visibility / ownerId 筛选（admin 场景为主） */
    @GetMapping
    public List<Map<String, Object>> list(HttpServletRequest req,
                                          @RequestParam(required = false) String visibility,
                                          @RequestParam(required = false) Long ownerId) {
        User user = VisibilityPolicy.currentUser(req);
        var q = Wrappers.<Task>lambdaQuery();
        VisibilityPolicy.applyScope(user, q);
        String vis = VisibilityPolicy.parseVisibility(visibility);
        if (vis != null) q.eq(Task::getVisibility, vis);
        if (ownerId != null) q.eq(Task::getOwnerId, ownerId);
        q.last("ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, id DESC");
        List<Task> tasks = taskMapper.selectList(q);
        Map<Long, Project> projectMap = new HashMap<>();
        for (Project p : projectMapper.selectList(null)) projectMap.put(p.getId(), p);
        Map<Long, String> ownerNames = VisibilityPolicy.ownerNames(
                userMapper, tasks.stream().map(Task::getOwnerId).toList());
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
        String title = body.getOrDefault("title", "").toString().trim();
        if (title.isBlank()) return err("任务标题不能为空");
        Task t = new Task();
        t.setTitle(title);
        t.setProjectId(body.get("projectId") == null ? null : Long.valueOf(body.get("projectId").toString()));
        t.setStatus(body.getOrDefault("status", "todo").toString());
        t.setPriority(body.getOrDefault("priority", "normal").toString());
        t.setNotes(body.get("notes") == null ? null : body.get("notes").toString());
        t.setDueDate(body.get("dueDate") == null || body.get("dueDate").toString().isBlank() ? null : body.get("dueDate").toString());
        t.setCompletedAt("done".equals(t.getStatus()) ? LocalDateTime.now() : null);
        // 可见性注入：owner_id 一律服务端取当前用户（不信任前端）；visibility 非法值回落默认
        t.setOwnerId(user == null ? null : user.getId());
        t.setVisibility(VisibilityPolicy.resolveVisibility(user, body.get("visibility")));
        t.setCreatedAt(LocalDateTime.now());
        t.setUpdatedAt(LocalDateTime.now());
        taskMapper.insert(t);
        return Map.of("ok", true, "task", toRow(t, Map.of()));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable Long id, @RequestBody Map<String, Object> body,
                                                      HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        Task t = taskMapper.selectById(id);
        if (t == null) return ResponseEntity.ok(err("任务不存在"));
        // 写权限边界（P1）：member 不能修改他人条目（含他人创建的通用条目）
        if (!VisibilityPolicy.canWrite(user, t.getOwnerId())) {
            return ResponseEntity.status(403).body(err(VisibilityPolicy.FORBIDDEN_MSG));
        }
        applyUpdate(t, body);
        taskMapper.updateById(t);
        return ResponseEntity.ok(Map.of("ok", true, "task", toRow(t, Map.of())));
    }

    /** 单条更新字段应用（批量更新复用） */
    private void applyUpdate(Task t, Map<String, Object> body) {
        if (body.get("title") != null) t.setTitle(body.get("title").toString());
        if (body.get("status") != null) {
            String st = body.get("status").toString();
            t.setStatus(st);
            t.setCompletedAt("done".equals(st) ? LocalDateTime.now() : null);
        }
        if (body.get("priority") != null) t.setPriority(body.get("priority").toString());
        if (body.get("notes") != null) t.setNotes(body.get("notes").toString());
        if (body.get("dueDate") != null) t.setDueDate(body.get("dueDate").toString().isBlank() ? null : body.get("dueDate").toString());
        if (body.get("projectId") != null) t.setProjectId(Long.valueOf(body.get("projectId").toString()));
        // 可见性更新（可选）：仅接受 personal/public，非法值忽略
        String vis = VisibilityPolicy.parseVisibility(body.get("visibility"));
        if (vis != null) t.setVisibility(vis);
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

    /** 批量更新：{ids: [], data: {status/priority/projectId/dueDate/visibility}}（逐条 canWrite 越权拦截） */
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
            Task t = taskMapper.selectById(id);
            if (t == null) {
                errors.add(BatchOps.itemError("id", id, "任务不存在"));
                continue;
            }
            // 批量越权逐条拦截：计入 itemError，保留部分成功语义
            if (!VisibilityPolicy.canWrite(user, t.getOwnerId())) {
                errors.add(BatchOps.itemError("id", id, VisibilityPolicy.BATCH_FORBIDDEN_MSG));
                continue;
            }
            try {
                applyUpdate(t, patch);
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
        if (ids.isEmpty()) return err("ids 不能为空");
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
        m.put("created_at", dt(t.getCreatedAt()));
        m.put("updated_at", dt(t.getUpdatedAt()));
        m.put("completed_at", dt(t.getCompletedAt()));
        m.put("project_name", t.getProjectName());
        m.put("project_color", t.getProjectColor());
        // 可见性透出：visibility 缺省按 public（旧数据/降级），owner_name 由 users 批量组装
        m.put("visibility", t.getVisibility() == null ? VisibilityPolicy.PUBLIC : t.getVisibility());
        m.put("owner_id", t.getOwnerId());
        m.put("owner_name", ownerNames.get(t.getOwnerId()));
        return m;
    }

    static String dt(LocalDateTime v) {
        return v == null ? null : v.toString().replace("T", " ");
    }

    private Map<String, Object> err(String msg) {
        return Map.of("ok", false, "error", msg);
    }
}
