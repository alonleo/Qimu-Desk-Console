import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8080";

/**
 * 服务端组件取数：把浏览器 token cookie 转发给 Spring Boot 后端。
 * 返回后端的 JSON（格式与组件期望一致，未包装）。
 *
 * 401（未登录/token 过期）时跳转登录页，而不是抛错——
 * 布局与页面并行渲染，页面抛错会压过布局的 redirect，导致
 * 用户看到 "Application error: digest" 而非登录页。
 */
export async function serverApi<T>(path: string): Promise<T> {
  const token = (await cookies()).get("token")?.value;

  // 如果没有 token，直接跳转登录页
  if (!token) {
    redirect("/login");
  }

  try {
    const res = await fetch(`${BACKEND}/api${path}`, {
      headers: { Cookie: `token=${token}` },
      cache: "no-store",
    });

    if (res.status === 401) {
      // Token 过期，跳转登录页
      redirect("/login");
    }

    if (!res.ok) {
      // 非 200 状态码，抛出包含状态码的友好错误
      throw new Error(`后端请求失败：${path} (HTTP ${res.status})`);
    }

    return res.json() as Promise<T>;
  } catch (error) {
    // 如果是 redirect 异常，重新抛出让它被 Next.js 处理
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }
    // 其他错误也重新抛出，让 error boundary 捕获
    throw error;
  }
}
