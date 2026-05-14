import { eq, or, sql } from "drizzle-orm";
import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

type CleanupRow = {
  locationId: string;
  itemId: string;
  referenceId: string;
  currentQty: string;
  desiredQty: string;
};

function getArgValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function toQuantity(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantityString(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const orgRef = getArgValue("--org") ?? "paonia-soil-company";

  const { db } = await import("@/lib/db");
  const { organization } = await import("@/lib/db/schema");
  const { withOrgContext } = await import("@/lib/db/with-org-context");
  const { applyReservationReferenceDeltasInTx } = await import(
    "@/lib/inventory/kernel/operations/common"
  );

  const [org] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    })
    .from(organization)
    .where(
      or(
        eq(organization.id, orgRef),
        eq(organization.slug, orgRef),
        eq(organization.name, orgRef)
      )
    );

  if (!org) {
    throw new Error(`Organization not found: ${orgRef}`);
  }

  const rows = await withOrgContext(org.id, async (tx) => {
    const result = await tx.execute(sql<CleanupRow>`
      SELECT
        reservations.location_id AS "locationId",
        reservations.item_id AS "itemId",
        reservations.reference_id AS "referenceId",
        reservations.quantity::text AS "currentQty",
        COALESCE(SUM(allocations.quantity), 0)::text AS "desiredQty"
      FROM inventory.inventory_reservations_summary reservations
      LEFT JOIN inventory.stock_allocations allocations
        ON allocations.organization_id = reservations.organization_id
       AND allocations.demand_type = 'sales_order_line'
       AND allocations.demand_id = reservations.reference_id
       AND allocations.item_id = reservations.item_id
       AND allocations.source_type = 'inventory_lot'
       AND allocations.status = 'active'
      WHERE reservations.organization_id = ${org.id}
        AND reservations.reference_type = 'sales_order_line'
      GROUP BY
        reservations.location_id,
        reservations.item_id,
        reservations.reference_id,
        reservations.quantity
      HAVING reservations.quantity > COALESCE(SUM(allocations.quantity), 0)
      ORDER BY reservations.location_id, reservations.item_id, reservations.reference_id
    `);
    return Array.isArray(result) ? result : result.rows;
  });

  const candidates = rows.map((row) => {
    const currentQty = toQuantity(row.currentQty);
    const desiredQty = toQuantity(row.desiredQty);
    return {
      locationId: row.locationId,
      itemId: row.itemId,
      referenceId: row.referenceId,
      currentQty,
      desiredQty,
      releaseQty: Math.max(0, currentQty - desiredQty),
    };
  });

  const summary = candidates.reduce(
    (acc, row) => {
      acc.lineCount += 1;
      acc.releaseQty += row.releaseQty;
      return acc;
    },
    { lineCount: 0, releaseQty: 0 }
  );

  console.log(
    JSON.stringify(
      {
        organization: { id: org.id, slug: org.slug, name: org.name },
        apply,
        lineCount: summary.lineCount,
        releaseQty: quantityString(summary.releaseQty),
        sample: candidates.slice(0, 20),
      },
      null,
      2
    )
  );

  if (!apply || candidates.length === 0) {
    return;
  }

  const byLocation = new Map<string, typeof candidates>();
  for (const row of candidates) {
    const bucket = byLocation.get(row.locationId) ?? [];
    bucket.push(row);
    byLocation.set(row.locationId, bucket);
  }

  await withOrgContext(org.id, async (tx) => {
    for (const [locationId, locationRows] of byLocation.entries()) {
      await applyReservationReferenceDeltasInTx(tx, {
        organizationId: org.id,
        locationId,
        eventSubtype: "sales_reservation_cleanup",
        deltas: locationRows.map((row) => ({
          itemId: row.itemId,
          referenceType: "sales_order_line",
          referenceId: row.referenceId,
          quantity: -row.releaseQty,
        })),
      });
    }
  });

  console.log(
    `Released ${quantityString(summary.releaseQty)} units from ${summary.lineCount} legacy SO reservations.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
