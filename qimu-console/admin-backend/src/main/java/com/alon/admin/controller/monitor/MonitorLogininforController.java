package com.alon.admin.controller.monitor;

import com.alon.admin.common.BaseController;
import com.alon.admin.common.BatchOps;
import com.alon.admin.entity.SysLogininfor;
import com.alon.admin.mapper.SysLogininforMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 登录日志（sys_logininfor）：查询 / 删除 / 清空 / 解锁（占位）。
 *
 * <p>解锁接口本期为占位实现：未引入 Redis 失败计数时，所有失败仅记录日志，
 * 无锁定状态可清。后续如启用 Redis 登录锁定，可在此方法内接入。
 */
@RestController
@RequestMapping("/api/monitor/logininfor")
public class MonitorLogininforController extends BaseController {

    private final SysLogininforMapper logininforMapper;

    public MonitorLogininforController(SysLogininforMapper logininforMapper) {
        this.logininforMapper = logininforMapper;
    }

    @GetMapping("/list")
    public Map<String, Object> list(
            @RequestParam(required = false) String userName,
            @RequestParam(required = false) String ipaddr,
            @RequestParam(required = false) String status) {
        Page<SysLogininfor> page = startPage();
        QueryWrapper<SysLogininfor> qw = new QueryWrapper<>();
        if (userName != null && !userName.isBlank()) qw.like("user_name", userName.trim());
        if (ipaddr != null && !ipaddr.isBlank()) qw.like("ipaddr", ipaddr.trim());
        if (status != null && !status.isBlank()) qw.eq("status", status.trim());
        qw.orderByDesc("login_time");
        Page<SysLogininfor> result = logininforMapper.selectPage(page, qw);
        return getDataTable(result);
    }

    @DeleteMapping("/{infoIds}")
    public Map<String, Object> remove(@PathVariable Long[] infoIds) {
        List<Map<String, Object>> errors = new java.util.ArrayList<>();
        int deleted = 0;
        for (Long id : infoIds) {
            if (logininforMapper.deleteById(id) > 0) deleted++;
            else errors.add(BatchOps.itemError("id", id, "记录不存在"));
        }
        return BatchOps.result("deleted", deleted, errors);
    }

    @DeleteMapping("/clean")
    public Map<String, Object> clean() {
        int n = logininforMapper.delete(new QueryWrapper<>());
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("deleted", n);
        return resp;
    }

    /** 解锁账号：当前未启用登录失败计数锁定，固定返回 ok */
    @PutMapping("/unlock/{userName}")
    public Map<String, Object> unlock(@PathVariable String userName) {
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("userName", userName);
        resp.put("message", "解锁指令已下发（当前未启用登录锁定）");
        return resp;
    }
}
