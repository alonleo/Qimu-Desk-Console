package com.alon.admin.service;
import com.alon.admin.entity.AiConfig;
import org.junit.jupiter.api.Test;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
class AiGenerationPolicyTest {
    @Test void minimaxDefaultsAndExplicitLimits() {
        AiConfig cfg = new AiConfig(); cfg.setModel("MiniMax-M2.7-highspeed");
        assertEquals(16384, AiGenerationPolicy.options(cfg, 8).get("max_tokens"));
        assertEquals(true, AiGenerationPolicy.options(cfg, 8).get("reasoning_split"));
        assertEquals(240, AiGenerationPolicy.timeout(cfg));
        AiGenerationPolicy.apply(cfg, Map.of("max_input_tokens", 50000, "max_output_tokens", 8192, "timeout_seconds", 180));
        assertEquals(8192, AiGenerationPolicy.options(cfg, 4000).get("max_tokens"));
        assertEquals(180, AiGenerationPolicy.timeout(cfg));
        AiGenerationPolicy.apply(cfg, Map.of("max_output_tokens", 0));
        assertEquals(50000, cfg.getMaxInputTokens());
        assertEquals(16384, AiGenerationPolicy.options(cfg, 4000).get("max_tokens"));
    }
    @Test void rejectInvalidNumbersBeforeChangingSettings() {
        AiConfig cfg = new AiConfig(); cfg.setMaxInputTokens(20);
        for (Object invalid : new Object[]{-1, 1.5, "100", true, 262145}) {
            assertThrows(IllegalArgumentException.class, () -> AiGenerationPolicy.apply(cfg, Map.of("max_input_tokens", 50, "max_output_tokens", invalid)));
            assertEquals(20, cfg.getMaxInputTokens());
        }
    }
    @Test void inputBudgetAndGenericModel() {
        AiConfig cfg = new AiConfig(); cfg.setModel("other");
        assertEquals(Map.of("max_tokens", 4000), AiGenerationPolicy.options(cfg, 4000));
        AiGenerationPolicy.apply(cfg, Map.of("max_input_tokens", 2));
        assertThrows(IllegalArgumentException.class, () -> AiGenerationPolicy.checkInput(cfg, "中文输入"));
        AiGenerationPolicy.apply(cfg, Map.of("max_input_tokens", 0));
        assertDoesNotThrow(() -> AiGenerationPolicy.checkInput(cfg, "中文输入"));
    }
}
