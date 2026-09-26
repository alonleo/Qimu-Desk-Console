package com.alon.admin.annotation;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 操作日志注解：被 @Log 标注的方法在 LogAspect 环绕通知中自动落库到 sys_oper_log。
 *
 * <p>字段均为字符串（与 admin-platform 风格一致，不引入枚举）：
 * <ul>
 *   <li>title：模块标题（如「定时任务」）</li>
 *   <li>businessType：业务类型字符串（0 其它 / 1 新增 / 2 修改 / 3 删除 / 4 授权 / 5 导出 / 6 导入 / 7 强退 / 8 生成代码 / 9 清空）</li>
 *   <li>isSaveRequestData：是否保存请求参数（默认 true）</li>
 *   <li>isSaveResponseData：是否保存响应参数（默认 false——列表类响应通常较大）</li>
 * </ul>
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Log {

    String title() default "";

    String businessType() default "0";

    boolean isSaveRequestData() default true;

    boolean isSaveResponseData() default false;

    /** 排除的请求参数名（敏感字段，如 password / token / apiKey） */
    String[] excludeParamNames() default {};
}
