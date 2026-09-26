# AI 助手能力

在 AI 助手输入框上方打开「能力管理」。添加后，在「选择 Skill、MCP 或插件」中选择本次对话要使用的能力。

- **AI Skill**：导入 `SKILL.md`，正文作为模型指令。支持 YAML 头部 `name`、`description`；不执行 Markdown 内的本地脚本，不加载相对路径资源。
- **MCP**：远程 Streamable HTTP 服务，通过官方 TypeScript SDK 完成初始化、工具分页发现、会话管理和工具调用。支持 JSON / SSE 响应及静态认证请求头。不支持本机 stdio 进程、旧版独立 SSE endpoint 或 OAuth 登录。
- **插件**：Qimu JSON 能力包，将多个 Skill 和 MCP 配置一起添加。它不是 npm 包安装器，也不直接兼容其他平台的可执行插件包。
- **工作台技能**：原有 `/` 引用保持可用；开启「允许工具调用」后，所引用技能将作为模型可调用工具，使用现有执行器并写入技能运行记录。

仅导入或启用能力不会执行工具。选好能力并开启「允许工具调用」后，发送消息会授权模型在本次请求内调用所选工具；工具可能修改外部数据。不开启时只注入所选 AI Skill 的指令。停止生成会取消等待和后续调用，不能撤销已经执行的操作；工作台执行器中正在运行的 shell / HTTP 技能仍受其原有超时控制。

聊天中显示每个工具的调用状态及结果摘要。重新生成会沿用原消息的能力和工具授权，因此可能再次执行操作。

生成的技能、工作流和知识文档以草稿形式展示，点击草稿卡上的保存按钮后才会入库。聊天输入区按「模型与能力选择 → 消息输入 → 知识库 / 工具调用与发送」排列。

## SKILL.md

```markdown
---
name: writing-assistant
description: 中文写作与润色
---
先明确读者与目的，保留事实，使用简洁自然的中文。
```

## MCP 配置

```json
{
  "name": "业务工具",
  "url": "https://your-mcp.example.com/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_TOKEN"
  }
}
```

添加后使用「测试与查看工具」验证连接并列出服务提供的工具。此测试不会调用业务工具。

## 插件 JSON

```json
{
  "name": "业务助手",
  "description": "业务分析指令与工具",
  "version": "1.0.0",
  "skills": [
    {
      "name": "analysis",
      "description": "分析数据",
      "instructions": "先调用已授权工具获取数据，再根据实际返回内容分析。不要编造数据。"
    }
  ],
  "mcpServers": [
    {
      "name": "业务数据",
      "url": "https://your-mcp.example.com/mcp",
      "headers": {}
    }
  ]
}
```

## 部署

- 新表 `ai_capabilities` 在首次访问时幂等创建，现有技能表不变。数据库账号需要 CREATE TABLE 权限，或由 DBA 预先执行同目录 `schema.sql`。
- 设置至少 32 位 `AI_CAPABILITY_SECRET`；未设置时使用 `JWT_SECRET`。配置整体通过 AES-256-GCM 加密落库，列表 API 不返回配置和凭据。备份与密钥轮换需要同时考虑加密数据。
- 能力按登录用户隔离，服务端每次加载校验所有权与启用状态；工作台技能调用校验可见性。
- MCP 默认仅连接公网 IP，拒绝重定向，并固定 DNS 解析结果。内网服务须在 `AI_MCP_ALLOWED_ORIGINS` 显式列出精确 origin，例如 `http://mcp.internal:8000`。使用 Docker 时地址相对工作台容器，`localhost` 不代表宿主机。
- 工具模式要求网关兼容 OpenAI `tools` / `tool_calls`。不支持时会显示错误，不会声称已执行。能力模式在工具调用期间推送状态，最终回答完成后再逐字展示；普通聊天继续使用原流式接口。
- 每次最多选择 10 个能力、发现 64 个工具、调用 12 次工具，最多 7 轮模型请求；能力请求总等待上限 180 秒，MCP 单请求 30 秒。工具原始文本最多传给模型 16000 字符，历史摘要最多 3000 字符。

## 验证

```sh
node scripts/qa-ai-integration/test-capabilities.mjs
node scripts/qa-ai-integration/test-mcp-http.mjs
node scripts/qa-ai-integration/test-chat-lifecycle.mjs
node scripts/qa-ai-integration/test-llm-stream.mjs
npx tsc --noEmit --incremental false
```

MCP 测试仅监听本机随机端口，使用模拟服务验证真实协议，不使用业务凭据。模型工具循环测试使用可控模拟响应，不依赖付费模型。

协议依据：[MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)、[MCP Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)。
