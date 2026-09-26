import { listDocs, listCategories, listTags, ensureSeedDocs } from "@/core/knowledge";
import { currentUser } from "@/core/auth";
import { redirect } from "next/navigation";
import KnowledgeView from "@/components/knowledge/KnowledgeView";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  // 空库时播种示例文档（幂等），保证检索开箱可试
  await ensureSeedDocs();
  const [docs, categories, tags] = await Promise.all([
    listDocs({ user, limit: 500 }),
    listCategories(user),
    listTags(user),
  ]);
  return (
    <KnowledgeView
      user={{ id: user.id, role: user.role }}
      initialDocs={docs}
      initialCategories={categories}
      initialTags={tags}
    />
  );
}
