package com.alon.admin.mapper;

import com.alon.admin.entity.Notice;
import com.alon.admin.entity.NoticeRead;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface NoticeReadMapper extends BaseMapper<NoticeRead> {

    /**
     * 指定用户在指定类型下未读的已发布通知（联查发布人展示名）。
     * 排序铁律与 notice 模块一致：is_pinned DESC, publish_time DESC, id DESC。
     */
    @Select("SELECT n.*, u.display_name AS publisher_name FROM notice n " +
            "LEFT JOIN users u ON u.id = n.publisher_id " +
            "WHERE n.status = 'published' AND n.type = #{type} " +
            "AND NOT EXISTS (SELECT 1 FROM notice_read r WHERE r.notice_id = n.id AND r.user_id = #{userId}) " +
            "ORDER BY n.is_pinned DESC, n.publish_time DESC, n.id DESC LIMIT #{limit}")
    List<Notice> selectUnreadByType(@Param("userId") Long userId, @Param("type") String type, @Param("limit") int limit);

    /** 指定用户全部未读的已发布通知/公告总数（铃铛角标口径） */
    @Select("SELECT COUNT(*) FROM notice n " +
            "WHERE n.status = 'published' " +
            "AND NOT EXISTS (SELECT 1 FROM notice_read r WHERE r.notice_id = n.id AND r.user_id = #{userId})")
    long countUnread(@Param("userId") Long userId);
}
