/**
 * commands 数据层单元测试（纯逻辑，无外部依赖）。
 *
 * 执行方式（项目当前未引入 vitest/jest，采用 tsc 编译临时 JS + node 断言脚本）：
 *   npx tsc core/ai/commands.ts core/ai/commands.test.ts \
 *     --outDir /tmp/commandstest --module commonjs --target es2019 \
 *     --moduleResolution node --esModuleInterop --skipLibCheck
 *   node /tmp/commandstest/commands.test.js
 *
 * 覆盖（回归：parseRunWorkflowIntent 的 id 过度劫持修复）：
 *   T1  普通问题不被劫持（无运行动词/无工作流名词/数字不在工作流词后）
 *   T2  "运行工作流 17" 正常解析为 id=17（含变体：无空格/英文/--参数）
 *   T3  "看看工作流第3步" / "测试一下这个工作流的第 3 步" 不再被劫持
 *   T4  /run-workflow 指令解析不受影响（id / 名称 / --参数）
 *   T5  名称匹配仍可用："运行工作流 dailyReport" → name
 *   T6  "N 号工作流" 形态："运行 3 号工作流" → id=3
 */

import assert from "node:assert";
import {
  parseRunWorkflowIntent,
  parseRunWorkflowCommand,
} from "./commands";

let passed = 0;
let failed = 0;
const lines: string[] = [];
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    lines.push(`PASS  ${name}`);
  } catch (e) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    lines.push(`FAIL  ${name} :: ${msg}`);
  }
}

// ---------- T1: 普通问题不被劫持 ----------
check("T1a 无运行动词：'帮我总结一下今天的工作' → null", () => {
  assert.strictEqual(parseRunWorkflowIntent("帮我总结一下今天的工作"), null);
});

check("T1b 无工作流名词：'跑个步休息一下' → null", () => {
  assert.strictEqual(parseRunWorkflowIntent("跑个步休息一下"), null);
});

check("T1c 有动词有名词但数字不在工作流词后：'测试一下这个工作流第3步' → null", () => {
  // 修复前：raw.match(/(\d+)/) 会返回 id=3，真实执行 3 号工作流（过度劫持）
  assert.strictEqual(parseRunWorkflowIntent("测试一下这个工作流第3步"), null);
});

check("T1d 变体：'执行 workflow 的第 2 步看看结果' → null", () => {
  assert.strictEqual(parseRunWorkflowIntent("执行 workflow 的第 2 步看看结果"), null);
});

check("T1e 变体：'帮我测试下工作流的第 12 步是否正常' → null", () => {
  assert.strictEqual(parseRunWorkflowIntent("帮我测试下工作流的第 12 步是否正常"), null);
});

// ---------- T2: "运行工作流 17" 正常解析 ----------
check("T2a '运行工作流 17' → {id:17}", () => {
  assert.deepStrictEqual(parseRunWorkflowIntent("运行工作流 17"), { id: 17, params: {} });
});

check("T2b '运行工作流17'（无空格）→ {id:17}", () => {
  assert.deepStrictEqual(parseRunWorkflowIntent("运行工作流17"), { id: 17, params: {} });
});

check("T2c 'run workflow 17' → {id:17}", () => {
  assert.deepStrictEqual(parseRunWorkflowIntent("run workflow 17"), { id: 17, params: {} });
});

check("T2d '运行工作流 17 --env prod' → {id:17, params:{env:'prod'}}", () => {
  const cmd = parseRunWorkflowIntent("运行工作流 17 --env prod");
  assert.ok(cmd, "应解析成功");
  assert.strictEqual(cmd!.id, 17);
  assert.deepStrictEqual(cmd!.params, { env: "prod" });
});

// ---------- T3: "看看工作流第3步" 不再被劫持 ----------
check("T3a '看看这个工作流第3步' → null", () => {
  assert.strictEqual(parseRunWorkflowIntent("看看这个工作流第3步"), null);
});

check("T3b '看看工作流第3步' → null", () => {
  assert.strictEqual(parseRunWorkflowIntent("看看工作流第3步"), null);
});

// ---------- T4: /run-workflow 指令不受影响 ----------
check("T4a '/run-workflow 17' → {id:17}", () => {
  assert.deepStrictEqual(parseRunWorkflowCommand("/run-workflow 17"), { id: 17, params: {} });
});

check("T4b '/run-workflow dailyReport --date 2024-01-01' → name + params", () => {
  const cmd = parseRunWorkflowCommand("/run-workflow dailyReport --date 2024-01-01");
  assert.ok(cmd, "应解析成功");
  assert.strictEqual(cmd!.name, "dailyReport");
  assert.deepStrictEqual(cmd!.params, { date: "2024-01-01" });
});

check("T4c '/run-workflow 17 --env prod' → {id:17, params:{env:'prod'}}", () => {
  const cmd = parseRunWorkflowCommand("/run-workflow 17 --env prod");
  assert.ok(cmd, "应解析成功");
  assert.strictEqual(cmd!.id, 17);
  assert.deepStrictEqual(cmd!.params, { env: "prod" });
});

check("T4d '/run-workflow'（无目标）→ null", () => {
  assert.strictEqual(parseRunWorkflowCommand("/run-workflow"), null);
});

// ---------- T5: 名称匹配仍可用 ----------
check("T5 '运行工作流 dailyReport' → {name:'dailyReport'}", () => {
  const cmd = parseRunWorkflowIntent("运行工作流 dailyReport");
  assert.ok(cmd, "应解析成功");
  assert.strictEqual(cmd!.name, "dailyReport");
  assert.strictEqual(cmd!.id, undefined);
});

// ---------- T6: "N 号工作流" 形态 ----------
check("T6 '运行 3 号工作流' → {id:3}", () => {
  assert.deepStrictEqual(parseRunWorkflowIntent("运行 3 号工作流"), { id: 3, params: {} });
});

// ---------- 汇总 ----------
console.log("\n==== commands.test.ts ====");
console.log(lines.join("\n"));
console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
