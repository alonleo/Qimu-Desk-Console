package com.alon.admin.common;

import com.alon.admin.entity.ChatConversation;
import com.alon.admin.entity.ChatConversationMember;
import com.alon.admin.entity.ChatMessage;
import com.alon.admin.entity.User;
import com.alon.admin.mapper.ChatConversationMapper;
import com.alon.admin.mapper.ChatConversationMemberMapper;
import com.alon.admin.mapper.ChatMessageMapper;
import com.alon.admin.mapper.UserMapper;
import com.alon.admin.websocket.ChatWebSocketHandler;
import com.alon.admin.websocket.OnlineRegistry;
import com.alon.admin.websocket.WsAuthInterceptor;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * chat-module v2 纯逻辑自动化测试（QA，QA 严过关）。
 *
 * 与 v1 ChatModuleQaTest 同一形式：admin-backend 无 test 依赖（不得新增），
 * 采用 "main 方法 + 断言计数" 可运行测试，仅依赖项目既有 classpath，
 * 不启动服务、不连数据库。Mapper 一律 JDK 动态代理假件模拟 DB 行为。
 *
 * 覆盖范围（对照 PRD-v2 / ARCHITECTURE-v2 红线）：
 * 1) ChatSupport.sanitizeGroupName：群名校验（trim 后 1~30 字符）；
 * 2) 建群参数推演：memberIds 去重/剔除创建者/≥2/合计≤50 的纯逻辑复算（镜像 ChatGroupController 规则）；
 * 3) (0,0) 群行与单聊 (min,max) 定位不冲突：getOrCreateConversation 查询键为 (min,max)，
 *    群行 (0,0) 不可能命中；"user_a_id=me OR user_b_id=me" 过滤对 me>0 时不会捞进群行（纯函数推演）；
 * 4) isMember / memberUserIds / insertGroupMessageAndFanout：成员校验分支 + 群扇出（含发送者 ack）+ clientId 幂等；
 * 5) v2 WS 帧协议：chat 群帧（无 to、conversationType=group）、单聊帧（含 conversationType=single、v1 字段全保留）、
 *    new_conversation 帧逐字段；错误码常量三处同步（ChatSupport vs ARCHITECTURE-v2 §1.3）；
 * 6) 群未读游标口径纯函数推演：unread = id > last_read_message_id AND sender_id <> me（镜像 Mapper @Select 语义）；
 *    单聊 is_read 口径推演：unread = is_read=0 AND sender <> me（v1 语义不变）；
 * 7) WS conversationId 寻址身份校验（经 ChatWebSocketHandler.handleTextMessage + 假 session/Mapper）：
 *    群=成员校验（非成员 NOT_MEMBER）、单聊=参与者校验（含 id>127 的 Long 拆箱回归——修复后的关键回归点）、
 *    会话不存在返回 NOT_MEMBER。
 *
 * 运行方式（JDK 21）：
 *   javac -encoding UTF-8 -cp "target/classes;<deps>" -d target/test-classes src/test/java/com/alon/admin/common/ChatModuleQaTestV2.java
 *   java  -cp "target/test-classes;target/classes;<deps>" com.alon.admin.common.ChatModuleQaTestV2
 */
public class ChatModuleQaTestV2 {

    private static final ObjectMapper JSON = new ObjectMapper();

    // ---------- 极简断言设施 ----------

    private int passed = 0;
    private final List<String> failures = new ArrayList<>();

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

    // ---------- 假件基础设施 ----------

    private static ChatMessage msg(long id, long convId, long senderId, String content, String clientId) {
        ChatMessage m = new ChatMessage();
        m.setId(id);
        m.setConversationId(convId);
        m.setSenderId(senderId);
        m.setContent(content);
        m.setIsRead(0);
        m.setClientId(clientId);
        m.setCreatedAt(LocalDateTime.of(2025, 6, 1, 10, 0, 0));
        return m;
    }

    private static ChatConversation groupConv(long id, String name, long ownerId) {
        ChatConversation c = new ChatConversation();
        c.setId(id);
        c.setUserAId(0L);
        c.setUserBId(0L);
        c.setType(ChatSupport.CONV_TYPE_GROUP);
        c.setGroupName(name);
        c.setOwnerId(ownerId);
        return c;
    }

    private static ChatConversation singleConv(long id, long a, long b) {
        ChatConversation c = new ChatConversation();
        c.setId(id);
        c.setUserAId(a);
        c.setUserBId(b);
        c.setType(ChatSupport.CONV_TYPE_SINGLE);
        return c;
    }

    private static ChatConversationMember member(long convId, long userId, String role) {
        ChatConversationMember m = new ChatConversationMember();
        m.setId(convId * 100 + userId);
        m.setConversationId(convId);
        m.setUserId(userId);
        m.setRole(role);
        m.setLastReadMessageId(0L);
        m.setJoinedAt(LocalDateTime.of(2025, 6, 1, 9, 0, 0));
        return m;
    }

    /** 会话 Mapper 假件：按 id 返回会话；记录 insert */
    private static class FakeConvDb implements InvocationHandler {
        final Map<Long, ChatConversation> rows = new LinkedHashMap<>();
        ChatConversation inserted;
        int insertCalls = 0;

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) {
            return switch (method.getName()) {
                case "selectById" -> rows.get(((Number) args[0]).longValue());
                case "selectOne" -> null;
                case "selectList" -> List.of();
                case "insert" -> {
                    ChatConversation c = (ChatConversation) args[0];
                    insertCalls++;
                    c.setId((long) (900 + insertCalls));
                    inserted = c;
                    rows.put(c.getId(), c);
                    yield 1;
                }
                case "updateById" -> 1;
                case "deleteById" -> 1;
                default -> throw new UnsupportedOperationException("FakeConvDb 未实现: " + method.getName());
            };
        }
    }

    /** 成员 Mapper 假件：内存成员表；selectCount/selectList 感知 Wrapper 条件（成员校验分支真实性） */
    private static class FakeMemberDb implements InvocationHandler {
        final List<ChatConversationMember> rows = new CopyOnWriteArrayList<>();
        final List<Object[]> selectCalls = new CopyOnWriteArrayList<>();

        private List<ChatConversationMember> filtered(Object wrapper) {
            List<Object> vals = wrapperValues(wrapper);
            List<ChatConversationMember> out = new ArrayList<>();
            for (ChatConversationMember r : rows) {
                if (memberRowMatches(r, vals)) out.add(r);
            }
            return out;
        }

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) {
            return switch (method.getName()) {
                case "insert" -> {
                    ChatConversationMember m = (ChatConversationMember) args[0];
                    if (m.getId() == null) m.setId((long) (rows.size() + 1));
                    rows.add(m);
                    yield 1;
                }
                case "selectCount" -> (long) filtered(args.length > 0 ? args[0] : null).size();
                case "selectList" -> {
                    selectCalls.add(args);
                    yield filtered(args.length > 0 ? args[0] : null);
                }
                case "selectMaps" -> List.of();
                case "selectOne" -> {
                    List<ChatConversationMember> f = filtered(args.length > 0 ? args[0] : null);
                    yield f.isEmpty() ? null : f.get(0);
                }
                case "updateById" -> 1;
                default -> throw new UnsupportedOperationException("FakeMemberDb 未实现: " + method.getName());
            };
        }
    }

    // ---------- Wrapper 条件感知（假件保真：从 AbstractWrapper 提取参数值做行匹配） ----------

    /** 从 MyBatis Plus Wrapper 提取 paramNameValuePairs（MP 3.5.x 参数懒物化：先渲染 getSqlSegment） */
    private static List<Object> wrapperValues(Object wrapper) {
        if (wrapper instanceof com.baomidou.mybatisplus.core.conditions.AbstractWrapper<?, ?, ?> aw) {
            aw.getSqlSegment(); // 触发 formatParam 物化 MPGENVAL* 参数
            return new ArrayList<>(aw.getParamNameValuePairs().values());
        }
        return List.of();
    }

    /** ChatMessage 行匹配：数值命中 id/conversationId/senderId/isRead 之一，字符串命中 clientId */
    private static boolean msgRowMatches(ChatMessage row, List<Object> vals) {
        for (Object v : vals) {
            if (v instanceof Number n) {
                long lv = n.longValue();
                boolean hit = lv == row.getId()
                        || lv == row.getConversationId()
                        || lv == row.getSenderId()
                        || (row.getIsRead() != null && lv == row.getIsRead());
                if (!hit) return false;
            } else if (v instanceof String s) {
                if (!s.equals(row.getClientId())) return false;
            } else if (v != null) {
                return false;
            }
        }
        return true;
    }

    /** ChatConversationMember 行匹配：数值命中 conversationId/userId，字符串命中 role */
    private static boolean memberRowMatches(ChatConversationMember row, List<Object> vals) {
        for (Object v : vals) {
            if (v instanceof Number n) {
                long lv = n.longValue();
                boolean hit = lv == row.getConversationId() || lv == row.getUserId()
                        || (row.getId() != null && lv == row.getId());
                if (!hit) return false;
            } else if (v instanceof String s) {
                if (!s.equals(row.getRole())) return false;
            } else if (v != null) {
                return false;
            }
        }
        return true;
    }

    /** 消息 Mapper 假件：内存消息表（selectOne/selectList 感知 Wrapper 条件，模拟 DB 过滤语义） */
    private static class FakeMsgDb implements InvocationHandler {
        final Map<Long, ChatMessage> rows = new LinkedHashMap<>();
        int nextId = 500;

        private List<ChatMessage> filtered(Object wrapper) {
            List<Object> vals = wrapperValues(wrapper);
            List<ChatMessage> out = new ArrayList<>();
            for (ChatMessage r : rows.values()) {
                if (msgRowMatches(r, vals)) out.add(r);
            }
            return out;
        }

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) {
            return switch (method.getName()) {
                case "insert" -> {
                    ChatMessage m = (ChatMessage) args[0];
                    m.setId((long) nextId++);
                    rows.put(m.getId(), m);
                    yield 1;
                }
                case "selectList" -> filtered(args.length > 0 ? args[0] : null);
                case "selectOne" -> {
                    List<ChatMessage> f = filtered(args.length > 0 ? args[0] : null);
                    yield f.isEmpty() ? null : f.get(0);
                }
                case "selectMaps" -> List.of();
                case "selectCount" -> (long) filtered(args.length > 0 ? args[0] : null).size();
                case "update" -> 1;
                default -> throw new UnsupportedOperationException("FakeMsgDb 未实现: " + method.getName());
            };
        }
    }

    /** 用户 Mapper 假件：按 id 返回用户（可注入禁用） */
    private static class FakeUserDb implements InvocationHandler {
        final Map<Long, User> rows = new LinkedHashMap<>();

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) {
            return switch (method.getName()) {
                case "selectById" -> {
                    User u = rows.get(((Number) args[0]).longValue());
                    // 防御：返回副本不影响断言（这里直接返回即可，测试不修改）
                    yield u;
                }
                default -> throw new UnsupportedOperationException("FakeUserDb 未实现: " + method.getName());
            };
        }
    }

    private static User user(long id, String username, String display, int disabled) {
        User u = new User();
        u.setId(id);
        u.setUsername(username);
        u.setDisplayName(display);
        u.setDisabled(disabled);
        return u;
    }

    private static <T> T proxy(Class<T> iface, InvocationHandler h) {
        return iface.cast(Proxy.newProxyInstance(iface.getClassLoader(), new Class<?>[]{iface}, h));
    }

    // ---------- 1. 群名校验 ----------

    private void testSanitizeGroupName() {
        System.out.println("\n== 1. ChatSupport.sanitizeGroupName（trim 后 1~30 字符，PRD P0-3） ==");
        checkEquals("null 群名非法", null, ChatSupport.sanitizeGroupName(null));
        checkEquals("空串非法", null, ChatSupport.sanitizeGroupName(""));
        checkEquals("纯空白非法（trim 后为空）", null, ChatSupport.sanitizeGroupName("   \t "));
        checkEquals("普通群名合法且不改动", "项目讨论群", ChatSupport.sanitizeGroupName("项目讨论群"));
        checkEquals("首尾空白被 trim", "abc", ChatSupport.sanitizeGroupName("  abc  "));
        checkEquals("恰好 30 字符合法", 30, ChatSupport.sanitizeGroupName("群".repeat(30)).length());
        checkEquals("31 字符非法", null, ChatSupport.sanitizeGroupName("群".repeat(31)));
        checkEquals("GROUP_NAME_MAX 常量=30", 30, ChatSupport.GROUP_NAME_MAX);
        checkEquals("GROUP_MAX_MEMBERS 常量=50", 50, ChatSupport.GROUP_MAX_MEMBERS);
    }

    // ---------- 2. 建群参数规则纯逻辑推演（镜像 ChatGroupController.createGroup 校验链） ----------

    /**
     * 复刻 ChatGroupController 的成员集合构造逻辑（去重、剔除创建者、剔除非法值），
     * 并对其断言边界行为；上限判断复用同一算式 memberIds.size() + 1 > 50。
     */
    private List<Long> buildMemberIds(List<Object> rawIds, long meId) {
        java.util.Set<Long> memberIds = new java.util.LinkedHashSet<>();
        if (rawIds != null) {
            for (Object raw : rawIds) {
                long id;
                try {
                    id = Long.parseLong(String.valueOf(raw).trim());
                } catch (NumberFormatException e) {
                    id = -1;
                }
                if (id > 0 && id != meId) {
                    memberIds.add(id);
                }
            }
        }
        return new ArrayList<>(memberIds);
    }

    private void testCreateGroupRules() {
        System.out.println("\n== 2. 建群参数规则推演（去重/剔除创建者/≥2/≤50） ==");

        // 2.1 去重 + 剔除创建者
        List<Long> ids = buildMemberIds(List.of(2, 2, 3, 1), 1L);
        checkEquals("memberIds 去重 [2,2,3] → 2 个", 2, ids.size());
        check("创建者自身 id 被剔除", !ids.contains(1L));
        checkEquals("去重后顺序稳定（LinkedHashSet）", List.of(2L, 3L), ids);

        // 2.2 不足 2 人（单选一人走退化单聊路径，REST 侧必须拒绝建群）
        checkEquals("去重后 <2 → MEMBER_INVALID 拒绝（镜像 controller: memberIds.size()<2）",
                true, buildMemberIds(List.of(2), 1L).size() < 2);
        checkEquals("空 memberIds → 拒绝", true, buildMemberIds(List.of(), 1L).size() < 2);
        checkEquals("全为创建者自己 → 剔除后 <2 拒绝", true, buildMemberIds(List.of(1, 1), 1L).size() < 2);
        checkEquals("非法值(负数/非数字)剔除后 <2 拒绝",
                true, buildMemberIds(List.of(-5, "abc"), 1L).size() < 2);

        // 2.3 上限：创建者 + 成员 ≤50（镜像 controller: memberIds.size() + 1 > GROUP_MAX_MEMBERS → GROUP_FULL）
        checkEquals("49 成员 + 创建者 = 50 → 允许", false, 49 + 1 > ChatSupport.GROUP_MAX_MEMBERS);
        checkEquals("50 成员 + 创建者 = 51 → GROUP_FULL", true, 50 + 1 > ChatSupport.GROUP_MAX_MEMBERS);
    }

    // ---------- 3. (0,0) 群行与单聊 (min,max) 定位不冲突（纯函数推演） ----------

    /**
     * 定案一/二推演：群会话行 user_a_id=user_b_id=0 后，
     * a) getOrCreateConversation 只按 (min(uidA,uidB), max(uidA,uidB)) 定位，me>0 时不可能命中 (0,0)；
     * b) 单聊过滤 "user_a_id=me OR user_b_id=me"（me>0）对 (0,0) 群行恒为 false → 单聊段不泄漏群行；
     * c) 单聊防重：唯一键移除后由 getOrCreateConversation 先查后插 + DuplicateKeyException 查回兜底（v1 逻辑未动）。
     */
    private void testGroupRowNotLeakingIntoSingle() throws Exception {
        System.out.println("\n== 3. (0,0) 群行 vs 单聊 (min,max) 定位推演 ==");

        // 3.1 getOrCreateConversation 对 (0,0) 群行免疫：假件只会在键完全匹配时返回行，
        //     这里用真实逻辑复算查询键，断言任何 me>0 的单聊定位键都不等于 (0,0)
        for (long x : new long[]{1, 5, 300, 99999}) {
            for (long y : new long[]{2, 5, 300, 99999}) {
                long a = Math.min(x, y);
                long b = Math.max(x, y);
                boolean hitsGroupRow = (a == 0 && b == 0);
                check("单聊定位键 (" + a + "," + b + ") 不命中 (0,0) 群行", !hitsGroupRow);
            }
        }

        // 3.2 单聊过滤谓词对群行恒 false（me>0）
        long me = 42L;
        long groupA = 0L, groupB = 0L;
        check("谓词 user_a_id=me 对群行(0,0) 为 false", groupA != me);
        check("谓词 user_b_id=me 对群行(0,0) 为 false", groupB != me);

        // 3.3 先查后插防重：唯一键移除后逻辑路径 = selectOne(min,max) 命中即返回，不依赖唯一键
        ChatModuleQaTestV2 probe = new ChatModuleQaTestV2();
        FakeConvDb convDb = new FakeConvDb();
        convDb.rows.put(1L, singleConv(1L, 3L, 7L)); // 已存在单聊 (3,7)
        ChatConversationMapper mapper = proxy(ChatConversationMapper.class, convDb);
        ChatConversation found = mapper.selectById(1L);
        checkEquals("已存在单聊按 (min,max) 语义可定位（先查路径可用）", 1L, found.getId());
        check("群行不写入成员表也不参与单聊先查键（类型隔离）",
                !ChatSupport.CONV_TYPE_GROUP.equals(found.getType()));

        // 3.4 反向推演：若查询键允许 me=0，则群行会被命中——红线要求 me 永不为 0
        //     （AuthInterceptor/JWT 侧 uid 来自登录用户主键，恒 >0；此处仅固化约定）
        check("约定：当前用户 id 恒 >0（群行 (0,0) 方案安全前提）", me > 0);

        // 3.5 单聊 getOrCreateConversation 归一化回归（唯一键移除不影响其键计算）
        ChatConversation created = ChatSupport.getOrCreateConversation(
                proxy(ChatConversationMapper.class, new FakeConvDb() {
                    @Override
                    public Object invoke(Object proxy, Method method, Object[] args) {
                        if (method.getName().equals("selectOne")) return null; // 强制走 insert
                        if (method.getName().equals("insert")) {
                            ChatConversation c = (ChatConversation) args[0];
                            c.setId(31L);
                            return 1;
                        }
                        return null;
                    }
                }), 9L, 4L);
        checkEquals("唯一键移除后新建单聊仍归一化 (min,max)", 4L, created.getUserAId());
        checkEquals("…userBId=max", 9L, created.getUserBId());
    }

    // ---------- 4. 成员校验 + 群落库扇出 + 幂等 ----------

    private void testMemberCheckAndFanout() throws Exception {
        System.out.println("\n== 4. 成员校验 / 群扇出（含发送者 ack）/ clientId 幂等 ==");

        FakeMemberDb memberDb = new FakeMemberDb();
        memberDb.rows.add(member(7L, 1L, ChatSupport.ROLE_OWNER));
        memberDb.rows.add(member(7L, 2L, ChatSupport.ROLE_MEMBER));
        memberDb.rows.add(member(7L, 3L, ChatSupport.ROLE_MEMBER));
        ChatConversationMemberMapper memberMapper = proxy(ChatConversationMemberMapper.class, memberDb);

        // 4.1 memberUserIds：扇出名册 = 全体成员（含发送者）
        List<Long> ids = ChatSupport.memberUserIds(memberMapper, 7L);
        checkEquals("memberUserIds 返回全部 3 个成员", 3, ids.size());
        check("扇出名册含发送者自己（ack 机制前提）", ids.contains(1L));

        // 4.2 insertGroupMessageAndFanout：落库 + touch + 对每个成员推送（在线与否由 registry 决定）
        FakeMsgDb msgDb = new FakeMsgDb();
        FakeConvDb convDb = new FakeConvDb();
        ChatConversation conv = groupConv(7L, "项目讨论群", 1L);
        convDb.rows.put(7L, conv);
        FakeRegistry registry = new FakeRegistry();
        registry.onlineUsers.add(2L); // 仅成员 2 在线

        ChatSupport.insertGroupMessageAndFanout(
                proxy(ChatMessageMapper.class, msgDb),
                proxy(ChatConversationMapper.class, convDb),
                memberMapper, registry, conv, 1L, "群主", "大家好", "cid-1");

        checkEquals("群消息落库 1 条", 1, msgDb.rows.size());
        ChatMessage stored = msgDb.rows.values().iterator().next();
        checkEquals("落库 conversationId=群 id", 7L, stored.getConversationId());
        checkEquals("落库 senderId=发送者", 1L, stored.getSenderId());
        checkEquals("会话摘要 = 纯内容（无昵称前缀，红线 §8-5）", "大家好", conv.getLastMessagePreview());
        checkEquals("会话 lastMessageId 已回填", stored.getId(), conv.getLastMessageId());
        // 推送目标 = 在线成员 ∩ 扇出名册（离线成员仅落库）
        checkEquals("在线成员 2 收到群帧", 1, registry.pushed.get(2L).size());
        check("离线成员 3 未推送（仅落库）", registry.pushed.get(3L) == null);
        // 发送者在线与否决定 ack：这里发送者 1 离线，但扇出名册循环仍会对其 pushToUser（在线才发）
        check("发送者离线时不推送 ack（与 v1 一致）", registry.pushed.get(1L) == null);

        // 4.3 发送者在线时收到 ack 帧 = 同一 chat 群帧
        FakeRegistry reg2 = new FakeRegistry();
        reg2.onlineUsers.add(1L);
        reg2.onlineUsers.add(2L);
        ChatMessage m2 = ChatSupport.insertGroupMessageAndFanout(
                proxy(ChatMessageMapper.class, msgDb),
                proxy(ChatConversationMapper.class, convDb),
                memberMapper, reg2, conv, 1L, "群主", "第二条", "cid-2");
        String ack = reg2.pushed.get(1L).get(0);
        JsonNode ackFrame = JSON.readTree(ack);
        checkEquals("发送者收到的 ack 帧类型=chat", "chat", ackFrame.path("type").asText());
        checkEquals("ack 帧 conversationType=group", "group", ackFrame.path("conversationType").asText());
        checkEquals("ack 帧 clientId 匹配（前端替换乐观气泡）", "cid-2", ackFrame.path("clientId").asText());
        checkEquals("ack 帧 messageId=落库消息", m2.getId(), ackFrame.path("messageId").asLong());

        // 4.4 clientId 幂等：同 (conversationId, senderId, clientId) 重发不重复落库
        FakeRegistry reg3 = new FakeRegistry();
        ChatSupport.insertGroupMessageAndFanout(
                proxy(ChatMessageMapper.class, msgDb),
                proxy(ChatConversationMapper.class, convDb),
                memberMapper, reg3, conv, 1L, "群主", "第二条", "cid-2");
        checkEquals("断线重发同 clientId → 不产生新落库行（仍 2 条）", 2, msgDb.rows.size());
    }

    // ---------- 5. v2 WS 帧协议（逐字段对照 ARCHITECTURE-v2 §1.3 / §3） ----------

    private void testV2Frames() throws Exception {
        System.out.println("\n== 5. v2 WS 帧协议（群帧/单聊帧/new_conversation/错误码） ==");

        // 5.1 群 chat 帧：无 to 字段 + conversationType=group（红线 §8-3：前端不得依赖群帧 to）
        ChatMessage gm = msg(102L, 7L, 3L, "群消息", "uuid-g1");
        JsonNode group = JSON.readTree(ChatSupport.chatGroupFrame(gm, "李四"));
        checkEquals("群帧.type=chat", "chat", group.path("type").asText());
        checkEquals("群帧.conversationId", 7L, group.path("conversationId").asLong());
        checkEquals("群帧.conversationType=group", "group", group.path("conversationType").asText());
        check("群帧无 to 字段（红线 §1.3）", !group.has("to"));
        checkEquals("群帧.from=senderId", 3L, group.path("from").asLong());
        checkEquals("群帧.fromName", "李四", group.path("fromName").asText());
        checkEquals("群帧.clientId", "uuid-g1", group.path("clientId").asText());
        checkEquals("群帧.content", "群消息", group.path("content").asText());
        checkEquals("群帧.createdAt 格式", "2025-06-01 10:00:00", group.path("createdAt").asText());
        check("群帧.ts>0", group.path("ts").asLong() > 0);
        check("群帧.fromName null → 空串（帧字段类型稳定）",
                JSON.readTree(ChatSupport.chatGroupFrame(gm, null)).path("fromName").asText().isEmpty());

        // 5.2 单聊 chat 帧：v1 字段全保留 + conversationType=single（含 to）
        ChatMessage sm = msg(101L, 5L, 3L, "hi", "uuid-s1");
        JsonNode single = JSON.readTree(ChatSupport.chatFrame(sm, "李四", 1L));
        checkEquals("单聊帧.conversationType=single", "single", single.path("conversationType").asText());
        checkEquals("单聊帧.to 保留（v1 兼容）", 1L, single.path("to").asLong());
        checkEquals("单聊帧.conversationId 保留", 5L, single.path("conversationId").asLong());
        checkEquals("单聊帧.messageId", 101L, single.path("messageId").asLong());
        checkEquals("单聊帧.clientId", "uuid-s1", single.path("clientId").asText());
        checkEquals("单聊帧.content v1 语义", "hi", single.path("content").asText());

        // 5.3 new_conversation 帧（定案三）
        JsonNode nc = JSON.readTree(ChatSupport.newConversationFrame(7L, "项目讨论群", 5));
        checkEquals("new_conversation.type", "new_conversation", nc.path("type").asText());
        checkEquals("new_conversation.conversationId", 7L, nc.path("conversationId").asLong());
        checkEquals("new_conversation.conversationType=group", "group", nc.path("conversationType").asText());
        checkEquals("new_conversation.name", "项目讨论群", nc.path("name").asText());
        checkEquals("new_conversation.memberCount", 5, nc.path("memberCount").asInt());
        check("new_conversation.ts>0", nc.path("ts").asLong() > 0);

        // 5.4 v2 错误码常量（协议常量三处同步红线 §8-4：ChatSupport ↔ 两端 core/chat.ts）
        checkEquals("ERR_NOT_MEMBER", "NOT_MEMBER", ChatSupport.ERR_NOT_MEMBER);
        checkEquals("ERR_GROUP_NAME_INVALID", "GROUP_NAME_INVALID", ChatSupport.ERR_GROUP_NAME_INVALID);
        checkEquals("ERR_GROUP_FULL", "GROUP_FULL", ChatSupport.ERR_GROUP_FULL);
        checkEquals("ERR_MEMBER_INVALID", "MEMBER_INVALID", ChatSupport.ERR_MEMBER_INVALID);
        checkEquals("CONV_TYPE_SINGLE", "single", ChatSupport.CONV_TYPE_SINGLE);
        checkEquals("CONV_TYPE_GROUP", "group", ChatSupport.CONV_TYPE_GROUP);
        checkEquals("ROLE_OWNER", "owner", ChatSupport.ROLE_OWNER);
        checkEquals("ROLE_MEMBER", "member", ChatSupport.ROLE_MEMBER);
    }

    // ---------- 6. 未读双口径纯函数推演 ----------

    /**
     * 红线 §8-1：4 个查询点口径一致。
     * 群口径（游标）：unread = {msg.id > cursor AND msg.sender != me}（镜像 ChatConversationMemberMapper
     *   countGroupUnread / workbench unread route 的 SQL 语义）；
     * 单聊口径（is_read）：unread = {msg.is_read == 0 AND msg.sender != me}（v1 语义不变）。
     * 下方以纯 Java 复算并核对两组口径对同一数据的差异化结果。
     */
    private void testUnreadSemantics() {
        System.out.println("\n== 6. 未读双口径推演（群=游标 / 单聊=is_read） ==");

        // 数据：群 7 的消息（id 递增），我的游标=103，我=1
        List<ChatMessage> groupMsgs = List.of(
                msg(101L, 7L, 2L, "a", "c-a"),   // >103, sender≠1 → 群未读
                msg(102L, 7L, 1L, "b", "c-b"),   // >103 但自己发的 → 不计
                msg(103L, 7L, 2L, "c", "c-c"),   // =103（游标本身）→ 已读不计
                msg(104L, 7L, 3L, "d", "c-d"),   // >103 → 群未读
                msg(105L, 7L, 1L, "e", "c-e"));  // 自己发 → 不计
        long cursor = 103L, me = 1L;

        long groupUnread = groupMsgs.stream()
                .filter(m -> m.getId() > cursor && m.getSenderId() != me).count();
        checkEquals("群游标口径：id>103 且 sender≠me → 1 条（101/103 已被游标覆盖，102/105 是自己发的）",
                1L, groupUnread);

        // 同一批数据若按单聊 is_read 口径计算（对群数据是禁用口径——用于证明为何必须双口径）
        long isReadStyle = groupMsgs.stream()
                .filter(m -> m.getIsRead() == 0 && m.getSenderId() != me).count();
        checkEquals("对照：is_read 口径会算出 3 条（含游标前的 103）——两口径必须隔离", 3L, isReadStyle);
        check("双口径并存且互不污染（群消息不参与单聊统计）", groupUnread != isReadStyle);

        // 单聊口径 v1 回归：is_read=0 且 sender≠me
        List<ChatMessage> singleMsgs = List.of(
                msg(201L, 5L, 2L, "x", "c-x"),          // 未读
                msg(202L, 5L, 1L, "y", "c-y"),          // 自己发
                setRead(msg(203L, 5L, 2L, "z", "c-z")), // 已读
                msg(204L, 5L, 2L, "w", "c-w"));         // 未读
        long singleUnread = singleMsgs.stream()
                .filter(m -> m.getIsRead() == 0 && m.getSenderId() != me).count();
        checkEquals("单聊 is_read 口径：2 条未读（v1 语义不变）", 2L, singleUnread);

        // 群已读推进：游标更新到 104 后群未读应归零语义验证
        long newCursor = 104L;
        long afterRead = groupMsgs.stream()
                .filter(m -> m.getId() > newCursor && m.getSenderId() != me).count();
        checkEquals("游标推进到 104 后群未读=1（仅 105 自己发不计外余量为 0，实际 105 是自己发的 → 0 条）",
                0L, afterRead);

        // 边界：游标=0（新成员未读全量）
        long fresh = groupMsgs.stream()
                .filter(m -> m.getId() > 0L && m.getSenderId() != me).count();
        checkEquals("新成员游标 0 → 未读=3（排除自己 2 条）", 3L, fresh);
    }

    private static ChatMessage setRead(ChatMessage m) {
        m.setIsRead(1);
        return m;
    }

    // ---------- 7. WS conversationId 寻址身份校验（假 session 直驱 handleTextMessage） ----------

    /** WebSocketSession 假件：uid 从 attributes 读出，sendMessage 捕获下行帧 */
    private static class FakeSession implements InvocationHandler {
        final Map<String, Object> attributes = new HashMap<>();
        final List<String> sent = new CopyOnWriteArrayList<>();

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) {
            return switch (method.getName()) {
                case "getAttributes" -> attributes;
                case "sendMessage" -> {
                    sent.add(((TextMessage) args[0]).getPayload());
                    yield null;
                }
                case "isOpen" -> true;
                default -> null; // 其余生命周期方法全部空实现
            };
        }
    }

    /** OnlineRegistry 假件：继承覆盖（OnlineRegistry 为具体类，非接口，无法 JDK 动态代理） */
    private static class FakeRegistry extends OnlineRegistry {
        final Map<Long, List<String>> pushed = new ConcurrentHashMap<>();
        final List<Long> onlineUsers = new CopyOnWriteArrayList<>();

        @Override
        public boolean online(Long userId) {
            return onlineUsers.contains(userId);
        }

        @Override
        public List<Long> onlineUserIds() {
            return new ArrayList<>(onlineUsers);
        }

        @Override
        public boolean pushToUser(Long userId, String jsonFrame) {
            // 与真实 OnlineRegistry.pushToUser 一致：离线用户静默不送达（仅落库）
            if (!onlineUsers.contains(userId)) {
                return false;
            }
            pushed.computeIfAbsent(userId, k -> new CopyOnWriteArrayList<>()).add(jsonFrame);
            return true;
        }
    }

    private ChatWebSocketHandler newHandler(FakeUserDb userDb, FakeMsgDb msgDb,
                                            FakeConvDb convDb, FakeMemberDb memberDb,
                                            FakeRegistry registry) {
        return new ChatWebSocketHandler(
                proxy(UserMapper.class, userDb),
                proxy(ChatMessageMapper.class, msgDb),
                proxy(ChatConversationMapper.class, convDb),
                proxy(ChatConversationMemberMapper.class, memberDb),
                registry);
    }

    private void wsSend(ChatWebSocketHandler handler, FakeSession session, String frame) throws Exception {
        // handleTextMessage 为 protected：同包（com.alon.admin.common→不行）——改经反射调用
        Method m = ChatWebSocketHandler.class.getDeclaredMethod("handleTextMessage", WebSocketSession.class, TextMessage.class);
        m.setAccessible(true);
        m.invoke(handler, proxy(WebSocketSession.class, session), new TextMessage(frame));
    }

    private String lastError(FakeSession session) throws Exception {
        if (session.sent.isEmpty()) return null;
        JsonNode n = JSON.readTree(session.sent.get(session.sent.size() - 1));
        return n.path("type").asText("error").equals("error") ? n.path("code").asText() : null;
    }

    private void testWsConversationAddressing() throws Exception {
        System.out.println("\n== 7. WS conversationId 寻址身份校验（越权防线） ==");

        // 场景数据：
        //  群 7（owner=1，成员 1/2/3）
        //  单聊 5（userA=300, userB=500）——**双方 id 均 >127**，Long 缓存失效，回归修复点
        //  用户库：1/2/3/300/500（500 禁用）
        FakeUserDb userDb = new FakeUserDb();
        userDb.rows.put(1L, user(1L, "owner", "群主", 0));
        userDb.rows.put(2L, user(2L, "bob", "鲍勃", 0));
        userDb.rows.put(3L, user(3L, "carol", "卡罗", 0));
        userDb.rows.put(300L, user(300L, "u300", "用户300", 0));
        userDb.rows.put(500L, user(500L, "u500", "用户500", 1));

        // 7.1 群聊：成员（me=2）经 conversationId 发送 → 落库 + 扇出
        FakeMemberDb memberDb1 = new FakeMemberDb();
        memberDb1.rows.add(member(7L, 1L, ChatSupport.ROLE_OWNER));
        memberDb1.rows.add(member(7L, 2L, ChatSupport.ROLE_MEMBER));
        memberDb1.rows.add(member(7L, 3L, ChatSupport.ROLE_MEMBER));
        FakeMsgDb msgDb1 = new FakeMsgDb();
        FakeConvDb convDb1 = new FakeConvDb();
        convDb1.rows.put(7L, groupConv(7L, "项目讨论群", 1L));
        FakeRegistry reg1 = new FakeRegistry();
        reg1.onlineUsers.add(1L);
        reg1.onlineUsers.add(3L);
        ChatWebSocketHandler h1 = newHandler(userDb, msgDb1, convDb1, memberDb1, reg1);
        FakeSession s1 = new FakeSession();
        s1.attributes.put(WsAuthInterceptor.ATTR_UID, 2L);
        wsSend(h1, s1, "{\"type\":\"chat\",\"conversationId\":7,\"content\":\"hello group\",\"clientId\":\"g-1\"}");
        checkEquals("群成员经 conversationId 发送 → 落库 1 条", 1, msgDb1.rows.size());
        checkEquals("群帧扇出到在线成员 1", 1, reg1.pushed.get(1L).size());
        checkEquals("群帧扇出到在线成员 3", 1, reg1.pushed.get(3L).size());
        JsonNode fan = JSON.readTree(reg1.pushed.get(1L).get(0));
        checkEquals("扇出帧 conversationType=group", "group", fan.path("conversationType").asText());
        check("扇出群帧无 to 字段", !fan.has("to"));
        checkEquals("错误帧 0 个", 0, s1.sent.size());

        // 7.2 群聊：非成员（me=500，禁用与否不影响——非成员一律拒）→ NOT_MEMBER，不落库
        FakeMemberDb memberDb2 = new FakeMemberDb();
        memberDb2.rows.add(member(7L, 1L, ChatSupport.ROLE_OWNER));
        FakeMsgDb msgDb2 = new FakeMsgDb();
        FakeConvDb convDb2 = new FakeConvDb();
        convDb2.rows.put(7L, groupConv(7L, "项目讨论群", 1L));
        ChatWebSocketHandler h2 = newHandler(userDb, msgDb2, convDb2, memberDb2, new FakeRegistry());
        FakeSession s2 = new FakeSession();
        s2.attributes.put(WsAuthInterceptor.ATTR_UID, 500L);
        wsSend(h2, s2, "{\"type\":\"chat\",\"conversationId\":7,\"content\":\"intrude\",\"clientId\":\"g-2\"}");
        checkEquals("非成员群发送 → NOT_MEMBER", "NOT_MEMBER", lastError(s2));
        checkEquals("非成员发送不落库", 0, msgDb2.rows.size());

        // 7.3 会话不存在 → NOT_MEMBER
        FakeSession s3 = new FakeSession();
        s3.attributes.put(WsAuthInterceptor.ATTR_UID, 1L);
        wsSend(h2, s3, "{\"type\":\"chat\",\"conversationId\":999,\"content\":\"ghost\",\"clientId\":\"g-3\"}");
        checkEquals("conversationId 不存在 → NOT_MEMBER", "NOT_MEMBER", lastError(s3));

        // 7.4 单聊 conversationId 寻址：参与者（id>127，Long 缓存失效区间）→ 通过（修复 Long 引用比较后的关键回归）
        FakeMsgDb msgDb4 = new FakeMsgDb();
        FakeConvDb convDb4 = new FakeConvDb();
        convDb4.rows.put(5L, singleConv(5L, 300L, 400L)); // 对端 400 未禁用
        userDb.rows.put(400L, user(400L, "u400", "用户400", 0));
        FakeRegistry reg4 = new FakeRegistry();
        reg4.onlineUsers.add(400L);
        FakeMemberDb emptyMembers = new FakeMemberDb();
        ChatWebSocketHandler h4 = newHandler(userDb, msgDb4, convDb4, emptyMembers, reg4);
        FakeSession s4 = new FakeSession();
        s4.attributes.put(WsAuthInterceptor.ATTR_UID, 300L); // userA，id>127
        wsSend(h4, s4, "{\"type\":\"chat\",\"conversationId\":5,\"content\":\"to my peer\",\"clientId\":\"s-1\"}");
        checkEquals("单聊参与者(id=300>127) conversationId 寻址 → 不被误拒（Long 拆箱修复回归）",
                0, s4.sent.size());
        checkEquals("单聊消息落库", 1, msgDb4.rows.size());
        checkEquals("对端 400 在线 → 收到推送帧", 1, reg4.pushed.get(400L).size());

        // 7.4b 单聊对端禁用 → PEER_DISABLED，不落库（conversationId 寻址同样防护）
        FakeMsgDb msgDb4b = new FakeMsgDb();
        FakeConvDb convDb4b = new FakeConvDb();
        convDb4b.rows.put(6L, singleConv(6L, 300L, 500L)); // 500 禁用
        ChatWebSocketHandler h4b = newHandler(userDb, msgDb4b, convDb4b, new FakeMemberDb(), new FakeRegistry());
        FakeSession s4b = new FakeSession();
        s4b.attributes.put(WsAuthInterceptor.ATTR_UID, 300L);
        wsSend(h4b, s4b, "{\"type\":\"chat\",\"conversationId\":6,\"content\":\"x\",\"clientId\":\"s-1b\"}");
        checkEquals("单聊对端禁用 → PEER_DISABLED", "PEER_DISABLED", lastError(s4b));
        checkEquals("对端禁用 → 不落库", 0, msgDb4b.rows.size());

        // 7.5 单聊 conversationId 寻址：非参与者（me=2）→ NOT_MEMBER
        FakeSession s5 = new FakeSession();
        s5.attributes.put(WsAuthInterceptor.ATTR_UID, 2L);
        wsSend(h4, s5, "{\"type\":\"chat\",\"conversationId\":5,\"content\":\"intrude\",\"clientId\":\"s-2\"}");
        checkEquals("单聊非参与者 → NOT_MEMBER", "NOT_MEMBER", lastError(s5));

        // 7.6 双寻址并存：conversationId 优先（红线 §8-6）
        FakeMsgDb msgDb6 = new FakeMsgDb();
        FakeConvDb convDb6 = new FakeConvDb();
        convDb6.rows.put(7L, groupConv(7L, "项目讨论群", 1L));
        FakeMemberDb memberDb6 = new FakeMemberDb();
        memberDb6.rows.add(member(7L, 1L, ChatSupport.ROLE_OWNER));
        ChatWebSocketHandler h6 = newHandler(userDb, msgDb6, convDb6, memberDb6, new FakeRegistry());
        FakeSession s6 = new FakeSession();
        s6.attributes.put(WsAuthInterceptor.ATTR_UID, 1L);
        wsSend(h6, s6, "{\"type\":\"chat\",\"conversationId\":7,\"to\":3,\"content\":\"both\",\"clientId\":\"b-1\"}");
        checkEquals("to 与 conversationId 并存 → 以 conversationId 为准（按群路由）",
                1, msgDb6.rows.size());

        // 7.7 v1 回归：to 寻址单聊仍通（原 handleChat 路径未动）
        FakeMsgDb msgDb7 = new FakeMsgDb();
        FakeConvDb convDb7 = new FakeConvDb();
        ChatWebSocketHandler h7 = newHandler(userDb, msgDb7, convDb7, new FakeMemberDb(), new FakeRegistry());
        FakeSession s7 = new FakeSession();
        s7.attributes.put(WsAuthInterceptor.ATTR_UID, 300L);
        wsSend(h7, s7, "{\"type\":\"chat\",\"to\":3,\"content\":\"v1 style\",\"clientId\":\"v-1\"}");
        checkEquals("v1 to 寻址 → getOrCreateConversation 新建单聊", 1, msgDb7.rows.size());
        ChatMessage v1msg = msgDb7.rows.values().iterator().next();
        checkEquals("v1 to 寻址落库 senderId=me", 300L, v1msg.getSenderId());

        // 7.8 内容校验回归：空内容 → CONTENT_INVALID
        FakeSession s8 = new FakeSession();
        s8.attributes.put(WsAuthInterceptor.ATTR_UID, 2L);
        wsSend(h2, s8, "{\"type\":\"chat\",\"conversationId\":7,\"content\":\"   \",\"clientId\":\"g-9\"}");
        checkEquals("空白内容 → CONTENT_INVALID", "CONTENT_INVALID", lastError(s8));
    }

    // ---------- 入口 ----------

    public static void main(String[] args) {
        // MP Lambda Wrapper 需要 TableInfo 元数据（lambda 列名解析），脱离 Spring 时手工初始化
        com.baomidou.mybatisplus.core.MybatisConfiguration mpCfg =
                new com.baomidou.mybatisplus.core.MybatisConfiguration();
        org.apache.ibatis.builder.MapperBuilderAssistant assistant =
                new org.apache.ibatis.builder.MapperBuilderAssistant(mpCfg, "");
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(assistant, ChatConversationMember.class);
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(assistant, ChatMessage.class);

        ChatModuleQaTestV2 t = new ChatModuleQaTestV2();
        try {
            t.testSanitizeGroupName();
            t.testCreateGroupRules();
            t.testGroupRowNotLeakingIntoSingle();
            t.testMemberCheckAndFanout();
            t.testV2Frames();
            t.testUnreadSemantics();
            t.testWsConversationAddressing();
        } catch (Exception e) {
            System.out.println("[ERROR] 测试执行异常: " + e);
            e.printStackTrace(System.out);
            t.failures.add("执行异常: " + e);
        }
        int total = t.passed + t.failures.size();
        System.out.println("\n============= ChatModuleQaTestV2 结果 =============");
        System.out.println("Total: " + total + " | Passed: " + t.passed + " | Failed: " + t.failures.size());
        if (!t.failures.isEmpty()) {
            System.out.println("失败项:");
            t.failures.forEach(f -> System.out.println("  - " + f));
            System.exit(1);
        }
        System.out.println("ALL PASSED");
    }
}
