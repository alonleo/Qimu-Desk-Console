> 历史设计与验证记录：自动保存产物功能现已移除（包括开关、持久化状态、请求参数和聊天接口自动入库分支）。当前仅支持草稿手动保存，下文涉及自动保存的描述不再适用。

# QA-REPORT — AI 产物「创建即入库」独立验证

- 验证人：严过关（Edward / QA Engineer）
- 验证时间：2026-09-03
- 验证方式：fresh eyes，不信任工程师自检，逐项亲测/亲读
- 被测版本：alon-workbench（前台）+ admin-platform（后台共享 MySQL `qimu_platform`）

---

## 0. 环境限制声明（先读）

- 本机 `127.0.0.1:3306` 的 MySQL **root/空密码被拒绝** → **所有需要 DB 的集成验证标记 BLOCKED**（迁移幂等、落库、409/1062、overwrite、三中心刷新、后台联调均无法在本机实测）。
- 已用三类替代手段覆盖：① 编译/类型门禁（全绿）；② 纯逻辑单元测试（67/67 绿 + 缺陷探针 2 violations）；③ 逐文件代码审读（给出 PASS/FAIL 结论）。
- 后端 Java 编译：`mvnw`/`mvn` 启动器均损坏（classworlds 缺类），改为 classworlds 直启 + JDK21 编译 **成功（EXIT=0）**；另直接 javac 因本地仓库存在新旧两套 Spring 版本（5.2/3.2）混入 classpath 而误报，**非源码缺陷**，以 classworlds/maven 编译结果为准。

---

## 1. 编译 / 类型门禁

| # | 项目 | 命令 | 结果 | 证据 |
|---|---|---|---|---|
| C1 | 前台 alon-workbench | `npx tsc --noEmit` | ✅ PASS | EXIT=0，0 行错误 |
| C2 | 后台前端 admin-platform | `npx tsc --noEmit` | ✅ PASS | EXIT=0，0 行错误 |
| C3 | 后台后端 admin-backend | JDK21 + classworlds 直启 maven `compile` | ✅ PASS | EXIT=0（详见 §0） |

---

## 2. 纯逻辑单元测试（无需 DB）

脚本位置：`F:\WorkSapce\workbench\alon-workbench\scripts\qa-ai-integration\`
- `run-artifacts-tests.mjs` —— 干净断言套件
- `probe-artifacts-bugs.mjs` —— 已知缺陷探针（记录违规，恒 exit 0）

做法说明：`core/ai/artifacts.ts`、`core/skills.ts` 的模块 import 链重（`../skills`→db→mysql2 且路径无 `.ts` 扩展，Node ESM 无法直读）。为**测试真实源码而非重写实现**，脚本读取源文件文本，仅把写库/执行器侧 import 替换为桩（桩若被调用即抛错），其余（函数体、zod schema、类型）逐字节保留，生成临时 `.ts` 后经 `--experimental-strip-types` 导入断言。

### 结果：passed = 67，failed = 0（15 组）

| 组 | 覆盖点 | 断言 | 结果 |
|---|---|---|---|
| T1 | `<artifacts>` 多产物解析、reply 清洗、key 分配、skipped 空 | 7 | ✅ |
| T2 | 标签内带 ```json 围栏（容错） | 2 | ✅ |
| T3 | 无标签时退而找 ```json 围栏（真产物数组） | 2 | ✅ |
| T4 | 坏 JSON → drafts=[]、reply 非空回落 | 3 | ✅ |
| T5 | 合法空数组 → drafts=[]、skipped=[] | 3 | ✅ |
| T6 | kind 非法/字段缺失 → 丢弃+skipped；全丢回复追加人话；混合保留合法项 | 7 | ✅ |
| T7 | reply 不含 `<artifacts>`/` ``` ` 残留 | 2 | ✅ |
| T8 | normalizeDraft 合法 skill、key 空由上层分配、完整 http 无 issues | 5 | ✅ |
| T9 | workflow 缺 steps/skill type 非法/title 超 200/name 空白 → skipped | 4 | ✅ |
| T10 | name 数字开头放行（对齐 Spring `[a-z0-9]...`） | 1 | ✅ |
| T11 | issues 轻量提示（http 缺 url、knowledge 空正文） | 2 | ✅ |
| T12 | `normalizeSourceValue`：ai→ai/file→file/admin→manual/未知→manual/null→manual/大写 AI→manual；`isSourceMarker` 边界 | 11 | ✅ |
| T13 | `parseParam`/`validateSkillParams`：合法/数字开头拒/连字符拒/非数组 error/undefined 通过 | 8 | ✅ |
| T14 | 纯问答无标签 → drafts=[]、reply 原样、skipped=[] | 3 | ✅ |
| T15 | `createSkill` 预 DB 校验：name/type/config/params 非法 → invalid（不触 DB）；合法 → 到达 DB 写库桩（证路径放行） | 7 | ✅ |

### 缺陷探针（记录真实源码缺陷，详见 §4）

| 探针 | 期望（架构 §3.2） | 实际（violation） |
|---|---|---|
| A1 | 纯问答正文含 ```json **对象示例**（无 `<artifacts>`）时 reply 应保持原文完整 | reply 在首个 ```json 前被截断，示例及后续文字丢失 |
| A2 | 纯问答含 ```json **字符串数组示例**（非产物）应回落原文 | reply 被截断且追加噪音「（未能生成结构化产物：…）」 |

---

## 3. 代码审读结论（DB 不可达，以审读代替集成测试）

| 项 | 结论 | 证据/说明 |
|---|---|---|
| createSkill name 正则 `^[a-z0-9][a-z0-9-]*$` | ✅ PASS | `core/skills.ts:105 CREATE_NAME_RE`，数字开头兼容（架构 §0.2） |
| createSkill type/config/params 深校验 | ✅ PASS | `buildSkillConfig` shell.command/prompt.template/http.url 必填；params 逐条 name 合法（T15 实测） |
| createSkill duplicate 顺序：先 SELECT 再 INSERT+1062 兜底 | ✅ PASS | `findSkillByName` → INSERT try/catch `isDuplicateKeyError` → duplicate+回查 existing；`isBadFieldError`→`ensureSourceColumns` 自愈 |
| overwrite 语义：UPDATE type/description/config/source | ✅ PASS | skills: `UPDATE type,description,config,source`；workflows: `version=version+1`+definition/source |
| source 列写入与 JSON 冗余一致 | ✅ PASS | INSERT/UPDATE 均写列；config/definition JSON 内冗余 `source`（后台旧逻辑兼容，权威为列） |
| skills POST：mode/source 白名单、400 VALIDATION_ERROR、409 NAME_CONFLICT+existing、200 `{ok:true,...}` | ✅ PASS | `app/api/skills/route.ts:53-86` |
| workflows POST：同上 | ✅ PASS | `app/api/workflows/route.ts:52-84` |
| knowledge POST：source 白名单 manual\|ai | ✅ PASS | `app/api/knowledge/route.ts:55-58` |
| **knowledge POST 成功响应缺 `ok:true`** | ❌ FAIL | 见 §4-2 |
| chat route autoSave 请求解析 | ✅ PASS | `body.autoSave` → `!!body?.autoSave` |
| 提示词注入位置（RAG 之后、system 末尾） | ✅ PASS | `sysBlocks.push(ARTIFACT_SYSTEM_PROMPT)` 在 RAG 之后 |
| maxTokens=4000 | ✅ PASS | chatLlm 调用处 `maxTokens: 4000` |
| drafts 与 saveResults 对齐 | ✅ PASS | 逐条 writeArtifact push，下标对齐 |
| 纯问答/校验失败不产 drafts | ✅ PASS（含 A1/A2 边界缺陷见 §4-1） | drafts.length===0 时返回基础 payload |
| RAG/网关逻辑未破坏 | ✅ PASS | usedDocs 组装、gatewayId 选择保持原逻辑 |
| **extractArtifacts 围栏兜底对纯问答正文误截断** | ❌ FAIL | 见 §4-1 |
| AIView：isValidChatItem 对旧 localStorage 历史（无 drafts/saveResults）放行 | ✅ PASS | 可选字段 undefined 不判；仅存在时校验元素 |
| AIView：DraftCard 挂在气泡下方、meta 上方 | ✅ PASS | assistant item 内 bubble 后渲染 DraftCard 列表 |
| AIView：自动保存 Switch 持久化 `alon:chat:autoSave` | ✅ PASS | 挂载读、变更写，hydrated 后首 flush 不覆盖 |
| AIView：send() 请求带 autoSave | ✅ PASS | `body: {messages, useKnowledge, autoSave, gatewayId}` |
| DraftCard：保存 body 带 `source:'ai'` | ✅ PASS | 所有 kind 统一 `{ source:"ai" }` + mode 仅 overwrite |
| DraftCard：409 冲突三选一（覆盖重发 overwrite/另存改名聚焦/放弃折叠） | ✅ PASS | `doSave("overwrite")`、`openEditor(true)`、`abandonDraft` |
| DraftCard：成功态显示 id | ✅ PASS（knowledge 分支被 §4-2 阻断） | `✓ 已保存 #id` |
| DraftCard：knowledge 保存响应契约 | ❌ FAIL | 见 §4-2 |
| 三中心 SourceTag 挂点 | ✅ PASS | SkillsView:310/440、WorkflowsView:314/464、KnowledgeView:450/513 |
| 原文展示已切 `sourceText`，无 `.source` 残留 | ✅ PASS | SkillsView:609、WorkflowsView:743 均用 `selected.sourceText`；无把原文当来源 Tag |
| T05：SkillController/WorkflowController list/detail 透出 source 归一化（列优先、JSON 仅认标记、admin→manual） | ✅ PASS | `resolveSource` 逻辑与 §3.4 一致 |
| T05：KnowledgeController docs 透出 source（列 null→manual） | ✅ PASS | `toDocItem/toDocFull` |
| T05：后台前端类型补 source 渲染 Tag | ✅ PASS | admin tsc C2 通过；SkillsManager/WorkflowsManager/KnowledgeManager 各有本地类型含 `source?` + AiTag |
| 回归：ChatMarkdown.tsx 未被改动 | ✅ PASS | 纯渲染组件，未见 drafts/source 逻辑 |
| 回归：core/api.ts 未被改动 | ✅ PASS | 仍是 requireUser/jsonError/assertOrigin/readJson 原样 |
| 回归：syncSkills/syncWorkflows 播种仍不带 source 列插入 | ✅ PASS | `INSERT INTO skills(name,type,description,config)` / `INSERT INTO workflows(name,description,definition,version)`——旧库兼容；列默认 manual |
| runSkill shell cwd 兜底（目录不存在回退 SKILLS_DIR） | ✅ PASS | `fs.existsSync(skillDir)?skillDir:SKILLS_DIR` |
| schema.sql 三表 source 列一致性 | ❌ FAIL | 见 §4-3 |

---

## 4. 源码缺陷清单（判定 Engineer）

### 4-1 【中】extractArtifacts 围栏兜底会把「纯问答正文里的 ```json 代码示例」当产物截断（回归风险）

- 文件：`alon-workbench/core/ai/artifacts.ts`（`extractArtifacts`，约 L152-207）
- 现象：
  - A1：回复正文中间含 ```json 对象示例（无 `<artifacts>` 标签）→ reply 被截断到围栏前，示例与其后正文丢失（reply=`"用户问…这是示例"`，丢失尾句）。
  - A2：回复含 ```json 字符串数组示例 → 逐条 normalize 失败累计 skipped，reply 被截断并追加「（未能生成结构化产物：…）」噪音。
- 期望（架构 §3.2/§3.5）：**只有确认是"产物数组"时才把围栏当草稿并剥离**；纯问答/非产物围栏应保持 reply=原文完整，drafts=[]，不产生 skipped 噪音。
- 建议修法：`lastFenceBlock` 兜底仅在「无 `<artifacts>` 标签 **且** 围栏内容能解析为数组 **且** 数组中至少一项可识别为 `{kind: skill|workflow|knowledge, payload:object}` 产物」时才消费该围栏（剥离并产 drafts）；否则直接 `reply = src.trim()`、drafts=[]、skipped=[]，不做任何截断/追加。
- 证据：`probe-artifacts-bugs.mjs` A1/A2 violations（已落盘可复跑）。
- 回归面：P0-9「既有纯问答无回归」——用户让 AI「给个 JSON 示例」等场景即触发。

### 4-2 【高】knowledge POST 成功响应缺 `ok:true`，DraftCard 知识草稿手动保存永远不进入已保存态（且可重复建卡）

- 文件：`alon-workbench/app/api/knowledge/route.ts:71`（成功返回 `NextResponse.json({ doc })`，无 `ok:true`）
  对照：skills `{ok:true, skill}`、workflows `{ok:true, workflow}` 均带 ok。
- 文件：`alon-workbench/components/ai/DraftCard.tsx:245`——成功判定为 `res.ok && data.ok`；knowledge 响应体无 `ok` → 永不进成功分支；也不是 NAME_CONFLICT、`!res.ok` 为假 → **三个分支都不执行**：不置已保存、不显示 `✓ #id`、`onSaved` 不触发，卡片停留在可再次保存状态（用户重复点击会不断新建重复文档）。
- 期望（架构 §3.6/§10 共享约定：业务成功 2xx body 带 `ok:true`）：knowledge POST 成功返回 `{ ok:true, doc }`（向后兼容——KnowledgeView 只检查 `!res.ok` 与 `data.doc`，加 `ok:true` 不破坏旧调用）。
- 建议修法：`route.ts:71` 改为 `return NextResponse.json({ ok: true, doc });`（并同步 PATCH/GET detail 可选，PATCH 用于编辑路径不在 DraftCard 主流程，可不动）。

### 4-3 【低】schema.sql 只在 workflows 表加 source 列，skills/docs 的 CREATE TABLE 缺 source（与 T01「新装即含」不符）

- 文件：`admin-platform/admin-backend/src/main/resources/db/schema.sql`
  - workflows L85 有 `source VARCHAR(16) NOT NULL DEFAULT 'manual'`；
  - skills（L55-64）与 docs（L104-115）**未加 source 列**。
- 影响：新库若由 schema.sql 直接建表（未经 admin SourceColumnMigrator/前台 ensureSourceColumns 补列）会缺列。当前读端 `withColumnFallback` 与写端自愈能兜底，风险有限；但与架构 §3.1「schema.sql 同步更新，三表新装即含」、T01 验收口径不一致。
- 建议修法：skills 表 `config` 后、docs 表 `created_by` 后补 `source VARCHAR(16) NOT NULL DEFAULT 'manual'`。

---

## 5. 智能路由判定

- **源码缺陷 3 项 → 判定 Engineer**
  - E-1：`core/ai/artifacts.ts` extractArtifacts 围栏兜底误截断纯问答正文（中）
  - E-2：`app/api/knowledge/route.ts` POST 成功响应缺 `ok:true` → DraftCard 知识手动保存失效（高）
  - E-3：`admin-backend/.../db/schema.sql` skills/docs 缺 source 列（低）
- 测试脚本自身缺陷：0（QA 自修不触发）
- 编译/类型门禁：全部通过（无 C 级问题）

---

## 6. 遗留环境限制（BLOCKED，建议有库环境补验命令）

因本机 MySQL root/空密码不可达，以下项在本环境标记 **BLOCKED**，请在可连库环境按序补验：

```bash
# 0) 前置：确保表已含 source 列（起一次 admin 或手动 ALTER）
mysql -h127.0.0.1 -uroot qimu_platform -e "SHOW COLUMNS FROM skills LIKE 'source'; SHOW COLUMNS FROM workflows LIKE 'source'; SHOW COLUMNS FROM docs LIKE 'source';"

# 1) 迁移幂等：admin 启动 SourceColumnMigrator 两次，重复启动无告警
# 2) 写接口成功：新建 skill/workflow（source=ai）→ 200 {ok:true,...} 且列表含 source
curl -s -X POST http://localhost:3000/api/skills -H 'Content-Type: application/json' \
  -d '{"name":"qa-skill-1","type":"http","config":{"http":{"url":"https://example.com"}},"source":"ai"}'

# 3) 重名 409 + existing（先建同名再 POST mode=create）
# 4) mode=overwrite 覆盖（type/config 变化 + created:false）
# 5) knowledge source=ai → 200 {ok:true, doc}（验证 §4-2 修复）
curl -s -X POST http://localhost:3000/api/knowledge -H 'Content-Type: application/json' \
  -d '{"title":"QA 验证文档","category":"QA","content":"# 正文","source":"ai"}'

# 6) 1062 兜底（并发/绕过 SELECT 撞唯一键）转 duplicate
# 7) AI shell 技能无磁盘目录执行成功（cwd 回退 SKILLS_DIR）
# 8) 端到端：对话→草稿卡→手动保存（skill/workflow/knowledge 三型）→三中心刷新带「AI 生成」Tag
# 9) 纯问答含 ```json 示例 → reply 不被截断（验证 §4-1 修复）
# 10) autoSave 开 → 直接落库 → saveResults 对齐 → 三中心可见；admin 8080 列表可见 AI Tag
# 11) 旧 localStorage 历史（无 drafts 字段）加载不破
```

---

## 7. 文件产物

- 测试脚本：
  - `alon-workbench/scripts/qa-ai-integration/run-artifacts-tests.mjs`（67 断言干净套件）
  - `alon-workbench/scripts/qa-ai-integration/probe-artifacts-bugs.mjs`（缺陷探针 A1/A2）
- 本报告：`alon-workbench/docs/ai-creation-integration/QA-REPORT.md`

---

## 8. Round 2 回归结论（缺陷修复验证 · 2026-09-04 交付总监复核）

> 说明：QA 子代理 Round 2 因 API 额度 429 中断，由交付总监按同一回归清单独立复核执行。

| 项 | 验证方式 | 结果 |
|---|---|---|
| E-1 修复（extractArtifacts 误消费围栏） | 重跑 `probe-artifacts-bugs.mjs`：A1/A2 均 PASS，violations=0；`run-artifacts-tests.mjs`：passed=67 failed=0 | ✅ PASS |
| E-2 修复（knowledge POST 缺 ok:true） | 读 route.ts：`NextResponse.json({ ok: true, doc })`；KnowledgeView 读 `data.doc`/`res.ok` 路径兼容无回归（行 133/150/185/188/206） | ✅ PASS |
| E-3 修复（schema.sql 漏 source 列） | awk 抽取三表 CREATE 段：skills/workflows/docs 均含 `source VARCHAR(16) NOT NULL DEFAULT 'manual'` | ✅ PASS |
| 类型门禁 | alon-workbench `npx tsc --noEmit` EXIT=0；admin-platform `npx tsc --noEmit` EXIT=0 | ✅ PASS |

**Round 2 判定：NoOne（可交付）**。Round 1 报告的 3 项源码缺陷已全部修复且无回归；
遗留仅环境性 BLOCKED（本机 MySQL 无权限，DB 集成项见 §6 补验清单），非代码缺陷。

---

## 9. P2 增强验证（2026-09-04 增量）

- `scripts/qa-ai-integration/test-commands.ts`：快捷指令解析 20 断言全 PASS（skill/workflow/doc/create-knowledge 别名、无描述空 rest、普通消息/空串/无关词/大小写/前缀相似均不误判；hint 含 kind 约束与需求描述；模板结构）。
- 回归：`run-artifacts-tests.mjs` 67 passed（extractArtifacts 未受影响）；alon-workbench `npx tsc --noEmit` EXIT=0。
- 环境限制同 §6：DB 集成端到端（快捷指令→草稿→保存链路）需在有库环境实测。
