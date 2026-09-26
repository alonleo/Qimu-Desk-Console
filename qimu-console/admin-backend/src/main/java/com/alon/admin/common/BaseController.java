package com.alon.admin.common;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;

import java.util.Map;

/**
 * Controller 基类：startPage + getDataTable 复用 PageUtils，仿 RuoYi 风格。
 * 监控相关 controller 继承本类即可获得统一分页入口。
 */
public class BaseController {

    protected <T> Page<T> startPage() {
        return PageUtils.startPage();
    }

    protected Map<String, Object> getDataTable(IPage<?> page) {
        return PageUtils.getDataTable(page);
    }
}
