import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  createItemCard,
  itemCardCreateSchema,
} from "@/lib/inventory/item-cards";

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "createItemCard");
  const data = itemCardCreateSchema.parse(await request.json());
  const item = await createItemCard(data, { idempotencyKey });
  return NextResponse.json(item, { status: 201 });
});
