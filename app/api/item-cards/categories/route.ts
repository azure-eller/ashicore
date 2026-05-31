import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { jsonError } from "@/lib/api/responses";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import { requestSearchParams } from "@/lib/routing/search-params";
import { getItemFamilyCategories } from "@/lib/inventory/item-cards";
import { ITEM_TYPES, type ItemType } from "@/app/(dashboard)/inventory/types";

export const GET = apiHandler(async (request) => {
  await assertModuleReadAccess("inventory", request.headers);
  const raw = requestSearchParams(request).get("itemType");
  if (!raw || !(ITEM_TYPES as readonly string[]).includes(raw)) {
    return jsonError("Invalid itemType");
  }
  const categories = await getItemFamilyCategories(raw as ItemType);
  return NextResponse.json(categories);
});
