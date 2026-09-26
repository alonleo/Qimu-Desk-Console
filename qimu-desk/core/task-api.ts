import { NextResponse } from "next/server";
import { currentUser, requestToken, backendBaseUrl } from "./auth";
import { assertOrigin } from "./api";
export async function taskServer<T>(path: string): Promise<T> {
  const token = await requestToken();
  if (!token) throw new Error("请先登录");
  const response = await fetch(`${backendBaseUrl()}/api${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error("任务服务暂不可用，请稍后刷新");
  return response.json();
}
export async function taskProxy(req: Request, path = "") {
  if (!await currentUser()) return NextResponse.json({error:"未登录"},{status:401});
  if (req.method !== "GET" && !assertOrigin(req)) return NextResponse.json({error:"来源不合法"},{status:403});
  try {
    const token = await requestToken();
    const response = await fetch(`${backendBaseUrl()}/api/tasks${path}${new URL(req.url).search}`, {
      method: req.method, headers: { Authorization: `Bearer ${token}`, "Content-Type":"application/json" },
      body: req.method === "GET" ? undefined : await req.text(), cache:"no-store",
    });
    const data = await response.json();
    return NextResponse.json(req.method === "GET" && path === "" && response.ok ? {tasks:data} : data,{status:response.status});
  } catch { return NextResponse.json({error:"任务服务暂不可用，请稍后重试"},{status:503}); }
}
