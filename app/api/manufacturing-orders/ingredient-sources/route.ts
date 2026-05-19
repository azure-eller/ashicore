import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import { manufacturingOrderIngredients, stockAllocations } from "@/lib/db/schema";
import { trimScale } from "@/lib/db/numeric";
import { getAllocationWorkspaceInTx } from "@/lib/inventory/allocation/read-model";

export const GET = apiHandler(async (request: Request) => {
  await assertModuleReadAccess("manufacturing", request.headers);

  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get("itemId");
  const ingredientId = searchParams.get("ingredientId");
  const manufacturingOrderId = searchParams.get("manufacturingOrderId");

  if (!itemId) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }

  const data = await withAuthedOrgContext(async (tx, orgId) => {
    const workspace = await getAllocationWorkspaceInTx(tx, {
      organizationId: orgId,
      itemId,
    });

    if (!workspace) return null;

    const currentDemandIds = manufacturingOrderId
      ? (
          await tx
            .select({ id: manufacturingOrderIngredients.id })
            .from(manufacturingOrderIngredients)
            .where(
              and(
                eq(manufacturingOrderIngredients.manufacturingOrderId, manufacturingOrderId),
                eq(manufacturingOrderIngredients.itemId, itemId)
              )
            )
        ).map((row) => row.id)
      : ingredientId
        ? [ingredientId]
        : [];

    const currentAllocations =
      currentDemandIds.length > 0
        ? await tx
            .select({
              sourceId: stockAllocations.sourceId,
              quantity: trimScale(
                sql`COALESCE(SUM(${stockAllocations.quantity}), 0)`
              ).as("quantity"),
            })
            .from(stockAllocations)
            .where(
              and(
                eq(stockAllocations.organizationId, orgId),
                eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
                inArray(stockAllocations.demandId, currentDemandIds),
                eq(stockAllocations.itemId, itemId),
                eq(stockAllocations.sourceType, "inventory_lot"),
                eq(stockAllocations.status, "active")
              )
            )
            .groupBy(stockAllocations.sourceId)
        : [];

    return { ...workspace, currentAllocations };
  });

  if (!data) {
    return NextResponse.json({ error: "Ingredient sources not found" }, { status: 404 });
  }

  return NextResponse.json(data);
});
