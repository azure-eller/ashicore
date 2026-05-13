import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { previewXeroPurchasingSync } from "@/lib/xero/import-purchasing";
import { XeroError } from "@/lib/xero/errors";

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const context = await getAuthedMemberContext();

  try {
    const result = await previewXeroPurchasingSync(context.orgId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof XeroError) return error.toResponse();
    throw error;
  }
});
