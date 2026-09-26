package com.alon.admin.mapper;

import com.alon.admin.entity.SkillRun;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

@Mapper
public interface SkillRunMapper extends BaseMapper<SkillRun> {

    /** 每个技能的运行次数（列表页一次查出，避免 N+1 循环 selectCount） */
    @Select("SELECT skill_id AS skillId, COUNT(*) AS cnt FROM skill_runs GROUP BY skill_id")
    List<Map<String, Object>> countGroupBySkill();

    /** 每个技能最近一次运行状态（按 max(id) 关联，一次查出，避免循环 selectOne+last LIMIT 1） */
    @Select("SELECT r.skill_id AS skillId, r.status AS status FROM skill_runs r " +
            "INNER JOIN (SELECT skill_id AS sid, MAX(id) AS mid FROM skill_runs GROUP BY skill_id) t " +
            "ON r.id = t.mid")
    List<Map<String, Object>> lastStatusBySkill();
}
