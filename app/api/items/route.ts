import { NextResponse } from "next/server";
import { getItems, createItemWithLot } from "@/app/(dashboard)/inventory/queries";
import { ITEM_TYPES, type ItemType } from "@/app/(dashboard)/inventory/types";
import { insertItemSchema } from "@/lib/schemas/items";
import { apiHandler } from "@/lib/api/handler";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("itemType");
  const itemType: ItemType | undefined =
    raw && (ITEM_TYPES as readonly string[]).includes(raw)
      ? (raw as ItemType)
      : undefined;
  const data = await getItems(itemType ? { itemType } : undefined);
  return NextResponse.json(data);
}

export const POST = apiHandler(async (request) => {
  const body = await request.json();
  const { stock, bom, ...data } = insertItemSchema.parse(body);
  const item = await createItemWithLot(data, stock, bom);
  return NextResponse.json(item, { status: 201 });
});
