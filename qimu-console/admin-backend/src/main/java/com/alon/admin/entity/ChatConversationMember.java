package com.alon.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 群成员关系（chat-module v2）：群会话(type='group')的成员行；单聊会话不写本表。
 * last_read_message_id 为该成员在该群的已读游标（已读至的消息 id），
 * 群未读数 = 会话内 id > 游标 且 sender_id <> 该成员 的消息条数。
 * role 本期仅作记录（owner = 创建者），无管理操作。
 */
@Data
@TableName("chat_conversation_members")
public class ChatConversationMember {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long conversationId;
    private Long userId;
    /** owner | member（本期仅记录） */
    private String role;
    /** 已读游标 */
    private Long lastReadMessageId;
    /** v3：该成员从列表移除时间（NULL=未删除；群内来新消息时由 ChatSupport 清空恢复） */
    private LocalDateTime deletedAt;
    private LocalDateTime joinedAt;
}
