package com.alon.admin.common;

import com.alon.admin.entity.ChatConversation;
import com.alon.admin.entity.ChatConversationMember;
import com.alon.admin.entity.ChatMessage;
import com.alon.admin.mapper.ChatConversationMapper;
import com.alon.admin.mapper.ChatConversationMemberMapper;
import com.alon.admin.mapper.ChatMessageMapper;
import com.alon.admin.websocket.WsAuthInterceptor;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.socket.WebSocketHandler;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * chat-module 纯逻辑自动化测试（QA）。
 *
 * 说明：admin-backend pom 未引入任何 test 依赖（无 JUnit/spring-boot-starter-test），
 * 且本次验证约束为"不得新增依赖"，故采用"main 方法 + 断言计数"的可运行测试形式，
 * 仅依赖项目既有 classpath（Spring/Jackson/MyBatis Plus），不启动服务、不连数据库：
 *
 * 1) ChatSupport.sanitizeContent：消息内容校验（trim 后 1~2000 字符）；
 * 2) ChatSupport.preview：会话摘要 128 截断；
 * 3) getOrCreateConversation：(min,max) 会话归一化 + 唯一键冲突查回（幂等）；
 * 4) insertMessage：clientId 幂等（已存在直接返回 / 空生成 UUID / 冲突竞态查回）；
 * 5) WS 帧序列化：chat/hello/read/online/pong/error 帧逐字段对照协议（ARCHITECTURE.md §3.3）；
 * 6) WsAuthInterceptor：非法/缺失 token 握手 401 拒绝，合法 token 通过并写入 uid/username。
 *
 * 运行方式（JDK 21）：
 *   javac -encoding UTF-8 -cp "target/classes;<deps>" -d target/test-classes src/test/java/com/alon/admin/common/ChatModuleQaTest.java
 *   java  -cp "target/test-classes;target/classes;<deps>" com.alon.admin.common.ChatModuleQaTest
 */
public class ChatModuleQaTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    // ---------- 极简断言设施 ----------

    private int passed = 0;
    private final List<String> failures = new java.util.ArrayList<>();

    private void check(String name, boolean cond) {
        if (cond) {
            passed++;
            System.out.println("[PASS] " + name);
        } else {
            failures.add(name);
            System.out.println("[FAIL] " + name);
        }
    }

    private void checkEquals(String name, Object expected, Object actual) {
        boolean ok = java.util.Objects.equals(expected, actual);
        if (!ok) {
            System.out.println("       expected=" + expected + " actual=" + actual);
        }
        check(name, ok);
    }

    // ---------- Mapper 假实现（JDK 动态代理，模拟 DB 行为） ----------

    /** 会话 Mapper 假件：可注入"已存在会话"与"insert 撞唯一键"两种行为 */
    private static class FakeConversationDb implements InvocationHandler {
        ChatConversation existingOnFirstSelect; // 非空：首次 selectOne 即返回
        ChatConversation existingOnSecondSelect; // 非空：首次 selectOne 返回 null，第二次起返回该行
        boolean insertThrowsDuplicate;
        ChatConversation inserted;
        int nextId = 100;
        final AtomicInteger selectCount = new AtomicInteger();

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) {
            return switch (method.getName()) {
                case "selectOne" -> {
                    int n = selectCount.incrementAndGet();
                    if (existingOnFirstSelect != null && n == 1) yield existingOnFirstSelect;
                    if (existingOnSecondSelect != null && n >= 2) yield existingOnSecondSelect;
                    yield null;
                }
                case "selectList" -> {
                    int n = selectCount.get();
                    if (existingOnFirstSelect != null && n == 1) yield List.of(existingOnFirstSelect);
                    if (existingOnSecondSelect != null && n >= 2) yield List.of(existingOnSecondSelect);
                    yield List.of();
                }
                case "insert" -> {
                    ChatConversation c = (ChatConversation) args[0];
                    if (insertThrowsDuplicate) throw new DuplicateKeyException("uk_chat_conv_pair");
                    c.setId((long) nextId++);
                    inserted = c;
                    yield 1;
                }
                case "updateById" -> { yield 1; }
                default -> throw new UnsupportedOperationException("FakeConversationDb 未实现: " + method.getName());
            };
        }
    }

    /** 消息 Mapper 假件：可注入"clientId 已存在"与"insert 撞唯一键后查回"两种行为 */
    private static class FakeMessageDb implements InvocationHandler {
        ChatMessage existing; // selectOne 直接返回（幂等命中）
        ChatMessage raceExisting; // 首次 selectOne 返回 null、insert 抛冲突后返回该行
        boolean insertThrowsDuplicate;
        ChatMessage inserted;
        int insertCalls = 0;
        int nextId = 500;

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) {
            return switch (method.getName()) {
                case "selectOne" -> {
                    if (existing != null) yield existing;
                    if (raceExisting != null && insertThrowsDuplicate && inserted != null) yield raceExisting;
                    if (raceExisting != null && insertCalls > 0) yield raceExisting;
                    yield null;
                }
                case "selectList" -> {
                    if (existing != null) yield List.of(existing);
                    if (raceExisting != null && insertCalls > 0) yield List.of(raceExisting);
                    yield List.of();
                }
                case "insert" -> {
                    ChatMessage m = (ChatMessage) args[0];
                    insertCalls++;
                    if (insertThrowsDuplicate) {
                        inserted = m; // 记录后再抛，供断言
                        throw new DuplicateKeyException("uk_chat_msg_client");
                    }
                    m.setId((long) nextId++);
                    inserted = m;
                    yield 1;
                }
                default -> throw new UnsupportedOperationException("FakeMessageDb 未实现: " + method.getName());
            };
        }
    }

    private static ChatConversationMapper proxyConv(FakeConversationDb db) {
        return (ChatConversationMapper) Proxy.newProxyInstance(
                ChatConversationMapper.class.getClassLoader(),
                new Class<?>[]{ChatConversationMapper.class}, db);
    }

    private static ChatMessageMapper proxyMsg(FakeMessageDb db) {
        return (ChatMessageMapper) Proxy.newProxyInstance(
                ChatMessageMapper.class.getClassLoader(),
                new Class<?>[]{ChatMessageMapper.class}, db);
    }

    /** v3：restoreDeleted 假件——计数 update 调用次数（一次 insertMessage 触发 会话侧+成员侧 各 1 次 UPDATE） */
    private static class FakeRestoreDb implements InvocationHandler {
        final AtomicInteger updateCalls = new AtomicInteger();

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) {
            return switch (method.getName()) {
                case "update" -> {
                    updateCalls.incrementAndGet();
                    yield 1;
                }
                case "selectOne" -> null;
                case "selectList" -> List.of();
                default -> throw new UnsupportedOperationException("FakeRestoreDb 未实现: " + method.getName());
            };
        }
    }

    private static ChatConversationMapper proxyConvRestore(FakeRestoreDb db) {
        return (ChatConversationMapper) Proxy.newProxyInstance(
                ChatConversationMapper.class.getClassLoader(),
                new Class<?>[]{ChatConversationMapper.class}, db);
    }

    private static ChatConversationMemberMapper proxyMemberRestore(FakeRestoreDb db) {
        return (ChatConversationMemberMapper) Proxy.newProxyInstance(
                ChatConversationMemberMapper.class.getClassLoader(),
                new Class<?>[]{ChatConversationMemberMapper.class}, db);
    }

    private static ChatMessage msg(long id, long convId, long senderId, String content, String clientId) {
        ChatMessage m = new ChatMessage();
        m.setId(id);
        m.setConversationId(convId);
        m.setSenderId(senderId);
        m.setContent(content);
        m.setIsRead(0);
        m.setClientId(clientId);
        m.setCreatedAt(LocalDateTime.of(2025, 1, 1, 12, 0, 0));
        return m;
    }

    // ---------- 1. 内容校验 ----------

    private void testSanitizeContent() {
        System.out.println("\n== 1. ChatSupport.sanitizeContent（trim 后 1~2000 字符） ==");
        checkEquals("null 内容非法", null, ChatSupport.sanitizeContent(null));
        checkEquals("空串非法", null, ChatSupport.sanitizeContent(""));
        checkEquals("纯空白非法（trim 后为空）", null, ChatSupport.sanitizeContent("   \t \n "));
        checkEquals("普通文本合法且不改动", "hello 👋", ChatSupport.sanitizeContent("hello 👋"));
        checkEquals("首尾空白被 trim", "hi", ChatSupport.sanitizeContent("  hi  "));
        checkEquals("恰好 2000 字符合法", 2000, ChatSupport.sanitizeContent("a".repeat(2000)).length());
        checkEquals("2001 字符非法", null, ChatSupport.sanitizeContent("a".repeat(2001)));
        checkEquals("CONTENT_MAX 常量=2000", 2000, ChatSupport.CONTENT_MAX);
    }

    // ---------- 2. 摘要截断 ----------

    private void testPreview() throws Exception {
        System.out.println("\n== 2. ChatSupport.preview（会话摘要 ≤128 截断） ==");
        checkEquals("短文本原样", "abc", ChatSupport.preview("abc"));
        checkEquals("恰好 128 字原样", "b".repeat(128), ChatSupport.preview("b".repeat(128)));
        checkEquals("129 字截断到 128", "c".repeat(128), ChatSupport.preview("c".repeat(129)));
        // 截断后必须能存进 last_message_preview VARCHAR(128)
        String preview = ChatSupport.preview("x".repeat(2000));
        check("preview 截断后 ≤128 字符", preview.length() <= 128);
    }

    // ---------- 3. 会话归一化 + 冲突幂等 ----------

    private void testGetOrCreateConversation() {
        System.out.println("\n== 3. getOrCreateConversation（min/max 归一化 + 冲突查回） ==");

        // 3.1 无会话：新建时 (7,3) 必须归一化为 userAId=3, userBId=7
        FakeConversationDb db1 = new FakeConversationDb();
        ChatConversation created = ChatSupport.getOrCreateConversation(proxyConv(db1), 7, 3);
        checkEquals("新建会话 userAId=min(7,3)=3", 3L, created.getUserAId());
        checkEquals("新建会话 userBId=max(7,3)=7", 7L, created.getUserBId());
        checkEquals("新建会话 insert 恰好一次", 1, db1.inserted == null ? 0 : 1);

        // 3.2 已存在：直接查回，不再 insert
        FakeConversationDb db2 = new FakeConversationDb();
        ChatConversation exist = new ChatConversation();
        exist.setId(9L);
        exist.setUserAId(3L);
        exist.setUserBId(7L);
        db2.existingOnFirstSelect = exist;
        ChatConversation got = ChatSupport.getOrCreateConversation(proxyConv(db2), 3, 7);
        checkEquals("已存在会话直接查回同一行", 9L, got.getId());
        checkEquals("已存在时不再 insert", null, db2.inserted);

        // 3.3 并发竞态：insert 撞 uk_chat_conv_pair → 查回已存在行
        FakeConversationDb db3 = new FakeConversationDb();
        db3.insertThrowsDuplicate = true;
        db3.existingOnSecondSelect = exist;
        ChatConversation raced = ChatSupport.getOrCreateConversation(proxyConv(db3), 7, 3);
        checkEquals("唯一键冲突后查回已存在会话", 9L, raced.getId());
    }

    // ---------- 4. clientId 幂等 ----------

    private void testInsertMessageIdempotent() {
        System.out.println("\n== 4. insertMessage（uk_chat_msg_client 幂等） ==");

        // 4.1 已存在（先查后写命中）：直接返回已有消息，不 insert
        FakeMessageDb db1 = new FakeMessageDb();
        ChatMessage exist = msg(501L, 5L, 1L, "hello", "c1");
        db1.existing = exist;
        FakeRestoreDb restore1 = new FakeRestoreDb();
        ChatMessage r1 = ChatSupport.insertMessage(proxyMsg(db1), proxyConvRestore(restore1),
                proxyMemberRestore(restore1), 5L, 1L, "hello", "c1");
        checkEquals("clientId 已存在 → 返回已有消息 id", 501L, r1.getId());
        checkEquals("幂等命中时不重复 insert", 0, db1.insertCalls);
        checkEquals("幂等命中（重发旧消息）不触发删除恢复 UPDATE", 0, restore1.updateCalls.get());

        // 4.2 新消息：is_read=0、clientId 原样（trim）、字段齐全
        FakeMessageDb db2 = new FakeMessageDb();
        FakeRestoreDb restore2 = new FakeRestoreDb();
        ChatMessage r2 = ChatSupport.insertMessage(proxyMsg(db2), proxyConvRestore(restore2),
                proxyMemberRestore(restore2), 5L, 1L, " hi ", "  c2  ");
        checkEquals("新消息 is_read=0", 0, r2.getIsRead());
        checkEquals("clientId trim 后写入", "c2", r2.getClientId());
        checkEquals("content 原样（上游已 sanitize）", " hi ", r2.getContent());
        checkEquals("新消息 conversationId 正确", 5L, r2.getConversationId());
        checkEquals("新消息 senderId 正确", 1L, r2.getSenderId());
        check("新消息 createdAt 非空", r2.getCreatedAt() != null);
        checkEquals("v3 新消息落库后触发删除恢复（会话侧+成员侧各 1 次 UPDATE）", 2, restore2.updateCalls.get());

        // 4.3 clientId 为空 → 生成 UUID
        FakeMessageDb db3 = new FakeMessageDb();
        FakeRestoreDb restore3 = new FakeRestoreDb();
        ChatMessage r3 = ChatSupport.insertMessage(proxyMsg(db3), proxyConvRestore(restore3),
                proxyMemberRestore(restore3), 5L, 1L, "hello", null);
        check("clientId 为空时生成 UUID(36 位)", r3.getClientId() != null && r3.getClientId().length() == 36);
        FakeMessageDb db4 = new FakeMessageDb();
        FakeRestoreDb restore4 = new FakeRestoreDb();
        ChatMessage r4 = ChatSupport.insertMessage(proxyMsg(db4), proxyConvRestore(restore4),
                proxyMemberRestore(restore4), 5L, 1L, "hello", "   ");
        check("clientId 空白时同样生成 UUID", r4.getClientId() != null && r4.getClientId().length() == 36);

        // 4.4 并发竞态：insert 撞 uk_chat_msg_client → 查回已存在消息（断线重发不重复落库）
        FakeMessageDb db5 = new FakeMessageDb();
        db5.insertThrowsDuplicate = true;
        ChatMessage racedMsg = msg(777L, 5L, 1L, "hello", "c5");
        db5.raceExisting = racedMsg;
        FakeRestoreDb restore5 = new FakeRestoreDb();
        ChatMessage r5 = ChatSupport.insertMessage(proxyMsg(db5), proxyConvRestore(restore5),
                proxyMemberRestore(restore5), 5L, 1L, "hello", "c5");
        checkEquals("唯一键冲突后查回已存在消息", 777L, r5.getId());
        checkEquals("冲突路径只尝试过一次 insert", 1, db5.insertCalls);
        checkEquals("冲突竞态查回路径不触发删除恢复 UPDATE", 0, restore5.updateCalls.get());
    }

    // ---------- 5. WS 帧序列化（对照 ARCHITECTURE.md §3.3） ----------

    private void testFrames() throws Exception {
        System.out.println("\n== 5. WS 帧序列化（协议字段逐项核对） ==");

        // chat 帧（推送/ack 通用）
        ChatMessage m = msg(101L, 5L, 3L, "hello 👋", "uuid-1");
        JsonNode chat = JSON.readTree(ChatSupport.chatFrame(m, "李四", 1L));
        checkEquals("chat.type", "chat", chat.path("type").asText());
        checkEquals("chat.messageId", 101L, chat.path("messageId").asLong());
        checkEquals("chat.conversationId", 5L, chat.path("conversationId").asLong());
        checkEquals("chat.clientId", "uuid-1", chat.path("clientId").asText());
        checkEquals("chat.from=senderId", 3L, chat.path("from").asLong());
        checkEquals("chat.fromName", "李四", chat.path("fromName").asText());
        checkEquals("chat.to", 1L, chat.path("to").asLong());
        checkEquals("chat.content", "hello 👋", chat.path("content").asText());
        checkEquals("chat.createdAt 格式", "2025-01-01 12:00:00", chat.path("createdAt").asText());
        check("chat.ts 为服务端毫秒时间戳", chat.path("ts").asLong() > 0);

        // hello 帧
        JsonNode hello = JSON.readTree(ChatSupport.helloFrame(1L, List.of(2L, 5L, 9L)));
        checkEquals("hello.type", "hello", hello.path("type").asText());
        checkEquals("hello.userId", 1L, hello.path("userId").asLong());
        checkEquals("hello.onlineIds 全量", "[2,5,9]", hello.path("onlineIds").toString());
        check("hello.ts > 0", hello.path("ts").asLong() > 0);

        // read 帧
        JsonNode read = JSON.readTree(ChatSupport.readFrame(1L, 5L, 101L));
        checkEquals("read.type", "read", read.path("type").asText());
        checkEquals("read.peerId=已读者", 1L, read.path("peerId").asLong());
        checkEquals("read.conversationId", 5L, read.path("conversationId").asLong());
        checkEquals("read.lastReadMessageId", 101L, read.path("lastReadMessageId").asLong());

        // online 帧
        JsonNode online = JSON.readTree(ChatSupport.onlineFrame(3L, true, LocalDateTime.of(2025, 1, 1, 12, 0, 0)));
        checkEquals("online.type", "online", online.path("type").asText());
        checkEquals("online.userId", 3L, online.path("userId").asLong());
        checkEquals("online.online=true", true, online.path("online").asBoolean());
        checkEquals("online.at 格式", "2025-01-01 12:00:00", online.path("at").asText());

        // pong 帧
        JsonNode pong = JSON.readTree(ChatSupport.pongFrame());
        checkEquals("pong.type", "pong", pong.path("type").asText());
        check("pong.ts > 0", pong.path("ts").asLong() > 0);

        // error 帧
        JsonNode err = JSON.readTree(ChatSupport.errorFrame("PEER_NOT_FOUND", "接收用户不存在"));
        checkEquals("error.type", "error", err.path("type").asText());
        checkEquals("error.code", "PEER_NOT_FOUND", err.path("code").asText());
        checkEquals("error.message", "接收用户不存在", err.path("message").asText());

        // 时间格式化
        checkEquals("fmt 时间格式", "2025-01-01 12:00:00", ChatSupport.fmt(LocalDateTime.of(2025, 1, 1, 12, 0, 0)));
        check("fmt null 安全", ChatSupport.fmt(null) == null);
    }

    // ---------- 6. WsAuthInterceptor 401 防线 ----------

    /** ServerHttpRequest 假件（仅实现 getURI） */
    private static ServerHttpRequest requestWithUri(URI uri) {
        return (ServerHttpRequest) Proxy.newProxyInstance(ServerHttpRequest.class.getClassLoader(),
                new Class<?>[]{ServerHttpRequest.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("getURI")) return uri;
                    throw new UnsupportedOperationException("request 假件未实现: " + method.getName());
                });
    }

    /** ServerHttpResponse 假件（捕获 setStatusCode） */
    private static class FakeResponse implements InvocationHandler {
        HttpStatus status;

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) {
            if (method.getName().equals("setStatusCode")) {
                Object a = args[0];
                status = a instanceof HttpStatus hs ? hs : HttpStatus.valueOf(((org.springframework.http.HttpStatusCode) a).value());
                return null;
            }
            return null;
        }
    }

    private static ServerHttpResponse responseProxy(FakeResponse db) {
        return (ServerHttpResponse) Proxy.newProxyInstance(ServerHttpResponse.class.getClassLoader(),
                new Class<?>[]{ServerHttpResponse.class}, db);
    }

    private void testWsAuthInterceptor() {
        System.out.println("\n== 6. WsAuthInterceptor（握手鉴权 401 防线） ==");
        JwtUtil jwt = new JwtUtil("qa-test-secret-0123456789-0123456789-abcdef", 72L, "development");
        WsAuthInterceptor interceptor = new WsAuthInterceptor(jwt);
        WebSocketHandler anyHandler = null;

        // 6.1 无 token → 401 拒绝
        FakeResponse r1 = new FakeResponse();
        Map<String, Object> attrs1 = new HashMap<>();
        boolean ok1 = interceptor.beforeHandshake(requestWithUri(URI.create("ws://localhost:8080/ws/chat")), responseProxy(r1), anyHandler, attrs1);
        check("无 token → 握手被拒绝", !ok1);
        checkEquals("无 token → 响应 401", HttpStatus.UNAUTHORIZED, r1.status);
        check("无 token → 不写入 uid", !attrs1.containsKey(WsAuthInterceptor.ATTR_UID));

        // 6.2 非法 token → 401 拒绝
        FakeResponse r2 = new FakeResponse();
        Map<String, Object> attrs2 = new HashMap<>();
        boolean ok2 = interceptor.beforeHandshake(requestWithUri(URI.create("ws://localhost:8080/ws/chat?token=garbage")), responseProxy(r2), anyHandler, attrs2);
        check("非法 token → 握手被拒绝", !ok2);
        checkEquals("非法 token → 响应 401", HttpStatus.UNAUTHORIZED, r2.status);

        // 6.3 空 token 参数 → 401 拒绝
        FakeResponse r3 = new FakeResponse();
        boolean ok3 = interceptor.beforeHandshake(requestWithUri(URI.create("ws://localhost:8080/ws/chat?token=")), responseProxy(r3), anyHandler, new HashMap<>());
        check("空 token → 握手被拒绝且 401", !ok3 && r3.status == HttpStatus.UNAUTHORIZED);

        // 6.4 合法 token → 放行并写入 uid/username
        String token = jwt.generate(42L, "alice", "member");
        FakeResponse r4 = new FakeResponse();
        Map<String, Object> attrs4 = new HashMap<>();
        boolean ok4 = interceptor.beforeHandshake(
                requestWithUri(URI.create("ws://localhost:8080/ws/chat?token=" + URLEncoder.encode(token, StandardCharsets.UTF_8))),
                responseProxy(r4), anyHandler, attrs4);
        check("合法 token → 握手放行", ok4);
        checkEquals("合法 token → attributes.uid=42", 42L, ((Number) attrs4.get(WsAuthInterceptor.ATTR_UID)).longValue());
        checkEquals("合法 token → attributes.username=alice", "alice", attrs4.get(WsAuthInterceptor.ATTR_USERNAME));

        // 6.5 过期 token → 401 拒绝（过期 1 小时的 token）
        JwtUtil shortJwt = new JwtUtil("qa-test-secret-0123456789-0123456789-abcdef", 0L, "development");
        String expired = shortJwt.generate(42L, "alice", "member");
        // expireHours=0 → 立即过期；重新生成一个早已过期的 token：直接等待不可行，用 0 小时过期时间
        try { Thread.sleep(50); } catch (InterruptedException ignored) { }
        FakeResponse r5 = new FakeResponse();
        boolean ok5 = interceptor.beforeHandshake(
                requestWithUri(URI.create("ws://localhost:8080/ws/chat?token=" + URLEncoder.encode(expired, StandardCharsets.UTF_8))),
                responseProxy(r5), anyHandler, new HashMap<>());
        check("过期 token → 握手被拒绝且 401", !ok5 && r5.status == HttpStatus.UNAUTHORIZED);
    }

    // ---------- 入口 ----------

    public static void main(String[] args) {
        ChatModuleQaTest t = new ChatModuleQaTest();
        try {
            // v3：restoreDeleted 的 lambdaUpdate.set(...) 会在构建期急切解析实体列缓存，
            // 而本测试不启动 Spring/MyBatis-Plus，需手动初始化 TableInfo（列缓存）
            MapperBuilderAssistant assistant = new MapperBuilderAssistant(new MybatisConfiguration(), "");
            TableInfoHelper.initTableInfo(assistant, ChatConversation.class);
            TableInfoHelper.initTableInfo(assistant, ChatConversationMember.class);
            t.testSanitizeContent();
            t.testPreview();
            t.testGetOrCreateConversation();
            t.testInsertMessageIdempotent();
            t.testFrames();
            t.testWsAuthInterceptor();
        } catch (Exception e) {
            System.out.println("[ERROR] 测试执行异常: " + e);
            e.printStackTrace(System.out);
            t.failures.add("执行异常: " + e);
        }
        int total = t.passed + t.failures.size();
        System.out.println("\n================ ChatModuleQaTest 结果 ================");
        System.out.println("Total: " + total + " | Passed: " + t.passed + " | Failed: " + t.failures.size());
        if (!t.failures.isEmpty()) {
            System.out.println("失败项:");
            t.failures.forEach(f -> System.out.println("  - " + f));
            System.exit(1);
        }
        System.out.println("ALL PASSED");
    }
}
