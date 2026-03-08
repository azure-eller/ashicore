// app/api/items/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getItems, createItem } from "@/app/(dashboard)/inventory/queries";
import { ITEM_TYPES, type ItemType } from "@/app/(dashboard)/inventory/types";
import { insertItemSchema } from "@/lib/schemas/items";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("itemType");
  const itemType: ItemType | undefined =
    raw && (ITEM_TYPES as readonly string[]).includes(raw)
      ? (raw as ItemType)
      : undefined;
  const data = await getItems(itemType ? { itemType } : undefined);
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const result = insertItemSchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json(
      { errors: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const item = await createItem(result.data);
  return NextResponse.json(item, { status: 201 });
}
