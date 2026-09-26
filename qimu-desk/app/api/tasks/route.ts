import { taskProxy } from "@/core/task-api";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => taskProxy(req);
export const POST = (req: Request) => taskProxy(req);
