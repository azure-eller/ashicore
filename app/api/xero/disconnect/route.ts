import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { deleteXeroConnection } from "@/lib/dal/xero";

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  await deleteXeroConnection();
  return NextResponse.json({ disconnected: true });
});
