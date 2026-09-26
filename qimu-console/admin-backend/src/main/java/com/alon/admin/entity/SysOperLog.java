package com.alon.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 操作日志（sys_oper_log）。status：0 正常 / 1 异常 */
@Data
@TableName("sys_oper_log")
public class SysOperLog {
    @TableId(type = IdType.AUTO)
    private Long id;

    private String title;

    @TableField("business_type")
    private String businessType;

    private String method;

    @TableField("request_method")
    private String requestMethod;

    @TableField("operator_type")
    private String operatorType;

    @TableField("oper_name")
    private String operName;

    @TableField("dept_name")
    private String deptName;

    @TableField("oper_url")
    private String operUrl;

    @TableField("oper_ip")
    private String operIp;

    @TableField("oper_param")
    private String operParam;

    @TableField("json_result")
    private String jsonResult;

    private String status;

    @TableField("error_msg")
    private String errorMsg;

    @TableField("cost_ms")
    private Long costMs;

    @TableField("oper_time")
    private LocalDateTime operTime;
}
