import { jsonCreated } from "@/lib/api/responses";
import { createInventoryTransfer } from "@/lib/inventory/queries/transfers";
import { createTransferSchema } from "@/lib/schemas/transfers";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess } from "@/lib/dal/auth";

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "createInventoryTransfer");
  const data = await parseJsonBody(request, createTransferSchema);
  const result = await createInventoryTransfer(data, { idempotencyKey });
  return jsonCreated(result);
});
