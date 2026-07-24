import Decimal from "decimal.js-light";
import { RowType, type ReportWithRows } from "xero-node";

/**
 * Pure overhead-rate derivation. Given a Xero Profit & Loss report and the chart
 * of accounts (for account types), classify each P&L line into revenue / overhead
 * / excluded, then compute a single company-wide overhead rate as a share of
 * revenue: `overhead% = overhead pool ÷ revenue`. Everything here is
 * deterministic and side-effect free so it can be tested against a fixture P&L.
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

function readCellAmount(value: string | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  try {
    return new OverheadDecimal(value.replace(/,/g, "")).toString();
  } catch {
    return null;
  }
}

/**
 * Walk a Xero ProfitAndLoss `ReportWithRows` and pull out one line per account
 * row: `{accountId, name, amount}`. The account id lives in the first cell's
 * attributes; the period amount is the last cell's value. Header, Section, and
 * SummaryRow rows are skipped, so section subtotals never double-count.
 */
export function parseProfitAndLoss(report: ReportWithRows): ProfitAndLossLine[] {
  const lines: ProfitAndLossLine[] = [];
  const sections = report.reports?.[0]?.rows ?? [];
  for (const section of sections) {
    for (const row of section.rows ?? []) {
      // Skip Header / Section / SummaryRow so section subtotals never
      // double-count; only leaf account rows carry an account id.
      if (row.rowType !== RowType.Row) continue;
      const cells = row.cells ?? [];
      if (cells.length === 0) continue;
      const accountId = cells[0]?.attributes?.find((attr) => attr.id === "account")?.value
        ?? cells[0]?.attributes?.[0]?.value;
      const name = cells[0]?.value ?? "";
      const amount = readCellAmount(cells[cells.length - 1]?.value);
      if (!accountId || amount == null) continue;
      lines.push({ accountId, name, amount });
    }
  }
  return lines;
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
