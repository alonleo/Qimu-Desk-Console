import { parseQuickIntent, parseQuickCommand } from "../../core/ai/commands.ts";

let fail = 0;
function check(name, cond) {
  if (!cond) { fail++; console.error("FAIL:", name); } else { console.log("ok:", name); }
}

// 应命中
check("帮我写一个抓取网页的技能", parseQuickIntent("帮我写一个抓取网页的技能")?.kind === "skill");
check("create a skill for me", parseQuickIntent("create a skill for me")?.kind === "skill");
check("帮我生成一个工作流", parseQuickIntent("帮我生成一个工作流")?.kind === "workflow");
check("build a deployment workflow", parseQuickIntent("build a deployment workflow")?.kind === "workflow");
check("帮我把这些要点整理成知识文档", parseQuickIntent("帮我把这些要点整理成知识文档")?.kind === "knowledge");
check("写一个部署文档", parseQuickIntent("写一个部署文档")?.kind === "knowledge");

// 不应命中（查询类 / 无动词 / 无名词）
check("技能中心在哪", parseQuickIntent("技能中心在哪") === null);
check("看看我的工作流列表", parseQuickIntent("看看我的工作流列表") === null);
check("帮我写个周报", parseQuickIntent("帮我写个周报") === null);
check("docker 是什么（doc 子串不误判）", parseQuickIntent("帮我解释下 docker 是什么") === null);
check("空串", parseQuickIntent("") === null);

// 快捷指令仍优先生效（路由层顺序保证）
check("/create-skill 指令仍可用", parseQuickCommand("/create-skill 抓取接口")?.kind === "skill");

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
