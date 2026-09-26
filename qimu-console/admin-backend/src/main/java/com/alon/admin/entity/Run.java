package com.alon.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("runs")
public class Run {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long workflowId;
    private String status;
    @TableField("`trigger`")
    private String trigger;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
    private Long durationMs;
    private String logs;
    private String triggeredBy;
}
