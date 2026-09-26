package com.alon.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("ai_config")
public class AiConfig {
    @TableId(type = IdType.AUTO)
    private Integer id;
    private String name;
    private String provider;
    private String baseUrl;
    private String apiKey;
    private String model;
    private Double temperature;
    private Integer maxInputTokens;
    private Integer maxOutputTokens;
    private Integer timeoutSeconds;
    private Integer enabled;
    private Integer isDefault;
    private LocalDateTime updatedAt;
}
