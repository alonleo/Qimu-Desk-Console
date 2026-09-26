import { listDocs, listCategories, listTags, ensureSeedDocs } from "@/core/knowledge";
import KnowledgeView from "@/components/knowledge/KnowledgeView";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  // 空库时播种示例文档（幂等），保证检索开箱可试
  await ensureSeedDocs();
  const [docs, categories, tags] = await Promise.all([
    listDocs(),
    listCategories(),
    listTags(),
  ]);
  return (
    <KnowledgeView
      initialDocs={docs}
      initialCategories={categories}
      initialTags={tags}
    />
  );
}
