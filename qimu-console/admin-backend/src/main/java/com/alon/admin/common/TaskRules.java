package com.alon.admin.common;
import com.alon.admin.entity.Task;
import com.alon.admin.entity.User;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.Set;
public final class TaskRules {
    private TaskRules() {}
    public static boolean canManage(User user, Task task) {
        return VisibilityPolicy.canWrite(user, task.getOwnerId());
    }
    public static boolean canChangeStatus(User user, Task task) {
        return canManage(user, task) || (user != null && "public".equals(task.getVisibility()) && user.getId().equals(task.getAssigneeId()));
    }
    public static void validate(Task t) {
        if (t.getTitle() == null || t.getTitle().trim().isEmpty() || t.getTitle().trim().length() > 200) throw new IllegalArgumentException("任务标题需为 1–200 个字符");
        t.setTitle(t.getTitle().trim());
        if (t.getStatus() == null || !Set.of("todo", "doing", "waiting", "done").contains(t.getStatus())) throw new IllegalArgumentException("无效任务状态");
        if (t.getPriority() == null || !Set.of("low", "normal", "high", "urgent").contains(t.getPriority())) throw new IllegalArgumentException("无效优先级");
        if (t.getNotes() != null && t.getNotes().length() > 2000) throw new IllegalArgumentException("备注不能超过 2000 字");
        if (t.getPeriod() != null && !Set.of("daily", "weekly").contains(t.getPeriod())) throw new IllegalArgumentException("无效任务周期");
        if (t.getVisibility() == null || !Set.of("personal", "public").contains(t.getVisibility())) throw new IllegalArgumentException("无效可见范围");
        if ("personal".equals(t.getVisibility()) && t.getAssigneeId() != null && !t.getAssigneeId().equals(t.getOwnerId())) throw new IllegalArgumentException("分配给其他成员前，请将任务设为团队可见");
        boolean time = "daily".equals(t.getPeriod());
        for (String value : new String[] {t.getStartDate(), t.getDueDate()}) {
            if (value == null) continue;
            try {
                if (time) { if (!value.matches("\\d{2}:\\d{2}")) throw new IllegalArgumentException(); LocalTime.parse(value); }
                else { if (!value.matches("\\d{4}-\\d{2}-\\d{2}")) throw new IllegalArgumentException(); LocalDate.parse(value); }
            } catch (IllegalArgumentException | DateTimeParseException e) { throw new IllegalArgumentException(time ? "日任务请使用 HH:mm 时间" : "请输入有效日期 yyyy-MM-dd"); }
        }
        if (t.getStartDate() != null && t.getDueDate() != null && t.getStartDate().compareTo(t.getDueDate()) > 0) throw new IllegalArgumentException("开始时间不能晚于截止时间");
    }
}
