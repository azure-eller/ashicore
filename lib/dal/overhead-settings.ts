import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { trimScaleNullable } from "@/lib/db/numeric";
import { organizationOverheadSettings } from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import { getAuthedMemberContext, withAuthedOrgContext } from "@/lib/dal/auth";
import { assertFeatureAccessInTx } from "@/lib/billing/entitlements";
import { DomainError } from "@/lib/errors/domain-error";
import { fetchOverheadInputs, type XeroAccountSummary } from "@/lib/xero/reports";
import {
  classifyLines,
  computeOverhead,
  type OverheadAccountOverrides,
  type OverheadClass,
  type OverheadDerivation,
} from "@/lib/overhead/compute";

export type OverheadSettingsData = {
  overheadPercent: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  overheadPool: string | null;
  revenueTotal: string | null;
  derivation: OverheadDerivation | null;
  accountOverrides: OverheadAccountOverrides;
  updatedAt: Date | null;
};

/** A recompute result: the derivation plus the live chart of accounts (for the UI). */
export type OverheadComputeResult = {
  derivation: OverheadDerivation;
  accounts: XeroAccountSummary[];
};

const overheadClassSchema: z.ZodType<OverheadClass> = z.enum([
  "revenue",
  "overhead",
  "excluded",
]);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Date must be a valid calendar date");

export const overheadRefreshSchema = z
  .object({
    periodStart: isoDate,
    periodEnd: isoDate,
    overrides: z.record(z.string(), overheadClassSchema).default({}),
  })
  .refine((value) => value.periodStart <= value.periodEnd, {
    message: "From date must be on or before to date",
    path: ["periodStart"],
  });
export type OverheadRefreshInput = z.infer<typeof overheadRefreshSchema>;

async function assertOverheadAccessInTx(tx: Tx, orgId: string, route: string) {
  await assertFeatureAccessInTx(tx, orgId, "pricing_scenarios", { route });
}

/** Trailing 12 whole months ending at the last completed month-end. */
export function getDefaultOverheadPeriod(now = new Date()): {
  periodStart: string;
  periodEnd: string;
} {
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000); // last day of prior month
  const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth() + 1, 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { periodStart: iso(start), periodEnd: iso(end) };
}

/**
 * Recompute the overhead rate from Xero for the given period + overrides. Pure
 * derivation, never persisted — used by both the "refresh" preview and (with the
 * same inputs) the persisted save, so the two can never disagree.
 */
async function deriveOverhead(
  orgId: string,
  input: OverheadRefreshInput
): Promise<OverheadComputeResult> {
  const inputs = await fetchOverheadInputs(orgId, input.periodStart, input.periodEnd);
  const classified = classifyLines(inputs.plLines, inputs.accountTypeById, input.overrides);
  const derivation = computeOverhead(classified, {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  });
  return { derivation, accounts: inputs.accounts };
}

export async function refreshOverheadRate(
  input: OverheadRefreshInput
): Promise<OverheadComputeResult> {
  const { orgId, userId } = await getAuthedMemberContext();
  await withOrgContext(
    orgId,
    (tx) => assertOverheadAccessInTx(tx, orgId, "POST /api/overhead-settings/refresh"),
    { userId }
  );
  return deriveOverhead(orgId, input);
}

/**
 * Recompute server-side AND persist as the org's overhead default. The derivation
 * is never taken from the client — we re-pull Xero and recompute, so a saved rate
 * always reflects a real P&L the server itself read.
 */
export async function saveOverheadSettings(
  input: OverheadRefreshInput
): Promise<OverheadSettingsData> {
  const { orgId, userId } = await getAuthedMemberContext();
  await withOrgContext(
    orgId,
    (tx) => assertOverheadAccessInTx(tx, orgId, "PUT /api/overhead-settings"),
    { userId }
  );
  const { derivation } = await deriveOverhead(orgId, input);
  const overheadPercent = Number(derivation.overheadPercent);
  if (
    derivation.overheadPercent == null ||
    !Number.isFinite(overheadPercent) ||
    overheadPercent < 0 ||
    overheadPercent >= 100
  ) {
    throw new DomainError(
      "Derived overhead must be at least 0% and below 100% to use as a pricing default.",
      422
    );
  }

  return withOrgContext(
    orgId,
    async (tx) => {
      await assertOverheadAccessInTx(tx, orgId, "PUT /api/overhead-settings");
      await tx
        .insert(organizationOverheadSettings)
        .values({
          organizationId: orgId,
          overheadPercent: derivation.overheadPercent,
          periodStart: derivation.periodStart,
          periodEnd: derivation.periodEnd,
          overheadPool: derivation.overheadPool,
          revenueTotal: derivation.revenueTotal,
          derivation,
          accountOverrides: input.overrides,
        })
        .onConflictDoUpdate({
          target: organizationOverheadSettings.organizationId,
          set: {
            overheadPercent: derivation.overheadPercent,
            periodStart: derivation.periodStart,
            periodEnd: derivation.periodEnd,
            overheadPool: derivation.overheadPool,
            revenueTotal: derivation.revenueTotal,
            derivation,
            accountOverrides: input.overrides,
            updatedAt: new Date(),
          },
        });
      return getOverheadSettingsInTx(tx, orgId);
    },
    { userId }
  );
}

export async function getOverheadSettings(): Promise<OverheadSettingsData> {
  return withAuthedOrgContext(async (tx, orgId) => {
    await assertOverheadAccessInTx(tx, orgId, "GET /api/overhead-settings");
    return getOverheadSettingsInTx(tx, orgId);
  });
}

export async function getOverheadSettingsInTx(
  tx: Tx,
  orgId: string
): Promise<OverheadSettingsData> {
  const [row] = await tx
    .select({
      overheadPercent: trimScaleNullable(organizationOverheadSettings.overheadPercent).as(
        "overheadPercent"
      ),
      periodStart: organizationOverheadSettings.periodStart,
      periodEnd: organizationOverheadSettings.periodEnd,
      overheadPool: trimScaleNullable(organizationOverheadSettings.overheadPool).as(
        "overheadPool"
      ),
      revenueTotal: trimScaleNullable(organizationOverheadSettings.revenueTotal).as(
        "revenueTotal"
      ),
      derivation: organizationOverheadSettings.derivation,
      accountOverrides: organizationOverheadSettings.accountOverrides,
      updatedAt: organizationOverheadSettings.updatedAt,
    })
    .from(organizationOverheadSettings)
    .where(eq(organizationOverheadSettings.organizationId, orgId))
    .limit(1);

  return {
    overheadPercent: row?.overheadPercent ?? null,
    periodStart: row?.periodStart ?? null,
    periodEnd: row?.periodEnd ?? null,
    overheadPool: row?.overheadPool ?? null,
    revenueTotal: row?.revenueTotal ?? null,
    derivation: row?.derivation ?? null,
    accountOverrides: row?.accountOverrides ?? {},
    updatedAt: row?.updatedAt ?? null,
  };
}
