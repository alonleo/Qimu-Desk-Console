import { headers } from "next/headers";
import { previewEnabled, localRequest } from "@/core/local-preview";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-context">
        <a href="/" className="brand">
          <img className="brand-logo" src="/logo-brand.png" alt="栖木管理台" width={32} height={32} />
          <span>栖木</span>
        </a>
        <div className="login-intro">
          <span className="section-label">管理控制台</span>
          <h1>
            让管理
            <br />
            井然有序。
          </h1>
          <p>管理成员、维护内容，查看任务与工作流的执行记录。</p>
        </div>
        <div className="login-footnote">Qimu Console</div>
      </section>
      <section className="login-form-panel">
        <div className="login-form-inner">
          <span className="section-label">ADMIN</span>
          <h2>登录管理后台</h2>
          <p className="login-description">使用你的账号继续</p>
          <LoginForm
            previewEnabled={previewEnabled() && localRequest(await headers())}
          />
        </div>
      </section>
    </main>
  );
}
