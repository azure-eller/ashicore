import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import {
  billingUsageEvents,
  inventoryLocations,
  items,
  salesOrders,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";

export type BillingUsage = {
  skuCount: number;
  salesOrderCount: number;
  locationCount: number;
};

export async function getBillingUsageInTx(
  tx: Tx,
  orgId: string,
  options?: {
    periodStart?: Date | null;
    periodEnd?: Date | null;
    salesOrderSource?: "billing_events" | "shipped_orders";
  }
): Promise<BillingUsage> {
  const [skuRow] = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(items)
    .where(and(eq(items.organizationId, orgId), isNull(items.deletedAt)));

  const [salesOrderRow] =
    options?.salesOrderSource === "shipped_orders"
      ? await tx
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(salesOrders)
          .where(
            and(
              eq(salesOrders.organizationId, orgId),
              isNull(salesOrders.deletedAt),
              sql`${salesOrders.shippedAt} IS NOT NULL`,
              options.periodStart
                ? gte(salesOrders.shippedAt, options.periodStart)
                : undefined,
              options.periodEnd
                ? lt(salesOrders.shippedAt, options.periodEnd)
                : undefined
            )
          )
      : await tx
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(billingUsageEvents)
          .where(
            and(
              eq(billingUsageEvents.organizationId, orgId),
              options?.periodStart
                ? gte(billingUsageEvents.occurredAt, options.periodStart)
                : undefined,
              options?.periodEnd
                ? lt(billingUsageEvents.occurredAt, options.periodEnd)
                : undefined
            )
          );

  const [locationRow] = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(inventoryLocations)
    .where(
      and(
        eq(inventoryLocations.organizationId, orgId),
        isNull(inventoryLocations.deletedAt)
      )
    );

  return {
    skuCount: Number(skuRow?.count ?? 0),
    salesOrderCount: Number(salesOrderRow?.count ?? 0),
    locationCount: Number(locationRow?.count ?? 0),
  };
}
