import { NextRequest, NextResponse } from "next/server";
import { currentUser, backendBaseUrl, requestToken } from "@/core/auth";
import { readJson } from "@/core/api";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  oldPassword: z.string().min(1, "请输入原密码"),
  newPassword: z.string().min(8, "新密码至少 8 位"),
});

/** POST /api/password - 修改当前用户密码 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "参数错误" }, { status: 400 });
  }

  const { oldPassword, newPassword } = parsed.data;

  // 调用后端 API 修改密码
  const token = await requestToken();
  try {
    const resp = await fetch(`${backendBaseUrl()}/api/user/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        userId: user.id,
        oldPassword,
        newPassword,
      }),
      cache: "no-store",
    });

    const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!data.ok) {
      return NextResponse.json({ error: data.error || "密码修改失败" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  }
}
