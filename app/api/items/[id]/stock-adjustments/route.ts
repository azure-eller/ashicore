import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import { inventoryLotBalances, items } from "@/lib/db/schema";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import {
  manualIncreaseStockInTx,
  seedOpeningBalanceInTx,
} from "@/lib/inventory/kernel/operations/inventory";
import { resolvePositiveStockUnitCostInTx } from "@/lib/inventory/kernel/operations/stock-core";

const addInitialStockSchema = z.object({
  quantity: z
    .string()
    .trim()
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
      message: "Quantity must be greater than 0",
    }),
  costPerUnit: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value == null || (Number.isFinite(Number(value)) && Number(value) >= 0), {
      message: "Cost per unit must be zero or greater",
    }),
  occurredAt: z.string().datetime(),
  note: z
    .string()
    .nullable()
    .optional()
    .transform((value) => (value != null ? value.trim() || null : null)),
});

export const POST = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "addInitialStock");
  const { id } = await (ctx as RouteContext).params;
  const input = addInitialStockSchema.parse(await request.json());

  const result = await withAuthedOrgContext(async (tx, orgId, userId) => {
    await lockItemsInTx(tx, [id]);

    const [item] = await tx
      .select({ id: items.id, deletedAt: items.deletedAt })
      .from(items)
      .where(eq(items.id, id));

    if (!item || item.deletedAt != null) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    const [positiveLot] = await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.organizationId, orgId),
          eq(inventoryLotBalances.itemId, id),
          sql`${inventoryLotBalances.quantity} > 0`,
        ),
      );

    const occurredAt = new Date(input.occurredAt);

    if ((positiveLot?.count ?? 0) === 0) {
      const unitCost = await resolvePositiveStockUnitCostInTx(tx, {
        itemId: id,
        explicitUnitCost: input.costPerUnit,
        reason: "opening_cost_required",
      });
      return seedOpeningBalanceInTx(tx, {
        organizationId: orgId,
        itemId: id,
        quantity: Number(input.quantity),
        unitCost,
        actorUserId: userId,
        idempotencyKey,
        receivedAt: occurredAt,
      });
    }

    return manualIncreaseStockInTx(tx, {
      organizationId: orgId,
      itemId: id,
      quantity: Number(input.quantity),
      unitCost: input.costPerUnit,
      note: input.note,
      actorUserId: userId,
      idempotencyKey,
      occurredAt,
    });
  });

  if (result instanceof NextResponse) return result;
  return NextResponse.json(result);
});
