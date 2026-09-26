package com.alon.admin.controller;

import com.alon.admin.common.BatchOps;
import com.alon.admin.common.VisibilityPolicy;
import com.alon.admin.entity.Category;
import com.alon.admin.entity.Doc;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.CategoryMapper;
import com.alon.admin.mapper.DocMapper;
import com.alon.admin.mapper.UserMapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/** 知识库：文档 CRUD + 全文检索 + 分类 CRUD（对齐前端组件格式；含可见性过滤与写权限，见 VisibilityPolicy） */
@RestController
@RequestMapping("/api/knowledge")
public class KnowledgeController {

    private final DocMapper docMapper;
    private final CategoryMapper categoryMapper;
    private final UserMapper userMapper;

    public KnowledgeController(DocMapper docMapper, CategoryMapper categoryMapper, UserMapper userMapper) {
        this.docMapper = docMapper;
        this.categoryMapper = categoryMapper;
        this.userMapper = userMapper;
    }

    // —— 文档 ——

    /** 列表：member 追加可见性 scope；可选 visibility / ownerId / q / category / tag 筛选 */
    @GetMapping
    public Map<String, Object> list(HttpServletRequest req,
                                    @RequestParam(required = false) String q,
                                    @RequestParam(required = false) String category,
                                    @RequestParam(required = false) String tag,
                                    @RequestParam(required = false) Integer limit,
                                    @RequestParam(required = false) String visibility,
                                    @RequestParam(required = false) Long ownerId) {
        User user = VisibilityPolicy.currentUser(req);
        int lim = limit == null ? 200 : Math.min(Math.max(limit, 1), 500);
        LambdaQueryWrapper<Doc> qw = new LambdaQueryWrapper<Doc>()
                .orderByDesc(Doc::getPinned)
                .orderByDesc(Doc::getUpdatedAt);
        if (q != null && !q.isBlank()) {
            String qt = q.trim();
            qw.and(w -> w.like(Doc::getTitle, qt).or().like(Doc::getTags, qt).or().like(Doc::getContent, qt));
        }
        VisibilityPolicy.applyScope(user, qw);
        String vis = VisibilityPolicy.parseVisibility(visibility);
        if (vis != null) qw.eq(Doc::getVisibility, vis);
        if (ownerId != null) qw.eq(Doc::getOwnerId, ownerId);
        IPage<Doc> page = docMapper.selectPage(Page.of(1, lim), qw);
        List<Doc> records = page.getRecords();
        Map<Long, String> ownerNames = VisibilityPolicy.ownerNames(
                userMapper, records.stream().map(Doc::getOwnerId).toList());
        List<Map<String, Object>> items = records.stream()
                .filter(d -> category == null || category.isBlank() || category.equals("all") || category.equals(d.getCategory()))
                .filter(d -> tag == null || tag.isBlank() || Arrays.asList(splitTags(d.getTags())).contains(tag))
                .map(d -> toDocItem(d, q, ownerNames))
                .collect(Collectors.toList());
        return Map.of("docs", items, "categories", listCategories(), "tags", listTags());
    }

    /** 详情：member 访问他人 personal 条目 → 403 + {"error":"无权访问"} */
    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> detail(@PathVariable Long id, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        Doc d = docMapper.selectById(id);
        if (d == null) return ResponseEntity.ok(Map.of("error", "文档不存在"));
        if (!VisibilityPolicy.canRead(user, d.getVisibility(), d.getOwnerId())) {
            return ResponseEntity.status(403).body(Map.of("error", "无权访问"));
        }
        return ResponseEntity.ok(Map.of("doc", toDocFull(d, VisibilityPolicy.ownerNames(userMapper, List.of(d.getOwnerId())))));
    }

    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        return createOne(body, VisibilityPolicy.currentUser(req));
    }

    /** 单条创建（批量创建复用）；返回 {doc} 或 {error}；owner_id 服务端注入、visibility 归一化、created_by 保留原语义 */
    private Map<String, Object> createOne(Map<String, Object> body, User user) {
        String title = body.getOrDefault("title", "").toString().trim();
        if (title.isBlank()) return Map.of("error", "文档标题不能为空");
        Doc d = new Doc();
        d.setTitle(title);
        d.setCategory(body.getOrDefault("category", "未分类").toString().isBlank() ? "未分类" : body.get("category").toString().trim());
        d.setTags(joinTags(body.get("tags")));
        d.setContent(body.get("content") == null ? "" : body.get("content").toString());
        d.setPinned(0);
        // docs 双轨（§六.8）：created_by（username 文本）保留原语义继续写；owner_id 为新权威
        d.setCreatedBy(user == null ? "admin" : user.getUsername());
        d.setOwnerId(user == null ? null : user.getId());
        d.setVisibility(VisibilityPolicy.resolveVisibility(user, body.get("visibility")));
        d.setCreatedAt(LocalDateTime.now());
        d.setUpdatedAt(LocalDateTime.now());
        docMapper.insert(d);
        ensureCategory(d.getCategory());
        return Map.of("doc", toDocFull(d, Map.of()));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable Long id, @RequestBody Map<String, Object> body,
                                                      HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        Doc d = docMapper.selectById(id);
        if (d == null) return ResponseEntity.ok(Map.of("error", "文档不存在"));
        // 写权限边界（P1）：member 不能修改他人条目（含他人创建的通用条目）
        if (!VisibilityPolicy.canWrite(user, d.getOwnerId())) {
            return ResponseEntity.status(403).body(Map.of("ok", false, "error", VisibilityPolicy.FORBIDDEN_MSG));
        }
        if (body.get("title") != null) d.setTitle(body.get("title").toString());
        if (body.get("category") != null) d.setCategory(body.get("category").toString());
        if (body.get("tags") != null) d.setTags(joinTags(body.get("tags")));
        if (body.get("content") != null) d.setContent(body.get("content").toString());
        if (body.get("pinned") != null) d.setPinned(Boolean.parseBoolean(body.get("pinned").toString()) ? 1 : 0);
        // 可见性更新（可选）：仅接受 personal/public，非法值忽略
        String vis = VisibilityPolicy.parseVisibility(body.get("visibility"));
        if (vis != null) d.setVisibility(vis);
        d.setUpdatedAt(LocalDateTime.now());
        docMapper.updateById(d);
        if (body.get("category") != null) ensureCategory(d.getCategory());
        return ResponseEntity.ok(Map.of("doc", toDocFull(d, Map.of())));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> delete(@PathVariable Long id, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        Doc d = docMapper.selectById(id);
        if (d == null) return ResponseEntity.ok(Map.of("error", "文档不存在"));
        // 写权限边界（P1）：member 不能删除他人条目
        if (!VisibilityPolicy.canWrite(user, d.getOwnerId())) {
            return ResponseEntity.status(403).body(Map.of("ok", false, "error", VisibilityPolicy.FORBIDDEN_MSG));
        }
        if (docMapper.deleteById(id) > 0) return ResponseEntity.ok(Map.of("ok", true));
        return ResponseEntity.ok(Map.of("error", "文档不存在"));
    }

    // —— 文档批量操作 ——

    /** 批量创建：{items: [{title,category,tags,content}, ...]} */
    @PostMapping("/batch-create")
    public Map<String, Object> batchCreate(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        User user = VisibilityPolicy.currentUser(req);
        if (!(body.get("items") instanceof List<?> items) || items.isEmpty()) {
            return Map.of("error", "items 不能为空");
        }
        List<Map<String, Object>> errors = new ArrayList<>();
        int created = 0;
        for (int i = 0; i < items.size(); i++) {
            if (!(items.get(i) instanceof Map<?, ?> im)) {
                errors.add(BatchOps.itemError("index", i, "条目必须是对象"));
                continue;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> resp = createOne((Map<String, Object>) im, user);
            if (resp.containsKey("doc")) created++;
            else errors.add(BatchOps.itemError("index", i, String.valueOf(resp.get("error"))));
        }
        return BatchOps.result("created", created, errors);
    }

    /** 批量更新：{ids: [], data: {category / pinned}} */
    @PostMapping("/batch-update")
    public Map<String, Object> batchUpdate(@RequestBody Map<String, Object> body) {
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) return Map.of("error", "ids 不能为空");
        if (!(body.get("data") instanceof Map<?, ?> data) || data.isEmpty()) {
            return Map.of("error", "data 不能为空（支持 category / pinned）");
        }
        String category = data.get("category") == null ? null : data.get("category").toString().trim();
        Integer pinned = data.get("pinned") == null ? null : (Boolean.parseBoolean(data.get("pinned").toString()) ? 1 : 0);
        if ((category == null || category.isBlank()) && pinned == null) {
            return Map.of("error", "仅支持批量修改分类（category）或置顶（pinned）");
        }
        List<Map<String, Object>> errors = new ArrayList<>();
        int updated = 0;
        for (Long id : ids) {
            Doc d = docMapper.selectById(id);
            if (d == null) {
                errors.add(BatchOps.itemError("id", id, "文档不存在"));
                continue;
            }
            if (category != null && !category.isBlank()) {
                d.setCategory(category);
                ensureCategory(category);
            }
            if (pinned != null) d.setPinned(pinned);
            d.setUpdatedAt(LocalDateTime.now());
            docMapper.updateById(d);
            updated++;
        }
        return BatchOps.result("updated", updated, errors);
    }

    /** 批量删除：{ids: []} */
    @PostMapping("/batch-delete")
    public Map<String, Object> batchDelete(@RequestBody Map<String, Object> body) {
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) return Map.of("error", "ids 不能为空");
        int deleted = docMapper.deleteBatchIds(ids);
        return BatchOps.result("deleted", deleted, List.of());
    }

    // —— 分类 ——

    @GetMapping("/categories")
    public Map<String, Object> categories() {
        return Map.of("categories", listCategories());
    }

    @PostMapping("/categories")
    public Map<String, Object> createCategory(@RequestBody Map<String, Object> body) {
        String name = body.getOrDefault("name", "").toString().trim();
        if (name.isBlank()) return Map.of("error", "分类名不能为空");
        if (name.length() > 30) return Map.of("error", "分类名过长（最多 30 字）");
        if (categoryMapper.selectCount(Wrappers.<Category>lambdaQuery().eq(Category::getName, name)) > 0) {
            return Map.of("error", "分类「" + name + "」已存在");
        }
        Category c = new Category();
        c.setName(name);
        c.setCreatedAt(LocalDateTime.now());
        categoryMapper.insert(c);
        return Map.of("ok", true, "category", Map.of("id", c.getId(), "name", c.getName()));
    }

    @PatchMapping("/categories/{id}")
    public Map<String, Object> renameCategory(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        String name = body.getOrDefault("name", "").toString().trim();
        if (name.isBlank()) return Map.of("error", "分类名不能为空");
        if (name.length() > 30) return Map.of("error", "分类名过长（最多 30 字）");
        Category c = categoryMapper.selectById(id);
        if (c == null) return Map.of("error", "分类不存在");
        if (c.getName().equals(name)) return Map.of("ok", true, "category", Map.of("id", c.getId(), "name", c.getName()));
        if (categoryMapper.selectCount(Wrappers.<Category>lambdaQuery().eq(Category::getName, name).ne(Category::getId, id)) > 0) {
            return Map.of("error", "分类「" + name + "」已存在");
        }
        String oldName = c.getName();
        c.setName(name);
        categoryMapper.updateById(c);
        // 同步文档分类文本引用
        docMapper.update(null, new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<Doc>()
                .eq(Doc::getCategory, oldName).set(Doc::getCategory, name));
        return Map.of("ok", true, "category", Map.of("id", c.getId(), "name", c.getName()));
    }

    @DeleteMapping("/categories/{id}")
    public Map<String, Object> deleteCategory(@PathVariable Long id) {
        Category c = categoryMapper.selectById(id);
        if (c == null) return Map.of("error", "分类不存在");
        if ("未分类".equals(c.getName())) return Map.of("error", "「未分类」是系统默认分类，不能删除");
        int moved = docMapper.update(null, new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<Doc>()
                .eq(Doc::getCategory, c.getName()).set(Doc::getCategory, "未分类"));
        categoryMapper.deleteById(id);
        return Map.of("ok", true, "moved", moved);
    }

    // —— 分类批量操作 ——

    /** 分类批量创建：{items: [{name}, ...]}（已存在的自动跳过） */
    @PostMapping("/categories/batch-create")
    public Map<String, Object> batchCreateCategories(@RequestBody Map<String, Object> body) {
        if (!(body.get("items") instanceof List<?> items) || items.isEmpty()) {
            return Map.of("error", "items 不能为空");
        }
        List<Map<String, Object>> errors = new ArrayList<>();
        int created = 0;
        for (int i = 0; i < items.size(); i++) {
            Object it = items.get(i);
            Object rawName = it instanceof Map<?, ?> m ? m.get("name") : it;
            String name = rawName == null ? "" : rawName.toString().trim();
            if (name.isBlank()) {
                errors.add(BatchOps.itemError("index", i, "分类名不能为空"));
                continue;
            }
            if (name.length() > 30) {
                errors.add(BatchOps.itemError("index", i, "分类名「" + name + "」过长（最多 30 字）"));
                continue;
            }
            if (categoryMapper.selectCount(Wrappers.<Category>lambdaQuery().eq(Category::getName, name)) > 0) {
                errors.add(BatchOps.itemError("index", i, "分类「" + name + "」已存在"));
                continue;
            }
            Category c = new Category();
            c.setName(name);
            c.setCreatedAt(LocalDateTime.now());
            categoryMapper.insert(c);
            created++;
        }
        return BatchOps.result("created", created, errors);
    }

    /** 分类批量删除：{ids: []}（「未分类」自动跳过，其余分类下文档移回未分类） */
    @PostMapping("/categories/batch-delete")
    public Map<String, Object> batchDeleteCategories(@RequestBody Map<String, Object> body) {
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) return Map.of("error", "ids 不能为空");
        List<Map<String, Object>> errors = new ArrayList<>();
        int deleted = 0;
        int moved = 0;
        for (Long id : ids) {
            Category c = categoryMapper.selectById(id);
            if (c == null) {
                errors.add(BatchOps.itemError("id", id, "分类不存在"));
                continue;
            }
            if ("未分类".equals(c.getName())) {
                errors.add(BatchOps.itemError("id", id, "「未分类」是系统默认分类，不能删除"));
                continue;
            }
            moved += docMapper.update(null, new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<Doc>()
                    .eq(Doc::getCategory, c.getName()).set(Doc::getCategory, "未分类"));
            categoryMapper.deleteById(id);
            deleted++;
        }
        Map<String, Object> resp = new LinkedHashMap<>(BatchOps.result("deleted", deleted, errors));
        resp.put("movedDocs", moved);
        return resp;
    }

    // —— 辅助 ——

    private List<Map<String, Object>> listCategories() {
        List<Category> cats = categoryMapper.selectList(Wrappers.<Category>lambdaQuery().orderByAsc(Category::getName));
        // 一次聚合统计各分类文档数，避免把全部文档拉回内存逐条 count
        Map<String, Long> countMap = docMapper.selectMaps(
                        new QueryWrapper<Doc>().select("category", "COUNT(*) AS cnt").groupBy("category"))
                .stream().collect(Collectors.toMap(
                        m -> m.get("category") == null ? "未分类" : String.valueOf(m.get("category")),
                        m -> ((Number) m.get("cnt")).longValue()));
        return cats.stream().map(c -> {
            Map<String, Object> m = new HashMap<>();
            m.put("id", c.getId());
            m.put("name", c.getName());
            m.put("count", countMap.getOrDefault(c.getName(), 0L));
            return m;
        }).toList();
    }

    private List<Map<String, Object>> listTags() {
        // 一次把含 tags 的文档取回（仅 category+tags 两列），按逗号拆分统计；避免全表拉取 content
        Map<String, Long> counter = new TreeMap<>();
        for (Map<String, Object> row : docMapper.selectMaps(
                new QueryWrapper<Doc>().select("tags").isNotNull("tags").ne("tags", ""))) {
            Object tags = row.get("tags");
            for (String t : splitTags(tags == null ? null : String.valueOf(tags))) counter.merge(t, 1L, Long::sum);
        }
        return counter.entrySet().stream()
                .sorted((a, b) -> Long.compare(b.getValue(), a.getValue()))
                .map(e -> Map.<String, Object>of("name", e.getKey(), "count", e.getValue()))
                .toList();
    }

    private void ensureCategory(String name) {
        if (name == null || name.isBlank()) return;
        if (categoryMapper.selectCount(Wrappers.<Category>lambdaQuery().eq(Category::getName, name)) == 0) {
            Category c = new Category();
            c.setName(name);
            c.setCreatedAt(LocalDateTime.now());
            categoryMapper.insert(c);
        }
    }

    private String[] splitTags(String raw) {
        if (raw == null || raw.isBlank()) return new String[0];
        return Arrays.stream(raw.split(",")).map(String::trim).filter(s -> !s.isBlank()).toArray(String[]::new);
    }

    private String joinTags(Object tags) {
        if (tags instanceof List<?> list) {
            return list.stream().map(String::valueOf).map(String::trim).filter(s -> !s.isBlank())
                    .distinct().limit(10).collect(Collectors.joining(","));
        }
        return "";
    }

    private Map<String, Object> toDocItem(Doc d, String q, Map<Long, String> ownerNames) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", d.getId());
        m.put("title", d.getTitle());
        m.put("category", d.getCategory());
        m.put("tags", Arrays.asList(splitTags(d.getTags())));
        m.put("pinned", d.getPinned());
        m.put("created_by", d.getCreatedBy());
        // 来源标识透出：docs 无独立 JSON，实体列缺省归为 manual（不依赖 created_by）
        m.put("source", d.getSource() == null || d.getSource().isBlank() ? "manual" : d.getSource());
        // 可见性透出：visibility 缺省按 public（旧数据/降级），owner_name 由 users 批量组装
        m.put("visibility", d.getVisibility() == null ? VisibilityPolicy.PUBLIC : d.getVisibility());
        m.put("owner_id", d.getOwnerId());
        m.put("owner_name", ownerNames.get(d.getOwnerId()));
        m.put("created_at", dt(d.getCreatedAt()));
        m.put("updated_at", dt(d.getUpdatedAt()));
        m.put("excerpt", makeExcerpt(d, q));
        return m;
    }

    private Map<String, Object> toDocFull(Doc d, Map<Long, String> ownerNames) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", d.getId());
        m.put("title", d.getTitle());
        m.put("category", d.getCategory());
        m.put("tags", Arrays.asList(splitTags(d.getTags())));
        m.put("content", d.getContent());
        m.put("pinned", d.getPinned());
        m.put("created_by", d.getCreatedBy());
        m.put("source", d.getSource() == null || d.getSource().isBlank() ? "manual" : d.getSource());
        m.put("visibility", d.getVisibility() == null ? VisibilityPolicy.PUBLIC : d.getVisibility());
        m.put("owner_id", d.getOwnerId());
        m.put("owner_name", ownerNames.get(d.getOwnerId()));
        m.put("created_at", dt(d.getCreatedAt()));
        m.put("updated_at", dt(d.getUpdatedAt()));
        return m;
    }

    private String makeExcerpt(Doc d, String q) {
        String text = d.getContent() == null ? "" : d.getContent()
                .replaceAll("```[\\s\\S]*?```", " ")
                .replaceAll("[#>*`~\\[\\]!]", " ")
                .replaceAll("\\s+", " ").trim();
        if (text.length() > 140) text = text.substring(0, 140) + "…";
        return text;
    }

    private String dt(LocalDateTime v) {
        return v == null ? null : v.toString().replace("T", " ");
    }
}
