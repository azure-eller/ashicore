import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { updateItemWithStockSchema } from "@/lib/schemas/items";
import { deleteItem, updateItemWithStock } from "@/app/(dashboard)/inventory/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const { newStock, ...itemData } = updateItemWithStockSchema.parse(body);

  // Build stock adjustment if stock value was provided
  let stockAdjustment: Parameters<typeof updateItemWithStock>[2] | undefined;
  if (newStock != null) {
    stockAdjustment = {
      newStock: parseFloat(newStock),
      reason: "adjustment",
    };
  }

  try {
    const item = await updateItemWithStock(id, itemData, stockAdjustment);
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stock adjustment failed";
    return NextResponse.json(
      { errors: { newStock: [message] } },
      { status: 400 }
    );
  }
});

export const DELETE = apiHandler(async (_req: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const deleted = await deleteItem(id);
  if (!deleted) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
});
