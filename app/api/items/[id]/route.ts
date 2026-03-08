import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { insertItemSchema } from "@/lib/schemas/items";
import { deleteItem, updateItem } from "@/app/(dashboard)/inventory/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  const body = await request.json();
  const data = insertItemSchema.parse(body);
  const item = await updateItem(id, data);
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  return NextResponse.json(item);
});

export const DELETE = apiHandler(async (_req: Request, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params;
  await deleteItem(id);
  return NextResponse.json({ success: true });
});
