package com.alon.admin.common;

import com.alon.admin.entity.ChatConversation;
import com.alon.admin.entity.ChatConversationMember;
import com.alon.admin.entity.ChatMessage;
import com.alon.admin.mapper.ChatConversationMapper;
import com.alon.admin.mapper.ChatConversationMemberMapper;
import com.alon.admin.mapper.ChatMessageMapper;
import com.alon.admin.websocket.OnlineRegistry;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.dao.DuplicateKeyException;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 聊天落库与 WS 帧序列化的共享工具（chat-module）。
 * WS 主路径（ChatWebSocketHandler）与 HTTP 兜底（ChatController / ChatGroupController）都必须走这里，
 * 保证多条写路径的校验规则、幂等行为、帧字段完全一致。
 *
 * 协议常量（与两端前端 core/chat.ts 保持一致，改动需同步）：
 * - 客户端 → 服务端：chat（to 寻址 v1 / conversationId 寻址 v2）/ read / ping
 * - 服务端 → 客户端：hello / chat / read / online / pong / error / new_conversation（v2）
 * - 错误码：BAD_FRAME / PEER_NOT_FOUND / PEER_DISABLED / CONTENT_INVALID / INTERNAL
 *          + v2：NOT_MEMBER / GROUP_NAME_INVALID / GROUP_FULL / MEMBER_INVALID
 */
public final class ChatSupport {

    /** 消息内容长度上限（trim 后 1~2000 字符），前后端同步校验 */
    public static final int CONTENT_MAX = 2000;
    /** 会话列表"最新消息摘要"截断长度（chat_conversations.last_message_preview VARCHAR(128)） */
    public static final int PREVIEW_MAX = 128;

    /** v2：群名长度上限（trim 后 1~30 字符），前后端同步校验 */
    public static final int GROUP_NAME_MAX = 30;
    /** v2：群成员上限（含创建者） */
    public static final int GROUP_MAX_MEMBERS = 50;

    /** 会话类型（chat_conversations.type） */
    public static final String CONV_TYPE_SINGLE = "single";
    public static final String CONV_TYPE_GROUP = "group";

    /** 群成员角色（本期仅记录，无管理操作） */
    public static final String ROLE_OWNER = "owner";
    public static final String ROLE_MEMBER = "member";

    // v2 错误码（与两端 core/chat.ts ChatErrorCode 保持一致，改动需三处同步）
    public static final String ERR_NOT_MEMBER = "NOT_MEMBER";
    public static final String ERR_GROUP_NAME_INVALID = "GROUP_NAME_INVALID";
    public static final String ERR_GROUP_FULL = "GROUP_FULL";
    public static final String ERR_MEMBER_INVALID = "MEMBER_INVALID";

    private static final DateTimeFormatter DTF = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final ObjectMapper FRAME_MAPPER = new ObjectMapper();

    private ChatSupport() {
    }

    // ---------- 校验 ----------

    /** 校验并规范化消息内容：trim 后要求 1~2000 字符；返回 null 表示非法 */
    public static String sanitizeContent(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.trim();
        if (s.isEmpty() || s.length() > CONTENT_MAX) {
            return null;
        }
        return s;
    }

    /** v2：校验并规范化群名：trim 后要求 1~30 字符；返回 null 表示非法 */
    public static String sanitizeGroupName(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.trim();
        if (s.isEmpty() || s.length() > GROUP_NAME_MAX) {
            return null;
        }
        return s;
    }

    /** 会话最新消息摘要（超长截断） */
    public static String preview(String content) {
        return content.length() <= PREVIEW_MAX ? content : content.substring(0, PREVIEW_MAX);
    }

    // ---------- 落库（幂等 / 并发安全） ----------

    /**
     * 定位或创建两人会话：user_a_id = min(uidA, uidB)、user_b_id = max(uidA, uidB)。
     * 唯一键 uk_chat_conv_pair 兜底并发创建，冲突时查回已有行。禁止按原始顺序 (a,b) 查询。
     */
    public static ChatConversation getOrCreateConversation(ChatConversationMapper mapper, long uidA, long uidB) {
        long a = Math.min(uidA, uidB);
        long b = Math.max(uidA, uidB);
        ChatConversation conv = mapper.selectOne(Wrappers.<ChatConversation>lambdaQuery()
                .eq(ChatConversation::getUserAId, a)
                .eq(ChatConversation::getUserBId, b));
        if (conv != null) {
            return conv;
        }
        ChatConversation created = new ChatConversation();
        created.setUserAId(a);
        created.setUserBId(b);
        LocalDateTime now = LocalDateTime.now();
        created.setCreatedAt(now);
        created.setUpdatedAt(now);
        try {
            mapper.insert(created);
            return created;
        } catch (DuplicateKeyException e) {
            // 并发创建撞唯一键：查回
            return mapper.selectOne(Wrappers.<ChatConversation>lambdaQuery()
                    .eq(ChatConversation::getUserAId, a)
                    .eq(ChatConversation::getUserBId, b));
        }
    }

    /**
     * 幂等写入消息：clientId 为空则生成 UUID；uk_chat_msg_client(conversation_id, sender_id, client_id)
     * 冲突（断线重发）时直接返回已存在的消息，不重复落库。
     * v3：新消息落库成功后追加"删除恢复"UPDATE——被用户从列表移除的会话恢复显示
     * （微信式删除：单聊清 user_a/b_deleted_at，群清成员行 deleted_at；无标记行 UPDATE 0 行无害，
     * 故无需区分会话类型，单条 UPDATE 覆盖单/群两种情况）。
     */
    public static ChatMessage insertMessage(ChatMessageMapper mapper, ChatConversationMapper conversationMapper,
                                            ChatConversationMemberMapper memberMapper,
                                            long conversationId, long senderId,
                                            String content, String clientId) {
        String cid = (clientId == null || clientId.isBlank())
                ? UUID.randomUUID().toString()
                : clientId.trim();
        ChatMessage exist = selectByClientId(mapper, conversationId, senderId, cid);
        if (exist != null) {
            return exist;
        }
        ChatMessage m = new ChatMessage();
        m.setConversationId(conversationId);
        m.setSenderId(senderId);
        m.setContent(content);
        m.setIsRead(0);
        m.setClientId(cid);
        m.setCreatedAt(LocalDateTime.now());
        try {
            mapper.insert(m);
        } catch (DuplicateKeyException e) {
            // 断线重发撞唯一键：查回已存在消息
            ChatMessage raced = selectByClientId(mapper, conversationId, senderId, cid);
            if (raced != null) {
                return raced;
            }
            throw e;
        }
        restoreDeleted(conversationMapper, memberMapper, conversationId);
        return m;
    }

    /**
     * v3：新消息到达 → 恢复被删除会话的显示标记。
     * 单聊清 chat_conversations.user_a_deleted_at/user_b_deleted_at；
     * 群清 chat_conversation_members.deleted_at（单聊无成员行、群行 a/b 标记恒为 NULL，互不干扰）。
     */
    private static void restoreDeleted(ChatConversationMapper conversationMapper,
                                       ChatConversationMemberMapper memberMapper, long conversationId) {
        conversationMapper.update(null, Wrappers.<ChatConversation>lambdaUpdate()
                .eq(ChatConversation::getId, conversationId)
                .set(ChatConversation::getUserADeletedAt, null)
                .set(ChatConversation::getUserBDeletedAt, null));
        memberMapper.update(null, Wrappers.<ChatConversationMember>lambdaUpdate()
                .eq(ChatConversationMember::getConversationId, conversationId)
                .set(ChatConversationMember::getDeletedAt, null));
    }

    private static ChatMessage selectByClientId(ChatMessageMapper mapper, long conversationId,
                                                long senderId, String clientId) {
        return mapper.selectOne(Wrappers.<ChatMessage>lambdaQuery()
                .eq(ChatMessage::getConversationId, conversationId)
                .eq(ChatMessage::getSenderId, senderId)
                .eq(ChatMessage::getClientId, clientId));
    }

    /** 发消息后回填会话的最近消息摘要与时间 */
    public static void touchConversation(ChatConversationMapper mapper, ChatConversation conv, ChatMessage msg) {
        conv.setLastMessageId(msg.getId());
        conv.setLastMessagePreview(preview(msg.getContent()));
        conv.setLastMessageAt(msg.getCreatedAt());
        conv.setUpdatedAt(LocalDateTime.now());
        mapper.updateById(conv);
    }

    // ---------- v2：群聊成员工具 ----------

    /** 当前用户是否为群会话成员（群一切读写入口的第一道越权防线） */
    public static boolean isMember(ChatConversationMemberMapper memberMapper, long conversationId, long userId) {
        Long count = memberMapper.selectCount(Wrappers.<ChatConversationMember>lambdaQuery()
                .eq(ChatConversationMember::getConversationId, conversationId)
                .eq(ChatConversationMember::getUserId, userId));
        return count != null && count > 0;
    }

    /** 群会话全部成员 id（群消息扇出用，≤50 人） */
    public static List<Long> memberUserIds(ChatConversationMemberMapper memberMapper, long conversationId) {
        List<ChatConversationMember> members = memberMapper.selectList(Wrappers.<ChatConversationMember>lambdaQuery()
                .eq(ChatConversationMember::getConversationId, conversationId));
        List<Long> ids = new ArrayList<>(members.size());
        for (ChatConversationMember m : members) {
            ids.add(m.getUserId());
        }
        return ids;
    }

    /**
     * v2：群消息幂等落库 + 回填会话摘要 + 向全部在线成员扇出 chat 群帧（含发送者 ack）。
     * WS 主路径与 HTTP 兜底共用，保证行为一致。
     * preview 存纯内容（发言人前缀由前端拼接）；推送成败不影响落库。
     */
    public static ChatMessage insertGroupMessageAndFanout(ChatMessageMapper messageMapper,
                                                          ChatConversationMapper conversationMapper,
                                                          ChatConversationMemberMapper memberMapper,
                                                          OnlineRegistry registry,
                                                          ChatConversation conv,
                                                          long senderId,
                                                          String senderName,
                                                          String content,
                                                          String clientId) {
        ChatMessage msg = insertMessage(messageMapper, conversationMapper, memberMapper,
                conv.getId(), senderId, content, clientId);
        touchConversation(conversationMapper, conv, msg);
        String frame = chatGroupFrame(msg, senderName);
        for (Long uid : memberUserIds(memberMapper, conv.getId())) {
            registry.pushToUser(uid, frame);
        }
        return msg;
    }

    // ---------- WS 帧序列化（服务端 → 客户端） ----------

    /**
     * chat 帧（单聊）：消息推送（发给接收者）/ 发送确认（回给发送者，带 clientId 供前端匹配乐观 UI）。
     * {"type":"chat","ts":...,"messageId":...,"conversationId":...,"clientId":...,"from":...,"fromName":...,"to":...,"content":...,"createdAt":...,"conversationType":"single"}
     * v2 兼容约定：v1 字段全保留，新增 conversationType（旧前端可无视）。
     */
    public static String chatFrame(ChatMessage msg, String fromName, long to) {
        ObjectNode n = FRAME_MAPPER.createObjectNode();
        n.put("type", "chat");
        n.put("ts", System.currentTimeMillis());
        n.put("messageId", msg.getId());
        n.put("conversationId", msg.getConversationId());
        n.put("clientId", msg.getClientId());
        n.put("from", msg.getSenderId());
        n.put("fromName", fromName == null ? "" : fromName);
        n.put("to", to);
        n.put("content", msg.getContent());
        n.put("createdAt", fmt(msg.getCreatedAt()));
        n.put("conversationType", CONV_TYPE_SINGLE);
        return n.toString();
    }

    /**
     * v2 chat 帧（群聊）：推送给群内全部在线成员（含发送者 ack），无 to 字段。
     * {"type":"chat","ts":...,"messageId":...,"conversationId":...,"clientId":...,"from":...,"fromName":...,"content":...,"createdAt":...,"conversationType":"group"}
     * 前端一律以 conversationType ?? "single" 分支，不得依赖群帧的 to 字段。
     */
    public static String chatGroupFrame(ChatMessage msg, String fromName) {
        ObjectNode n = FRAME_MAPPER.createObjectNode();
        n.put("type", "chat");
        n.put("ts", System.currentTimeMillis());
        n.put("messageId", msg.getId());
        n.put("conversationId", msg.getConversationId());
        n.put("clientId", msg.getClientId());
        n.put("from", msg.getSenderId());
        n.put("fromName", fromName == null ? "" : fromName);
        n.put("content", msg.getContent());
        n.put("createdAt", fmt(msg.getCreatedAt()));
        n.put("conversationType", CONV_TYPE_GROUP);
        return n.toString();
    }

    /**
     * v2 new_conversation 帧：群创建成功后向全部在线成员（含创建者）广播，
     * 前端收到后统一 loadConversations() 全量刷新（不做局部拼接）。
     */
    public static String newConversationFrame(long conversationId, String name, int memberCount) {
        ObjectNode n = FRAME_MAPPER.createObjectNode();
        n.put("type", "new_conversation");
        n.put("ts", System.currentTimeMillis());
        n.put("conversationId", conversationId);
        n.put("conversationType", CONV_TYPE_GROUP);
        n.put("name", name == null ? "" : name);
        n.put("memberCount", memberCount);
        return n.toString();
    }

    /**
     * read 帧：推给消息发送方，表示"对方（readerId）已读我的消息至 lastReadMessageId"。
     */
    public static String readFrame(long readerId, long conversationId, long lastReadMessageId) {
        ObjectNode n = FRAME_MAPPER.createObjectNode();
        n.put("type", "read");
        n.put("ts", System.currentTimeMillis());
        n.put("peerId", readerId);
        n.put("conversationId", conversationId);
        n.put("lastReadMessageId", lastReadMessageId);
        return n.toString();
    }

    /** online 帧：在线状态变更广播（离线→在线 / 在线→离线） */
    public static String onlineFrame(long userId, boolean online, LocalDateTime at) {
        ObjectNode n = FRAME_MAPPER.createObjectNode();
        n.put("type", "online");
        n.put("ts", System.currentTimeMillis());
        n.put("userId", userId);
        n.put("online", online);
        n.put("at", fmt(at));
        return n.toString();
    }

    /** hello 帧：连接建立后首个下发帧（身份确认 + 在线用户全量） */
    public static String helloFrame(long userId, List<Long> onlineIds) {
        ObjectNode n = FRAME_MAPPER.createObjectNode();
        n.put("type", "hello");
        n.put("ts", System.currentTimeMillis());
        n.put("userId", userId);
        ArrayNode ids = n.putArray("onlineIds");
        for (Long id : onlineIds) {
            ids.add(id);
        }
        return n.toString();
    }

    /** pong 帧：心跳应答 */
    public static String pongFrame() {
        ObjectNode n = FRAME_MAPPER.createObjectNode();
        n.put("type", "pong");
        n.put("ts", System.currentTimeMillis());
        return n.toString();
    }

    /** error 帧：协议/业务错误 */
    public static String errorFrame(String code, String message) {
        ObjectNode n = FRAME_MAPPER.createObjectNode();
        n.put("type", "error");
        n.put("ts", System.currentTimeMillis());
        n.put("code", code);
        n.put("message", message);
        return n.toString();
    }

    // ---------- 时间 ----------

    /** LocalDateTime → "yyyy-MM-dd HH:mm:ss"（与 jackson 全局配置一致） */
    public static String fmt(LocalDateTime t) {
        return t == null ? null : t.format(DTF);
    }
}
