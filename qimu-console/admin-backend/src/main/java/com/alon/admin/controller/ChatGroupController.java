package com.alon.admin.controller;

import com.alon.admin.auth.AuthInterceptor;
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
import com.alon.admin.websocket.OnlineRegistry;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 群聊 REST（chat-module v2）：建群 / 成员列表 / 群历史消息 / 群发送兜底 / 群已读。
 *
 * 定案：群读写走独立前缀 /api/chat/groups/{conversationId}/*，单聊 peerId 接口一行不改。
 * 越权防线：一切群读写入口第一步校验 me ∈ chat_conversation_members（不含建群本身），
 * 非成员一律 NOT_MEMBER，根本不进入按 conversationId 的数据查询。
 * 统一响应 common/Result{ok,data,error}；error 为错误码（与 WS error 帧 code 一致）。
 */
@RestController
@RequestMapping("/api/chat")
public class ChatGroupController {

    private final UserMapper userMapper;
    private final ChatMessageMapper messageMapper;
    private final ChatConversationMapper conversationMapper;
    private final ChatConversationMemberMapper memberMapper;
    private final OnlineRegistry registry;

    public ChatGroupController(UserMapper userMapper,
                               ChatMessageMapper messageMapper,
                               ChatConversationMapper conversationMapper,
                               ChatConversationMemberMapper memberMapper,
                               OnlineRegistry registry) {
        this.userMapper = userMapper;
        this.messageMapper = messageMapper;
        this.conversationMapper = conversationMapper;
        this.memberMapper = memberMapper;
        this.registry = registry;
    }

    // ---------- 建群 ----------

    /**
     * 建群。body {name, memberIds:[≥2 个]}。
     * 校验：群名 trim 后 1~30 字符；memberIds 去重（并剔除创建者自身）后 ≥2 且创建者+成员 ≤50；
     * 成员必须存在且未禁用（过滤后不足 2 个报 MEMBER_INVALID）。
     * 成功：INSERT conversation(type='group') + owner/member 成员行，响应完整群会话项，
     * 并向全部在线成员（含创建者）广播 new_conversation 帧。
     */
    @PostMapping("/groups")
    public Result<Map<String, Object>> createGroup(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        User me = me(req);
        String name = ChatSupport.sanitizeGroupName(body.get("name") == null ? null : body.get("name").toString());
        if (name == null) {
            return Result.fail(ChatSupport.ERR_GROUP_NAME_INVALID);
        }

        // 成员 id：去重、剔除创建者自身、剔除非法值（LinkedHashSet 保持去重且顺序稳定）
        Set<Long> memberIds = new LinkedHashSet<>();
        if (body.get("memberIds") instanceof List<?> rawIds) {
            for (Object raw : rawIds) {
                long id = parseLong(raw, -1);
                if (id > 0 && id != me.getId()) {
                    memberIds.add(id);
                }
            }
        }
        if (memberIds.size() < 2) {
            return Result.fail(ChatSupport.ERR_MEMBER_INVALID);
        }
        if (memberIds.size() + 1 > ChatSupport.GROUP_MAX_MEMBERS) {
            return Result.fail(ChatSupport.ERR_GROUP_FULL);
        }
        // 成员必须存在且未禁用（禁用/不存在成员剔除，剔除后不足 2 个报错）
        List<User> validMembers = userMapper.selectBatchIds(memberIds).stream()
                .filter(u -> u.getDisabled() == null || u.getDisabled() != 1)
                .toList();
        if (validMembers.size() < 2) {
            return Result.fail(ChatSupport.ERR_MEMBER_INVALID);
        }

        // 建会话行（type='group'；群会话 user_a_id/user_b_id 固定 0，配对唯一键已由迁移脚本移除）
        ChatConversation conv = new ChatConversation();
        conv.setUserAId(0L);
        conv.setUserBId(0L);
        conv.setType(ChatSupport.CONV_TYPE_GROUP);
        conv.setGroupName(name);
        conv.setOwnerId(me.getId());
        LocalDateTime now = LocalDateTime.now();
        conv.setCreatedAt(now);
        conv.setUpdatedAt(now);
        conversationMapper.insert(conv);

        // 成员行：创建者 owner + 成员 member（uk_chat_member 兜底并发）
        try {
            insertMember(conv.getId(), me.getId(), ChatSupport.ROLE_OWNER);
            for (User u : validMembers) {
                insertMember(conv.getId(), u.getId(), ChatSupport.ROLE_MEMBER);
            }
        } catch (Exception e) {
            // 成员行写入失败：回滚刚建的会话行，避免残留空群
            conversationMapper.deleteById(conv.getId());
            throw e;
        }

        int memberCount = validMembers.size() + 1;
        // 广播 new_conversation 帧：全部在线成员（含创建者；创建者另有 REST 响应兜底，双保险无害）
        String frame = ChatSupport.newConversationFrame(conv.getId(), name, memberCount);
        Set<Long> memberIdsAll = new HashSet<>(ChatSupport.memberUserIds(memberMapper, conv.getId()));
        for (Long uid : registry.onlineUserIds()) {
            if (memberIdsAll.contains(uid)) {
                registry.pushToUser(uid, frame);
            }
        }

        return Result.ok(groupItem(conv, memberCount));
    }

    private void insertMember(long conversationId, long userId, String role) {
        ChatConversationMember m = new ChatConversationMember();
        m.setConversationId(conversationId);
        m.setUserId(userId);
        m.setRole(role);
        m.setLastReadMessageId(0L);
        m.setJoinedAt(LocalDateTime.now());
        memberMapper.insert(m);
    }

    // ---------- 成员列表 ----------

    /** 群成员列表（成员校验）：[{id,username,displayName,role,online,isOwner}] */
    @GetMapping("/groups/{conversationId}/members")
    public Result<List<Map<String, Object>>> members(@PathVariable long conversationId, HttpServletRequest req) {
        long myId = me(req).getId();
        if (!requireConversationAndMember(conversationId, myId)) {
            return Result.fail(ChatSupport.ERR_NOT_MEMBER);
        }
        List<ChatConversationMember> members = memberMapper.selectList(Wrappers.<ChatConversationMember>lambdaQuery()
                .eq(ChatConversationMember::getConversationId, conversationId)
                .orderByAsc(ChatConversationMember::getId));
        Set<Long> userIds = members.stream().map(ChatConversationMember::getUserId)
                .collect(Collectors.toCollection(LinkedHashSet::new));
        Map<Long, User> users = userIds.isEmpty()
                ? Map.of()
                : userMapper.selectBatchIds(userIds).stream().collect(Collectors.toMap(User::getId, u -> u));
        List<Map<String, Object>> data = new ArrayList<>(members.size());
        for (ChatConversationMember m : members) {
            User u = users.get(m.getUserId());
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", m.getUserId());
            row.put("username", u == null ? "" : u.getUsername());
            row.put("displayName", u == null ? "" : displayName(u));
            row.put("role", m.getRole());
            row.put("online", registry.online(m.getUserId()));
            row.put("isOwner", ChatSupport.ROLE_OWNER.equals(m.getRole()));
            data.add(row);
        }
        return Result.ok(data);
    }

    // ---------- 群历史消息（双向分页 + 断线补拉，语义与单聊一致） ----------

    @GetMapping("/groups/{conversationId}/messages")
    public Result<Map<String, Object>> messages(@PathVariable long conversationId,
                                                @RequestParam(required = false) Long beforeId,
                                                @RequestParam(required = false) Long afterId,
                                                @RequestParam(defaultValue = "50") int limit,
                                                HttpServletRequest req) {
        long myId = me(req).getId();
        if (!requireConversationAndMember(conversationId, myId)) {
            return Result.fail(ChatSupport.ERR_NOT_MEMBER);
        }
        int size = Math.min(100, Math.max(1, limit));
        List<ChatMessage> list;
        boolean hasMore;
        if (afterId != null) {
            // 增量补拉：id > afterId，升序，无更多分页语义
            list = messageMapper.selectList(Wrappers.<ChatMessage>lambdaQuery()
                    .eq(ChatMessage::getConversationId, conversationId)
                    .gt(ChatMessage::getId, afterId)
                    .orderByAsc(ChatMessage::getId)
                    .last("LIMIT " + size));
            hasMore = false;
        } else if (beforeId != null) {
            list = fetchNewest(conversationId, beforeId, size);
            hasMore = trimAndReverse(list, size);
        } else {
            list = fetchNewest(conversationId, null, size);
            hasMore = trimAndReverse(list, size);
        }
        // 每条带 senderName（批量回查避免 N+1）
        Set<Long> senderIds = list.stream().map(ChatMessage::getSenderId)
                .collect(Collectors.toCollection(HashSet::new));
        Map<Long, String> names = displayNameMap(senderIds);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("messages", list.stream()
                .map(m -> toGroupMsg(m, names.getOrDefault(m.getSenderId(), "")))
                .collect(Collectors.toList()));
        data.put("hasMore", hasMore);
        return Result.ok(data);
    }

    // ---------- 群发送（HTTP 兜底，WS 不可用时） ----------

    /** 群发送兜底：落库 + touch（preview 存纯内容）+ 向全部在线成员推群 chat 帧（含发送者 ack） */
    @PostMapping("/groups/{conversationId}/messages")
    public Result<Map<String, Object>> send(@PathVariable long conversationId,
                                            @RequestBody Map<String, Object> body,
                                            HttpServletRequest req) {
        User me = me(req);
        if (!requireConversationAndMember(conversationId, me.getId())) {
            return Result.fail(ChatSupport.ERR_NOT_MEMBER);
        }
        String content = ChatSupport.sanitizeContent(body.get("content") == null ? null : body.get("content").toString());
        if (content == null) {
            return Result.fail("消息内容须为 1~2000 字符");
        }
        String clientId = body.get("clientId") == null ? null : body.get("clientId").toString();
        ChatConversation conv = conversationMapper.selectById(conversationId);
        if (conv == null) {
            return Result.fail(ChatSupport.ERR_NOT_MEMBER);
        }
        ChatMessage msg = ChatSupport.insertGroupMessageAndFanout(messageMapper, conversationMapper, memberMapper,
                registry, conv, me.getId(), displayName(me), content, clientId);
        return Result.ok(toGroupMsg(msg, displayName(me)));
    }

    // ---------- 群已读（游标落库，不推任何帧） ----------

    /**
     * 群已读：UPDATE 成员行 SET last_read_message_id = 会话 MAX(chat_messages.id)。
     * 本期无逐条已读回执：不广播 read 帧，前端本地清零 + REST 落游标即可。
     */
    @PostMapping("/groups/{conversationId}/read")
    public Result<Map<String, Object>> markRead(@PathVariable long conversationId, HttpServletRequest req) {
        long myId = me(req).getId();
        if (!requireConversationAndMember(conversationId, myId)) {
            return Result.fail(ChatSupport.ERR_NOT_MEMBER);
        }
        ChatMessage last = messageMapper.selectOne(Wrappers.<ChatMessage>lambdaQuery()
                .eq(ChatMessage::getConversationId, conversationId)
                .orderByDesc(ChatMessage::getId)
                .last("LIMIT 1"));
        long cursor = last == null ? 0 : last.getId();
        ChatConversationMember member = memberMapper.selectOne(Wrappers.<ChatConversationMember>lambdaQuery()
                .eq(ChatConversationMember::getConversationId, conversationId)
                .eq(ChatConversationMember::getUserId, myId));
        if (member != null && (member.getLastReadMessageId() == null || member.getLastReadMessageId() < cursor)) {
            member.setLastReadMessageId(cursor);
            memberMapper.updateById(member);
        }
        return Result.ok(Map.of("cursor", cursor));
    }

    // ---------- 工具 ----------

    /** 越权防线：会话必须存在且 type='group'，且我是成员；任一不满足返回 false（NOT_MEMBER） */
    private boolean requireConversationAndMember(long conversationId, long myId) {
        ChatConversation conv = conversationMapper.selectById(conversationId);
        if (conv == null || !ChatSupport.CONV_TYPE_GROUP.equals(conv.getType())) {
            return false;
        }
        return ChatSupport.isMember(memberMapper, conversationId, myId);
    }

    /** 群会话列表项（建群响应与 conversations 群段同结构） */
    private Map<String, Object> groupItem(ChatConversation conv, long memberCount) {
        Map<String, Object> group = new LinkedHashMap<>();
        group.put("name", conv.getGroupName() == null ? "" : conv.getGroupName());
        group.put("memberCount", memberCount);
        group.put("ownerId", conv.getOwnerId());
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("conversationId", conv.getId());
        item.put("type", ChatSupport.CONV_TYPE_GROUP);
        item.put("group", group);
        item.put("unread", 0L);
        item.put("lastMessage", null);
        item.put("lastMessageAt", null);
        return item;
    }

    /** 群消息体（每条带 senderName） */
    private static Map<String, Object> toGroupMsg(ChatMessage m, String senderName) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", m.getId());
        row.put("conversationId", m.getConversationId());
        row.put("senderId", m.getSenderId());
        row.put("senderName", senderName);
        row.put("content", m.getContent());
        row.put("createdAt", ChatSupport.fmt(m.getCreatedAt()));
        return row;
    }

    /** 取 id < beforeId（或全部）的最新 size+1 条，用于判断 hasMore */
    private List<ChatMessage> fetchNewest(long conversationId, Long beforeId, int size) {
        return messageMapper.selectList(Wrappers.<ChatMessage>lambdaQuery()
                .eq(ChatMessage::getConversationId, conversationId)
                .lt(beforeId != null, ChatMessage::getId, beforeId)
                .orderByDesc(ChatMessage::getId)
                .last("LIMIT " + (size + 1)));
    }

    /** 超出 size 则截断并置 hasMore；反转为升序返回（与单聊分页语义一致） */
    private boolean trimAndReverse(List<ChatMessage> list, int size) {
        boolean hasMore = false;
        if (list.size() > size) {
            hasMore = true;
            list.subList(size, list.size()).clear();
        }
        Collections.reverse(list);
        return hasMore;
    }

    private Map<Long, String> displayNameMap(Set<Long> userIds) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        return userMapper.selectBatchIds(userIds).stream()
                .collect(Collectors.toMap(User::getId, this::displayName));
    }

    private String displayName(User u) {
        return u.getDisplayName() == null || u.getDisplayName().isBlank() ? u.getUsername() : u.getDisplayName();
    }

    private User me(HttpServletRequest req) {
        Object attr = req.getAttribute(AuthInterceptor.ATTR_USER);
        if (attr instanceof User u) {
            return u;
        }
        throw new IllegalStateException("未登录或鉴权上下文缺失");
    }

    private long parseLong(Object v, long fallback) {
        if (v == null) {
            return fallback;
        }
        try {
            return Long.parseLong(v.toString().trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
