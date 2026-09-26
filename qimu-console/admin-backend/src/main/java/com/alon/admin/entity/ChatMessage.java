package com.alon.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 聊天消息（chat-module）。
 * is_read 表示"已被对方阅读"（对发送者视角为已读）；未读数 = 会话内 sender_id <> 我 且 is_read = 0。
 * client_id 为发送端幂等键（uk_chat_msg_client），断线重发不产生重复消息。
 */
@Data
@TableName("chat_messages")
public class ChatMessage {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long conversationId;
    private Long senderId;
    private String content;
    private Integer isRead;
    private String clientId;
    private LocalDateTime createdAt;
}
