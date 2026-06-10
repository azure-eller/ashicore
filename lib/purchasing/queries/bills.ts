import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { purchaseOrders } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { CreatePurchaseBill } from "@/lib/schemas/purchase-orders";
import type { PurchaseOrderListRow } from "../types";
import { PurchasingError } from "./errors";

export async function createPurchaseBillAccountingSync(
  id: string,
  data: CreatePurchaseBill,
) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const { getActiveAccountingProviderForOrg } = await import(
      "@/lib/dal/accounting"
    );
    const active = await getActiveAccountingProviderForOrg(orgId);
    if (active.status === "none") {
      throw new PurchasingError(
        "Connect an accounting provider before creating supplier bills.",
        409,
      );
    }
    if (active.status === "conflict") {
      throw new PurchasingError(
        "Disconnect either Xero or QuickBooks before creating supplier bills.",
        409,
      );
    }

    if (active.provider === "quickbooks") {
      const { createPurchaseBillInQuickBooks, markQuickBooksBillPushFailed } =
        await import("@/lib/accounting/providers/quickbooks/push-bill");
      const { QuickBooksError } = await import(
        "@/lib/accounting/providers/quickbooks/client"
      );
      try {
        const result = await createPurchaseBillInQuickBooks(orgId, id, data);
        return { ok: true as const, result };
      } catch (error) {
        const isExpectedPreflight =
          error instanceof QuickBooksError &&
          (error.status === 404 ||
            error.message.includes("not connected") ||
            error.message.includes("already running"));

        if (!isExpectedPreflight) {
          await markQuickBooksBillPushFailed(orgId, id, error);
        }
        throw error;
      }
    }

    const { createPurchaseBillAccountingSync, markXeroPurchaseBillPushFailed } =
      await import("@/lib/xero/push-purchase-bill");
    const { XeroError } = await import("@/lib/xero/errors");
    try {
      const result = await createPurchaseBillAccountingSync(orgId, id, data);
      return { ok: true as const, result };
    } catch (error) {
      const isExpectedPreflight =
        error instanceof XeroError &&
        (error.status === 404 ||
          error.message.includes("not connected") ||
          error.message.includes("already running"));

      if (!isExpectedPreflight) {
        await markXeroPurchaseBillPushFailed(orgId, id, error);
      }
      throw error;
    }
  });
}

export async function setPurchaseBillManualStatus(
  id: string,
  status: PurchaseOrderListRow["purchaseBillManualStatus"],
) {
  return withAuthedOrgContext(async (tx) => {
    const [order] = await tx
      .update(purchaseOrders)
      .set({
        purchaseBillManualStatus: status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.type, "standard"),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .returning({
        id: purchaseOrders.id,
        purchaseBillManualStatus: purchaseOrders.purchaseBillManualStatus,
      });

    return order ?? null;
  });
}
