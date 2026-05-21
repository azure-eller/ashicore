import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { getItemFamilyCategories } from "@/lib/inventory/item-cards";
import { ITEM_TYPES, type ItemType } from "@/app/(dashboard)/inventory/types";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("inventory", request.headers);
  const raw = new URL(request.url).searchParams.get("itemType");
  if (!raw || !(ITEM_TYPES as readonly string[]).includes(raw)) {
    return NextResponse.json({ error: "Invalid itemType" }, { status: 400 });
  }
  const categories = await getItemFamilyCategories(raw as ItemType);
  return NextResponse.json(categories);
});
