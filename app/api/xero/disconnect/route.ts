import { apiHandler } from "@/lib/api/handler";
import { jsonFlag } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { deleteXeroConnection } from "@/lib/dal/xero";
import { tryRecordAccountingAuditEvent } from "@/lib/accounting/audit-events";
import {
  getAuthedXeroClient,
  isPermanentXeroGrantFailure,
} from "@/lib/xero/client";
import { XeroError } from "@/lib/xero/errors";

export const POST = apiHandler(async (request: Request) => {
  const context = await assertModuleWriteAccess("sales", request.headers);
  try {
    const { client } = await getAuthedXeroClient(context.orgId);
    await client.initialize();
    await client.revokeToken();
  } catch (error) {
    const grantIsAlreadyInvalid =
      (error instanceof XeroError && error.status === 401) ||
      isPermanentXeroGrantFailure(error);
    if (!grantIsAlreadyInvalid) throw error;
  }
  await deleteXeroConnection();
  await tryRecordAccountingAuditEvent({
    organizationId: context.orgId,
    actor: { type: "user", userId: context.userId },
    eventType: "xero_disconnect",
    outcome: "success",
    source: "POST /api/xero/disconnect",
  });
  return jsonFlag("disconnected");
});
