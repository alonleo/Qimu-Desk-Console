package com.alon.admin.service;

import com.alon.admin.common.VisibilityPolicy;
import com.alon.admin.entity.User;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Service
public class KnowledgeTagService {
    private final JdbcTemplate jdbc;
    public KnowledgeTagService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public List<Map<String, Object>> list(User user) {
        Map<String, Long> counts = new TreeMap<>();
        for (String name : jdbc.queryForList("SELECT name FROM knowledge_tags ORDER BY name", String.class)) counts.put(name, 0L);
        List<String> values = VisibilityPolicy.isAdmin(user)
                ? jdbc.queryForList("SELECT tags FROM docs", String.class)
                : jdbc.queryForList("SELECT tags FROM docs WHERE visibility='public' OR owner_id=?", String.class, user == null ? -1L : user.getId());
        for (String raw : values) for (String tag : tags(raw)) counts.merge(tag, 1L, Long::sum);
        return counts.entrySet().stream().sorted(Map.Entry.<String, Long>comparingByValue().reversed().thenComparing(Map.Entry.comparingByKey()))
                .map(e -> Map.<String, Object>of("name", e.getKey(), "count", e.getValue())).toList();
    }

    public boolean create(String name) {
        Long used = jdbc.queryForObject("SELECT COUNT(*) FROM docs WHERE FIND_IN_SET(?, tags) > 0", Long.class, name);
        if (used != null && used > 0) return false;
        jdbc.update("INSERT INTO knowledge_tags (name) VALUES (?)", name);
        return true;
    }

    @Transactional
    public int delete(String name) {
        // 锁住匹配文档，避免读出标签后覆盖其他请求刚写入的标签。
        List<Map<String, Object>> docs = jdbc.queryForList("SELECT id, tags FROM docs WHERE FIND_IN_SET(?, tags) > 0 FOR UPDATE", name);
        int changed = 0;
        for (Map<String, Object> doc : docs) {
            Set<String> remaining = tags((String) doc.get("tags"));
            if (remaining.remove(name)) changed += jdbc.update("UPDATE docs SET tags=?, updated_at=NOW() WHERE id=?", String.join(",", remaining), doc.get("id"));
        }
        jdbc.update("DELETE FROM knowledge_tags WHERE name=?", name);
        return changed;
    }

    private Set<String> tags(String raw) {
        Set<String> result = new LinkedHashSet<>();
        if (raw != null) for (String tag : raw.split(",")) if (!tag.trim().isEmpty()) result.add(tag.trim());
        return result;
    }
}
