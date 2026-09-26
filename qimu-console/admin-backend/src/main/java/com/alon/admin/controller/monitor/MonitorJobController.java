package com.alon.admin.controller.monitor;

import com.alon.admin.annotation.Log;
import com.alon.admin.common.BaseController;
import com.alon.admin.common.BatchOps;
import com.alon.admin.entity.SysJob;
import com.alon.admin.mapper.SysJobMapper;
import com.alon.admin.service.SysJobRunner;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 定时任务管理（CRUD + 启停 + 立即执行）。
 *
 * <p>对接 sys_job 表，运行时由 SysJobRunner 通过 Spring TaskScheduler 调度。
 * 注意：所有接口不写操作日志（@Log 自身不记录，避免循环落库）。
 */
@RestController
@RequestMapping("/api/monitor/job")
public class MonitorJobController extends BaseController {

    private final SysJobMapper jobMapper;
    private final SysJobRunner jobRunner;

    public MonitorJobController(SysJobMapper jobMapper, SysJobRunner jobRunner) {
        this.jobMapper = jobMapper;
        this.jobRunner = jobRunner;
    }

    @GetMapping("/list")
    public Map<String, Object> list(
            @RequestParam(required = false) String jobName,
            @RequestParam(required = false) String jobGroup,
            @RequestParam(required = false) String status) {
        Page<SysJob> page = startPage();
        QueryWrapper<SysJob> qw = new QueryWrapper<>();
        if (jobName != null && !jobName.isBlank()) qw.like("job_name", jobName.trim());
        if (jobGroup != null && !jobGroup.isBlank()) qw.eq("job_group", jobGroup.trim());
        if (status != null && !status.isBlank()) qw.eq("status", status.trim());
        qw.orderByDesc("id");
        Page<SysJob> result = jobMapper.selectPage(page, qw);
        return getDataTable(result);
    }

    @GetMapping("/{jobId}")
    public Map<String, Object> getInfo(@PathVariable Long jobId) {
        SysJob job = jobMapper.selectById(jobId);
        Map<String, Object> resp = new LinkedHashMap<>();
        if (job == null) {
            resp.put("ok", false);
            resp.put("error", "任务不存在");
            return resp;
        }
        resp.put("ok", true);
        resp.put("job", job);
        return resp;
    }

    @Log(title = "定时任务", businessType = "1")
    @PostMapping
    public Map<String, Object> add(@RequestBody SysJob body) {
        return saveOrUpdate(body, true);
    }

    @Log(title = "定时任务", businessType = "2")
    @PutMapping
    public Map<String, Object> edit(@RequestBody SysJob body) {
        return saveOrUpdate(body, false);
    }

    private Map<String, Object> saveOrUpdate(SysJob body, boolean isCreate) {
        Map<String, Object> resp = new LinkedHashMap<>();
        if (body.getJobName() == null || body.getJobName().isBlank()) return err("任务名称不能为空");
        if (body.getInvokeTarget() == null || body.getInvokeTarget().isBlank()) return err("调用目标不能为空");
        if (body.getCronExpression() == null || body.getCronExpression().isBlank()) return err("cron 表达式不能为空");
        if (!CronExpression.isValidExpression(body.getCronExpression())) return err("cron 表达式无效");
        if (body.getJobGroup() == null || body.getJobGroup().isBlank()) body.setJobGroup("DEFAULT");
        if (body.getStatus() == null || body.getStatus().isBlank()) body.setStatus("0");
        if (body.getMisfirePolicy() == null) body.setMisfirePolicy("3");
        if (body.getConcurrent() == null) body.setConcurrent("1");

        if (isCreate) {
            body.setCreateTime(LocalDateTime.now());
            jobMapper.insert(body);
            // 新建后若状态为运行则加入调度器
            if ("1".equals(body.getStatus())) jobRunner.addJob(body);
        } else {
            if (body.getId() == null) return err("id 不能为空");
            body.setUpdateTime(LocalDateTime.now());
            jobMapper.updateById(body);
            // 状态变更：运行中 → 重新调度；暂停 → 移除调度
            jobRunner.removeJob(body.getId());
            if ("1".equals(body.getStatus())) jobRunner.addJob(body);
        }
        resp.put("ok", true);
        resp.put("job", body);
        return resp;
    }

    @Log(title = "定时任务", businessType = "3")
    @DeleteMapping("/{jobIds}")
    public Map<String, Object> remove(@PathVariable Long[] jobIds) {
        List<Map<String, Object>> errors = new java.util.ArrayList<>();
        int deleted = 0;
        for (Long id : jobIds) {
            try {
                jobRunner.removeJob(id);
                if (jobMapper.deleteById(id) > 0) deleted++;
                else errors.add(BatchOps.itemError("id", id, "任务不存在"));
            } catch (Exception ex) {
                errors.add(BatchOps.itemError("id", id, ex.getMessage()));
            }
        }
        return BatchOps.result("deleted", deleted, errors);
    }

    @Log(title = "定时任务", businessType = "2")
    @PutMapping("/changeStatus")
    public ResponseEntity<Map<String, Object>> changeStatus(@RequestBody Map<String, Object> body) {
        Map<String, Object> resp = new LinkedHashMap<>();
        Object idObj = body.get("id");
        Object stObj = body.get("status");
        if (idObj == null || stObj == null) { resp.put("ok", false); resp.put("error", "id/status 不能为空"); return ResponseEntity.ok(resp); }
        Long id = Long.valueOf(idObj.toString());
        String st = stObj.toString();
        SysJob job = jobMapper.selectById(id);
        if (job == null) { resp.put("ok", false); resp.put("error", "任务不存在"); return ResponseEntity.ok(resp); }
        job.setStatus(st);
        job.setUpdateTime(LocalDateTime.now());
        jobMapper.updateById(job);
        jobRunner.removeJob(id);
        if ("1".equals(st)) jobRunner.addJob(job);
        resp.put("ok", true);
        return ResponseEntity.ok(resp);
    }

    @Log(title = "定时任务", businessType = "2")
    @PutMapping("/run")
    public Map<String, Object> run(@RequestBody Map<String, Object> body) {
        Map<String, Object> resp = new LinkedHashMap<>();
        Object idObj = body.get("id");
        if (idObj == null) { resp.put("ok", false); resp.put("error", "id 不能为空"); return resp; }
        try {
            jobRunner.runOnce(Long.valueOf(idObj.toString()));
            resp.put("ok", true);
        } catch (Exception ex) {
            resp.put("ok", false);
            resp.put("error", ex.getMessage());
        }
        return resp;
    }

    private static Map<String, Object> err(String msg) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", false);
        m.put("error", msg);
        return m;
    }
}
