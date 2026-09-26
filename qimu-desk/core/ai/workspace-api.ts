import * as projects from "@/app/api/projects/route";
import * as project from "@/app/api/projects/[id]/route";
import * as knowledge from "@/app/api/knowledge/route";
import * as doc from "@/app/api/knowledge/[id]/route";
import * as notices from "@/app/api/notices/route";
import * as notice from "@/app/api/notices/[id]/route";
import { taskProxy } from "@/core/task-api";
import { currentUser, requestToken, backendBaseUrl } from "@/core/auth";
import { row } from "@/core/db";
import type { WorkspaceTransport } from "./workspace-tools";

/** Invoke the same authenticated handlers as the UI; never accept model URLs or credentials. */
export function workspaceTransport(signal: AbortSignal): WorkspaceTransport {
  return async ({ resource, action, id, data, query }) => {
    signal.throwIfAborted();
    const user = await currentUser();
    if (!user) return { ok: false, data: { error: "登录已失效" } };
    const method = { list: "GET", get: "GET", create: "POST", update: "PATCH", delete: "DELETE" }[action];
    const params = new URLSearchParams(Object.entries(query || {}).map(([key, value]) => [key, String(value)]));
    const body = resource === "knowledge" && action === "create" ? { ...data, source: "ai" } : data;
    const req = new Request(`http://workspace.internal/api/${resource}?${params}`, {
      method, signal, headers: { "Content-Type": "application/json" },
      ...(method !== "GET" ? { body: JSON.stringify(body || {}) } : {}),
    });
    const ctx = { params: Promise.resolve({ id: String(id) }) };
    let response: Response;
    if (resource === "notices" && user.role === "admin") {
      if (action === "get") {
        const record = await row("SELECT * FROM notice WHERE id = ?", [id!]);
        return { ok: !!record, data: record ? { notice: record } : { error: "通知不存在" } };
      }
      const token = await requestToken();
      response = await fetch(`${backendBaseUrl()}/api/notices${["update", "delete"].includes(action) ? `/${id}` : ""}?${params}`, {
        method: action === "update" ? "PUT" : method, signal, cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(method !== "GET" ? { body: JSON.stringify(body || {}) } : {}),
      });
    } else if (resource === "notices") {
      if (action !== "list" && action !== "get") return { ok: false, data: { error: "仅管理员可管理通知公告" } };
      if (query?.type) params.set("tab", String(query.type));
      response = action === "get" ? await notice.GET(req, ctx) : await notices.GET(new Request(`http://workspace.internal/api/notices?${params}`));
    } else if (resource === "tasks") {
      response = await taskProxy(req, ["update", "delete"].includes(action) ? `/${id}` : "");
    } else if (resource === "projects") {
      response = action === "create" ? await projects.POST(req) : action === "update" ? await project.PATCH(req, ctx)
        : action === "delete" ? await project.DELETE(req, ctx) : await projects.GET(action === "get" ? new Request("http://workspace.internal/api/projects?includeArchived=1") : req);
    } else {
      response = action === "create" ? await knowledge.POST(req) : action === "update" ? await doc.PATCH(req, ctx)
        : action === "delete" ? await doc.DELETE(req, ctx) : action === "get" ? await doc.GET(req, ctx) : await knowledge.GET(req);
    }
    const payload = await response.json();
    if (response.ok && action === "get" && (resource === "tasks" || resource === "projects")) {
      const record = payload[resource]?.find((item: { id: number }) => Number(item.id) === id);
      return { ok: !!record, data: record || { error: "条目不存在或无权访问" } };
    }
    return { ok: response.ok && payload?.ok !== false && !payload?.error, data: payload };
  };
}
