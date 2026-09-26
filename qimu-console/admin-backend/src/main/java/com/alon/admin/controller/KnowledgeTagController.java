package com.alon.admin.controller;

import com.alon.admin.common.VisibilityPolicy;
import com.alon.admin.service.KnowledgeTagService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/knowledge/tags")
public class KnowledgeTagController {
    private final KnowledgeTagService tags;
    public KnowledgeTagController(KnowledgeTagService tags) { this.tags = tags; }

    @GetMapping public Map<String, Object> list(HttpServletRequest req) {
        return Map.of("tags", tags.list(VisibilityPolicy.currentUser(req)));
    }
    @PostMapping public ResponseEntity<?> create(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        if (!VisibilityPolicy.isAdmin(VisibilityPolicy.currentUser(req))) return denied();
        Object raw = body.get("name");
        String name = raw instanceof String ? ((String) raw).trim() : "";
        if (name.isEmpty() || name.length() > 30 || (name.matches(".*[,，;；].*") || name.chars().anyMatch(Character::isISOControl)))
            return ResponseEntity.badRequest().body(Map.of("error", "标签名需为 1–30 个字符，不能包含逗号、分号或控制字符"));
        try {
            if (!tags.create(name)) return conflict();
            return ResponseEntity.ok(Map.of("ok", true, "tag", Map.of("name", name, "count", 0)));
        } catch (DuplicateKeyException e) { return conflict(); }
    }
    @DeleteMapping public ResponseEntity<?> delete(@RequestParam String name, HttpServletRequest req) {
        if (!VisibilityPolicy.isAdmin(VisibilityPolicy.currentUser(req))) return denied();
        if (name.isBlank() || name.contains(",")) return ResponseEntity.badRequest().body(Map.of("error", "无效标签名"));
        return ResponseEntity.ok(Map.of("ok", true, "updated", tags.delete(name.trim())));
    }
    private ResponseEntity<?> denied() { return ResponseEntity.status(403).body(Map.of("error", "仅管理员可管理共享分类和标签")); }
    private ResponseEntity<?> conflict() { return ResponseEntity.status(409).body(Map.of("error", "标签已存在")); }
}
