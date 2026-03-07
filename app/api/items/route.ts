// app/api/items/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getItems } from "@/app/(dashboard)/inventory/queries";
import { ITEM_TYPES, type ItemType } from "@/app/(dashboard)/inventory/types";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("itemType");
  const itemType: ItemType | undefined =
    raw && (ITEM_TYPES as readonly string[]).includes(raw)
      ? (raw as ItemType)
      : undefined;
  const data = await getItems(itemType ? { itemType } : undefined);
  return NextResponse.json(data);
}
