import { taskProxy } from "@/core/task-api";
export const dynamic = "force-dynamic";
export const POST = (req: Request) => taskProxy(req, "/batch-delete");
