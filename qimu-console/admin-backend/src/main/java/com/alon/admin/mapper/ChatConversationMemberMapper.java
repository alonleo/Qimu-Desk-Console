package com.alon.admin.mapper;

import com.alon.admin.entity.ChatConversationMember;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

@Mapper
public interface ChatConversationMemberMapper extends BaseMapper<ChatConversationMember> {

    /**
     * 群未读总数（游标口径）：我所在全部群会话内，
     * id > 我的已读游标 且 sender_id <> 我 的消息条数合计。
     * 角标轮询 /unread 的群口径单条 COUNT（轻量）。
     */
    @Select("SELECT COUNT(*) FROM chat_conversation_members m "
            + "JOIN chat_conversations c ON c.id = m.conversation_id AND c.type = 'group' "
            + "JOIN chat_messages g ON g.conversation_id = m.conversation_id "
            + "AND g.id > m.last_read_message_id AND g.sender_id <> m.user_id "
            + "WHERE m.user_id = #{userId}")
    long countGroupUnread(@Param("userId") long userId);

    /**
     * 按群会话维度的群未读数（游标口径），会话列表 /conversations 的群段使用。
     * 返回 [{conversationId, cnt}]（LEFT JOIN 保证无未读的会话也返回 0 行计数）。
     */
    @Select("SELECT m.conversation_id AS conversationId, COUNT(g.id) AS cnt "
            + "FROM chat_conversation_members m "
            + "JOIN chat_conversations c ON c.id = m.conversation_id AND c.type = 'group' "
            + "LEFT JOIN chat_messages g ON g.conversation_id = m.conversation_id "
            + "AND g.id > m.last_read_message_id AND g.sender_id <> m.user_id "
            + "WHERE m.user_id = #{userId} "
            + "GROUP BY m.conversation_id")
    List<Map<String, Object>> countGroupUnreadByConversation(@Param("userId") long userId);
}
