import Decimal from "decimal.js-light";
import { RowType, type ReportWithRows } from "xero-node";
import type { ProfitAndLossLine } from "./compute";

/**
 * Xero P&L parsing lives here, isolated from the pure math in `compute.ts`, so
 * the client worksheet can import the arithmetic without pulling `xero-node`
 * into the browser bundle. Server-only (a report reader), never imported by
 * client code.
 */

const ParseDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

function readCellAmount(value: string | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  // Xero can render negatives in accounting style, e.g. "(1,234.56)". Normalise
  // the parentheses to a sign and drop thousands separators so the amount reads
  // as a real negative instead of throwing — an unparsed cell would otherwise
  // drop the whole account (parseProfitAndLoss skips lines with a null amount),
  // silently omitting it from the pool/revenue totals.
  const normalized = value
    .trim()
    .replace(/,/g, "")
    .replace(/^\(([^)]*)\)$/, "-$1");
  try {
    return new ParseDecimal(normalized).toString();
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
      const accountId =
        cells[0]?.attributes?.find((attr) => attr.id === "account")?.value ??
        cells[0]?.attributes?.[0]?.value;
      const name = cells[0]?.value ?? "";
      const amount = readCellAmount(cells[cells.length - 1]?.value);
      if (!accountId || amount == null) continue;
      lines.push({ accountId, name, amount });
    }
  }
  return lines;
}
