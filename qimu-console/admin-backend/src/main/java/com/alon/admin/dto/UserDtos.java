package com.alon.admin.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 用户/认证接口请求 DTO（配合 Bean Validation，替代 Map<String,Object> 收参） */
public final class UserDtos {

    private UserDtos() {}

    /** POST /api/admin/users 创建用户 */
    public record CreateUser(
            @NotBlank(message = "用户名不能为空")
            @Size(max = 64, message = "用户名过长")
            @Pattern(regexp = "[A-Za-z0-9_\\-]+", message = "用户名仅支持字母/数字/下划线/短横线")
            String username,

            @NotBlank(message = "密码不能为空")
            @Size(min = 6, max = 64, message = "密码长度需在 6~64 之间")
            String password,

            @Pattern(regexp = "admin|member", message = "角色需为 admin / member")
            String role,

            @Size(max = 64, message = "显示名过长")
            String displayName
    ) {}

    /** PATCH /api/admin/users/:id 更新用户（全部可选） */
    public record UpdateUser(
            @Size(min = 6, max = 64, message = "密码长度需在 6~64 之间")
            String password,

            @Size(max = 64, message = "显示名过长")
            String displayName,

            @Pattern(regexp = "admin|member", message = "角色需为 admin / member")
            String role,

            Boolean disabled
    ) {}

    /** POST /api/auth/login 登录 */
    public record Login(
            @NotBlank(message = "用户名不能为空")
            String username,

            @NotBlank(message = "密码不能为空")
            String password
    ) {}
}
