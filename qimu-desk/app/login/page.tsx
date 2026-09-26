import { headers } from "next/headers";
import { previewEnabled, localRequest } from "@/core/local-preview";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

/** 统一登录：账号由后台统一管理（users 表），登录走后端 JWT */
export default async function LoginPage() {
  // 已登录直接进工作台
  // （延迟 require 避免循环依赖——LoginForm 在客户端侧）
  const { currentUser } = await import("@/core/auth");
  const user = await currentUser();
  if (user) redirect("/");

  return (
    <main className="login-page">
      <section className="login-context">
        <a href="/" className="brand">
          <img className="brand-logo" src="/logo-brand.png" alt="栖木工作台" width={32} height={32} />
          <span>栖木</span>
        </a>
        <div className="login-intro">
          <span className="section-label">个人工作空间</span>
          <h1>
            把注意力
            <br />
            留给手头的事。
          </h1>
          <p>从任务到项目，把资料、协作与日常工作放在一起。</p>
        </div>
        <div className="login-footnote">Qimu Desk</div>
      </section>
      <section className="login-form-panel">
        <div className="login-form-inner">
          <span className="section-label">WORKBENCH</span>
          <h2>登录工作台</h2>
          <p className="login-description">使用你的账号继续</p>
          <LoginForm
            previewEnabled={previewEnabled() && localRequest(await headers())}
          />
        </div>
      </section>
    </main>
  );
}
