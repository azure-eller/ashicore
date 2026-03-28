import { NextResponse } from "next/server";
import { apiHandler, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { InsufficientStockError, MissingStockCostError } from "@/lib/inventory/stock";
import { updateItemSchema } from "@/lib/schemas/items";
import { deleteItem, updateItem } from "@/app/(dashboard)/inventory/queries";


export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const { stock, bom, ...itemData } = updateItemSchema.parse(body);

  if (bom?.some((row) => row.componentId === id)) {
    return NextResponse.json(
      { errors: { bom: ["An item cannot reference itself as a component"] } },
      { status: 400 }
    );
  }

  try {
    const item = await updateItem(
      id,
      itemData,
      stock != null ? parseFloat(stock) : undefined,
      bom,
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
    if (error instanceof MissingStockCostError) {
      return NextResponse.json(
        { errors: { [error.field]: [error.message] } },
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
          "Cannot delete: this product is still used by one or more draft or confirmed sales orders.",
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
