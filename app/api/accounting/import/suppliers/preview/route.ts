import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { previewXeroContactImport } from "@/lib/xero/import-contacts";
export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("purchasing", request.headers);
  const context = await getAuthedMemberContext();

  const result = await previewXeroContactImport(context.orgId, "suppliers");
  return NextResponse.json(result);
});
