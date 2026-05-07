import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { previewXeroContactImport } from "@/lib/xero/import-contacts";
import { XeroError } from "@/lib/xero/errors";

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const context = await getAuthedMemberContext();

  try {
    const result = await previewXeroContactImport(context.orgId, "customers");
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof XeroError) return error.toResponse();
    throw error;
  }
});
