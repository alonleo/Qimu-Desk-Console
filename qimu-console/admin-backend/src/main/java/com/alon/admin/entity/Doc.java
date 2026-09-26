package com.alon.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("docs")
public class Doc {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String title;
    private String category;
    private String tags;
    private String content;
    private Integer pinned;
    private String createdBy;
    /** 来源标识：manual | file | ai（AI 产物入库用 ai） */
    private String source;
    /** 可见性：personal | public（默认 public，见 VisibilityPolicy）；权限只认 owner_id，created_by 仅作展示保留 */
    private String visibility;
    /** 创建人 users.id；NULL = 系统通用数据（docs 双轨：created_by 文本列保留原语义继续写） */
    private Long ownerId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
