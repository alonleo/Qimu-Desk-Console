package com.alon.admin.controller;

import com.alon.admin.auth.AuthInterceptor;
import com.alon.admin.entity.Notice;
import com.alon.admin.entity.NoticeRead;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.NoticeMapper;
import com.alon.admin.mapper.NoticeReadMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 通知阅读状态（全员登录用户，member 可访问）：
 * - GET  /api/notices/pending      未读公告（强制阅读队列）+ 未读通知（顶部弹窗）+ 未读总数；
 * - POST /api/notices/{id}/read    写阅读回执（幂等，(notice_id, user_id) 联合唯一兜底）。
 * 读路径不在此处（workbench 本地 Route Handler 直连 MySQL）；此处只承担"写回执"收口。
 */
@RestController
@RequestMapping("/api/notices")
public class NoticeReadController {

    private final NoticeReadMapper noticeReadMapper;
    private final NoticeMapper noticeMapper;

    public NoticeReadController(NoticeReadMapper noticeReadMapper, NoticeMapper noticeMapper) {
        this.noticeReadMapper = noticeReadMapper;
        this.noticeMapper = noticeMapper;
    }

    /** currentUser 由 AuthInterceptor 注入，member/admin 均可访问 */
    private User current(HttpServletRequest req) {
        Object attr = req.getAttribute(AuthInterceptor.ATTR_USER);
        return attr instanceof User user ? user : null;
    }

    @GetMapping("/pending")
    public ResponseEntity<Map<String, Object>> pending(HttpServletRequest req) {
        User user = current(req);
        if (user == null) return ResponseEntity.status(401).body(Map.of("ok", false, "error", "未登录"));

        // 公告全量拉取（强制阅读不能漏）；通知最多 20 条（弹窗+角标足够）
        List<Notice> announcements = noticeReadMapper.selectUnreadByType(user.getId(), "announcement", 50);
        List<Notice> notifications = noticeReadMapper.selectUnreadByType(user.getId(), "notification", 20);
        long unreadTotal = noticeReadMapper.countUnread(user.getId());

        Map<String, Object> data = new HashMap<>();
        data.put("announcements", announcements.stream().map(NoticeController::toRow).toList());
        data.put("notifications", notifications.stream().map(NoticeController::toRow).toList());
        data.put("unreadTotal", unreadTotal);
        return ResponseEntity.ok(Map.of("ok", true, "data", data));
    }

    @PostMapping("/{id}/read")
    public ResponseEntity<Map<String, Object>> markRead(HttpServletRequest req, @PathVariable Long id) {
        User user = current(req);
        if (user == null) return ResponseEntity.status(401).body(Map.of("ok", false, "error", "未登录"));

        Notice n = noticeMapper.selectById(id);
        if (n == null) return ResponseEntity.ok(Map.of("ok", false, "error", "通知不存在"));

        QueryWrapper<NoticeRead> qw = new QueryWrapper<>();
        qw.eq("notice_id", id).eq("user_id", user.getId());
        if (noticeReadMapper.selectCount(qw) == 0) {
            NoticeRead r = new NoticeRead();
            r.setNoticeId(id);
            r.setUserId(user.getId());
            r.setReadTime(LocalDateTime.now());
            noticeReadMapper.insert(r);
        }
        return ResponseEntity.ok(Map.of("ok", true));
    }
}
