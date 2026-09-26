"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getWsToken, resolveWsUrl, type ChatFrame, type WsStatus } from "@/core/chat";

/**
 * 聊天 WebSocket 连接 hook（chat-module）：
 * - 指数退避自动重连：1s 起、×2、上限 30s、抖动 ±20%；
 * - 页面 visibilitychange 恢复可见时立即尝试重连；
 * - 25s 心跳（{"type":"ping"} → 服务端回 pong）；
 * - 连接成功（hello）后的增量补拉由调用方在 onHello 回调里触发；
 * - 帧协议与后端 ChatWebSocketHandler / ChatSupport 保持一致（改动需同步）。
 * v2：sendFrame 支持按 conversationId 寻址（单/群通用，单聊仍可用 to 寻址）；新增 onNewConversation。
 */

const HEARTBEAT_MS = 25_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** v2：chat 帧发送参数（to 与 conversationId 并存时服务端以 conversationId 为准） */
export type ChatSendFrame = {
  to?: number;
  conversationId?: number;
  content: string;
  clientId: string;
};

export type ChatWsHandlers = {
  onHello?: (frame: Extract<ChatFrame, { type: "hello" }>) => void;
  /** 收到 chat 帧：既包括对方消息，也包括自己发送的 ack（按 clientId/from 区分） */
  onChat: (frame: Extract<ChatFrame, { type: "chat" }>) => void;
  onRead?: (frame: Extract<ChatFrame, { type: "read" }>) => void;
  onOnline?: (frame: Extract<ChatFrame, { type: "online" }>) => void;
  /** v2：群创建广播（前端统一 loadConversations 全量刷新，不做局部拼接） */
  onNewConversation?: (frame: Extract<ChatFrame, { type: "new_conversation" }>) => void;
  onError?: (frame: Extract<ChatFrame, { type: "error" }>) => void;
};

export function useChatWebSocket(handlers: ChatWsHandlers) {
  const [status, setStatus] = useState<WsStatus>("connecting");

  // 回调经 ref 转发：连接生命周期只建立一次，避免 handlers 变化触发重连
  const handlersRef = useRef<ChatWsHandlers>(handlers);
  handlersRef.current = handlers;

  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const disposedRef = useRef(false);

  /** 发送 chat 帧（v1 单聊寻址：to；WS 已连接返回 true；未连接由调用方走 HTTP 兜底） */
  const send = useCallback((to: number, content: string, clientId: string): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "chat", clientId, to, content }));
    return true;
  }, []);

  /** v2：发送 chat 帧（双寻址：单聊 to / 已有会话 conversationId；WS 已连接返回 true） */
  const sendFrame = useCallback((frame: ChatSendFrame): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "chat", ...frame }));
    return true;
  }, []);

  /** 发送 read 帧（标记与某用户的单聊会话已读；群已读走 REST，无 read 帧） */
  const markRead = useCallback((peerId: number): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "read", peerId }));
    return true;
  }, []);

  useEffect(() => {
    disposedRef.current = false;

    const stopHeartbeat = () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };

    const startHeartbeat = () => {
      stopHeartbeat();
      heartbeatRef.current = setInterval(() => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, HEARTBEAT_MS);
    };

    const scheduleReconnect = () => {
      if (disposedRef.current || reconnectRef.current) return;
      const attempt = attemptRef.current++;
      const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, attempt));
      // 抖动 ±20%，避免多端同时重连打爆服务端
      const delay = Math.max(200, base * (0.8 + Math.random() * 0.4));
      reconnectRef.current = setTimeout(() => {
        reconnectRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposedRef.current) return;
      setStatus("connecting");
      getWsToken()
        .then((token) => {
          if (disposedRef.current) return;
          const ws = new WebSocket(resolveWsUrl(token));
          wsRef.current = ws;

          ws.onopen = () => {
            attemptRef.current = 0;
            setStatus("open");
            startHeartbeat();
          };

          ws.onmessage = (ev: MessageEvent) => {
            let frame: ChatFrame | null = null;
            try {
              frame = JSON.parse(String(ev.data)) as ChatFrame;
            } catch {
              return; // 非法帧直接忽略
            }
            if (!frame || typeof frame.type !== "string") return;
            switch (frame.type) {
              case "hello":
                setStatus("open");
                handlersRef.current.onHello?.(frame);
                break;
              case "chat":
                handlersRef.current.onChat(frame);
                break;
              case "read":
                handlersRef.current.onRead?.(frame);
                break;
              case "online":
                handlersRef.current.onOnline?.(frame);
                break;
              case "new_conversation":
                handlersRef.current.onNewConversation?.(frame);
                break;
              case "error":
                handlersRef.current.onError?.(frame);
                break;
              case "pong":
                break; // 心跳应答无需处理
            }
          };

          ws.onclose = () => {
            stopHeartbeat();
            setStatus("closed");
            scheduleReconnect();
          };

          ws.onerror = () => {
            try {
              ws.close();
            } catch {
              /* 忽略 */
            }
          };
        })
        .catch(() => {
          // token 获取失败（未登录/接口异常）也走重连退避
          setStatus("closed");
          scheduleReconnect();
        });
    };

    connect();

    // 页面重新可见时立即尝试重连（清空退避等待）
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      attemptRef.current = 0;
      connect();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposedRef.current = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      stopHeartbeat();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        try {
          ws.close();
        } catch {
          /* 忽略 */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, send, sendFrame, markRead };
}
