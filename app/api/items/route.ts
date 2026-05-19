import { NextResponse } from "next/server";
import { getItems, createItemWithLot, deleteItems } from "@/app/(dashboard)/inventory/queries";
import { ITEM_TYPES, type ItemType } from "@/app/(dashboard)/inventory/types";
import { MissingCostBasisError } from "@/lib/inventory/kernel";
import { insertItemSchema } from "@/lib/schemas/items";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import { apiHandler, requireIdempotencyKey } from "@/lib/api/handler";
import {
  assertLockedBomManagementAccess,
  assertModuleReadAccess,
  assertModuleWriteAccess,
} from "@/lib/dal/auth";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("inventory", request.headers);
  const { searchParams } = new URL(request.url);
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
  const body = await request.json();
  const data = bulkDeleteSchema.parse(body);
  const result = await deleteItems(data.ids);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ deletedCount: result.deletedCount });
});

export const POST = apiHandler(async (request) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const body = await request.json();

  if (body.isMaster) {
    return NextResponse.json(
      {
        error:
          "Legacy variant master creation is disabled. Use /api/item-cards and variant-config instead.",
      },
      { status: 410 }
    );
  }

  const idempotencyKey = requireIdempotencyKey(request, "createItemWithLot");
  const { stock, bom, operationCosts, revisionNote, ...data } =
    insertItemSchema.parse(body);

  if (data.itemType === "product" && data.bomLocked) {
    await assertLockedBomManagementAccess(request.headers);
  }

  try {
    const item = await createItemWithLot(
      data,
      stock,
      bom,
      operationCosts,
      revisionNote,
      {
        idempotencyKey,
      }
    );
    return NextResponse.json(item, { status: 201 });
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
