import { taskProxy } from "@/core/task-api";
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
async function forward(req: Request, {params}: {params:Promise<{id:string}>}) {
 const {id} = await params;
 if (!/^[1-9]\d*$/.test(id)) return NextResponse.json({error:"无效 ID"},{status:400});
 return taskProxy(req, `/${id}`);
}
export const PATCH = forward;
export const DELETE = forward;
