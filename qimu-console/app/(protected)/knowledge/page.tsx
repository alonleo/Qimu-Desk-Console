import { serverApi } from "@/utils/serverApi";
import KnowledgeManager from "@/components/knowledge/KnowledgeManager";
import type { DocRow, CategoryRow, TagRow } from "@/components/knowledge/KnowledgeManager";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const data = await serverApi<{ docs: DocRow[]; categories: CategoryRow[]; tags: TagRow[] }>("/knowledge");
  return (
    <KnowledgeManager initialDocs={data.docs} initialCategories={data.categories} initialTags={data.tags} />
  );
}
