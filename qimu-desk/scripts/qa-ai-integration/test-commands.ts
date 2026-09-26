/**
 * P2 快捷指令纯函数单测（node --experimental-strip-types 直接运行）：
 *   cd alon-workbench && node --experimental-strip-types scripts/qa-ai-integration/test-commands.ts
 */
import {
  parseQuickCommand,
  quickSystemHint,
  QUICK_TEMPLATES,
  QUICK_KIND_LABEL,
} from "../../core/ai/commands.ts";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ""}`);
  }
}

// —— parseQuickCommand ——
{
  const c1 = parseQuickCommand("/create-skill 帮我创建一个抓取网页的技能");
  check("skill 带描述", c1?.kind === "skill" && c1.rest === "帮我创建一个抓取网页的技能", c1);

  const c2 = parseQuickCommand("/create-skill");
  check("skill 无描述 → rest 空串", c2?.kind === "skill" && c2.rest === "", c2);

  const c3 = parseQuickCommand("/create-workflow 先抓数据再总结");
  check("workflow 带描述", c3?.kind === "workflow" && c3.rest === "先抓数据再总结", c3);

  const c4 = parseQuickCommand("/create-doc 把这周要点整理成知识");
  check("doc 别名", c4?.kind === "knowledge", c4);

  const c5 = parseQuickCommand("/create-knowledge 整理运维手册");
  check("create-knowledge 别名", c5?.kind === "knowledge" && c5.rest === "整理运维手册", c5);

  check("非指令普通消息 → null", parseQuickCommand("帮我写个技能吧") === null);
  check("空串 → null", parseQuickCommand("") === null);
  check("无关斜杠词 → null", parseQuickCommand("/clear") === null);
  check("大小写不敏感前缀不误判", parseQuickCommand("/CREATE-SKILL x") === null);
  check("前缀相似不误判", parseQuickCommand("/create-skillx 内容") === null);
}

// —— quickSystemHint ——
{
  const hint = quickSystemHint({ kind: "skill", rest: "抓取统计接口" });
  check("hint 含 kind=skill 约束", hint.includes('"skill"'), hint);
  check("hint 含需求描述", hint.includes("抓取统计接口"), hint);
  const h2 = quickSystemHint({ kind: "workflow", rest: "" });
  check("hint 无描述分支", h2.includes("未给出具体描述"), h2);
}

// —— QUICK_KIND_LABEL / QUICK_TEMPLATES ——
{
  check("label skill=技能", QUICK_KIND_LABEL.skill === "技能");
  check("label workflow=工作流", QUICK_KIND_LABEL.workflow === "工作流");
  check("label knowledge=知识", QUICK_KIND_LABEL.knowledge === "知识");
  check("模板 3 个", QUICK_TEMPLATES.length === 3, QUICK_TEMPLATES.length);
  for (const t of QUICK_TEMPLATES) {
    check(`模板 ${t.key} 以 /create- 指令开头`, t.prompt.startsWith("/create-"), t.prompt.slice(0, 20));
  }
}

console.log(`\n===== P2 commands 单测：passed=${passed} failed=${failed} =====`);
process.exit(failed > 0 ? 1 : 0);
