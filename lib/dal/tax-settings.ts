import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { trimScale } from "@/lib/db/numeric";
import { organizationTaxSettings, taxRates } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { isNonNegativeNumberString } from "@/lib/schemas/shared";

export type TaxRateOption = {
  id: string;
  name: string;
  ratePercent: string;
};

export type TaxSettingsData = {
  rates: TaxRateOption[];
  defaultSalesTaxRateId: string | null;
  defaultPurchaseTaxRateId: string | null;
};

export const taxRateInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  ratePercent: z.string().trim().min(1, "Rate is required").superRefine((value, ctx) => {
    if (!isNonNegativeNumberString(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Rate must be 0 or greater",
      });
    }
  }),
});

export const updateTaxSettingsSchema = z.object({
  rates: z.array(taxRateInputSchema),
  defaultSalesTaxRateId: z.string().uuid().nullable(),
  defaultPurchaseTaxRateId: z.string().uuid().nullable(),
});

export type UpdateTaxSettingsInput = z.infer<typeof updateTaxSettingsSchema>;

export async function getTaxSettings(): Promise<TaxSettingsData> {
  return withAuthedOrgContext((tx, orgId) => getTaxSettingsInTx(tx, orgId));
}

export async function updateTaxSettings(
  input: UpdateTaxSettingsInput,
): Promise<TaxSettingsData> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const seenNames = new Set<string>();
    for (const rate of input.rates) {
      const normalizedName = rate.name.trim().toLocaleLowerCase();
      if (seenNames.has(normalizedName)) {
        throw new Error("Tax rate names must be unique.");
      }
      seenNames.add(normalizedName);
    }

    const existing = await tx
      .select({ id: taxRates.id })
      .from(taxRates)
      .where(and(eq(taxRates.organizationId, orgId), isNull(taxRates.deletedAt)));
    const existingIds = new Set(existing.map((row) => row.id));
    const inputIds = new Set(
      input.rates
        .map((rate) => rate.id)
        .filter((id): id is string => Boolean(id)),
    );
    const deletedIds = [...existingIds].filter((id) => !inputIds.has(id));

    for (const rate of input.rates) {
      if (rate.id && existingIds.has(rate.id)) {
        await tx
          .update(taxRates)
          .set({
            name: rate.name.trim(),
            ratePercent: normalizeRatePercent(rate.ratePercent),
            updatedAt: new Date(),
          })
          .where(eq(taxRates.id, rate.id));
      } else {
        await tx.insert(taxRates).values({
          id: rate.id,
          organizationId: orgId,
          name: rate.name.trim(),
          ratePercent: normalizeRatePercent(rate.ratePercent),
        });
      }
    }

    if (deletedIds.length > 0) {
      await tx
        .update(taxRates)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(inArray(taxRates.id, deletedIds));
    }

    const activeIds = new Set(input.rates.map((rate) => rate.id).filter(Boolean));
    await upsertTaxDefaultsInTx(tx, orgId, {
      defaultSalesTaxRateId:
        input.defaultSalesTaxRateId && activeIds.has(input.defaultSalesTaxRateId)
          ? input.defaultSalesTaxRateId
          : null,
      defaultPurchaseTaxRateId:
        input.defaultPurchaseTaxRateId && activeIds.has(input.defaultPurchaseTaxRateId)
          ? input.defaultPurchaseTaxRateId
          : null,
    });

    return getTaxSettingsInTx(tx, orgId);
  });
}

export async function getTaxSettingsInTx(
  tx: Tx,
  orgId: string,
): Promise<TaxSettingsData> {
  const [rates, defaults] = await Promise.all([
    tx
      .select({
        id: taxRates.id,
        name: taxRates.name,
        ratePercent: trimScale(taxRates.ratePercent).as("ratePercent"),
      })
      .from(taxRates)
      .where(and(eq(taxRates.organizationId, orgId), isNull(taxRates.deletedAt)))
      .orderBy(asc(taxRates.createdAt), asc(taxRates.name)),
    tx
      .select({
        defaultSalesTaxRateId: organizationTaxSettings.defaultSalesTaxRateId,
        defaultPurchaseTaxRateId: organizationTaxSettings.defaultPurchaseTaxRateId,
      })
      .from(organizationTaxSettings)
      .where(eq(organizationTaxSettings.organizationId, orgId))
      .limit(1),
  ]);

  return {
    rates,
    defaultSalesTaxRateId: defaults[0]?.defaultSalesTaxRateId ?? null,
    defaultPurchaseTaxRateId: defaults[0]?.defaultPurchaseTaxRateId ?? null,
  };
}

export async function getDefaultTaxRatesInTx(tx: Tx, orgId: string) {
  const settings = await getTaxSettingsInTx(tx, orgId);
  const byId = new Map(settings.rates.map((rate) => [rate.id, rate]));
  return {
    sales: settings.defaultSalesTaxRateId
      ? byId.get(settings.defaultSalesTaxRateId) ?? null
      : null,
    purchase: settings.defaultPurchaseTaxRateId
      ? byId.get(settings.defaultPurchaseTaxRateId) ?? null
      : null,
  };
}

export async function getTaxRatesByIdInTx(tx: Tx, ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map<string, TaxRateOption>();

  const rows = await tx
    .select({
      id: taxRates.id,
      name: taxRates.name,
      ratePercent: trimScale(taxRates.ratePercent).as("ratePercent"),
    })
    .from(taxRates)
    .where(and(inArray(taxRates.id, uniqueIds), isNull(taxRates.deletedAt)));

  return new Map(rows.map((row) => [row.id, row]));
}

async function upsertTaxDefaultsInTx(
  tx: Tx,
  orgId: string,
  defaults: Pick<
    TaxSettingsData,
    "defaultSalesTaxRateId" | "defaultPurchaseTaxRateId"
  >,
) {
  await tx
    .insert(organizationTaxSettings)
    .values({
      organizationId: orgId,
      defaultSalesTaxRateId: defaults.defaultSalesTaxRateId,
      defaultPurchaseTaxRateId: defaults.defaultPurchaseTaxRateId,
    })
    .onConflictDoUpdate({
      target: organizationTaxSettings.organizationId,
      set: {
        defaultSalesTaxRateId: defaults.defaultSalesTaxRateId,
        defaultPurchaseTaxRateId: defaults.defaultPurchaseTaxRateId,
        updatedAt: new Date(),
      },
    });
}

function normalizeRatePercent(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toString() : "0";
}
