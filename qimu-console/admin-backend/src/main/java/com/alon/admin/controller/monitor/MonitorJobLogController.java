package com.alon.admin.controller.monitor;

import com.alon.admin.annotation.Log;
import com.alon.admin.common.BaseController;
import com.alon.admin.common.BatchOps;
import com.alon.admin.entity.SysJobLog;
import com.alon.admin.mapper.SysJobLogMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 定时任务执行日志：分页查询 / 单删 / 批量删 / 清空。
 */
@RestController
@RequestMapping("/api/monitor/jobLog")
public class MonitorJobLogController extends BaseController {

    private final SysJobLogMapper jobLogMapper;

    public MonitorJobLogController(SysJobLogMapper jobLogMapper) {
        this.jobLogMapper = jobLogMapper;
    }

    @GetMapping("/list")
    public Map<String, Object> list(
            @RequestParam(required = false) String jobName,
            @RequestParam(required = false) String jobGroup,
            @RequestParam(required = false) String status) {
        Page<SysJobLog> page = startPage();
        QueryWrapper<SysJobLog> qw = new QueryWrapper<>();
        if (jobName != null && !jobName.isBlank()) qw.like("job_name", jobName.trim());
        if (jobGroup != null && !jobGroup.isBlank()) qw.eq("job_group", jobGroup.trim());
        if (status != null && !status.isBlank()) qw.eq("status", status.trim());
        qw.orderByDesc("start_time");
        Page<SysJobLog> result = jobLogMapper.selectPage(page, qw);
        return getDataTable(result);
    }

    @GetMapping("/{jobLogId}")
    public Map<String, Object> getInfo(@PathVariable Long jobLogId) {
        SysJobLog log = jobLogMapper.selectById(jobLogId);
        Map<String, Object> resp = new LinkedHashMap<>();
        if (log == null) { resp.put("ok", false); resp.put("error", "日志不存在"); return resp; }
        resp.put("ok", true);
        resp.put("log", log);
        return resp;
    }

    @Log(title = "调度日志", businessType = "3")
    @DeleteMapping("/{jobLogIds}")
    public Map<String, Object> remove(@PathVariable Long[] jobLogIds) {
        List<Map<String, Object>> errors = new java.util.ArrayList<>();
        int deleted = 0;
        for (Long id : jobLogIds) {
            if (jobLogMapper.deleteById(id) > 0) deleted++;
            else errors.add(BatchOps.itemError("id", id, "日志不存在"));
        }
        return BatchOps.result("deleted", deleted, errors);
    }

    @Log(title = "调度日志", businessType = "9")
    @DeleteMapping("/clean")
    public Map<String, Object> clean() {
        // SQL: DELETE FROM sys_job_log; 用 delete(new QueryWrapper<>().ne("id", 0)) 兼容
        int n = jobLogMapper.delete(new QueryWrapper<>());
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("deleted", n);
        return resp;
    }
}
