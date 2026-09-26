package com.alon.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("workflows")
public class Workflow {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String name;
    private String description;
    private String definition;
    /** 来源标识：manual | file | ai（AI 产物入库用 ai） */
    private String source;
    /** 可见性：personal | public（默认 public，见 VisibilityPolicy） */
    private String visibility;
    /** 创建人 users.id；NULL = 系统通用数据 */
    private Long ownerId;
    private Integer version;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
