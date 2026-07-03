import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { jsonError, jsonNotFound, jsonSuccess } from "@/lib/api/responses";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { deleteItem } from "@/lib/inventory/queries/item-write";
import { getItem } from "@/lib/inventory/queries/item-detail";
import { deleteVariant, ItemCardError } from "@/lib/inventory/item-cards";

export const DELETE = apiHandler(async (_req: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", _req.headers);
  const { id } = await (ctx as RouteContext).params;
  const existingItem = await getItem(id);

  if (!existingItem) {
    return jsonNotFound("Item not found");
  }

  if (existingItem.familyId) {
    const idempotencyKey = requireIdempotencyKey(_req, "deleteItemCardVariant");
    try {
      return NextResponse.json(await deleteVariant(id, { idempotencyKey }));
    } catch (error) {
      if (error instanceof ItemCardError) {
        return jsonError(error.message, error.status);
      }
      throw error;
    }
  }

  const result = await deleteItem(id);
  if (result.usedInBom) {
    return jsonError("Cannot delete: this item is used as a component in other products.");
  }
  if (result.usedInActiveOrders) {
    return jsonError(
      "Cannot delete: this product is still used by one or more active sales orders."
    );
  }
  if (result.usedInActiveManufacturing) {
    return jsonError(
      "Cannot delete: this item is still used by one or more open manufacturing orders."
    );
  }
  if (result.usedInActivePurchasing) {
    return jsonError(
      "Cannot delete: this material is still used by one or more ordered or partially received purchase orders."
    );
  }
  if (result.usedInDraftStocktakes) {
    return jsonError(
      "Cannot delete: this item is still included in one or more draft stocktakes."
    );
  }
  if (!result.deleted) {
    return jsonNotFound("Item not found");
  }
  return jsonSuccess();
});
