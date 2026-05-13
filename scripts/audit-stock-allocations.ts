import { and, eq, sql } from "drizzle-orm";
import { loadWorktreeEnv } from "./load-worktree-env";

type Finding = {
  check: string;
  count: number;
  details?: unknown;
};

async function main() {
  loadWorktreeEnv();

  const { db } = await import("@/lib/db");
  const {
    inventoryLotBalances,
    lots,
    manufacturingOrders,
    salesOrderLines,
    stockAllocations,
    manufacturingOrderIngredients,
  } = await import("@/lib/db/schema");

  const findings: Finding[] = [];

  const [invalidSourceTypes] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.status, "active"),
        sql`${stockAllocations.sourceType} NOT IN ('inventory_lot', 'manufacturing_order')`
      )
    );
  if ((invalidSourceTypes?.count ?? 0) > 0) {
    findings.push({ check: "invalid active source types", count: invalidSourceTypes.count });
  }

  const [nullSourceIds] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(stockAllocations)
    .where(and(eq(stockAllocations.status, "active"), sql`${stockAllocations.sourceId} IS NULL`));
  if ((nullSourceIds?.count ?? 0) > 0) {
    findings.push({ check: "active null source_id", count: nullSourceIds.count });
  }

  const lotMismatchRows = await db
    .select({
      allocationId: stockAllocations.id,
      allocationItemId: stockAllocations.itemId,
      sourceItemId: lots.itemId,
    })
    .from(stockAllocations)
    .innerJoin(lots, eq(stockAllocations.sourceId, lots.id))
    .where(
      and(
        eq(stockAllocations.status, "active"),
        eq(stockAllocations.sourceType, "inventory_lot"),
        sql`${stockAllocations.itemId} <> ${lots.itemId}`
      )
    );
  if (lotMismatchRows.length > 0) {
    findings.push({
      check: "inventory_lot source item mismatch",
      count: lotMismatchRows.length,
      details: lotMismatchRows.slice(0, 10),
    });
  }

  const moMismatchRows = await db
    .select({
      allocationId: stockAllocations.id,
      allocationItemId: stockAllocations.itemId,
      sourceItemId: manufacturingOrders.productId,
    })
    .from(stockAllocations)
    .innerJoin(manufacturingOrders, eq(stockAllocations.sourceId, manufacturingOrders.id))
    .where(
      and(
        eq(stockAllocations.status, "active"),
        eq(stockAllocations.sourceType, "manufacturing_order"),
        sql`${stockAllocations.itemId} <> ${manufacturingOrders.productId}`
      )
    );
  if (moMismatchRows.length > 0) {
    findings.push({
      check: "manufacturing_order source item mismatch",
      count: moMismatchRows.length,
      details: moMismatchRows.slice(0, 10),
    });
  }

  const unavailableLotRows = await db
    .select({
      allocationId: stockAllocations.id,
      lotId: stockAllocations.sourceId,
    })
    .from(stockAllocations)
    .leftJoin(
      inventoryLotBalances,
      and(
        eq(stockAllocations.organizationId, inventoryLotBalances.organizationId),
        eq(stockAllocations.itemId, inventoryLotBalances.itemId),
        eq(stockAllocations.sourceId, inventoryLotBalances.lotId),
        eq(inventoryLotBalances.disposition, "available"),
        sql`${inventoryLotBalances.quantity} > 0`
      )
    )
    .where(
      and(
        eq(stockAllocations.status, "active"),
        eq(stockAllocations.sourceType, "inventory_lot"),
        sql`${inventoryLotBalances.lotId} IS NULL`
      )
    );
  if (unavailableLotRows.length > 0) {
    findings.push({
      check: "active inventory_lot allocation without available lot balance",
      count: unavailableLotRows.length,
      details: unavailableLotRows.slice(0, 10),
    });
  }

  const salesDemandMismatchRows = await db
    .select({
      allocationId: stockAllocations.id,
      allocationItemId: stockAllocations.itemId,
      demandItemId: salesOrderLines.itemId,
    })
    .from(stockAllocations)
    .innerJoin(salesOrderLines, eq(stockAllocations.demandId, salesOrderLines.id))
    .where(
      and(
        eq(stockAllocations.status, "active"),
        eq(stockAllocations.demandType, "sales_order_line"),
        sql`${stockAllocations.itemId} <> ${salesOrderLines.itemId}`
      )
    );
  if (salesDemandMismatchRows.length > 0) {
    findings.push({
      check: "sales_order_line demand item mismatch",
      count: salesDemandMismatchRows.length,
      details: salesDemandMismatchRows.slice(0, 10),
    });
  }

  const manufacturingDemandMismatchRows = await db
    .select({
      allocationId: stockAllocations.id,
      allocationItemId: stockAllocations.itemId,
      demandItemId: manufacturingOrderIngredients.itemId,
    })
    .from(stockAllocations)
    .innerJoin(
      manufacturingOrderIngredients,
      eq(stockAllocations.demandId, manufacturingOrderIngredients.id)
    )
    .where(
      and(
        eq(stockAllocations.status, "active"),
        eq(stockAllocations.demandType, "manufacturing_order_ingredient"),
        sql`${stockAllocations.itemId} <> ${manufacturingOrderIngredients.itemId}`
      )
    );
  if (manufacturingDemandMismatchRows.length > 0) {
    findings.push({
      check: "manufacturing_order_ingredient demand item mismatch",
      count: manufacturingDemandMismatchRows.length,
      details: manufacturingDemandMismatchRows.slice(0, 10),
    });
  }

  if (findings.length > 0) {
    console.error(JSON.stringify({ ok: false, findings }, null, 2));
    process.exit(1);
  }

  console.log("Stock allocation audit passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
