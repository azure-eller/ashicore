import { NextResponse } from "next/server";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import {
  deleteItem,
  getItem,
} from "@/app/(dashboard)/inventory/queries";
import { deleteVariant, ItemCardError } from "@/lib/inventory/item-cards";

export const DELETE = apiHandler(async (_req: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", _req.headers);
  const { id } = await (ctx as RouteContext).params;
  const existingItem = await getItem(id);

  if (!existingItem) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (existingItem.familyId) {
    const idempotencyKey = requireIdempotencyKey(_req, "deleteItemCardVariant");
    try {
      return NextResponse.json(await deleteVariant(id, { idempotencyKey }));
    } catch (error) {
      if (error instanceof ItemCardError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

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
          "Cannot delete: this product is still used by one or more active sales orders.",
      },
      { status: 400 }
    );
  }
  if (result.usedInActiveManufacturing) {
    return NextResponse.json(
      {
        error:
          "Cannot delete: this item is still used by one or more open manufacturing orders.",
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
