package com.alon.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 定时任务执行日志（sys_job_log）。status：0 失败 / 1 成功 */
@Data
@TableName("sys_job_log")
public class SysJobLog {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("job_id")
    private Long jobId;

    @TableField("job_name")
    private String jobName;

    @TableField("job_group")
    private String jobGroup;

    @TableField("invoke_target")
    private String invokeTarget;

    private String status;

    @TableField("exception_message")
    private String exceptionMessage;

    @TableField("start_time")
    private LocalDateTime startTime;

    @TableField("stop_time")
    private LocalDateTime stopTime;

    @TableField("cost_ms")
    private Long costMs;
}
