import { NextResponse } from "next/server";
import { getItems, createItemWithLot, createMasterProduct, deleteItems } from "@/app/(dashboard)/inventory/queries";
import {
  INVENTORY_PRODUCT_VIEWS,
  ITEM_TYPES,
  type InventoryProductView,
  type ItemType,
} from "@/app/(dashboard)/inventory/types";
import { MissingCostBasisError } from "@/lib/inventory/kernel";
import { insertItemSchema, insertMasterItemSchema } from "@/lib/schemas/items";
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
  const rawView = searchParams.get("view");
  const itemType: ItemType | undefined =
    raw && (ITEM_TYPES as readonly string[]).includes(raw)
      ? (raw as ItemType)
      : undefined;
  const view: InventoryProductView | undefined =
    rawView && (INVENTORY_PRODUCT_VIEWS as readonly string[]).includes(rawView)
      ? (rawView as InventoryProductView)
      : undefined;
  const data = await getItems(
    itemType ? { itemType, view: itemType === "product" ? view : undefined } : undefined
  );
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
    const idempotencyKey = requireIdempotencyKey(request, "createMasterProduct");
    const data = insertMasterItemSchema.parse(body);
    const item = await createMasterProduct(data, { idempotencyKey });
    return NextResponse.json(item, { status: 201 });
  }

  const idempotencyKey = requireIdempotencyKey(request, "createItemWithLot");
  const { stock, bom, revisionNote, ...data } = insertItemSchema.parse(body);

  if (data.itemType === "product" && data.bomLocked) {
    await assertLockedBomManagementAccess(request.headers);
  }

  try {
    const item = await createItemWithLot(data, stock, bom, revisionNote, {
      idempotencyKey,
    });
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
