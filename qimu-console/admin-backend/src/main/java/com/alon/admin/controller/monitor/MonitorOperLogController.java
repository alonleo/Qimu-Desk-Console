package com.alon.admin.controller.monitor;

import com.alon.admin.common.BaseController;
import com.alon.admin.common.BatchOps;
import com.alon.admin.entity.SysOperLog;
import com.alon.admin.mapper.SysOperLogMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 操作日志（sys_oper_log）：只读分页查询 + 单删 + 批量删 + 清空。
 *
 * <p>本控制器自身不挂 @Log，避免「读日志的操作也写日志」造成的雪球效应。
 */
@RestController
@RequestMapping("/api/monitor/operlog")
public class MonitorOperLogController extends BaseController {

    private final SysOperLogMapper operLogMapper;

    public MonitorOperLogController(SysOperLogMapper operLogMapper) {
        this.operLogMapper = operLogMapper;
    }

    @GetMapping("/list")
    public Map<String, Object> list(
            @RequestParam(required = false) String title,
            @RequestParam(required = false) String operName,
            @RequestParam(required = false) String businessType,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String ip) {
        Page<SysOperLog> page = startPage();
        QueryWrapper<SysOperLog> qw = new QueryWrapper<>();
        if (title != null && !title.isBlank()) qw.like("title", title.trim());
        if (operName != null && !operName.isBlank()) qw.like("oper_name", operName.trim());
        if (businessType != null && !businessType.isBlank()) qw.eq("business_type", businessType.trim());
        if (status != null && !status.isBlank()) qw.eq("status", status.trim());
        if (ip != null && !ip.isBlank()) qw.like("oper_ip", ip.trim());
        qw.orderByDesc("oper_time");
        Page<SysOperLog> result = operLogMapper.selectPage(page, qw);
        return getDataTable(result);
    }

    @GetMapping("/{operId}")
    public Map<String, Object> getInfo(@PathVariable Long operId) {
        SysOperLog row = operLogMapper.selectById(operId);
        Map<String, Object> resp = new LinkedHashMap<>();
        if (row == null) { resp.put("ok", false); resp.put("error", "记录不存在"); return resp; }
        resp.put("ok", true);
        resp.put("log", row);
        return resp;
    }

    @DeleteMapping("/{operIds}")
    public Map<String, Object> remove(@PathVariable Long[] operIds) {
        List<Map<String, Object>> errors = new java.util.ArrayList<>();
        int deleted = 0;
        for (Long id : operIds) {
            if (operLogMapper.deleteById(id) > 0) deleted++;
            else errors.add(BatchOps.itemError("id", id, "记录不存在"));
        }
        return BatchOps.result("deleted", deleted, errors);
    }

    @DeleteMapping("/clean")
    public Map<String, Object> clean() {
        int n = operLogMapper.delete(new QueryWrapper<>());
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("deleted", n);
        return resp;
    }
}
