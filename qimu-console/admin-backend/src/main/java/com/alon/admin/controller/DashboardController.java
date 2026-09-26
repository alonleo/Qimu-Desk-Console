package com.alon.admin.controller;

import com.alon.admin.entity.*;
import com.alon.admin.mapper.*;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 仪表盘统计 */
@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final UserMapper userMapper;
    private final TaskMapper taskMapper;
    private final SkillMapper skillMapper;
    private final WorkflowMapper workflowMapper;
    private final DocMapper docMapper;
    private final CategoryMapper categoryMapper;
    private final AiConfigMapper aiConfigMapper;
    private final RunMapper runMapper;

    public DashboardController(UserMapper userMapper, TaskMapper taskMapper, SkillMapper skillMapper,
                               WorkflowMapper workflowMapper, DocMapper docMapper, CategoryMapper categoryMapper,
                               AiConfigMapper aiConfigMapper, RunMapper runMapper) {
        this.userMapper = userMapper;
        this.taskMapper = taskMapper;
        this.skillMapper = skillMapper;
        this.workflowMapper = workflowMapper;
        this.docMapper = docMapper;
        this.categoryMapper = categoryMapper;
        this.aiConfigMapper = aiConfigMapper;
        this.runMapper = runMapper;
    }

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        Map<String, Object> taskSummary = new HashMap<>();
        taskSummary.put("todo", count("todo"));
        taskSummary.put("doing", count("doing"));
        taskSummary.put("waiting", count("waiting"));
        taskSummary.put("done", count("done"));

        List<Map<String, Object>> recentRuns = runMapper.selectList(
                        new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<Run>()
                                .last("ORDER BY id DESC LIMIT 6"))
                .stream().map(r -> {
                    Workflow w = workflowMapper.selectById(r.getWorkflowId());
                    Map<String, Object> m = new HashMap<>();
                    m.put("id", r.getId());
                    m.put("name", w == null ? "#" + r.getId() : w.getName());
                    m.put("status", r.getStatus());
                    m.put("triggered_by", r.getTriggeredBy());
                    m.put("started_at", r.getStartedAt() == null ? null : r.getStartedAt().toString().replace("T", " "));
                    return m;
                }).toList();

        boolean aiEnabled = aiConfigMapper.selectCount(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<AiConfig>()
                .eq("enabled", 1)) > 0;

        Map<String, Object> stats = new HashMap<>();
        stats.put("users", userMapper.selectCount(null));
        stats.put("tasks", taskMapper.selectCount(null));
        stats.put("skills", skillMapper.selectCount(null));
        stats.put("workflows", workflowMapper.selectCount(null));
        stats.put("docs", docMapper.selectCount(null));
        stats.put("categories", categoryMapper.selectCount(null));
        stats.put("aiEnabled", aiEnabled);
        stats.put("taskSummary", taskSummary);
        stats.put("recentRuns", recentRuns);
        return Map.of("stats", stats);
    }

    private long count(String status) {
        return taskMapper.selectCount(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<Task>()
                .eq("status", status));
    }
}
