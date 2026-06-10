import { NextResponse } from "next/server";
import { getItems, createItemWithLot, deleteItems } from "@/app/(dashboard)/inventory/queries";
import { ITEM_TYPES, type ItemType } from "@/lib/inventory/types";
import { MissingCostBasisError } from "@/lib/inventory/kernel";
import { insertItemSchema } from "@/lib/schemas/items";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { jsonError, jsonCreated } from "@/lib/api/responses";
import { requestSearchParams } from "@/lib/routing/search-params";
import {
  assertLockedBomManagementAccess,
  assertModuleReadAccess,
  assertModuleWriteAccess,
} from "@/lib/dal/auth";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("inventory", request.headers);
  const searchParams = requestSearchParams(request);
  const raw = searchParams.get("itemType");
  const itemType: ItemType | undefined =
    raw && (ITEM_TYPES as readonly string[]).includes(raw)
      ? (raw as ItemType)
      : undefined;
  const data = await getItems(itemType ? { itemType } : undefined);
  return NextResponse.json(data);
});

export const DELETE = apiHandler(async (request) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const data = await parseJsonBody(request, bulkDeleteSchema);
  const result = await deleteItems(data.ids);

  if (result.error) {
    return jsonError(result.error);
  }

  return NextResponse.json({ deletedCount: result.deletedCount });
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("inventory", request.headers);

  const idempotencyKey = requireIdempotencyKey(request, "createItemWithLot");
  const { stock, outputQuantity, bom, operationCosts, revisionNote, ...data } =
    await parseJsonBody(request, insertItemSchema);

  if (data.itemType === "product" && data.bomLocked) {
    await assertLockedBomManagementAccess(request.headers);
  }

  try {
    const item = await createItemWithLot(
      data,
      stock,
      outputQuantity,
      bom,
      operationCosts,
      revisionNote,
      {
        idempotencyKey,
      }
    );
    return jsonCreated(item);
  } catch (error) {
    if (error instanceof MissingCostBasisError) {
      const field =
        error.reason === "material_default_price" ? "defaultPurchasePrice" : "stock";
      return NextResponse.json(
        {
          errors: {
            [field]: [error.message],
          },
        },
        { status: 400 }
      );
    }

    throw error;
  }
});
