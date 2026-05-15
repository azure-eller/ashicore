import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import {
  assertLockedBomManagementAccess,
  assertModuleWriteAccess,
} from "@/lib/dal/auth";
import { InsufficientStockError, MissingCostBasisError } from "@/lib/inventory/kernel";
import { insertMasterItemSchema, updateItemSchema } from "@/lib/schemas/items";
import {
  deleteItem,
  getItem,
  updateItem,
  updateMasterProduct,
} from "@/app/(dashboard)/inventory/queries";


export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "updateItem");
  const { id } = await (ctx as RouteContext).params;
  const existingItem = await getItem(id);

  if (!existingItem) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (existingItem.itemType === "product" && existingItem.bomLocked) {
    await assertLockedBomManagementAccess(request.headers);
  }

  const body = await request.json();
  if (existingItem.isMaster) {
    const data = insertMasterItemSchema.parse(body);
    const item = await updateMasterProduct(id, data, { idempotencyKey });
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json(item);
  }

  const { stock, bom, revisionNote, ...itemData } = updateItemSchema.parse(body);
  const nextItemData =
    existingItem.parentId != null
      ? {
          ...itemData,
          name: existingItem.parentName ?? existingItem.name,
        }
      : itemData;

  if (existingItem.itemType === "product" && nextItemData.bomLocked && !existingItem.bomLocked) {
    await assertLockedBomManagementAccess(request.headers);
  }

  if (bom?.some((row) => row.componentId === id)) {
    return NextResponse.json(
      { errors: { bom: ["An item cannot reference itself as a component"] } },
      { status: 400 }
    );
  }

  try {
    const item = await updateItem(
      id,
      nextItemData,
      stock != null ? parseFloat(stock) : undefined,
      bom,
      revisionNote,
      { idempotencyKey }
    );
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return NextResponse.json(
        { errors: { stock: [error.message] } },
        { status: 400 }
      );
    }
    if (error instanceof MissingCostBasisError) {
      const field =
        error.reason === "material_default_price" ? "defaultPurchasePrice" : "stock";
      return NextResponse.json(
        { errors: { [field]: [error.message] } },
        { status: 400 }
      );
    }
    throw error;
  }
});

export const DELETE = apiHandler(async (_req: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", _req.headers);
  const { id } = await (ctx as RouteContext).params;

  const result = await deleteItem(id);
  if (result.hasActiveVariants) {
    return NextResponse.json(
      { error: "Cannot delete: this product still has active variants. Delete all variants first." },
      { status: 400 }
    );
  }
  if (result.usedInBom) {
    return NextResponse.json(
      { error: "Cannot delete: this item is used as a component in other products." },
      { status: 400 }
    );
  }
  if (result.usedInActiveOrders) {
    return NextResponse.json(
      {
        error:
          "Cannot delete: this product is still used by one or more active sales orders.",
      },
      { status: 400 }
    );
  }
  if (result.usedInActiveManufacturing) {
    return NextResponse.json(
      {
        error:
          "Cannot delete: this item is still used by one or more draft or released manufacturing orders.",
      },
      { status: 400 }
    );
  }
  if (result.usedInActivePurchasing) {
    return NextResponse.json(
      {
        error:
          "Cannot delete: this material is still used by one or more draft, ordered, or partially received purchase orders.",
      },
      { status: 400 }
    );
  }
  if (result.usedInDraftStocktakes) {
    return NextResponse.json(
      {
        error:
          "Cannot delete: this item is still included in one or more draft stocktakes.",
      },
      { status: 400 }
    );
  }
  if (!result.deleted) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
});
