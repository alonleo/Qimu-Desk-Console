"use client";
import { useState } from "react";
import { Button, message } from "antd";
import { useRouter } from "next/navigation";
export default function PreviewExit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch("/api/local-preview", { method: "DELETE" });
          if (!res.ok) throw new Error();
          router.replace("/login");
          router.refresh();
        } catch {
          message.error("退出失败，请重试");
        } finally {
          setBusy(false);
        }
      }}
    >
      退出预览
    </Button>
  );
}
