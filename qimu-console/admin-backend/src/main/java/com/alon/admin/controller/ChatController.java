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
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
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
 * 聊天 REST（chat-module）：contacts / conversations / messages / 发送兜底 / read / unread / stats。
 *
 * 统一响应 common/Result{ok,data,error}（架构文档 §3.1 约定）。
 * 越权防线：会话一律以 (min(me,peerId), max(me,peerId)) 定位——不存在任何"按 conversationId
 * 直接读写"的入口，越权 peerId 只会得到空会话语义。
 * WS 主路径为消息写入主通道；本控制器 POST /api/chat/messages 仅作 WS 不可用时的 HTTP 兜底，
 * 落库逻辑与 WS 共用 ChatSupport，保证两条写路径行为一致。
 */
@RestController
@RequestMapping("/api/chat")
public class ChatController {

    private static final DateTimeFormatter DTF = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /** 批量删除会话单次上限 */
    private static final int DELETE_BATCH_MAX = 200;

    private final UserMapper userMapper;
    private final ChatMessageMapper messageMapper;
    private final ChatConversationMapper conversationMapper;
    private final ChatConversationMemberMapper memberMapper;
    private final OnlineRegistry registry;

    public ChatController(UserMapper userMapper,
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

    // ---------- 联系人 ----------

    /** 用户列表 + 在线状态（过滤禁用用户） */
    @GetMapping("/contacts")
    public Result<List<Map<String, Object>>> contacts() {
        List<User> users = userMapper.selectList(Wrappers.<User>lambdaQuery()
                .eq(User::getDisabled, 0)
                .orderByAsc(User::getId));
        return Result.ok(users.stream().map(u -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", u.getId());
            m.put("username", u.getUsername());
            m.put("displayName", u.getDisplayName());
            m.put("role", u.getRole());
            m.put("online", registry.online(u.getId()));
            m.put("lastOnlineAt", fmtLastSeen(registry.lastOnlineAt(u.getId())));
            return m;
        }).toList());
    }

    // ---------- 会话列表 ----------

    /**
     * 我的会话列表（v2：单聊 + 群聊，按最近消息时间倒序），一次聚合出各会话未读数。
     * 单聊段：a/b 定位 + type='single' 限定（单聊定位逻辑不变，仅加 type 限定防止群消息误计入）；
     * 群段：chat_conversation_members.user_id=me JOIN type='group'。
     * 响应项：单聊 = v1 结构 + type/senderName；群聊 = type:'group' + group:{name,memberCount,ownerId}，无 peer。
     */
    @GetMapping("/conversations")
    public Result<List<Map<String, Object>>> conversations(HttpServletRequest req) {
        long myId = me(req).getId();

        // 单聊段
        List<ChatConversation> singleConvs = conversationMapper.selectList(Wrappers.<ChatConversation>lambdaQuery()
                .and(w -> w.eq(ChatConversation::getUserAId, myId).or().eq(ChatConversation::getUserBId, myId))
                .eq(ChatConversation::getType, ChatSupport.CONV_TYPE_SINGLE)
                .orderByDesc(ChatConversation::getLastMessageAt)
                .orderByDesc(ChatConversation::getId));

        // 群段：先取成员行定位我的群会话，再查会话行
        List<Long> myGroupConvIds = memberMapper.selectList(Wrappers.<ChatConversationMember>lambdaQuery()
                        .eq(ChatConversationMember::getUserId, myId))
                .stream().map(ChatConversationMember::getConversationId).distinct().toList();
        List<ChatConversation> groupConvs = myGroupConvIds.isEmpty()
                ? List.of()
                : conversationMapper.selectList(Wrappers.<ChatConversation>lambdaQuery()
                        .in(ChatConversation::getId, myGroupConvIds)
                        .eq(ChatConversation::getType, ChatSupport.CONV_TYPE_GROUP));
        if (singleConvs.isEmpty() && groupConvs.isEmpty()) {
            return Result.ok(List.of());
        }

        // 单聊未读数：会话内 sender_id <> 我 且 is_read = 0（一次 GROUP BY 聚合，仅单聊会话参与）
        List<Long> singleConvIds = singleConvs.stream().map(ChatConversation::getId).toList();
        Map<Long, Long> unreadByConv = new HashMap<>();
        if (!singleConvIds.isEmpty()) {
            for (Map<String, Object> row : messageMapper.selectMaps(Wrappers.<ChatMessage>query()
                    .select("conversation_id", "COUNT(*) AS cnt")
                    .eq("is_read", 0)
                    .ne("sender_id", myId)
                    .in("conversation_id", singleConvIds)
                    .groupBy("conversation_id"))) {
                unreadByConv.put(((Number) row.get("conversation_id")).longValue(),
                        ((Number) row.get("cnt")).longValue());
            }
        }

        // 群未读数（游标口径）：id > last_read_message_id 且 sender_id <> me，按会话聚合
        Map<Long, Long> groupUnreadByConv = new HashMap<>();
        for (Map<String, Object> row : memberMapper.countGroupUnreadByConversation(myId)) {
            groupUnreadByConv.put(((Number) row.get("conversationId")).longValue(),
                    ((Number) row.get("cnt")).longValue());
        }

        // 群成员数（一次 GROUP BY 聚合）
        Map<Long, Long> memberCountByConv = new HashMap<>();
        if (!myGroupConvIds.isEmpty()) {
            for (Map<String, Object> row : memberMapper.selectMaps(Wrappers.<ChatConversationMember>query()
                    .select("conversation_id", "COUNT(*) AS cnt")
                    .in("conversation_id", myGroupConvIds)
                    .groupBy("conversation_id"))) {
                memberCountByConv.put(((Number) row.get("conversation_id")).longValue(),
                        ((Number) row.get("cnt")).longValue());
            }
        }

        // 单聊对方信息
        Set<Long> peerIds = new HashSet<>();
        for (ChatConversation c : singleConvs) {
            peerIds.add(c.getUserAId() == myId ? c.getUserBId() : c.getUserAId());
        }
        Map<Long, User> peers = peerIds.isEmpty()
                ? Map.of()
                : userMapper.selectBatchIds(peerIds).stream().collect(Collectors.toMap(User::getId, u -> u));

        // 最近消息（取 senderId / createdAt / senderName 展示用；批量回查避免 N+1）
        List<Long> lastMsgIds = new ArrayList<>();
        for (ChatConversation c : singleConvs) {
            if (c.getLastMessageId() != null) {
                lastMsgIds.add(c.getLastMessageId());
            }
        }
        for (ChatConversation c : groupConvs) {
            if (c.getLastMessageId() != null) {
                lastMsgIds.add(c.getLastMessageId());
            }
        }
        Map<Long, ChatMessage> lastMsgs = lastMsgIds.isEmpty()
                ? Map.of()
                : messageMapper.selectBatchIds(lastMsgIds).stream()
                        .collect(Collectors.toMap(ChatMessage::getId, m -> m));

        // 最近消息发送者昵称（单聊 + 群聊摘要前缀共用）
        Set<Long> lastSenderIds = new HashSet<>();
        for (ChatMessage lm : lastMsgs.values()) {
            lastSenderIds.add(lm.getSenderId());
        }
        Map<Long, String> senderNames = displayNameMap(lastSenderIds);

        List<Map<String, Object>> data = new ArrayList<>(singleConvs.size() + groupConvs.size());

        for (ChatConversation c : singleConvs) {
            long peerId = c.getUserAId() == myId ? c.getUserBId() : c.getUserAId();
            User peer = peers.get(peerId);
            Map<String, Object> peerMap = new LinkedHashMap<>();
            peerMap.put("id", peerId);
            peerMap.put("username", peer == null ? "" : peer.getUsername());
            peerMap.put("displayName", peer == null ? ""
                    : (peer.getDisplayName() == null || peer.getDisplayName().isBlank()
                            ? peer.getUsername() : peer.getDisplayName()));
            peerMap.put("online", registry.online(peerId));

            ChatMessage lm = c.getLastMessageId() == null ? null : lastMsgs.get(c.getLastMessageId());
            Map<String, Object> lastMessage = null;
            if (lm != null) {
                lastMessage = new LinkedHashMap<>();
                lastMessage.put("id", lm.getId());
                lastMessage.put("preview", c.getLastMessagePreview() == null ? "" : c.getLastMessagePreview());
                lastMessage.put("senderId", lm.getSenderId());
                lastMessage.put("senderName", senderNames.getOrDefault(lm.getSenderId(), ""));
                lastMessage.put("createdAt", ChatSupport.fmt(lm.getCreatedAt()));
            }

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("conversationId", c.getId());
            item.put("type", ChatSupport.CONV_TYPE_SINGLE);
            item.put("peer", peerMap);
            item.put("unread", unreadByConv.getOrDefault(c.getId(), 0L));
            item.put("lastMessage", lastMessage);
            item.put("lastMessageAt", ChatSupport.fmt(c.getLastMessageAt()));
            data.add(item);
        }

        for (ChatConversation c : groupConvs) {
            ChatMessage lm = c.getLastMessageId() == null ? null : lastMsgs.get(c.getLastMessageId());
            Map<String, Object> lastMessage = null;
            if (lm != null) {
                lastMessage = new LinkedHashMap<>();
                lastMessage.put("id", lm.getId());
                lastMessage.put("preview", c.getLastMessagePreview() == null ? "" : c.getLastMessagePreview());
                lastMessage.put("senderId", lm.getSenderId());
                lastMessage.put("senderName", senderNames.getOrDefault(lm.getSenderId(), ""));
                lastMessage.put("createdAt", ChatSupport.fmt(lm.getCreatedAt()));
            }

            Map<String, Object> group = new LinkedHashMap<>();
            group.put("name", c.getGroupName() == null ? "" : c.getGroupName());
            group.put("memberCount", memberCountByConv.getOrDefault(c.getId(), 0L));
            group.put("ownerId", c.getOwnerId());

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("conversationId", c.getId());
            item.put("type", ChatSupport.CONV_TYPE_GROUP);
            item.put("group", group);
            item.put("unread", groupUnreadByConv.getOrDefault(c.getId(), 0L));
            item.put("lastMessage", lastMessage);
            item.put("lastMessageAt", ChatSupport.fmt(c.getLastMessageAt()));
            data.add(item);
        }

        // 合并排序：lastMessageAt 倒序（字符串格式天然可比较），其次 conversationId 倒序
        data.sort((a, b) -> {
            String ta = (String) a.get("lastMessageAt");
            String tb = (String) b.get("lastMessageAt");
            if (ta == null && tb != null) {
                return 1;
            }
            if (ta != null && tb == null) {
                return -1;
            }
            int cmp = tb == null || ta == null ? 0 : tb.compareTo(ta);
            if (cmp != 0) {
                return cmp;
            }
            long ia = ((Number) a.get("conversationId")).longValue();
            long ib = ((Number) b.get("conversationId")).longValue();
            return Long.compare(ib, ia);
        });
        return Result.ok(data);
    }

    // ---------- 删除会话（v3，微信式：仅从我的列表移除，不影响对方，新消息恢复） ----------

    /**
     * 批量删除会话：POST /api/chat/conversations/delete，body {"ids":[1,2,...]}。
     * 校验：ids 非空、每个为正整数、去重、单次 ≤200 个（非法值直接拒绝，不做静默剔除）。
     * 语义（不删消息、不通知对方）：
     * - 单聊：须为 user_a_id/user_b_id 参与者，置我对应侧 deleted_at = now（非参与者跳过）；
     * - 群聊：须存在我的 chat_conversation_members 行，置该行 deleted_at = now（无成员行跳过）。
     * 新消息到达时由 ChatSupport.insertMessage 清空标记，会话恢复显示。
     * 不存在的会话 / 非我参与的会话一律跳过，返回实际删除数（@Transactional 保证本次批量原子）。
     */
    @PostMapping("/conversations/delete")
    @Transactional
    public Result<Map<String, Object>> deleteConversations(@RequestBody Map<String, Object> body,
                                                           HttpServletRequest req) {
        long myId = me(req).getId();
        if (!(body.get("ids") instanceof List<?> rawIds) || rawIds.isEmpty()) {
            return Result.fail("ids 不能为空");
        }
        if (rawIds.size() > DELETE_BATCH_MAX) {
            return Result.fail("单次最多删除 " + DELETE_BATCH_MAX + " 个会话");
        }
        // LinkedHashSet：去重且顺序稳定
        Set<Long> ids = new LinkedHashSet<>();
        for (Object raw : rawIds) {
            long id = parseLong(raw, -1);
            if (id <= 0) {
                return Result.fail("ids 必须为正整数");
            }
            ids.add(id);
        }

        LocalDateTime now = LocalDateTime.now();
        int deleted = 0;
        for (Long id : ids) {
            ChatConversation conv = conversationMapper.selectById(id);
            if (conv == null) {
                continue;
            }
            if (ChatSupport.CONV_TYPE_GROUP.equals(conv.getType())) {
                // 群：必须存在我的成员行，置该行 deleted_at
                ChatConversationMember member = memberMapper.selectOne(
                        Wrappers.<ChatConversationMember>lambdaQuery()
                                .eq(ChatConversationMember::getConversationId, id)
                                .eq(ChatConversationMember::getUserId, myId));
                if (member == null) {
                    continue;
                }
                memberMapper.update(null, Wrappers.<ChatConversationMember>lambdaUpdate()
                        .eq(ChatConversationMember::getId, member.getId())
                        .set(ChatConversationMember::getDeletedAt, now));
                deleted++;
                continue;
            }
            // 单聊：必须为参与者，置我对应侧 deleted_at（Long 与 long 比较先判空再拆箱）
            boolean isA = conv.getUserAId() != null && conv.getUserAId() == myId;
            boolean isB = conv.getUserBId() != null && conv.getUserBId() == myId;
            if (!isA && !isB) {
                continue;
            }
            if (isA) {
                conversationMapper.update(null, Wrappers.<ChatConversation>lambdaUpdate()
                        .eq(ChatConversation::getId, id)
                        .set(ChatConversation::getUserADeletedAt, now));
            } else {
                conversationMapper.update(null, Wrappers.<ChatConversation>lambdaUpdate()
                        .eq(ChatConversation::getId, id)
                        .set(ChatConversation::getUserBDeletedAt, now));
            }
            deleted++;
        }
        return Result.ok(Map.of("deleted", deleted));
    }

    // ---------- 历史消息（双向分页 + 断线补拉） ----------

    /**
     * 与某用户的历史消息（仅"我参与的会话"，按 (min,max) 定位）：
     * - afterId：断线重连增量补拉（id > afterId，升序）；
     * - beforeId：向上翻页（id &lt; beforeId 的最新 limit 条，升序返回）；
     * - 默认：最新 limit 条（升序返回）。
     */
    @GetMapping("/conversations/{peerId}/messages")
    public Result<Map<String, Object>> messages(@PathVariable long peerId,
                                                @RequestParam(required = false) Long beforeId,
                                                @RequestParam(required = false) Long afterId,
                                                @RequestParam(defaultValue = "50") int limit,
                                                HttpServletRequest req) {
        long myId = me(req).getId();
        int size = Math.min(100, Math.max(1, limit));
        ChatConversation conv = conversationMapper.selectOne(Wrappers.<ChatConversation>lambdaQuery()
                .eq(ChatConversation::getUserAId, Math.min(myId, peerId))
                .eq(ChatConversation::getUserBId, Math.max(myId, peerId)));

        List<ChatMessage> list = new ArrayList<>();
        boolean hasMore = false;
        if (conv != null) {
            if (afterId != null) {
                // 增量补拉：无更多分页语义
                list = messageMapper.selectList(Wrappers.<ChatMessage>lambdaQuery()
                        .eq(ChatMessage::getConversationId, conv.getId())
                        .gt(ChatMessage::getId, afterId)
                        .orderByAsc(ChatMessage::getId)
                        .last("LIMIT " + size));
            } else if (beforeId != null) {
                list = fetchNewest(conv.getId(), beforeId, size);
                hasMore = trimAndReverse(list, size);
            } else {
                list = fetchNewest(conv.getId(), null, size);
                hasMore = trimAndReverse(list, size);
            }
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("messages", list.stream().map(ChatController::toMsg).collect(Collectors.toList()));
        data.put("hasMore", hasMore);
        return Result.ok(data);
    }

    /** 取 id < beforeId（或全部）的最新 size+1 条，用于判断 hasMore */
    private List<ChatMessage> fetchNewest(long conversationId, Long beforeId, int size) {
        return messageMapper.selectList(Wrappers.<ChatMessage>lambdaQuery()
                .eq(ChatMessage::getConversationId, conversationId)
                .lt(beforeId != null, ChatMessage::getId, beforeId)
                .orderByDesc(ChatMessage::getId)
                .last("LIMIT " + (size + 1)));
    }

    /** 超出 size 则截断并置 hasMore；反转为升序返回；返回 hasMore（入参按 id 倒序，多出的那条在最末） */
    private boolean trimAndReverse(List<ChatMessage> list, int size) {
        boolean hasMore = false;
        if (list.size() > size) {
            hasMore = true;
            list.subList(size, list.size()).clear();
        }
        Collections.reverse(list);
        return hasMore;
    }

    // ---------- 发送（HTTP 兜底，WS 不可用时） ----------

    @PostMapping("/messages")
    public Result<Map<String, Object>> send(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        User me = me(req);
        long to = parseLong(body.get("toUserId"), -1);
        String content = ChatSupport.sanitizeContent(body.get("content") == null ? null : body.get("content").toString());
        if (to <= 0) {
            return Result.fail("缺少接收用户");
        }
        if (content == null) {
            return Result.fail("消息内容须为 1~2000 字符");
        }
        User peer = userMapper.selectById(to);
        if (peer == null) {
            return Result.fail("接收用户不存在");
        }
        if (peer.getDisabled() != null && peer.getDisabled() == 1) {
            return Result.fail("接收用户已被禁用");
        }
        String clientId = body.get("clientId") == null ? null : body.get("clientId").toString();
        ChatConversation conv = ChatSupport.getOrCreateConversation(conversationMapper, me.getId(), to);
        ChatMessage msg = ChatSupport.insertMessage(messageMapper, conversationMapper, memberMapper,
                conv.getId(), me.getId(), content, clientId);
        ChatSupport.touchConversation(conversationMapper, conv, msg);
        // 兜底发送也推送接收者，保证 WS 已连接的接收端不依赖轮询
        registry.pushToUser(to, ChatSupport.chatFrame(msg, displayName(me), to));
        return Result.ok(toMsg(msg));
    }

    // ---------- 标记已读 ----------

    @PostMapping("/conversations/{peerId}/read")
    public Result<Map<String, Object>> markRead(@PathVariable long peerId, HttpServletRequest req) {
        User me = me(req);
        long myId = me.getId();
        ChatConversation conv = conversationMapper.selectOne(Wrappers.<ChatConversation>lambdaQuery()
                .eq(ChatConversation::getUserAId, Math.min(myId, peerId))
                .eq(ChatConversation::getUserBId, Math.max(myId, peerId)));
        if (conv == null) {
            return Result.ok(Map.of("cleared", 0));
        }
        int cleared = messageMapper.update(null, Wrappers.<ChatMessage>lambdaUpdate()
                .eq(ChatMessage::getConversationId, conv.getId())
                .eq(ChatMessage::getSenderId, peerId)
                .eq(ChatMessage::getIsRead, 0)
                .set(ChatMessage::getIsRead, 1));
        if (cleared > 0) {
            ChatMessage last = messageMapper.selectOne(Wrappers.<ChatMessage>lambdaQuery()
                    .eq(ChatMessage::getConversationId, conv.getId())
                    .eq(ChatMessage::getSenderId, peerId)
                    .orderByDesc(ChatMessage::getId)
                    .last("LIMIT 1"));
            if (last != null) {
                // 已读通知推给消息发送方，清除其"对方未读"展示
                registry.pushToUser(peerId, ChatSupport.readFrame(myId, conv.getId(), last.getId()));
            }
        }
        return Result.ok(Map.of("cleared", cleared));
    }

    // ---------- 未读总数（角标轮询，轻量） ----------

    @GetMapping("/unread")
    public Result<Map<String, Object>> unread(HttpServletRequest req) {
        User me = me(req);
        long myId = me.getId();
        List<Long> convIds = conversationMapper.selectList(Wrappers.<ChatConversation>lambdaQuery()
                        .and(w -> w.eq(ChatConversation::getUserAId, myId).or().eq(ChatConversation::getUserBId, myId)))
                .stream().map(ChatConversation::getId).toList();
        long total = convIds.isEmpty() ? 0
                : messageMapper.selectCount(Wrappers.<ChatMessage>lambdaQuery()
                        .in(ChatMessage::getConversationId, convIds)
                        .ne(ChatMessage::getSenderId, myId)
                        .eq(ChatMessage::getIsRead, 0));
        return Result.ok(Map.of("total", total));
    }

    // ---------- 概况统计（仅 admin 角色，P1） ----------

    @GetMapping("/stats")
    public ResponseEntity<Result<Map<String, Object>>> stats(HttpServletRequest req) {
        User me = me(req);
        if (!"admin".equals(me.getRole())) {
            return ResponseEntity.status(403).body(Result.fail("无权限"));
        }
        LocalDateTime todayStart = LocalDate.now().atStartOfDay();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("onlineCount", registry.onlineUserIds().size());
        data.put("todayMessages", messageMapper.selectCount(Wrappers.<ChatMessage>lambdaQuery()
                .ge(ChatMessage::getCreatedAt, todayStart)));
        data.put("activeConversations", conversationMapper.selectCount(Wrappers.<ChatConversation>lambdaQuery()
                .ge(ChatConversation::getLastMessageAt, todayStart)));
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

    private String displayName(User u) {
        return u.getDisplayName() == null || u.getDisplayName().isBlank() ? u.getUsername() : u.getDisplayName();
    }

    /** 批量取用户展示昵称（displayName 为空回退 username），会话列表摘要/群消息 senderName 用 */
    private Map<Long, String> displayNameMap(Set<Long> userIds) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        return userMapper.selectBatchIds(userIds).stream()
                .collect(Collectors.toMap(User::getId, this::displayName));
    }

    /** 最后在线时间（毫秒时间戳 → 展示字符串；无记录返回 null） */
    private String fmtLastSeen(Long epochMillis) {
        if (epochMillis == null) {
            return null;
        }
        return DTF.format(LocalDateTime.ofInstant(Instant.ofEpochMilli(epochMillis), ZoneId.systemDefault()));
    }

    private static Map<String, Object> toMsg(ChatMessage m) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", m.getId());
        row.put("conversationId", m.getConversationId());
        row.put("senderId", m.getSenderId());
        row.put("content", m.getContent());
        row.put("createdAt", ChatSupport.fmt(m.getCreatedAt()));
        return row;
    }
}
