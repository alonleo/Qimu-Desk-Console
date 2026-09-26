package com.alon.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 定时任务（sys_job 表）。
 * invoke_target：Bean.method('arg') 字符串，由 SysJobRunner 反射执行；
 * misfire_policy：3=不触发（默认，Spring 不补跑）；concurrent：0=允许并行 1=禁止并行（默认）。
 */
@Data
@TableName("sys_job")
public class SysJob {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("job_name")
    private String jobName;

    @TableField("job_group")
    private String jobGroup;

    @TableField("invoke_target")
    private String invokeTarget;

    @TableField("cron_expression")
    private String cronExpression;

    @TableField("misfire_policy")
    private String misfirePolicy;

    @TableField("concurrent")
    private String concurrent;

    @TableField("status")
    private String status;

    private String remark;

    @TableField("create_by")
    private String createBy;

    @TableField("create_time")
    private LocalDateTime createTime;

    @TableField("update_by")
    private String updateBy;

    @TableField("update_time")
    private LocalDateTime updateTime;
}
