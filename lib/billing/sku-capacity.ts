import { and, eq, isNull, sql } from "drizzle-orm";
import { items, organization } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { DomainError } from "@/lib/errors/domain-error";
import { env } from "@/lib/env";
import { FREE_SKU_LIMIT } from "./types";

export class SkuCapacityError extends DomainError<{
  billing: {
    dimension: "skus";
    limit: number;
    current: number;
    requested: number;
  };
}> {
  constructor(current: number, requested: number) {
    super(
      `Free includes up to ${FREE_SKU_LIMIT} active SKUs. Start Pro for unlimited SKUs.`,
      402,
      {
        name: "SkuCapacityError",
        extra: {
          billing: {
            dimension: "skus",
            limit: FREE_SKU_LIMIT,
            current,
            requested,
          },
        },
      }
    );
  }
}

export async function lockSkuCapacityOrgInTx(tx: Tx, orgId: string) {
  const [org] = await tx
    .select({
      plan: organization.plan,
      skuLimitStartsAt: organization.skuLimitStartsAt,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .for("update");

  if (!org) throw new Error("Active organization not found for SKU capacity check.");
  return org;
}

export async function assertSkuCapacityInTx(
  tx: Tx,
  orgId: string,
  requestedCount = 1
) {
  if (!Number.isInteger(requestedCount) || requestedCount < 0) {
    throw new Error("Requested SKU capacity must be a non-negative integer.");
  }
  if (requestedCount === 0 || env.BILLING_SKU_LIMIT_ENFORCED === "0") {
    return { allowed: true as const, current: 0, requested: requestedCount };
  }

  const org = await lockSkuCapacityOrgInTx(tx, orgId);
  if (org.plan === "core" || org.plan === "pro" || org.skuLimitStartsAt > new Date()) {
    return { allowed: true as const, current: 0, requested: requestedCount };
  }

  const [row] = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(items)
    .where(and(eq(items.organizationId, orgId), isNull(items.deletedAt)));
  const current = Number(row?.count ?? 0);
  if (current + requestedCount > FREE_SKU_LIMIT) {
    throw new SkuCapacityError(current, requestedCount);
  }

  return { allowed: true as const, current, requested: requestedCount };
}
