package com.alon.admin.common;

import com.alon.admin.entity.User;
import com.alon.admin.mapper.UserMapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import jakarta.servlet.http.HttpServletRequest;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Consumer;
import java.util.stream.Collectors;

/**
 * 可见性权限唯一真源（架构 §六.1 / §3.4）：
 *
 * <ul>
 *   <li>读：member 可见 = {@code visibility='public' OR owner_id=自己}；admin 全量；</li>
 *   <li>写：member 可写 = owner_id 非空且 = 自己（通用条目 owner-only 只读共享）；
 *       admin 全权；owner_id NULL（旧通用数据）member 只读；</li>
 *   <li>创建：owner_id 一律服务端取当前用户（不信任前端）；visibility 非法值回落默认
 *       （admin → public / member → personal）；</li>
 *   <li>旧数据：visibility='public' + owner_id=NULL，全员可见、仅 admin 可写。</li>
 * </ul>
 *
 * <p>取值常量唯一出处：{@link #PERSONAL} / {@link #PUBLIC}；TS 侧唯一出处为
 * alon-workbench {@code core/visibility.ts}，禁止各处硬编码字符串。
 */
public final class VisibilityPolicy {

    /** 可见性：个人（仅创建人可见可写） */
    public static final String PERSONAL = "personal";
    /** 可见性：通用（全员可见） */
    public static final String PUBLIC = "public";

    private VisibilityPolicy() {}

    /** 是否 admin（null 用户按 member fail-closed 处理） */
    public static boolean isAdmin(User u) {
        return u != null && "admin".equals(u.getRole());
    }

    /** 入参 visibility 是否为合法取值 */
    public static boolean isValidVisibility(String v) {
        return PERSONAL.equals(v) || PUBLIC.equals(v);
    }

    /**
     * 创建入参归一化：visibility 清洗（非 personal/public → 默认），默认 admin=public / member=personal。
     *
     * @param u              当前登录用户（null 按 member）
     * @param bodyVisibility 前端传入的 visibility（可为任意对象/空）
     * @return 合法可见性值
     */
    public static String resolveVisibility(User u, Object bodyVisibility) {
        String v = bodyVisibility == null ? null : String.valueOf(bodyVisibility);
        if (PERSONAL.equals(v)) return PERSONAL;
        if (PUBLIC.equals(v)) return PUBLIC;
        return isAdmin(u) ? PUBLIC : PERSONAL;
    }

    /**
     * 更新/批量更新入参清洗：仅接受 personal/public，其余（含 null）返回 null 表示「不更新该字段」。
     */
    public static String parseVisibility(Object v) {
        if (v == null) return null;
        String s = String.valueOf(v);
        return PERSONAL.equals(s) ? PERSONAL : (PUBLIC.equals(s) ? PUBLIC : null);
    }

    /**
     * member 列表过滤条件（追加到既有 LambdaQueryWrapper：{@code wrapper.and(scopeFilter(user))}）；
     * admin 返回 null 表示不追加（调用方判空跳过，也可用 {@link #applyScope} 一步完成）。
     *
     * <p>实现说明：用 {@code apply("visibility = {0} OR owner_id = {1}")} 占位符拼条件，
     * 使该工具与具体实体类型解耦（LambdaQueryWrapper 无法按字符串列名 eq）；
     * {0}/{1} 走 PreparedStatement 参数，无注入风险。
     */
    public static <T> Consumer<LambdaQueryWrapper<T>> scopeFilter(User u) {
        if (isAdmin(u)) return null;
        long uid = u == null ? -1L : u.getId();
        return w -> w.apply("visibility = {0} OR owner_id = {1}", PUBLIC, uid);
    }

    /** 一步追加 scope 条件：member 追加 (visibility='public' OR owner_id=uid)，admin 不追加 */
    public static <T> void applyScope(User u, LambdaQueryWrapper<T> wrapper) {
        Consumer<LambdaQueryWrapper<T>> f = scopeFilter(u);
        if (f != null) wrapper.and(f);
    }

    /**
     * member 可写判定：owner_id 非空且等于自己；admin 恒 true；
     * owner_id NULL（旧通用数据）member 不可写。
     */
    public static boolean canWrite(User u, Long ownerId) {
        if (isAdmin(u)) return true;
        return u != null && ownerId != null && ownerId.equals(u.getId());
    }

    /** member 可读判定（详情接口防越权）：public/NULL 旧数据全员可见，personal 仅创建人与 admin */
    public static boolean canRead(User u, String visibility, Long ownerId) {
        if (isAdmin(u)) return true;
        if (visibility == null || PUBLIC.equals(visibility)) return true;
        return u != null && ownerId != null && ownerId.equals(u.getId());
    }

    /** 单条写越权统一文案（Spring 403 响应体用，与 err() 风格一致） */
    public static final String FORBIDDEN_MSG = "仅创建人可修改";
    /** 批量越权计入 itemError 的统一文案 */
    public static final String BATCH_FORBIDDEN_MSG = "无权操作他人条目";

    /**
     * 从请求属性取当前登录用户（AuthInterceptor 写入）。
     * 字符串字面量与 AuthInterceptor.ATTR_USER 保持一致，避免 common → auth 反向依赖。
     */
    public static User currentUser(HttpServletRequest req) {
        if (req == null) return null;
        Object u = req.getAttribute("currentUser");
        return u instanceof User user ? user : null;
    }

    /**
     * 批量组装创建人展示名（一次 selectBatchIds，避免列表 N+1）；
     * display_name 为空回退 username；ownerIds 中的 null 自动剔除。
     */
    public static Map<Long, String> ownerNames(UserMapper userMapper, Collection<Long> ownerIds) {
        List<Long> ids = ownerIds == null ? List.of()
                : ownerIds.stream().filter(Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return Map.of();
        return userMapper.selectBatchIds(ids).stream()
                .collect(Collectors.toMap(
                        User::getId,
                        u -> u.getDisplayName() == null || u.getDisplayName().isBlank()
                                ? u.getUsername() : u.getDisplayName(),
                        (a, b) -> a));
    }
}
