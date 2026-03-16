import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { updateItemSchema } from "@/lib/schemas/items";
import { deleteItem, updateItem, isItemUsedInBom } from "@/app/(dashboard)/inventory/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const { stock, bom, ...itemData } = updateItemSchema.parse(body);

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
    if (error instanceof Error && error.message.startsWith("Insufficient stock")) {
      return NextResponse.json(
        { errors: { stock: [error.message] } },
        { status: 400 }
      );
    }
    throw error;
  }
});

export const DELETE = apiHandler(async (_req: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;

  const usedInBom = await isItemUsedInBom(id);
  if (usedInBom) {
    return NextResponse.json(
      { error: "Cannot delete: this item is used as a component in other products." },
      { status: 400 }
    );
  }

  const deleted = await deleteItem(id);
  if (!deleted) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
});
