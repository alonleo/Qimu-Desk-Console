package com.alon.admin.controller;

import com.alon.admin.auth.AuthInterceptor;
import com.alon.admin.common.BatchOps;
import com.alon.admin.common.ChatSupport;
import com.alon.admin.common.Result;
import com.alon.admin.entity.ChatConversation;
import com.alon.admin.entity.ChatConversationMember;
import com.alon.admin.entity.ChatMessage;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.ChatConversationMapper;
import com.alon.admin.mapper.ChatConversationMemberMapper;
import com.alon.admin.mapper.ChatMessageMapper;
import com.alon.admin.mapper.UserMapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 消息会话管理（仅 admin 角色）：管理员查看/管理系统内全部用户之间的会话与消息。
 *
 * 与工作台端聊天链路（ChatController / ChatGroupController / ChatWebSocket*）完全独立：
 * - 只读浏览全量会话与消息，不校验管理员是否为会话成员；
 * - 删除会话级联清理 chat_messages / chat_conversation_members / chat_conversations 三表；
 * - 每个接口先做角色校验，非 admin 一律 403（写法与 ChatController /stats 一致）。
 */
@RestController
@RequestMapping("/api/chat/admin")
public class ChatAdminController {

    private final UserMapper userMapper;
    private final ChatMessageMapper messageMapper;
    private final ChatConversationMapper conversationMapper;
    private final ChatConversationMemberMapper memberMapper;

    public ChatAdminController(UserMapper userMapper,
                               ChatMessageMapper messageMapper,
                               ChatConversationMapper conversationMapper,
                               ChatConversationMemberMapper memberMapper) {
        this.userMapper = userMapper;
        this.messageMapper = messageMapper;
        this.conversationMapper = conversationMapper;
        this.memberMapper = memberMapper;
    }

    // ---------- 会话列表（全量，服务端分页） ----------

    /**
     * GET /api/chat/admin/conversations
     * 参数：keyword（模糊匹配单聊双方昵称/用户名或群名，可选）、type（single|group，可选）、
     *       page（默认 1）、size（默认 20，上限 100）。
     * 按 lastMessageAt 倒序；返回 {list, total, page, size}。
     */
    @GetMapping("/conversations")
    public ResponseEntity<Result<Map<String, Object>>> conversations(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String types,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size,
            HttpServletRequest req) {
        User me = me(req);
        if (!"admin".equals(me.getRole())) {
            return ResponseEntity.status(403).body(Result.fail("无权限"));
        }

        int pageNo = Math.max(1, page);
        int pageSize = Math.min(100, Math.max(1, size));

        // 类型多选解析：types=逗号分隔（single,group），兼容旧单值 type 参数
        Set<String> typeSet = new LinkedHashSet<>();
        if (types != null && !types.isBlank()) {
            for (String t : types.split(",")) {
                String v = t.trim();
                if (ChatSupport.CONV_TYPE_SINGLE.equals(v) || ChatSupport.CONV_TYPE_GROUP.equals(v)) typeSet.add(v);
            }
        }
        if (typeSet.isEmpty()) {
            if (ChatSupport.CONV_TYPE_SINGLE.equals(type)) typeSet.add(ChatSupport.CONV_TYPE_SINGLE);
            if (ChatSupport.CONV_TYPE_GROUP.equals(type)) typeSet.add(ChatSupport.CONV_TYPE_GROUP);
        }

        // keyword 预筛：定位命中的会话 id（单聊按参与者昵称/用户名，群聊按群名），并按所选类型收敛
        String kw = keyword == null ? "" : keyword.trim();
        List<Long> matchedIds = null;
        if (!kw.isEmpty()) {
            Set<Long> ids = new HashSet<>();
            if (typeSet.isEmpty() || typeSet.contains(ChatSupport.CONV_TYPE_SINGLE)) {
                List<Long> hitUserIds = userMapper.selectList(Wrappers.<User>lambdaQuery()
                                .and(w -> w.like(User::getUsername, kw).or().like(User::getDisplayName, kw)))
                        .stream().map(User::getId).toList();
                if (!hitUserIds.isEmpty()) {
                    conversationMapper.selectList(Wrappers.<ChatConversation>lambdaQuery()
                                    .eq(ChatConversation::getType, ChatSupport.CONV_TYPE_SINGLE)
                                    .and(w -> w.in(ChatConversation::getUserAId, hitUserIds)
                                            .or().in(ChatConversation::getUserBId, hitUserIds)))
                            .forEach(c -> ids.add(c.getId()));
                }
            }
            if (typeSet.isEmpty() || typeSet.contains(ChatSupport.CONV_TYPE_GROUP)) {
                conversationMapper.selectList(Wrappers.<ChatConversation>lambdaQuery()
                                .eq(ChatConversation::getType, ChatSupport.CONV_TYPE_GROUP)
                                .like(ChatConversation::getGroupName, kw))
                        .forEach(c -> ids.add(c.getId()));
            }
            matchedIds = new ArrayList<>(ids);
            if (matchedIds.isEmpty()) {
                return ResponseEntity.ok(Result.ok(emptyPage(pageNo, pageSize)));
            }
        }

        LambdaQueryWrapper<ChatConversation> qw = Wrappers.<ChatConversation>lambdaQuery()
                .in(!typeSet.isEmpty(), ChatConversation::getType, typeSet)
                .in(matchedIds != null, ChatConversation::getId, matchedIds == null ? List.of() : matchedIds)
                .orderByDesc(ChatConversation::getLastMessageAt)
                .orderByDesc(ChatConversation::getId);
        Page<ChatConversation> result = conversationMapper.selectPage(new Page<>(pageNo, pageSize), qw);
        List<ChatConversation> convs = result.getRecords();

        // 批量聚合：消息总数 / 群成员数 / 参与用户（避免逐行 N+1）
        List<Long> convIds = convs.stream().map(ChatConversation::getId).toList();
        Map<Long, Long> messageCountByConv = messageCountByConversation(convIds);
        Map<Long, Long> memberCountByConv = memberCountByConversation(convIds);

        Set<Long> userIds = new HashSet<>();
        for (ChatConversation c : convs) {
            if (ChatSupport.CONV_TYPE_SINGLE.equals(c.getType())) {
                userIds.add(c.getUserAId());
                userIds.add(c.getUserBId());
            }
        }
        Map<Long, User> users = userIds.isEmpty()
                ? Map.of()
                : userMapper.selectBatchIds(userIds).stream().collect(Collectors.toMap(User::getId, u -> u));

        List<Map<String, Object>> list = new ArrayList<>(convs.size());
        for (ChatConversation c : convs) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("conversationId", c.getId());
            item.put("type", c.getType());
            if (ChatSupport.CONV_TYPE_SINGLE.equals(c.getType())) {
                List<Map<String, Object>> participants = new ArrayList<>(2);
                for (Long uid : List.of(c.getUserAId(), c.getUserBId())) {
                    User u = users.get(uid);
                    Map<String, Object> p = new LinkedHashMap<>();
                    p.put("id", uid);
                    p.put("username", u == null ? "" : u.getUsername());
                    p.put("displayName", u == null ? "" : displayName(u));
                    participants.add(p);
                }
                item.put("participants", participants);
            } else {
                Map<String, Object> group = new LinkedHashMap<>();
                group.put("name", c.getGroupName() == null ? "" : c.getGroupName());
                group.put("memberCount", memberCountByConv.getOrDefault(c.getId(), 0L));
                group.put("ownerId", c.getOwnerId());
                item.put("group", group);
            }
            item.put("messageCount", messageCountByConv.getOrDefault(c.getId(), 0L));
            item.put("lastMessagePreview", c.getLastMessagePreview() == null ? "" : c.getLastMessagePreview());
            item.put("lastMessageAt", ChatSupport.fmt(c.getLastMessageAt()));
            list.add(item);
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("list", list);
        data.put("total", result.getTotal());
        data.put("page", pageNo);
        data.put("size", pageSize);
        return ResponseEntity.ok(Result.ok(data));
    }

    // ---------- 会话消息（只读，向上翻页） ----------

    /**
     * GET /api/chat/admin/conversations/{id}/messages
     * 参数：beforeId（向上翻页，可选）、limit（默认 50，上限 100）。
     * 升序返回 {messages:[...], hasMore}；会话不存在返回空列表。
     */
    @GetMapping("/conversations/{id}/messages")
    public ResponseEntity<Result<Map<String, Object>>> messages(@PathVariable long id,
                                                                @RequestParam(required = false) Long beforeId,
                                                                @RequestParam(defaultValue = "50") int limit,
                                                                HttpServletRequest req) {
        User me = me(req);
        if (!"admin".equals(me.getRole())) {
            return ResponseEntity.status(403).body(Result.fail("无权限"));
        }
        int size = Math.min(100, Math.max(1, limit));

        List<ChatMessage> list = new ArrayList<>();
        boolean hasMore = false;
        if (conversationMapper.selectById(id) != null) {
            list = fetchNewest(id, beforeId, size);
            hasMore = trimAndReverse(list, size);
        }

        Set<Long> senderIds = new HashSet<>();
        for (ChatMessage m : list) {
            senderIds.add(m.getSenderId());
        }
        Map<Long, String> senderNames = displayNameMap(senderIds);

        List<Map<String, Object>> messages = list.stream().map(m -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", m.getId());
            row.put("conversationId", m.getConversationId());
            row.put("senderId", m.getSenderId());
            row.put("senderName", senderNames.getOrDefault(m.getSenderId(), ""));
            row.put("content", m.getContent());
            row.put("createdAt", ChatSupport.fmt(m.getCreatedAt()));
            row.put("isRead", m.getIsRead());
            return row;
        }).collect(Collectors.toList());

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("messages", messages);
        data.put("hasMore", hasMore);
        return ResponseEntity.ok(Result.ok(data));
    }

    // ---------- 删除会话（级联三表） ----------

    /**
     * DELETE /api/chat/admin/conversations/{id}
     * 级联删除 chat_messages / chat_conversation_members / chat_conversations；
     * 返回 {deleted:true, removedMessages:n}；会话不存在返回 fail("会话不存在")。
     */
    @DeleteMapping("/conversations/{id}")
    public ResponseEntity<Result<Map<String, Object>>> delete(@PathVariable long id, HttpServletRequest req) {
        User me = me(req);
        if (!"admin".equals(me.getRole())) {
            return ResponseEntity.status(403).body(Result.fail("无权限"));
        }
        ChatConversation conv = conversationMapper.selectById(id);
        if (conv == null) {
            return ResponseEntity.ok(Result.fail("会话不存在"));
        }
        int removedMessages = messageMapper.delete(Wrappers.<ChatMessage>lambdaQuery()
                .eq(ChatMessage::getConversationId, id));
        memberMapper.delete(Wrappers.<ChatConversationMember>lambdaQuery()
                .eq(ChatConversationMember::getConversationId, id));
        conversationMapper.deleteById(id);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("deleted", true);
        data.put("removedMessages", removedMessages);
        return ResponseEntity.ok(Result.ok(data));
    }

    /** 批量删除会话：{ids: []}，逐条级联清理三表，非 admin 一律 403 */
    @PostMapping("/conversations/batch-delete")
    public ResponseEntity<Result<Map<String, Object>>> batchDelete(HttpServletRequest req,
                                                                   @RequestBody Map<String, Object> body) {
        User me = me(req);
        if (!"admin".equals(me.getRole())) {
            return ResponseEntity.status(403).body(Result.fail("无权限"));
        }
        List<Long> ids = BatchOps.parseIds(body.get("ids"));
        if (ids.isEmpty()) {
            return ResponseEntity.ok(Result.fail("ids 不能为空"));
        }
        List<Map<String, Object>> errors = new ArrayList<>();
        int deleted = 0;
        int removedMessages = 0;
        for (Long id : ids) {
            ChatConversation conv = conversationMapper.selectById(id);
            if (conv == null) {
                errors.add(BatchOps.itemError("id", id, "会话不存在"));
                continue;
            }
            removedMessages += messageMapper.delete(Wrappers.<ChatMessage>lambdaQuery()
                    .eq(ChatMessage::getConversationId, id));
            memberMapper.delete(Wrappers.<ChatConversationMember>lambdaQuery()
                    .eq(ChatConversationMember::getConversationId, id));
            conversationMapper.deleteById(id);
            deleted++;
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("deleted", deleted);
        data.put("failed", errors.size());
        data.put("errors", errors);
        data.put("removedMessages", removedMessages);
        return ResponseEntity.ok(Result.ok(data));
    }

    // ---------- 工具 ----------

    private User me(HttpServletRequest req) {
        Object attr = req.getAttribute(AuthInterceptor.ATTR_USER);
        if (attr instanceof User u) {
            return u;
        }
        // AuthInterceptor 保证 /api/** 下必有 currentUser；此处仅为类型收窄兜底
        throw new IllegalStateException("未登录或鉴权上下文缺失");
    }

    private String displayName(User u) {
        return u.getDisplayName() == null || u.getDisplayName().isBlank() ? u.getUsername() : u.getDisplayName();
    }

    /** 批量取用户展示昵称（displayName 为空回退 username） */
    private Map<Long, String> displayNameMap(Set<Long> userIds) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        return userMapper.selectBatchIds(userIds).stream()
                .collect(Collectors.toMap(User::getId, this::displayName));
    }

    /** 按会话维度一次 GROUP BY 聚合消息总数（chat_messages） */
    private Map<Long, Long> messageCountByConversation(List<Long> convIds) {
        Map<Long, Long> out = new HashMap<>();
        if (convIds.isEmpty()) {
            return out;
        }
        for (Map<String, Object> row : messageMapper.selectMaps(Wrappers.<ChatMessage>query()
                .select("conversation_id", "COUNT(*) AS cnt")
                .in("conversation_id", convIds)
                .groupBy("conversation_id"))) {
            out.put(((Number) row.get("conversation_id")).longValue(),
                    ((Number) row.get("cnt")).longValue());
        }
        return out;
    }

    /** 按会话维度一次 GROUP BY 聚合群成员数（chat_conversation_members） */
    private Map<Long, Long> memberCountByConversation(List<Long> convIds) {
        Map<Long, Long> out = new HashMap<>();
        if (convIds.isEmpty()) {
            return out;
        }
        for (Map<String, Object> row : memberMapper.selectMaps(Wrappers.<ChatConversationMember>query()
                .select("conversation_id", "COUNT(*) AS cnt")
                .in("conversation_id", convIds)
                .groupBy("conversation_id"))) {
            out.put(((Number) row.get("conversation_id")).longValue(),
                    ((Number) row.get("cnt")).longValue());
        }
        return out;
    }

    /** 取 id < beforeId（或全部）的最新 size+1 条，用于判断 hasMore（与 ChatController 同策略） */
    private List<ChatMessage> fetchNewest(long conversationId, Long beforeId, int size) {
        return messageMapper.selectList(Wrappers.<ChatMessage>lambdaQuery()
                .eq(ChatMessage::getConversationId, conversationId)
                .lt(beforeId != null, ChatMessage::getId, beforeId)
                .orderByDesc(ChatMessage::getId)
                .last("LIMIT " + (size + 1)));
    }

    /** 超出 size 则截断并置 hasMore；反转为升序返回 */
    private boolean trimAndReverse(List<ChatMessage> list, int size) {
        boolean hasMore = false;
        if (list.size() > size) {
            hasMore = true;
            list.subList(size, list.size()).clear();
        }
        Collections.reverse(list);
        return hasMore;
    }

    private Map<String, Object> emptyPage(int page, int size) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("list", List.of());
        data.put("total", 0L);
        data.put("page", page);
        data.put("size", size);
        return data;
    }
}
