/**
 * QA — AI 产物结构化解析纯逻辑单元测试（无需 DB）。
 *
 * 做法说明（fresh eyes 独立验证）：
 * - artifacts.ts / skills.ts 的模块级 import 链较重（core/db → mysql2、core/executor 等，
 *   且相对路径不带 .ts 扩展，Node ESM 无法直接 resolve），
 *   因此本脚本读取【真实源文件】文本，仅把"写通道/DB 侧 import"替换为桩模块
 *   （桩函数若被调用会直接 throw，确保解析路径不被写库行为污染），
 *   其余函数体、zod schema、类型逐一保持与源码字节一致 → 生成到临时 .ts 再动态导入测试。
 * - 这等价于对真实 extractArtifacts / normalizeDraft / isSourceMarker /
 *   normalizeSourceValue / parseParam / validateSkillParams 的行为验证，
 *   不是"另写一份被测实现"。
 *
 * 运行：node scripts/qa-ai-integration/run-artifacts-tests.mjs
 *   （内部用 --experimental-strip-types 的 node 进程跑生成的 .ts，或用本进程动态 import 均可）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const TMP = join(__dirname, ".qa-tmp");
mkdirSync(TMP, { recursive: true });

// ---------- 桩模块 ----------
const STUB_PATH = join(TMP, "stub-db.ts");
writeFileSync(
  STUB_PATH,
  `// QA 自动生成：DB 写通道桩。若被测纯函数意外走到写库，将在此抛错暴露。
export async function createSkill(): Promise<never> { throw new Error("QA: unexpected createSkill call"); }
export async function createWorkflow(): Promise<never> { throw new Error("QA: unexpected createWorkflow call"); }
export async function createDoc(): Promise<never> { throw new Error("QA: unexpected createDoc call"); }
export async function runShell(): Promise<never> { throw new Error("QA: unexpected runShell call"); }
export async function runHttp(): Promise<never> { throw new Error("QA: unexpected runHttp call"); }
export async function row(): Promise<never> { throw new Error("QA: unexpected row call"); }
export async function rows(): Promise<never> { throw new Error("QA: unexpected rows call"); }
export async function exec(): Promise<never> { throw new Error("QA: unexpected exec call"); }
export async function withTransaction(): Promise<never> { throw new Error("QA: unexpected withTransaction call"); }
export async function withColumnFallback(): Promise<never> { throw new Error("QA: unexpected withColumnFallback call"); }
export async function ensureSourceColumns(): Promise<boolean> { return true; }
export async function ensureVisibilityColumns(): Promise<boolean> { return true; }
export function nowString(): string { return "2026-01-01 00:00:00"; }
export function isBadFieldError(): boolean { return false; }
export function isDuplicateKeyError(): boolean { return false; }
export function coerceSkillConfig(type: string, raw: unknown): Record<string, unknown> {
  const obj = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  if (type === "http") {
    const FLAT_KEYS = ["method", "url", "headers", "body", "timeout"] as const;
    const nested =
      obj.http && typeof obj.http === "object" ? ({ ...(obj.http as Record<string, unknown>) } as Record<string, unknown>) : {};
    let moved = false;
    for (const k of FLAT_KEYS) {
      if (nested[k] === undefined && obj[k] !== undefined) { nested[k] = obj[k]; moved = true; }
    }
    if (moved || (obj.http === undefined && nested.url !== undefined)) {
      for (const k of FLAT_KEYS) delete obj[k];
      obj.http = nested;
    }
  }
  return obj;
}
export default {};
`
);

// ---------- 生成 artifacts.ts 的可测副本 ----------
function buildArtifactsTs() {
  const src = readFileSync(join(ROOT, "core", "ai", "artifacts.ts"), "utf-8");
  const out = src
    .replaceAll('from "../skills"', 'from "./stub-db.ts"')
    .replaceAll('from "../workflows"', 'from "./stub-db.ts"')
    .replaceAll('from "../knowledge"', 'from "./stub-db.ts"');
  const p = join(TMP, "artifacts-under-test.ts");
  writeFileSync(p, out);
  return p;
}

// ---------- 生成 skills.ts 的可测副本 ----------
function buildSkillsTs() {
  const src = readFileSync(join(ROOT, "core", "skills.ts"), "utf-8");
  const out = src
    .replaceAll('from "./db"', 'from "./stub-db.ts"')
    .replaceAll('from "./executor"', 'from "./stub-db.ts"')
    .replaceAll('from "./visibility"', 'from "../../../core/visibility.ts"')
    .replaceAll('from "./ai/artifacts"', 'from "./stub-db.ts"');
  const p = join(TMP, "skills-under-test.ts");
  writeFileSync(p, out);
  return p;
}

// ---------- 简易断言 ----------
let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name, detail = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}${detail ? " — " + detail : ""}`);
    console.error(`✗ FAIL: ${name}${detail ? " | " + detail : ""}`);
  }
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, name, `expected ${e}, got ${a}`);
}

const artifactsPath = pathToFileURL(buildArtifactsTs()).href;
const skillsPath = pathToFileURL(buildSkillsTs()).href;

const artifactsMod = await import(artifactsPath);
const skillsMod = await import(skillsPath);
const { extractArtifacts, normalizeDraft } = artifactsMod;
const { isSourceMarker, normalizeSourceValue, parseParam, validateSkillParams, createSkill, NAME_RE } = skillsMod;

// ============================================================
// 1. extractArtifacts：<artifacts> 标签多产物
// ============================================================
{
  const content = `好的，已为你生成两个草稿。\n<artifacts>\n[{"kind":"skill","payload":{"name":"fetch-stats","type":"http","config":{"http":{"url":"https://example.com"}}}},{"kind":"knowledge","payload":{"title":"运维周报","content":"# 周报"}}]\n</artifacts>`;
  const r = extractArtifacts(content);
  eq(r.reply, "好的，已为你生成两个草稿。", "T1.1 reply 清洗（标签前文本）");
  assert(!r.reply.includes("<artifacts>"), "T1.2 reply 不含 <artifacts> 残留", r.reply);
  assert(r.drafts.length === 2, "T1.3 多产物解析 2 条", JSON.stringify(r.drafts));
  assert(r.drafts[0].kind === "skill" && r.drafts[0].key === "draft-0", "T1.4 首条 skill key=draft-0");
  assert(r.drafts[1].kind === "knowledge" && r.drafts[1].key === "draft-1", "T1.5 次条 knowledge key=draft-1");
  assert(r.drafts[0].payload.name === "fetch-stats", "T1.6 skill payload.name");
  assert(Array.isArray(r.skipped) && r.skipped.length === 0, "T1.7 skipped 为空", JSON.stringify(r.skipped));
}

// ============================================================
// 2. extractArtifacts：```json 围栏包裹（标签内部带围栏 → 容错）
// ============================================================
{
  const content = `说明文字。\n<artifacts>\n\`\`\`json\n[{"kind":"workflow","payload":{"name":"wf-1","steps":[{"id":"s1","type":"http","http":{"url":"https://e.com"}}]}}]\n\`\`\`\n</artifacts>`;
  const r = extractArtifacts(content);
  assert(r.drafts.length === 1 && r.drafts[0].kind === "workflow", "T2.1 围栏内 JSON 解析", JSON.stringify(r.drafts));
  eq(r.reply, "说明文字。", "T2.2 reply 清洗");
}

// ============================================================
// 3. extractArtifacts：无标签但退而找 ```json 围栏块
// ============================================================
{
  const content = `下面给出结构：\n\`\`\`json\n[{"kind":"skill","payload":{"name":"abc","type":"prompt","config":{"prompt":{"template":"hi"}}}}]\n\`\`\``;
  const r = extractArtifacts(content);
  assert(r.drafts.length === 1 && r.drafts[0].kind === "skill", "T3.1 围栏兜底解析", JSON.stringify(r.drafts));
  eq(r.reply, "下面给出结构：", "T3.2 围栏兜底 reply 清洗");
}

// ============================================================
// 4. extractArtifacts：坏 JSON → drafts=[] 且 reply 原样（回落纯文本）
// ============================================================
{
  const bad = `一些说明\n<artifacts>\n[{"kind":"skill","payload":{broken}\n</artifacts>`;
  const r = extractArtifacts(bad);
  eq(r.drafts, [], "T4.1 坏 JSON → 空 drafts");
  assert(r.skipped.length === 0, "T4.2 坏 JSON 不回显 skipped", JSON.stringify(r.skipped));
  assert(typeof r.reply === "string" && r.reply.length > 0, "T4.3 坏 JSON reply 非空");
}

// ============================================================
// 5. extractArtifacts：合法 JSON 但为空数组 → drafts=[] 不回显 skipped
// ============================================================
{
  const empty = `有文字\n<artifacts>\n[]\n</artifacts>`;
  const r = extractArtifacts(empty);
  eq(r.drafts, [], "T5.1 空数组 → drafts=[]");
  eq(r.skipped, [], "T5.2 空数组 → skipped=[]");
  eq(r.reply, "有文字", "T5.3 空数组 reply 正常");
}

// ============================================================
// 6. extractArtifacts：kind 非法 / payload 缺关键字段 → 丢弃 + skipped
// ============================================================
{
  const content = `结构如下\n<artifacts>\n[{"kind":"skill","payload":{"name":"ok-1","type":"http","config":{"http":{"url":"https://e.com"}}}},{"kind":"skill","payload":{"name":"ok-2","type":"http","config":{"http":{"url":"https://e.com"}}}}]\n</artifacts>`;
  const badKind = `好的\n<artifacts>\n[{"kind":"doc","payload":{"title":"x"}}]\n</artifacts>`;
  const badPayload = `好的\n<artifacts>\n[{"kind":"skill","payload":{"name":"","type":"http"}}]\n</artifacts>`;
  const mixed = `好的\n<artifacts>\n[{"kind":"skill","payload":{"name":"keep","type":"http","config":{"http":{"url":"https://e.com"}}}},{"kind":"unknown","payload":{}}]\n</artifacts>`;

  const r1 = extractArtifacts(badKind);
  eq(r1.drafts, [], "T6.1 kind=doc（非枚举）全部丢弃");
  assert(r1.skipped.length === 1, "T6.2 kind 非法累计 skipped", JSON.stringify(r1.skipped));
  assert(r1.reply.includes("未能生成结构化产物"), "T6.3 全部丢弃时 reply 追加人话说明", r1.reply);

  const r2 = extractArtifacts(badPayload);
  eq(r2.drafts, [], "T6.4 payload 缺关键字段全部丢弃（skill name 空/无 config）");
  assert(r2.skipped.length === 1, "T6.5 payload 非法累计 skipped", JSON.stringify(r2.skipped));

  const r3 = extractArtifacts(mixed);
  assert(r3.drafts.length === 1 && r3.drafts[0].payload.name === "keep", "T6.6 合法项保留、非法项丢弃", JSON.stringify(r3.drafts));
  assert(r3.skipped.length === 1, "T6.7 混合场景 skipped 仅 1", JSON.stringify(r3.skipped));
}

// ============================================================
// 7. extractArtifacts：reply 清洗后不含标签残留 / 围栏残留
// ============================================================
{
  const content = `第一段\n\n<artifacts>\n[{"kind":"knowledge","payload":{"title":"t","content":"c"}}]\n</artifacts>`;
  const r = extractArtifacts(content);
  assert(!r.reply.includes("</artifacts>") && !r.reply.includes("<artifacts>"), "T7.1 reply 无标签残留", r.reply);
  const fence = `回答如下：\n\`\`\`json\n[{"kind":"skill","payload":{"name":"s","type":"http","config":{"http":{"url":"https://e.com"}}}}]\n\`\`\``;
  const r2 = extractArtifacts(fence);
  assert(!r2.reply.includes("```"), "T7.2 围栏兜底路径 reply 无 ``` 残留", r2.reply);
}

// ============================================================
// 8. normalizeDraft：合法 draft（宽松 schema 通过并分配 key 空串由上层补）
// ============================================================
{
  const r = normalizeDraft({ kind: "skill", payload: { name: "fetch-stats", type: "http", config: { http: { url: "https://example.com" } } } });
  assert("draft" in r && !!r.draft, "T8.1 合法 skill → draft");
  const d = r.draft;
  assert(d.kind === "skill", "T8.2 draft.kind");
  assert(d.payload.name === "fetch-stats", "T8.3 draft.payload.name");
  assert(d.key === "", "T8.4 初始 key 为空（由 extractArtifacts 分配）");
  assert(d.issues === undefined, "T8.5 完整 http skill 无 issues", JSON.stringify(d.issues));
}

// ============================================================
// 9. normalizeDraft：缺字段/类型错 → skipped；knowledge title 超长 → skipped
// ============================================================
{
  const missing = normalizeDraft({ kind: "workflow", payload: { name: "wf" } }); // 无 steps
  assert(!("draft" in missing), "T9.1 workflow 缺 steps → skipped");
  const typeErr = normalizeDraft({ kind: "skill", payload: { name: "s", type: "jdbc" } });
  assert(!("draft" in typeErr), "T9.2 skill type 非法 → skipped", JSON.stringify(typeErr));
  const longTitle = normalizeDraft({ kind: "knowledge", payload: { title: "x".repeat(201), content: "c" } });
  assert(!("longTitle" in longTitle) && !("draft" in longTitle), "T9.3 knowledge title>200 → skipped");
  const emptyName = normalizeDraft({ kind: "skill", payload: { name: "  ", type: "http" } });
  assert(!("draft" in emptyName), "T9.4 skill name 空白 → skipped");
}

// ============================================================
// 10. normalizeDraft：name 正则接受数字开头（对齐 Spring `[a-z0-9]...`）
// ============================================================
{
  const r = normalizeDraft({ kind: "skill", payload: { name: "2fa-setup", type: "http", config: { http: { url: "https://e.com" } } } });
  assert("draft" in r && !!r.draft, "T10.1 数字开头 name 放行（架构 §0.2）", JSON.stringify(r));
}

// ============================================================
// 11. normalizeDraft：issues 轻量提示（http 缺 url / knowledge 空正文）
// ============================================================
{
  const r1 = normalizeDraft({ kind: "skill", payload: { name: "s", type: "http", config: { http: {} } } });
  assert("draft" in r1 && Array.isArray(r1.draft?.issues) && (r1.draft.issues ?? []).some((i) => i.includes("http.url")), "T11.1 http 缺 url → issues 提示", JSON.stringify(r1));
  const r2 = normalizeDraft({ kind: "knowledge", payload: { title: "标题", content: "" } });
  assert("draft" in r2 && Array.isArray(r2.draft?.issues) && (r2.draft.issues ?? []).some((i) => i.includes("正文为空")), "T11.2 knowledge 空正文 → issues 提示", JSON.stringify(r2));
}

// ============================================================
// 12. 来源归一化纯函数（core/skills.ts 导出）
// ============================================================
{
  assert(normalizeSourceValue("ai") === "ai", "T12.1 'ai'→ai");
  assert(normalizeSourceValue("file") === "file", "T12.2 'file'→file");
  assert(normalizeSourceValue("admin") === "manual", "T12.3 'admin'→manual");
  assert(normalizeSourceValue("manual") === "manual", "T12.4 'manual'→manual");
  assert(normalizeSourceValue("foo") === "manual", "T12.5 未知字符串→manual");
  assert(normalizeSourceValue(undefined) === "manual", "T12.6 undefined→manual");
  assert(normalizeSourceValue(null) === "manual", "T12.7 null→manual");
  assert(normalizeSourceValue(123) === "manual", "T12.8 非字符串→manual");
  assert(normalizeSourceValue("AI") === "manual", "T12.9 大写 AI（非标记）→manual");
  assert(isSourceMarker("ai") && isSourceMarker("file") && isSourceMarker("admin") && isSourceMarker("manual"), "T12.10 isSourceMarker 四标记全真");
  assert(!isSourceMarker("raw yaml text") && !isSourceMarker(undefined) && !isSourceMarker(""), "T12.11 原文/空/undefined 非标记");
}

// ============================================================
// 13. parseParam / validateSkillParams（写接口与文件扫描共用）
// ============================================================
{
  assert(parseParam({ name: "url", required: true })?.name === "url", "T13.1 合法 param");
  assert(parseParam({ name: "1bad", required: true }) === null, "T13.2 数字开头 param name 拒绝");
  assert(parseParam({ name: "a-b" }) === null, "T13.3 param name 连字符拒绝");
  assert(parseParam(null) === null && parseParam(undefined) === null, "T13.4 null/undefined param 拒绝");
  const v1 = validateSkillParams([{ name: "a" }, { name: "b" }]);
  assert(!v1.error && v1.params.length === 2, "T13.5 数组参数通过");
  const v2 = validateSkillParams({});
  assert(!!v2.error, "T13.6 非数组 params → error");
  const v3 = validateSkillParams([{ name: "bad-name" }]);
  assert(!!v3.error, "T13.7 数组中非法 param → error 全拒");
  const v4 = validateSkillParams(undefined);
  assert(!v4.error && v4.params.length === 0, "T13.8 undefined → [] 通过");
}

// ============================================================
// 14. 纯问答/无标签 → 空 drafts，reply=原文（不破坏既有纯问答）
// ============================================================
{
  const qa = "你好，今天天气怎么样？";
  const r = extractArtifacts(qa);
  eq(r.drafts, [], "T14.1 纯问答 drafts=[]");
  eq(r.reply, qa, "T14.2 纯问答 reply 原样");
  eq(r.skipped, [], "T14.3 纯问答 skipped=[]");
}

// ============================================================
// 15. createSkill 预 DB 校验路径（非法入参应在触碰 DB 前返回 invalid SaveResult）
// ============================================================
{
  // 名称非法 → invalid（不会触碰 DB stub）
  const r1 = await createSkill({ name: "Bad_Name", type: "shell", config: { shell: { command: "echo hi" } } });
  assert(r1.ok === false && r1.status === "invalid", "T15.1 createSkill name 非法 → invalid", JSON.stringify(r1));
  const r2 = await createSkill({ name: "ok-name", type: "jdbc", config: {} });
  assert(r2.ok === false && r2.status === "invalid", "T15.2 createSkill type 非法 → invalid", JSON.stringify(r2));
  const r3 = await createSkill({ name: "shell-1", type: "shell", config: {} });
  assert(r3.ok === false && r3.status === "invalid" && r3.message.includes("shell.command"), "T15.3 shell 缺 shell.command → invalid", JSON.stringify(r3));
  const r4 = await createSkill({ name: "http-1", type: "http", config: { http: {} } });
  assert(r4.ok === false && r4.status === "invalid" && r4.message.includes("http.url"), "T15.4 http 缺 http.url → invalid", JSON.stringify(r4));
  const r5 = await createSkill({ name: "prompt-1", type: "prompt", config: { prompt: { template: "" } } });
  assert(r5.ok === false && r5.status === "invalid" && r5.message.includes("prompt.template"), "T15.5 prompt 缺 template → invalid", JSON.stringify(r5));
  const r6 = await createSkill({ name: "bad-param", type: "http", config: { http: { url: "https://e.com" } }, params: [{ name: "bad-name" }] });
  assert(r6.ok === false && r6.status === "invalid", "T15.6 params 中非法 name → invalid", JSON.stringify(r6));
  // 合法入参应走到 DB stub → 抛出 QA unexpected（说明校验已放行，进入写库阶段）
  let reachedDb = false;
  try {
    await createSkill({ name: "fetch-stats", type: "http", config: { http: { url: "https://example.com" } } });
  } catch (e) {
    reachedDb = String((e && e.message) || e).includes("QA: unexpected");
  }
  assert(reachedDb, "T15.7 合法 skill 校验放行后进入 DB 写库（stub 拦截证实路径到达）");
  // 扁平 config 容错：url 平铺在 config 顶层时应自动搬运进 config.http，不再误报缺少
  let reachedDbFlat = false;
  try {
    await createSkill({ name: "flat-http", type: "http", config: { method: "GET", url: "https://example.com" } });
  } catch (e) {
    reachedDbFlat = String((e && e.message) || e).includes("QA: unexpected");
  }
  assert(reachedDbFlat, "T15.8 扁平 config.url 自动归一后校验放行（不再误报 http.url 缺失）");
}

// ============================================================
// 16. normalizeDraft 扁平 config 容错：http url 平铺顶层 → 归一进 config.http 且无 issues
// ============================================================
{
  const r = normalizeDraft({ kind: "skill", payload: { name: "nvd-query", type: "http", params: [{ name: "cveId" }], config: { method: "GET", url: "https://services.nvd.nist.gov/rest/json/cves/2.0?cveId={{cveId}}" } } });
  assert("draft" in r && !!r.draft, "T16.1 扁平 url 草稿可解析", JSON.stringify(r).slice(0, 200));
  const draft = "draft" in r ? r.draft : null;
  const payload = draft?.payload;
  assert(payload?.config?.http?.url === "https://services.nvd.nist.gov/rest/json/cves/2.0?cveId={{cveId}}", "T16.2 url 已搬运进 config.http", JSON.stringify(payload?.config));
  assert(payload?.config?.http?.method === "GET", "T16.3 method 已搬运进 config.http");
  assert(draft?.issues === undefined, "T16.4 归一后无 http.url 告警", JSON.stringify(draft?.issues));
  // 嵌套已有值优先：config.http.url 存在时顶层平铺 url 不覆盖
  const r2 = normalizeDraft({ kind: "skill", payload: { name: "both-url", type: "http", config: { http: { url: "https://nested.example.com" }, url: "https://flat.example.com" } } });
  const p2 = "draft" in r2 ? r2.draft?.payload : null;
  assert(p2?.config?.http?.url === "https://nested.example.com", "T16.5 嵌套值优先不被平铺覆盖", JSON.stringify(p2?.config));
}

console.log(`\n===== QA artifacts 纯逻辑单测：passed=${passed} failed=${failed} =====`);
if (failed > 0) {
  console.error("失败清单：\n" + failures.join("\n"));
  process.exit(1);
}
