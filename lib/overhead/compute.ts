import Decimal from "decimal.js-light";

/**
 * Pure overhead-rate math: classify each P&L line into revenue / overhead /
 * excluded, then compute a single company-wide overhead rate as a share of
 * revenue: `overhead% = overhead pool ÷ revenue`. Deterministic and side-effect
 * free (no `xero-node` import), so both the server and the client worksheet can
 * import it and preview the exact same figure the server persists. The Xero P&L
 * *parsing* lives in `parse.ts` to keep this module browser-safe.
 */

const OverheadDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Dec = InstanceType<typeof OverheadDecimal>;

export type OverheadClass = "revenue" | "overhead" | "excluded";

/** Stored per-account classification overrides, keyed by Xero account id. */
export type OverheadAccountOverrides = Record<string, OverheadClass>;

/** One account line lifted out of the P&L report. */
export type ProfitAndLossLine = {
  accountId: string;
  name: string;
  amount: string; // decimal string, as reported for the period
};

/** A P&L line with its resolved classification and the account type behind it. */
export type ClassifiedLine = ProfitAndLossLine & {
  accountType: string | null;
  classification: OverheadClass;
  classificationSource: "auto" | "override";
};

export type OverheadDerivation = {
  periodStart: string;
  periodEnd: string;
  lines: ClassifiedLine[];
  overheadPool: string;
  revenueTotal: string;
  /** overhead pool ÷ revenue, as a percent string (e.g. "34.20"); null if revenue is 0. */
  overheadPercent: string | null;
};

/**
 * Xero account `type` → default overhead classification.
 * - Revenue types feed the denominator.
 * - Operating-overhead types feed the pool (SG&A + manufacturing overhead +
 *   depreciation).
 * - DIRECTCOSTS are excluded: direct materials/labor are already in the BOM
 *   `costToRecover`, so counting them here would double-count.
 * - Everything else (balance-sheet types that can appear via manual journals,
 *   unknowns) defaults to excluded; the user can override.
 */
const REVENUE_TYPES = new Set(["REVENUE", "SALES", "OTHERINCOME"]);
const OVERHEAD_TYPES = new Set(["OVERHEADS", "EXPENSE", "DEPRECIATN"]);
const DIRECT_TYPES = new Set(["DIRECTCOSTS"]);

export function autoClassify(accountType: string | null): OverheadClass {
  if (accountType == null) return "excluded";
  const type = accountType.toUpperCase();
  if (REVENUE_TYPES.has(type)) return "revenue";
  if (OVERHEAD_TYPES.has(type)) return "overhead";
  if (DIRECT_TYPES.has(type)) return "excluded";
  return "excluded";
}

/**
 * True when an account's Xero `type` matched none of the known revenue /
 * overhead / direct-cost sets (or is absent). Such accounts fall through to
 * "excluded" by default — safe for the total, but indistinguishable from a
 * confidently-excluded direct cost, so the worksheet surfaces the count to
 * prompt review: a real overhead account with an unexpected type would
 * otherwise stay silently out of the pool and understate the rate.
 */
export function isUnresolvedType(accountType: string | null): boolean {
  if (accountType == null) return true;
  const type = accountType.toUpperCase();
  return (
    !REVENUE_TYPES.has(type) &&
    !OVERHEAD_TYPES.has(type) &&
    !DIRECT_TYPES.has(type)
  );
}

/**
 * Attach a classification to each P&L line, preferring a stored user override,
 * else the account type's auto rule.
 */
export function classifyLines(
  lines: ProfitAndLossLine[],
  accountTypeById: Map<string, string | null>,
  overrides: OverheadAccountOverrides = {}
): ClassifiedLine[] {
  return lines.map((line) => {
    const accountType = accountTypeById.get(line.accountId) ?? null;
    const override = overrides[line.accountId];
    return {
      ...line,
      accountType,
      classification: override ?? autoClassify(accountType),
      classificationSource: override ? "override" : "auto",
    };
  });
}

function sumByClass(lines: ClassifiedLine[], target: OverheadClass): Dec {
  return lines.reduce(
    (total, line) =>
      line.classification === target ? total.plus(new OverheadDecimal(line.amount)) : total,
    new OverheadDecimal(0)
  );
}

function money(value: Dec): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/**
 * Combine classified lines into the derived overhead rate. `overheadPercent` is
 * the pool as a share of revenue, rounded to 2dp; null when revenue is 0 (can't
 * divide) so callers surface "no revenue in period" rather than a bogus number.
 */
export function computeOverhead(
  lines: ClassifiedLine[],
  period: { periodStart: string; periodEnd: string }
): OverheadDerivation {
  const overheadPool = sumByClass(lines, "overhead");
  const revenueTotal = sumByClass(lines, "revenue");

  const overheadPercent = revenueTotal.gt(0)
    ? overheadPool.div(revenueTotal).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
    : null;

  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    lines,
    overheadPool: money(overheadPool),
    revenueTotal: money(revenueTotal),
    overheadPercent,
  };
}
