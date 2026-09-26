package com.alon.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 通知公告（notice 表）：type 区分通知/公告，status 预留草稿态 */
@Data
@TableName("notice")
public class Notice {
    @TableId(type = IdType.AUTO)
    private Long id;
    /** notification=通知 / announcement=公告 */
    private String type;
    private String title;
    private String content;
    /** 0=否 1=是 */
    private Integer isPinned;
    /** draft=草稿(预留) / published=已发布 */
    private String status;
    private Long publisherId;
    private LocalDateTime publishTime;
    private LocalDateTime expireTime;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;

    /** 联查字段（非表列）：发布人展示名 */
    @TableField(exist = false)
    private String publisherName;
}
