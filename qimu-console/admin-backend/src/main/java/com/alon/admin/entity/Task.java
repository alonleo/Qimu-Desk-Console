package com.alon.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("tasks")
public class Task {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long projectId;
    private String title;
    private String notes;
    private String status;
    private String priority;
    private String dueDate;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private LocalDateTime completedAt;
    /** 可见性：personal | public（默认 public，见 VisibilityPolicy） */
    private String visibility;
    /** 创建人 users.id；NULL = 系统通用数据 */
    private Long ownerId;

    /** 联查字段（非表列） */
    @TableField(exist = false)
    private String projectName;
    @TableField(exist = false)
    private String projectColor;
}
