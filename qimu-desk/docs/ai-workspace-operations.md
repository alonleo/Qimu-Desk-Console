# AI 助手操作业务模块

在 AI 助手输入框下方开启「AI 操作」，即可使用内置业务工具，无需添加 MCP 或选择技能。网关模型需要支持 function calling。

示例：

- 创建一个「官网改版」项目，描述是优化移动端体验。
- 在「官网改版」项目里创建任务「检查首页」，优先级设为高。
- 把任务「检查首页」改为进行中。
- 将以下内容保存为知识库文档，标题是「发布流程」：……
- 修改知识库文档「发布流程」，在末尾增加以下内容：……
- 创建一条公告草稿，标题是「维护安排」，内容是……
- 发布公告「维护安排」。
- 删除任务「检查首页」。

任务、项目、知识文档沿用各自 API 的权限；通知公告只有管理员可创建、编辑、发布和删除，普通成员只能读取已发布内容。模型先查询目标，目标不明确时询问用户。工具执行状态和结果显示在对话中。

开启 AI 操作后，自然语言要求知识文档入库会直接保存。明确使用 `/create-doc` 或 `/create-knowledge` 时仍生成可预览保存的草稿。

实现位于 `core/ai/workspace-tools.ts`（工具定义）和 `core/ai/workspace-api.ts`（认证接口适配）。适配器直接复用项目、知识库的 API handler，任务复用后端代理，通知公告写入使用管理端认证 API。模型不能指定请求地址、认证信息或所有者。

回归检查：`node scripts/check-workspace-tools.cjs`、`node scripts/check-projects.cjs`、`npx tsc --noEmit`、`npm run build`。前两个脚本使用模拟依赖验证参数、权限分支和请求映射，不修改真实业务数据；真实网关对话和数据库联调结果见 [联调记录](ai-workspace-live-results.md)，可使用 `scripts/qa-ai-integration/test-workspace-live.cjs` 复测。
