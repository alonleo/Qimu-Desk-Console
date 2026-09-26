package com.alon.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** 登录日志（sys_logininfor）。status：0 失败 / 1 成功 */
@Data
@TableName("sys_logininfor")
public class SysLogininfor {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("user_name")
    private String userName;

    private String ipaddr;

    @TableField("login_location")
    private String loginLocation;

    private String browser;

    private String os;

    private String status;

    private String msg;

    @TableField("login_time")
    private LocalDateTime loginTime;
}
