import { jsonCreated } from "@/lib/api/responses";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  createItemCard,
  itemCardCreateSchema,
} from "@/lib/inventory/item-cards";

export const POST = apiHandler(async (request) => {
  const idempotencyKey = requireIdempotencyKey(request, "createItemCard");
  const data = await parseJsonBody(request, itemCardCreateSchema);
  if (data.lotTrackingMode === "untracked") {
    await assertModuleAccess("inventory", "admin", request.headers);
  } else {
    await assertModuleWriteAccess("inventory", request.headers);
  }
  const item = await createItemCard(data, { idempotencyKey });
  return jsonCreated(item);
});
