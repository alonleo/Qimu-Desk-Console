/**
 * QA — 已知缺陷探针（记录"当前实际行为"是否违反契约，供缺陷清单引用）。
 * 不参与干净套件断言计数：每条探针打印 PASS/VIOLATION，脚本恒 exit 0。
 *
 * 覆盖点（架构 §3.2）：
 * A. 纯问答正文含 ```json 代码示例（非数组、非 <artifacts>）：reply 应保持原文完整，
 *    不得因"退而找围栏"误截断。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const TMP = join(__dirname, ".qa-tmp");
mkdirSync(TMP, { recursive: true });

writeFileSync(
  join(TMP, "stub-db.ts"),
  `export async function createSkill(): Promise<never> { throw new Error("stub"); }
export async function createWorkflow(): Promise<never> { throw new Error("stub"); }
export async function createDoc(): Promise<never> { throw new Error("stub"); }
export async function runShell(): Promise<never> { throw new Error("stub"); }
export async function runHttp(): Promise<never> { throw new Error("stub"); }
`
);

function buildArtifactsTs() {
  const src = readFileSync(join(ROOT, "core", "ai", "artifacts.ts"), "utf-8");
  const out = src
    .replaceAll('from "../skills"', 'from "./stub-db.ts"')
    .replaceAll('from "../workflows"', 'from "./stub-db.ts"')
    .replaceAll('from "../knowledge"', 'from "./stub-db.ts"');
  const p = join(TMP, "artifacts-probe.ts");
  writeFileSync(p, out);
  return p;
}

const mod = await import(pathToFileURL(buildArtifactsTs()).href);
const { extractArtifacts } = mod;

let violation = 0;

function probe(name, cond, detail) {
  if (cond) {
    console.log(`PASS      ${name}`);
  } else {
    violation++;
    console.log(`VIOLATION ${name} | ${detail}`);
  }
}

// A1: 纯问答里给一个 ```json 对象示例，且后面还有正文 → 期望 reply 完整（不丢尾部）
{
  const qa =
    '用户问：返回一个 JSON 示例。\n助手答：这是示例\n```json\n{"name":"demo","ok":true}\n```\n希望对你有帮助。';
  const r = extractArtifacts(qa);
  probe(
    "A1 非 <artifacts> 的 ```json 对象示例不应截断 reply",
    r.reply.includes("希望对你有帮助") && r.drafts.length === 0,
    `reply=${JSON.stringify(r.reply)} drafts=${JSON.stringify(r.drafts)}`
  );
}

// A2: 纯问答含 ```json 数组但内容不是 skill/workflow/knowledge 结构 → 应回落完整原文（不会丢尾部）
{
  const qa = '回答：\n```json\n["a","b"]\n```\n尾部文字。';
  const r = extractArtifacts(qa);
  probe(
    "A2 非产物 JSON 数组（字符串数组）不应截断 reply",
    r.reply.includes("尾部文字") && r.drafts.length === 0,
    `reply=${JSON.stringify(r.reply)} drafts=${JSON.stringify(r.drafts)}`
  );
}

console.log(`\n===== 缺陷探针完成：violations=${violation} =====`);
