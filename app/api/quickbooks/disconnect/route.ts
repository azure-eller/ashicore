import { apiHandler } from "@/lib/api/handler";
import { jsonFlag } from "@/lib/api/responses";
import { ACCOUNTING_PROVIDER_QUICKBOOKS } from "@/lib/accounting/constants";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { deleteAccountingConnection } from "@/lib/dal/accounting";

export const POST = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const context = await getAuthedMemberContext();
  await deleteAccountingConnection(context.orgId, ACCOUNTING_PROVIDER_QUICKBOOKS);
  return jsonFlag("disconnected");
});
