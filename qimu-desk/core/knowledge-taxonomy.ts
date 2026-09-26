import { NextResponse } from "next/server";
import { currentUser, requestToken, backendBaseUrl } from "./auth";
import { assertOrigin, jsonError } from "./api";

/** 共享目录只由 Java 后端修改，两端使用同一套权限与事务。 */
export async function taxonomyProxy(req: Request, kind: "categories" | "tags") {
  const user = await currentUser();
  if (!user) return jsonError("未登录", 401);
  if (user.role !== "admin") return jsonError("仅管理员可管理共享分类和标签", 403);
  if (!assertOrigin(req)) return jsonError("来源不合法", 403);
  try {
    const token = await requestToken();
    const response = await fetch(`${backendBaseUrl()}/api/knowledge/${kind}${new URL(req.url).search}`, {
      method: req.method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(req.method === "POST" ? { body: await req.text() } : {}),
      cache: "no-store",
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.ok && data.error ? 400 : response.status });
  } catch {
    return jsonError("分类和标签服务暂不可用，请稍后重试", 503);
  }
}
