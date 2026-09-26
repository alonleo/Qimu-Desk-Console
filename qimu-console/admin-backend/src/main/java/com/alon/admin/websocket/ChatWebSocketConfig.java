package com.alon.admin.websocket;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * WS 端点注册（chat-module）：/ws/chat?token=&lt;JWT&gt;。
 * - 握手鉴权由 WsAuthInterceptor 完成（不走 AuthInterceptor，其只挂 /api/**）；
 * - 放行全部 Origin：WS 实际凭据是 token 参数，浏览器跨端口/跨域握手无法携带 cookie，
 *   dev（localhost:300x → :8080）与 prod（OpenResty 反代）统一走 token 校验。
 */
@Configuration
@EnableWebSocket
public class ChatWebSocketConfig implements WebSocketConfigurer {

    private final ChatWebSocketHandler chatWebSocketHandler;
    private final WsAuthInterceptor wsAuthInterceptor;

    public ChatWebSocketConfig(ChatWebSocketHandler chatWebSocketHandler, WsAuthInterceptor wsAuthInterceptor) {
        this.chatWebSocketHandler = chatWebSocketHandler;
        this.wsAuthInterceptor = wsAuthInterceptor;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(chatWebSocketHandler, "/ws/chat")
                .addInterceptors(wsAuthInterceptor)
                .setAllowedOriginPatterns("*");
    }
}
