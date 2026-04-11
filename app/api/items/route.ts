import { NextResponse } from "next/server";
import { getItems, createItemWithLot, createMasterProduct, deleteItems } from "@/app/(dashboard)/inventory/queries";
import { ITEM_TYPES, type ItemType } from "@/app/(dashboard)/inventory/types";
import { MissingStockCostError } from "@/lib/inventory/stock";
import { insertItemSchema, insertMasterItemSchema } from "@/lib/schemas/items";
import { bulkDeleteSchema } from "@/lib/schemas/shared";
import { apiHandler } from "@/lib/api/handler";
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
    const data = insertMasterItemSchema.parse(body);
    const item = await createMasterProduct(data);
    return NextResponse.json(item, { status: 201 });
  }

  const { stock, bom, revisionNote, ...data } = insertItemSchema.parse(body);

  if (data.itemType === "product" && data.bomLocked) {
    await assertLockedBomManagementAccess(request.headers);
  }

  try {
    const item = await createItemWithLot(data, stock, bom, revisionNote);
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (error instanceof MissingStockCostError) {
      return NextResponse.json(
        {
          errors: {
            [error.field]: [error.message],
          },
        },
        { status: 400 }
      );
    }

    throw error;
  }
});
