import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { assertModuleAccess, assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  createItemCard,
  itemCardCreateSchema,
} from "@/lib/inventory/item-cards";

export const POST = apiHandler(async (request) => {
  const idempotencyKey = requireIdempotencyKey(request, "createItemCard");
  const data = itemCardCreateSchema.parse(await request.json());
  if (data.lotTrackingMode === "untracked") {
    await assertModuleAccess("inventory", "admin", request.headers);
  } else {
    await assertModuleWriteAccess("inventory", request.headers);
  }
  const item = await createItemCard(data, { idempotencyKey });
  return NextResponse.json(item, { status: 201 });
});
