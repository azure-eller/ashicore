import { and, eq, isNull, sql } from "drizzle-orm";
import { organizationTaxSettings, taxRates } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";

export const DEFAULT_SALES_TAX_RATE_NAME = "Tax Exempt";
export const DEFAULT_PURCHASE_TAX_RATE_NAME = "Tax On Purchase";
const LEGACY_DEFAULT_PURCHASE_TAX_RATE_NAME = "Tax on Purchase";

export async function initializeDefaultTaxSettingsInTx(tx: Tx, orgId: string) {
  const rows = await tx
    .select({
      id: taxRates.id,
      name: taxRates.name,
    })
    .from(taxRates)
    .where(and(eq(taxRates.organizationId, orgId), isNull(taxRates.deletedAt)));

  const exactSalesRate = rows.find((row) => row.name === DEFAULT_SALES_TAX_RATE_NAME);
  const exactPurchaseRate = rows.find(
    (row) => row.name === DEFAULT_PURCHASE_TAX_RATE_NAME,
  );
  const legacyPurchaseRate = rows.find(
    (row) => row.name === LEGACY_DEFAULT_PURCHASE_TAX_RATE_NAME,
  );

  const [salesRate] = exactSalesRate
    ? [exactSalesRate]
    : await tx
        .insert(taxRates)
        .values({
          organizationId: orgId,
          name: DEFAULT_SALES_TAX_RATE_NAME,
          ratePercent: "0",
        })
        .onConflictDoUpdate({
          target: [taxRates.organizationId, taxRates.name],
          targetWhere: sql`deleted_at IS NULL`,
          set: { ratePercent: "0", updatedAt: new Date() },
        })
        .returning({ id: taxRates.id, name: taxRates.name });

  const [purchaseRate] = exactPurchaseRate
    ? [exactPurchaseRate]
    : legacyPurchaseRate
      ? await tx
          .update(taxRates)
          .set({
            name: DEFAULT_PURCHASE_TAX_RATE_NAME,
            ratePercent: "0",
            updatedAt: new Date(),
          })
          .where(eq(taxRates.id, legacyPurchaseRate.id))
          .returning({ id: taxRates.id, name: taxRates.name })
      : await tx
          .insert(taxRates)
          .values({
            organizationId: orgId,
            name: DEFAULT_PURCHASE_TAX_RATE_NAME,
            ratePercent: "0",
          })
          .onConflictDoUpdate({
            target: [taxRates.organizationId, taxRates.name],
            targetWhere: sql`deleted_at IS NULL`,
            set: { ratePercent: "0", updatedAt: new Date() },
          })
          .returning({ id: taxRates.id, name: taxRates.name });

  await tx
    .insert(organizationTaxSettings)
    .values({
      organizationId: orgId,
      defaultSalesTaxRateId: salesRate.id,
      defaultPurchaseTaxRateId: purchaseRate.id,
    })
    .onConflictDoUpdate({
      target: organizationTaxSettings.organizationId,
      set: {
        defaultSalesTaxRateId: salesRate.id,
        defaultPurchaseTaxRateId: purchaseRate.id,
        updatedAt: new Date(),
      },
    });

  return { salesRate, purchaseRate };
}
