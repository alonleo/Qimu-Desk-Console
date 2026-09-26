package com.alon.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 聊天会话（chat-module）。
 * v1 单聊：两人会话固定 user_a_id = 较小 id、user_b_id = 较大 id。
 * v2 增量：type='group' 的群会话行 user_a_id/user_b_id 固定填 0，
 * 群信息存 group_name/owner_id，成员关系见 chat_conversation_members。
 */
@Data
@TableName("chat_conversations")
public class ChatConversation {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long userAId;
    private Long userBId;
    /** single | group（存量行默认 single） */
    private String type;
    /** 群名（type=group 时非空，1~30 字符） */
    private String groupName;
    /** 群主 users.id（type=group 时非空） */
    private Long ownerId;
    private Long lastMessageId;
    private String lastMessagePreview;
    private LocalDateTime lastMessageAt;
    /** v3：user_a 从列表移除时间（NULL=未删除；对方来新消息时由 ChatSupport 清空恢复） */
    private LocalDateTime userADeletedAt;
    /** v3：user_b 从列表移除时间（NULL=未删除；对方来新消息时由 ChatSupport 清空恢复） */
    private LocalDateTime userBDeletedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
