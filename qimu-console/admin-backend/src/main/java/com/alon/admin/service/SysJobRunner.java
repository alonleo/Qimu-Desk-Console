package com.alon.admin.service;

import com.alon.admin.entity.SysJob;
import com.alon.admin.entity.SysJobLog;
import com.alon.admin.mapper.SysJobLogMapper;
import com.alon.admin.mapper.SysJobMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationContext;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Service;

import java.lang.reflect.Method;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

/**
 * 定时任务调度器（不引入 Quartz，用 Spring 原生 TaskScheduler + CronTrigger）。
 *
 * <p>设计要点：
 * <ul>
 *   <li>启动时加载 status=1 的任务到调度器（@PostConstruct）；后续 CRUD 接口动态 addJob / removeJob / reschedule</li>
 *   <li>并发控制（concurrent=1 禁止）通过 ScheduledFuture 取消 + 重新调度 + 维护并发锁</li>
 *   <li>invoke_target 解析：Bean.method('arg') → Spring 容器拿 bean → 反射调用 method.invoke(bean, parsedArgs)</li>
 *   <li>每次执行落 sys_job_log（start/stop/cost_ms/status）；异常吞掉不影响调度循环</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SysJobRunner {

    private final SysJobMapper jobMapper;
    private final SysJobLogMapper jobLogMapper;
    private final ApplicationContext ctx;
    private final TaskScheduler taskScheduler;

    /** 任务 id → ScheduledFuture；removeJob 时 cancel；concurrent=1 时同 key 互斥 */
    private final Map<Long, ScheduledFuture<?>> futures = new ConcurrentHashMap<>();
    /** 任务 id → 互斥锁（concurrent=1 禁止并行执行） */
    private final Map<Long, Object> locks = new ConcurrentHashMap<>();

    @PostConstruct
    public void init() {
        try {
            List<SysJob> jobs = jobMapper.selectList(null);
            int n = 0;
            for (SysJob j : jobs) {
                if ("1".equals(j.getStatus())) {
                    try {
                        addJob(j);
                        n++;
                    } catch (Exception ex) {
                        log.warn("加载定时任务失败：id={}, cron={}, msg={}", j.getId(), j.getCronExpression(), ex.getMessage());
                    }
                }
            }
            log.info("SysJobRunner 启动：共 {} 个运行中任务", n);
        } catch (Exception ex) {
            log.warn("SysJobRunner 初始化失败：{}", ex.getMessage());
        }
    }

    /** 添加或重新调度任务。concurrent=1 时若已有 Future 在跑则跳过本次触发（避免重叠）。 */
    public void addJob(SysJob job) {
        if (!CronExpression.isValidExpression(job.getCronExpression())) {
            throw new IllegalArgumentException("cron 表达式无效：" + job.getCronExpression());
        }
        // 取消旧 Future
        ScheduledFuture<?> old = futures.remove(job.getId());
        if (old != null) old.cancel(false);
        locks.computeIfAbsent(job.getId(), k -> new Object());

        ScheduledFuture<?> future = taskScheduler.schedule(
                () -> execute(job.getId()),
                new org.springframework.scheduling.support.CronTrigger(job.getCronExpression(), ZoneId.systemDefault())
        );
        futures.put(job.getId(), future);
    }

    /** 移除调度（不删表）；仅 cancel Future */
    public void removeJob(Long jobId) {
        ScheduledFuture<?> f = futures.remove(jobId);
        if (f != null) f.cancel(false);
    }

    /** 立即执行一次（不等 cron） */
    public void runOnce(Long jobId) {
        SysJob job = jobMapper.selectById(jobId);
        if (job == null) throw new IllegalArgumentException("任务不存在");
        // 异步执行，避免阻塞 HTTP 线程
        taskScheduler.schedule(() -> execute(jobId), java.time.Instant.now());
    }

    /** 实际执行任务：反射调用 invoke_target 并落 sys_job_log */
    void execute(Long jobId) {
        SysJob job = jobMapper.selectById(jobId);
        if (job == null) {
            log.warn("SysJobRunner 找不到任务 id={}", jobId);
            return;
        }
        Object lock = locks.get(jobId);
        // concurrent=1 禁止并行：若锁已被占用则跳过本次（用 tryLock 替代 synchronized 阻塞）
        if ("1".equals(job.getConcurrent()) && lock != null) {
            java.util.concurrent.locks.ReentrantLock rl = reentrantLock(jobId, lock);
            if (!rl.tryLock()) {
                log.info("任务 {} 上一轮未结束，跳过本次触发", jobId);
                return;
            }
            try {
                doExecute(job);
            } finally {
                rl.unlock();
            }
        } else {
            doExecute(job);
        }
    }

    private void doExecute(SysJob job) {
        SysJobLog row = new SysJobLog();
        row.setJobId(job.getId());
        row.setJobName(job.getJobName());
        row.setJobGroup(job.getJobGroup());
        row.setInvokeTarget(job.getInvokeTarget());
        row.setStartTime(LocalDateTime.now());
        row.setStatus("1");
        try {
            invoke(job.getInvokeTarget());
            row.setStatus("1");
        } catch (Throwable ex) {
            row.setStatus("0");
            row.setExceptionMessage(ex.getMessage());
            log.warn("任务执行失败：id={}, msg={}", job.getId(), ex.getMessage());
        } finally {
            row.setStopTime(LocalDateTime.now());
            long ms = java.time.Duration.between(row.getStartTime(), row.getStopTime()).toMillis();
            row.setCostMs(ms);
            try {
                jobLogMapper.insert(row);
            } catch (Exception ex) {
                log.warn("写入 sys_job_log 失败：{}", ex.getMessage());
            }
        }
    }

    /** 解析 Bean.method('arg1','arg2') 并反射调用；目标 bean 必须已在 Spring 容器中 */
    private void invoke(String target) throws Exception {
        if (target == null || target.isBlank()) throw new IllegalArgumentException("invokeTarget 不能为空");
        int paren = target.indexOf('(');
        int brace = target.lastIndexOf(')');
        String beanAndMethod = paren < 0 ? target : target.substring(0, paren).trim();
        String argsPart = (paren > 0 && brace > paren) ? target.substring(paren + 1, brace).trim() : "";

        int dot = beanAndMethod.lastIndexOf('.');
        if (dot < 0) throw new IllegalArgumentException("invoke_target 格式错误（需要 Bean.method）：" + target);
        String beanName = beanAndMethod.substring(0, dot);
        String methodName = beanAndMethod.substring(dot + 1);
        Object bean = ctx.getBean(beanName);
        Method method = findMethod(bean.getClass(), methodName);
        Object[] args = parseArgs(argsPart);
        method.invoke(bean, args);
    }

    /** 简单方法查找：按 methodName + 参数全为 String（含无参）匹配同名方法 */
    private static Method findMethod(Class<?> cls, String name) throws NoSuchMethodException {
        for (Method m : cls.getMethods()) {
            if (!m.getName().equals(name)) continue;
            boolean allStrings = true;
            for (Class<?> p : m.getParameterTypes()) {
                if (p != String.class) { allStrings = false; break; }
            }
            if (allStrings) return m;
        }
        throw new NoSuchMethodException(cls.getName() + "#" + name);
    }

    /** 解析 'a','b' 风格参数：单引号包裹、按 , 切分；不解析数字/对象，仅支持字符串 */
    private static Object[] parseArgs(String argsPart) {
        if (argsPart.isEmpty()) return new Object[0];
        java.util.List<String> parts = new java.util.ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuote = false;
        for (int i = 0; i < argsPart.length(); i++) {
            char c = argsPart.charAt(i);
            if (c == '\'') inQuote = !inQuote;
            else if (c == ',' && !inQuote) {
                parts.add(cur.toString());
                cur.setLength(0);
            } else cur.append(c);
        }
        if (cur.length() > 0 || !parts.isEmpty()) parts.add(cur.toString());
        return parts.stream().map(s -> s.trim().replaceAll("^'+|'+$", "")).toArray();
    }

    /** 用 Object 槽作为 ReentrantLock 占位（按 jobId 缓存），减少对象创建 */
    private final Map<Long, java.util.concurrent.locks.ReentrantLock> lockMap = new ConcurrentHashMap<>();
    private java.util.concurrent.locks.ReentrantLock reentrantLock(Long id, Object slot) {
        return lockMap.computeIfAbsent(id, k -> new java.util.concurrent.locks.ReentrantLock());
    }
}
