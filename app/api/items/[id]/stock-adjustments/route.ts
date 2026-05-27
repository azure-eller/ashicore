import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { apiHandler, requireIdempotencyKey, type RouteContext } from "@/lib/api/handler";
import { assertModuleWriteAccess, withAuthedOrgContext } from "@/lib/dal/auth";
import { inventoryLotBalances, items } from "@/lib/db/schema";
import { lockItemsInTx } from "@/lib/inventory/kernel/locking";
import {
  manualDecreaseStockInTx,
  manualIncreaseStockInTx,
  seedOpeningBalanceInTx,
} from "@/lib/inventory/kernel/operations/inventory";
import { getDefaultInventoryLocationInTx } from "@/lib/inventory/kernel/locations";
import { resolvePositiveStockUnitCostInTx } from "@/lib/inventory/kernel/operations/stock-core";
import { getItemLotTrackingModeInTx } from "@/lib/inventory/lot-tracking";

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

const setItemStockSchema = z.object({
  quantity: z
    .string()
    .trim()
    .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, {
      message: "Quantity must be zero or greater",
    }),
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

export const PUT = apiHandler(async (request: Request, ctx: unknown) => {
  await assertModuleWriteAccess("inventory", request.headers);
  const idempotencyKey = requireIdempotencyKey(request, "setItemStockQuantity");
  const { id } = await (ctx as RouteContext).params;
  const input = setItemStockSchema.parse(await request.json());

  const result = await withAuthedOrgContext(async (tx, orgId, userId) => {
    await lockItemsInTx(tx, [id]);

    const [item] = await tx
      .select({ id: items.id, deletedAt: items.deletedAt })
      .from(items)
      .where(eq(items.id, id));

    if (!item || item.deletedAt != null) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    const lotTrackingMode = await getItemLotTrackingModeInTx(tx, id);
    if (lotTrackingMode !== "untracked") {
      return NextResponse.json(
        { error: "Set item quantity is only available for untracked items." },
        { status: 409 }
      );
    }

    const location = await getDefaultInventoryLocationInTx(tx, orgId);
    const [current] = await tx
      .select({
        quantity: sql<string>`COALESCE(SUM(${inventoryLotBalances.quantity}), 0)`,
      })
      .from(inventoryLotBalances)
      .where(
        and(
          eq(inventoryLotBalances.organizationId, orgId),
          eq(inventoryLotBalances.locationId, location.id),
          eq(inventoryLotBalances.itemId, id),
          eq(inventoryLotBalances.disposition, "available"),
        ),
      );

    const currentQuantity = Number(current?.quantity ?? "0");
    const nextQuantity = Number(input.quantity);
    const delta = nextQuantity - currentQuantity;

    if (delta === 0) {
      return { quantity: input.quantity };
    }

    if (delta > 0) {
      return manualIncreaseStockInTx(tx, {
        organizationId: orgId,
        itemId: id,
        quantity: delta,
        note: input.note,
        actorUserId: userId,
        idempotencyKey: `${idempotencyKey}:increase`,
      });
    }

    return manualDecreaseStockInTx(tx, {
      organizationId: orgId,
      itemId: id,
      quantity: Math.abs(delta),
      note: input.note,
      actorUserId: userId,
      idempotencyKey: `${idempotencyKey}:decrease`,
    });
  });

  if (result instanceof NextResponse) return result;
  return NextResponse.json(result);
});
