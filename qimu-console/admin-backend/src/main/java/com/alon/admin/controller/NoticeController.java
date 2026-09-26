package com.alon.admin.controller;

import com.alon.admin.auth.AuthInterceptor;
import com.alon.admin.common.BatchOps;
import com.alon.admin.entity.Notice;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.NoticeMapper;
import com.alon.admin.mapper.UserMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * 通知公告管理（仅 admin）：列表分页 / 新建 / 编辑 / 删除 / 置顶。
 * snake_case 输出对齐前端组件；排序铁律 is_pinned DESC, publish_time DESC, id DESC。
 * 权限硬约束：所有接口要求 admin，非 admin 一律 HTTP 403。
 */
@RestController
@RequestMapping("/api/notices")
public class NoticeController {

    private static final List<String> TYPES = List.of("notification", "announcement");
    private static final List<String> STATUSES = List.of("draft", "published");
    private static final DateTimeFormatter DTF = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final NoticeMapper noticeMapper;
    private final UserMapper userMapper;

    public NoticeController(NoticeMapper noticeMapper, UserMapper userMapper) {
        this.noticeMapper = noticeMapper;
        this.userMapper = userMapper;
    }

    /** admin 校验：currentUser 由 AuthInterceptor 注入，非 admin 一律 403 兜底 */
    private ResponseEntity<Map<String, Object>> forbidden() {
        return ResponseEntity.status(403).body(Map.of("ok", false, "error", "无权限"));
    }

    private User requireAdmin(HttpServletRequest req) {
        Object attr = req.getAttribute(AuthInterceptor.ATTR_USER);
        if (!(attr instanceof User user)) return null;
        return "admin".equals(user.getRole()) ? user : null;
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> list(
            HttpServletRequest req,
            @RequestParam(defaultValue = "1") long page,
            @RequestParam(defaultValue = "10") long pageSize,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String types,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String statuses,
            @RequestParam(required = false) String title) {
        if (requireAdmin(req) == null) return forbidden();

        long p = Math.max(1, page);
        long size = Math.min(100, Math.max(1, pageSize));

        // 多选解析：types/statuses 逗号分隔，兼容旧单值 type/status；非法值忽略
        List<String> typeList = new ArrayList<>();
        for (String t : (types == null || types.isBlank() ? "" : types).split(",")) {
            String v = t.trim();
            if (TYPES.contains(v)) typeList.add(v);
        }
        if (typeList.isEmpty() && type != null && TYPES.contains(type)) typeList.add(type);
        List<String> statusList = new ArrayList<>();
        for (String s : (statuses == null || statuses.isBlank() ? "" : statuses).split(",")) {
            String v = s.trim();
            if (STATUSES.contains(v)) statusList.add(v);
        }
        if (statusList.isEmpty() && status != null && STATUSES.contains(status)) statusList.add(status);

        QueryWrapper<Notice> qw = new QueryWrapper<>();
        if (!typeList.isEmpty()) qw.in("type", typeList);
        if (!statusList.isEmpty()) qw.in("status", statusList);
        if (title != null && !title.isBlank()) qw.like("title", title.trim());
        qw.orderByDesc("is_pinned", "publish_time", "id");

        Page<Notice> result = noticeMapper.selectPage(new Page<>(p, size), qw);
        fillPublishers(result.getRecords());
        List<Map<String, Object>> notices = result.getRecords().stream().map(NoticeController::toRow).toList();

        Map<String, Object> body = new HashMap<>();
        body.put("ok", true);
        body.put("total", result.getTotal());
        body.put("page", result.getCurrent());
        body.put("pageSize", result.getSize());
        body.put("notices", notices);
        return ResponseEntity.ok(body);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        User admin = requireAdmin(req);
        if (admin == null) return forbidden();
        return ResponseEntity.ok(createOne(admin, body));
    }

    /** 单条创建（批量创建复用）；返回 {ok, notice} 或 {ok:false, error} */
    private Map<String, Object> createOne(User admin, Map<String, Object> body) {
        // null 安全：显式 {"title":null} 时 getOrDefault 仍返回 null，须用 Objects.toString 兜底，避免 NPE 500
        String title = Objects.toString(body.get("title"), "").trim();
        if (title.isBlank()) return err("通知标题不能为空");
        String type = Objects.toString(body.get("type"), "notification");
        if (!TYPES.contains(type)) return err("类型不合法");
        String status = Objects.toString(body.get("status"), "published");
        if (!STATUSES.contains(status)) return err("状态不合法");

        Notice n = new Notice();
        n.setType(type);
        n.setTitle(title);
        n.setContent(body.get("content") == null ? null : body.get("content").toString());
        n.setIsPinned(parsePinned(body.get("is_pinned")));
        n.setStatus(status);
        n.setPublisherId(admin.getId());
        // 发布语义：创建即 published 并写 publish_time（首次）
        n.setPublishTime("published".equals(status) ? LocalDateTime.now() : null);
        n.setCreateTime(LocalDateTime.now());
        n.setUpdateTime(LocalDateTime.now());
        noticeMapper.insert(n);
        // toRow 含可空字段，不能用 Map.of（null 值会抛 NPE）
        Map<String, Object> resp = new HashMap<>();
        resp.put("ok", true);
        resp.put("notice", toRow(withPublisher(n)));
        return resp;
    }

    @PutMapping("/{id}")
    public ResponseEntity<Map<String, Object>> update(
            HttpServletRequest req, @PathVariable Long id, @RequestBody Map<String, Object> body) {
        if (requireAdmin(req) == null) return forbidden();

        Notice n = noticeMapper.selectById(id);
        if (n == null) return ResponseEntity.ok(err("通知不存在"));

        if (body.get("title") != null) {
            String title = body.get("title").toString().trim();
            if (title.isBlank()) return ResponseEntity.ok(err("通知标题不能为空"));
            n.setTitle(title);
        }
        if (body.get("type") != null) {
            String type = body.get("type").toString();
            if (!TYPES.contains(type)) return ResponseEntity.ok(err("类型不合法"));
            n.setType(type);
        }
        if (body.get("content") != null) n.setContent(body.get("content").toString());
        if (body.get("is_pinned") != null) n.setIsPinned(parsePinned(body.get("is_pinned")));
        if (body.get("expire_time") != null) {
            n.setExpireTime(parseDateTime(body.get("expire_time").toString()));
        }
        if (body.get("status") != null) {
            String st = body.get("status").toString();
            if (!STATUSES.contains(st)) return ResponseEntity.ok(err("状态不合法"));
            boolean becamePublished = "published".equals(st) && !"published".equals(n.getStatus());
            n.setStatus(st);
            // 若由非 published → published 且 publish_time 为空则补写发布时间
            if (becamePublished && n.getPublishTime() == null) n.setPublishTime(LocalDateTime.now());
        }
        n.setUpdateTime(LocalDateTime.now());
        noticeMapper.updateById(n);
        Map<String, Object> resp = new HashMap<>();
        resp.put("ok", true);
        resp.put("notice", toRow(withPublisher(n)));
        return ResponseEntity.ok(resp);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> delete(HttpServletRequest req, @PathVariable Long id) {
        if (requireAdmin(req) == null) return forbidden();
        if (noticeMapper.deleteById(id) > 0) return ResponseEntity.ok(Map.of("ok", true));
        return ResponseEntity.ok(err("通知不存在"));
    }

    // —— 批量操作（均要求 admin） ——

    /** 批量创建：{items: [{type,title,content,is_pinned,status}, ...]} */
    @PostMapping("/batch-create")
    public ResponseEntity<Map<String, Object>> batchCreate(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        User admin = requireAdmin(req);
        if (admin == null) return forbidden();
        if (!(body.get("items") instanceof List<?> items) || items.isEmpty()) {
            return ResponseEntity.ok(err("items 不能为空"));
        }
        List<Map<String, Object>> errors = new ArrayList<>();
        int created = 0;
        for (int i = 0; i < items.size(); i++) {
            if (!(items.get(i) instanceof Map<?, ?> im)) {
                errors.add(BatchOps.itemError("index", i, "条目必须是对象"));
                continue;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> resp = createOne(admin, (Map<String, Object>) im);
            if (Boolean.TRUE.equals(resp.get("ok"))) created++;
            else errors.add(BatchOps.itemError("index", i, String.valueOf(resp.get("error"))));
        }
        return ResponseEntity.ok(BatchOps.result("created", created, errors));
    }

    /** 批量更新：{ids: [], data: {type / status / is_pinned}} */
    @PostMapping("/batch-update")
    public ResponseEntity<Map<String, Object>> batchUpdate(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        if (requireAdmin(req) == null) return forbidden();
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) return ResponseEntity.ok(err("ids 不能为空"));
        if (!(body.get("data") instanceof Map<?, ?> data) || data.isEmpty()) {
            return ResponseEntity.ok(err("data 不能为空"));
        }
        String type = data.get("type") == null ? null : data.get("type").toString();
        if (type != null && !TYPES.contains(type)) return ResponseEntity.ok(err("类型不合法"));
        String status = data.get("status") == null ? null : data.get("status").toString();
        if (status != null && !STATUSES.contains(status)) return ResponseEntity.ok(err("状态不合法"));
        Integer pinned = data.get("is_pinned") == null ? null : parsePinned(data.get("is_pinned"));

        List<Map<String, Object>> errors = new ArrayList<>();
        int updated = 0;
        for (Long id : ids) {
            Notice n = noticeMapper.selectById(id);
            if (n == null) {
                errors.add(BatchOps.itemError("id", id, "通知不存在"));
                continue;
            }
            if (type != null) n.setType(type);
            if (status != null) {
                if ("published".equals(status) && !"published".equals(n.getStatus()) && n.getPublishTime() == null) {
                    n.setPublishTime(LocalDateTime.now());
                }
                n.setStatus(status);
            }
            if (pinned != null) n.setIsPinned(pinned);
            n.setUpdateTime(LocalDateTime.now());
            noticeMapper.updateById(n);
            updated++;
        }
        return ResponseEntity.ok(BatchOps.result("updated", updated, errors));
    }

    /** 批量删除：{ids: []} */
    @PostMapping("/batch-delete")
    public ResponseEntity<Map<String, Object>> batchDelete(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        if (requireAdmin(req) == null) return forbidden();
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) return ResponseEntity.ok(err("ids 不能为空"));
        List<Map<String, Object>> errors = new ArrayList<>();
        int deleted = 0;
        for (Long id : ids) {
            if (noticeMapper.deleteById(id) > 0) deleted++;
            else errors.add(BatchOps.itemError("id", id, "通知不存在"));
        }
        return ResponseEntity.ok(BatchOps.result("deleted", deleted, errors));
    }

    @PatchMapping("/{id}/pin")
    public ResponseEntity<Map<String, Object>> pin(
            HttpServletRequest req, @PathVariable Long id, @RequestBody Map<String, Object> body) {
        if (requireAdmin(req) == null) return forbidden();

        Notice n = noticeMapper.selectById(id);
        if (n == null) return ResponseEntity.ok(err("通知不存在"));
        n.setIsPinned(parsePinned(body.get("is_pinned")));
        n.setUpdateTime(LocalDateTime.now());
        noticeMapper.updateById(n);
        Map<String, Object> resp = new HashMap<>();
        resp.put("ok", true);
        resp.put("notice", toRow(withPublisher(n)));
        return ResponseEntity.ok(resp);
    }

    // —— helpers ——

    /** is_pinned 解析：非 0 一律按 1 处理（缺省视为取消置顶） */
    private static Integer parsePinned(Object v) {
        if (v == null) return 0;
        try {
            return Integer.parseInt(v.toString()) == 0 ? 0 : 1;
        } catch (NumberFormatException e) {
            return 1;
        }
    }

    /** 兼容 "yyyy-MM-dd HH:mm:ss" 与 "yyyy-MM-ddTHH:mm:ss"，空串返回 null */
    private static LocalDateTime parseDateTime(String s) {
        if (s == null || s.isBlank()) return null;
        try {
            return LocalDateTime.parse(s.trim().replace(" ", "T"));
        } catch (Exception e) {
            return null;
        }
    }

    /** 批量补齐 publisher_name（users.display_name，空则回退 username），单次 IN 查询 */
    private void fillPublishers(List<Notice> notices) {
        List<Long> ids = notices.stream()
                .map(Notice::getPublisherId)
                .filter(Objects::nonNull)
                .distinct()
                .collect(Collectors.toList());
        if (ids.isEmpty()) return;
        Map<Long, String> nameMap = new HashMap<>();
        for (User u : userMapper.selectBatchIds(ids)) {
            String name = (u.getDisplayName() == null || u.getDisplayName().isBlank()) ? u.getUsername() : u.getDisplayName();
            nameMap.put(u.getId(), name);
        }
        for (Notice n : notices) {
            if (n.getPublisherId() != null) n.setPublisherName(nameMap.get(n.getPublisherId()));
        }
    }

    /** 单条补齐 publisher_name（写接口返回用） */
    private Notice withPublisher(Notice n) {
        fillPublishers(List.of(n));
        return n;
    }

    static Map<String, Object> toRow(Notice n) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", n.getId());
        m.put("type", n.getType());
        m.put("title", n.getTitle());
        m.put("content", n.getContent());
        m.put("is_pinned", n.getIsPinned());
        m.put("status", n.getStatus());
        m.put("publisher_id", n.getPublisherId());
        m.put("publisher_name", n.getPublisherName());
        m.put("publish_time", dt(n.getPublishTime()));
        m.put("expire_time", dt(n.getExpireTime()));
        m.put("create_time", dt(n.getCreateTime()));
        m.put("update_time", dt(n.getUpdateTime()));
        return m;
    }

    static String dt(LocalDateTime v) {
        return v == null ? null : v.format(DTF);
    }

    private Map<String, Object> err(String msg) {
        return Map.of("ok", false, "error", msg);
    }
}
