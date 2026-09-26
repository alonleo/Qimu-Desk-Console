package com.alon.admin.websocket;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * 在线注册表（单机内存版）：userId → WS 会话集合（同一用户多标签页 = 多条会话）。
 * - 在线判定以 session 生命周期为准：最后一个 session 关闭即离线；
 * - 多实例部署时的扩展点：仅替换本实现为 Redis pub/sub 版即可（接口已收敛，本期不做）。
 */
@Component
public class OnlineRegistry {

    private final ConcurrentHashMap<Long, Set<WebSocketSession>> sessionsByUser = new ConcurrentHashMap<>();

    /** 用户最后在线时间（最后一个连接关闭时刻，毫秒）；重启丢失，联系人列表展示用，可接受 */
    private final ConcurrentHashMap<Long, Long> lastOnlineAt = new ConcurrentHashMap<>();

    /** 用户当前是否在线 */
    public boolean online(Long userId) {
        Set<WebSocketSession> set = sessionsByUser.get(userId);
        return set != null && !set.isEmpty();
    }

    /** 注册会话；返回 true 表示该用户由离线转为在线（首个连接建立） */
    public synchronized boolean add(Long userId, WebSocketSession session) {
        Set<WebSocketSession> set = sessionsByUser.computeIfAbsent(userId, k -> new CopyOnWriteArraySet<>());
        boolean first = set.isEmpty();
        set.add(session);
        lastOnlineAt.remove(userId);
        return first;
    }

    /** 注销会话；返回 true 表示该用户最后一个连接已关闭（转为离线） */
    public synchronized boolean remove(Long userId, WebSocketSession session) {
        Set<WebSocketSession> set = sessionsByUser.get(userId);
        if (set == null) {
            return false;
        }
        set.remove(session);
        if (!set.isEmpty()) {
            return false;
        }
        sessionsByUser.remove(userId);
        lastOnlineAt.put(userId, System.currentTimeMillis());
        return true;
    }

    /** 当前全部在线用户 id */
    public List<Long> onlineUserIds() {
        return new ArrayList<>(sessionsByUser.keySet());
    }

    /** 向指定用户的全部在线会话推送 JSON 帧；任一会话送达即视为成功 */
    public boolean pushToUser(Long userId, String jsonFrame) {
        Set<WebSocketSession> set = sessionsByUser.get(userId);
        if (set == null || set.isEmpty()) {
            return false;
        }
        boolean delivered = false;
        for (WebSocketSession session : set) {
            if (!session.isOpen()) {
                continue;
            }
            try {
                // sendMessage 非线程安全：同一会话的并发写必须串行化
                synchronized (session) {
                    session.sendMessage(new TextMessage(jsonFrame));
                }
                delivered = true;
            } catch (IOException | IllegalStateException e) {
                // 单个会话推送失败不影响其他会话；断连由容器 onClose 兜底清理
            }
        }
        return delivered;
    }

    /** 最后在线时间（毫秒时间戳）；从未上线/重启后无记录返回 null */
    public Long lastOnlineAt(Long userId) {
        return lastOnlineAt.get(userId);
    }
}
