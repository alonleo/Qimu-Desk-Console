package com.alon.admin.websocket;

import com.alon.admin.common.JwtUtil;
import io.jsonwebtoken.Claims;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.util.MultiValueMap;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Map;

/**
 * WS 握手鉴权（chat-module）：从查询参数 ?token=&lt;JWT&gt; 解析并校验，非法/过期直接 401 拒绝握手。
 * 校验通过后把 uid / username 写入握手 attributes，供 Handler 用 session.getAttributes() 读取。
 * 不依赖 AuthInterceptor（它只挂在 MVC /api/** 层）。
 */
@Component
public class WsAuthInterceptor implements HandshakeInterceptor {

    public static final String ATTR_UID = "uid";
    public static final String ATTR_USERNAME = "username";

    private final JwtUtil jwtUtil;

    public WsAuthInterceptor(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        MultiValueMap<String, String> params =
                UriComponentsBuilder.fromUri(request.getURI()).build().getQueryParams();
        String token = params.getFirst("token");
        Claims claims = (token == null || token.isBlank()) ? null : jwtUtil.parse(token);
        if (claims == null) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        attributes.put(ATTR_UID, jwtUtil.userId(claims));
        attributes.put(ATTR_USERNAME, jwtUtil.username(claims));
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // 无需处理
    }
}
