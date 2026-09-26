package com.alon.admin.websocket;

import com.alon.admin.common.ChatSupport;
import com.alon.admin.entity.ChatConversation;
import com.alon.admin.entity.ChatMessage;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.ChatConversationMapper;
import com.alon.admin.mapper.ChatConversationMemberMapper;
import com.alon.admin.mapper.ChatMessageMapper;
import com.alon.admin.mapper.UserMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.time.LocalDateTime;

/**
 * 聊天 WebSocket 处理器（chat-module，裸 WS + Spring WebSocketConfigurer，非 STOMP）。
 *
 * 帧协议（与两端前端 core/chat.ts 常量保持一致，改动需同步）：
 * - 客户端 → 服务端：chat（to 寻址 v1 单聊 / conversationId 寻址 v2 单群通用）/ read（标记已读，仅单聊）/ ping（心跳）
 * - 服务端 → 客户端：hello / chat / read / online / pong / error / new_conversation（v2）
 *
 * 消息投递：校验 → 寻址（to=单聊 min/max；conversationId=查会话按 type 路由 + 身份校验）
 * → 幂等落库 → 回填会话摘要 → 群消息扇出全部在线成员（含发送者 ack）/
 * 单聊推送接收者（离线仅落库，上线补拉）→ 给发送者回 ack 帧（带 clientId）。
 */
@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(ChatWebSocketHandler.class);
    private static final com.fasterxml.jackson.databind.ObjectMapper FRAME_READER =
            new com.fasterxml.jackson.databind.ObjectMapper();

    private final UserMapper userMapper;
    private final ChatMessageMapper messageMapper;
    private final ChatConversationMapper conversationMapper;
    private final ChatConversationMemberMapper memberMapper;
    private final OnlineRegistry registry;

    public ChatWebSocketHandler(UserMapper userMapper,
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

    // ---------- 连接生命周期 ----------

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        Long uid = uid(session);
        if (uid == null) {
            // 握手拦截器已校验，理论不可达；防御性关闭
            closeQuietly(session);
            return;
        }
        boolean first = registry.add(uid, session);
        if (first) {
            // 离线 → 在线：向全部在线用户广播
            registry.onlineUserIds().forEach(other ->
                    registry.pushToUser(other, ChatSupport.onlineFrame(uid, true, LocalDateTime.now())));
        }
        // hello：身份确认 + 在线用户全量（先注册再发，保证 onlineIds 包含自己）
        registry.pushToUser(uid, ChatSupport.helloFrame(uid, registry.onlineUserIds()));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Long uid = uid(session);
        if (uid == null) {
            return;
        }
        boolean offline = registry.remove(uid, session);
        if (offline) {
            // 最后一个连接关闭 → 在线转离线：向全部在线用户广播
            registry.onlineUserIds().forEach(other ->
                    registry.pushToUser(other, ChatSupport.onlineFrame(uid, false, LocalDateTime.now())));
        }
    }

    // ---------- 帧处理 ----------

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        Long uid = uid(session);
        if (uid == null) {
            return;
        }
        JsonNode node;
        try {
            node = readTree(message.getPayload());
        } catch (Exception e) {
            sendError(session, "BAD_FRAME", "帧格式非法");
            return;
        }
        if (node == null || !node.isObject()) {
            sendError(session, "BAD_FRAME", "帧格式非法");
            return;
        }
        String type = node.path("type").asText("");
        switch (type) {
            case "ping" -> registry.pushToUser(uid, ChatSupport.pongFrame());
            case "chat" -> handleChat(session, uid, node);
            case "read" -> handleRead(uid, node);
            case "" -> sendError(session, "BAD_FRAME", "缺少 type 字段");
            default -> sendError(session, "BAD_FRAME", "未知帧类型: " + type);
        }
    }

    /**
     * chat 帧（双寻址，向后兼容）：
     * - 带 conversationId（>0）→ v2 按会话寻址：查会话按 type 路由，单聊须为参与者、群聊须为成员；
     * - 仅 to → v1 单聊寻址原样。
     * 同一帧同时带 to 与 conversationId 时以 conversationId 为准。
     */
    private void handleChat(WebSocketSession session, Long me, JsonNode frame) {
        String clientId = frame.path("clientId").asText(null);
        String content = ChatSupport.sanitizeContent(frame.path("content").asText(""));
        if (content == null) {
            sendError(session, "CONTENT_INVALID", "消息内容须为 1~2000 字符");
            return;
        }
        long conversationId = frame.path("conversationId").asLong(-1);
        if (conversationId > 0) {
            handleChatByConversation(session, me, conversationId, content, clientId);
            return;
        }
        long to = frame.path("to").asLong(-1);
        User peer = userMapper.selectById(to);
        if (peer == null) {
            sendError(session, "PEER_NOT_FOUND", "接收用户不存在");
            return;
        }
        if (peer.getDisabled() != null && peer.getDisabled() == 1) {
            sendError(session, "PEER_DISABLED", "接收用户已被禁用");
            return;
        }
        try {
            ChatMessage msg = persistAndTouch(me, to, content, clientId);
            // 接收者在线即推（离线仅落库，上线后前端按 afterId 补拉）；推送成败不影响落库
            registry.pushToUser(to, ChatSupport.chatFrame(msg, peerDisplayName(me), to));
            // 给发送者回 ack（前端凭 clientId 将乐观 UI 替换为服务端消息）
            registry.pushToUser(me, ChatSupport.chatFrame(msg, peerDisplayName(me), to));
        } catch (Exception e) {
            log.error("[chat] 处理 chat 帧失败: from={} to={}", me, to, e);
            sendError(session, "INTERNAL", "消息处理失败，请重试");
        }
    }

    /**
     * v2：按 conversationId 寻址的 chat 帧。
     * 越权防线：先查会话存在，单聊校验 me = user_a_id OR user_b_id，群聊校验 me ∈ 成员表，
     * 任何校验不过一律 NOT_MEMBER，不进入后续数据读写。
     */
    private void handleChatByConversation(WebSocketSession session, Long me, long conversationId,
                                          String content, String clientId) {
        ChatConversation conv = conversationMapper.selectById(conversationId);
        if (conv == null) {
            sendError(session, ChatSupport.ERR_NOT_MEMBER, "会话不存在或无权访问");
            return;
        }
        if (ChatSupport.CONV_TYPE_GROUP.equals(conv.getType())) {
            // 群聊：成员校验 → 落库 + 扇出全部在线成员（含发送者 ack，发送者收到的同帧即确认）
            if (!ChatSupport.isMember(memberMapper, conv.getId(), me)) {
                sendError(session, ChatSupport.ERR_NOT_MEMBER, "会话不存在或无权访问");
                return;
            }
            try {
                ChatSupport.insertGroupMessageAndFanout(messageMapper, conversationMapper, memberMapper,
                        registry, conv, me, peerDisplayName(me), content, clientId);
            } catch (Exception e) {
                log.error("[chat] 处理群消息失败: from={} conversationId={}", me, conversationId, e);
                sendError(session, "INTERNAL", "消息处理失败，请重试");
            }
            return;
        }
        // 单聊（type='single' 或存量 null）：参与者校验
        // 注意 getUserAId/getUserBId 返回 Long 包装类型，必须转为 long 基本类型再比较，
        // 否则 id > 127 时走对象引用比较，合法参与者会被误判为非参与者（QA 修复，见测试报告）
        long userAId = conv.getUserAId() == null ? -1L : conv.getUserAId();
        long userBId = conv.getUserBId() == null ? -1L : conv.getUserBId();
        if (userAId != me && userBId != me) {
            sendError(session, ChatSupport.ERR_NOT_MEMBER, "会话不存在或无权访问");
            return;
        }
        long peerId = userAId == me ? userBId : userAId;
        User peer = userMapper.selectById(peerId);
        if (peer == null) {
            sendError(session, "PEER_NOT_FOUND", "接收用户不存在");
            return;
        }
        if (peer.getDisabled() != null && peer.getDisabled() == 1) {
            sendError(session, "PEER_DISABLED", "接收用户已被禁用");
            return;
        }
        try {
            ChatMessage msg = ChatSupport.insertMessage(messageMapper, conversationMapper, memberMapper,
                    conv.getId(), me, content, clientId);
            ChatSupport.touchConversation(conversationMapper, conv, msg);
            registry.pushToUser(peerId, ChatSupport.chatFrame(msg, peerDisplayName(me), peerId));
            // ack 帧（前端凭 clientId 将乐观 UI 替换为服务端消息）
            registry.pushToUser(me, ChatSupport.chatFrame(msg, peerDisplayName(me), peerId));
        } catch (Exception e) {
            log.error("[chat] 处理 chat 帧失败: from={} conversationId={}", me, conversationId, e);
            sendError(session, "INTERNAL", "消息处理失败，请重试");
        }
    }

    /** read 帧：标记"对方发给我的消息"为已读，并把已读通知推给对方 */
    private void handleRead(Long me, JsonNode frame) {
        long peerId = frame.path("peerId").asLong(-1);
        if (peerId <= 0 || peerId == me) {
            return;
        }
        ChatConversation conv = conversationMapper.selectOne(Wrappers.<ChatConversation>lambdaQuery()
                .eq(ChatConversation::getUserAId, Math.min(me, peerId))
                .eq(ChatConversation::getUserBId, Math.max(me, peerId)));
        if (conv == null) {
            return;
        }
        Long lastRead = markRead(conv.getId(), peerId);
        if (lastRead != null) {
            // 已读通知推给消息发送方（peerId 视角：reader 是我）
            registry.pushToUser(peerId, ChatSupport.readFrame(me, conv.getId(), lastRead));
        }
    }

    // ---------- 共用落库逻辑（HTTP 兜底 ChatController 走同一套 ChatSupport） ----------

    /** 会话定位 + 幂等落库 + 回填会话摘要 */
    private ChatMessage persistAndTouch(long from, long to, String content, String clientId) {
        ChatConversation conv = ChatSupport.getOrCreateConversation(conversationMapper, from, to);
        ChatMessage msg = ChatSupport.insertMessage(messageMapper, conversationMapper, memberMapper,
                conv.getId(), from, content, clientId);
        ChatSupport.touchConversation(conversationMapper, conv, msg);
        return msg;
    }

    /**
     * 标记会话中"peerId 发给我的未读消息"为已读；返回最后一条被读消息 id（无未读时返回 null）。
     * 未读口径：sender_id = peerId 且 is_read = 0。
     */
    private Long markRead(long conversationId, long peerId) {
        int cleared = messageMapper.update(null, Wrappers.<ChatMessage>lambdaUpdate()
                .eq(ChatMessage::getConversationId, conversationId)
                .eq(ChatMessage::getSenderId, peerId)
                .eq(ChatMessage::getIsRead, 0)
                .set(ChatMessage::getIsRead, 1));
        if (cleared <= 0) {
            return null;
        }
        ChatMessage last = messageMapper.selectOne(Wrappers.<ChatMessage>lambdaQuery()
                .eq(ChatMessage::getConversationId, conversationId)
                .eq(ChatMessage::getSenderId, peerId)
                .orderByDesc(ChatMessage::getId)
                .last("LIMIT 1"));
        return last == null ? null : last.getId();
    }

    // ---------- 工具 ----------

    private JsonNode readTree(String payload) throws IOException {
        return FRAME_READER.readTree(payload);
    }

    /** 从握手 attributes 取当前用户 id（WsAuthInterceptor 写入） */
    private Long uid(WebSocketSession session) {
        Object v = session.getAttributes().get(WsAuthInterceptor.ATTR_UID);
        return v instanceof Long l ? l : null;
    }

    /** 发送者昵称（帧内 fromName 展示用；查不到回退空串） */
    private String peerDisplayName(long userId) {
        User u = userMapper.selectById(userId);
        if (u == null) {
            return "";
        }
        return u.getDisplayName() == null || u.getDisplayName().isBlank() ? u.getUsername() : u.getDisplayName();
    }

    private void sendError(WebSocketSession session, String code, String message) {
        try {
            synchronized (session) {
                session.sendMessage(new TextMessage(ChatSupport.errorFrame(code, message)));
            }
        } catch (IOException e) {
            log.warn("[chat] 发送 error 帧失败: {}", e.getMessage());
        }
    }

    private void closeQuietly(WebSocketSession session) {
        try {
            session.close(CloseStatus.POLICY_VIOLATION);
        } catch (IOException ignored) {
            // 忽略关闭异常
        }
    }
}
