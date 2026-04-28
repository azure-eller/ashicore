import type { Report, SalesImportReport } from "./types";
import type { ResetCounts } from "./reset";

export function printReport(report: Report, dryRun: boolean) {
  const mode = dryRun ? "Dry run" : "Apply";
  console.log(`${mode} summary:`);
  console.log(`  Units created: ${report.createdUnits.length}`);
  console.log(`  Units reactivated: ${report.reactivatedUnits.length}`);
  console.log(`  Units updated: ${report.updatedUnits.length}`);
  console.log(`  Units unchanged: ${report.unchangedUnits.length}`);
  console.log(`  Items created: ${report.createdItems.length}`);
  console.log(`  Items reactivated: ${report.reactivatedItems.length}`);
  console.log(`  Items updated: ${report.updatedItems.length}`);
  console.log(`  Items unchanged: ${report.unchangedItems.length}`);
  console.log(`  BOMs synced: ${report.syncedBoms.length}`);
  console.log(`  BOMs unchanged: ${report.unchangedBoms.length}`);
  console.log(`  Unresolved formulas: ${report.unresolvedFormulae.length}`);

  if (report.unresolvedFormulae.length > 0) {
    console.log("");
    console.log("Unresolved formula notes:");
    for (const note of report.unresolvedFormulae) {
      console.log(`  - ${note}`);
    }
  }

  console.log(`  Stock lots ${dryRun ? "pending" : "created"}: ${report.stockLotsCreated.length}`);
  console.log(`  Stock lots already loaded: ${report.stockLotsExisting.length}`);
  console.log(
    `  Stock lots skipped (missing cost): ${report.stockLotsSkippedMissingCost.length}`
  );
  console.log(`  Suppliers created: ${report.createdSuppliers.length}`);
  console.log(`  Suppliers reactivated: ${report.reactivatedSuppliers.length}`);
  console.log(`  Suppliers updated: ${report.updatedSuppliers.length}`);
  console.log(`  Suppliers unchanged: ${report.unchangedSuppliers.length}`);
  console.log(`  SO snapshots repaired: ${report.repairedSoSnapshots}`);

  if (report.stockLotsCreated.length > 0) {
    console.log("");
    console.log(`Stock ${dryRun ? "to load" : "loaded"}:`);
    for (const entry of report.stockLotsCreated) {
      console.log(`  - ${entry}`);
    }
  }

  if (report.stockLotsSkippedMissingCost.length > 0) {
    console.log("");
    console.log("Stock skipped (missing cost basis):");
    for (const entry of report.stockLotsSkippedMissingCost) {
      console.log(`  - ${entry}`);
    }
  }
}

export function printSalesImportReport(
  report: SalesImportReport,
  dryRun: boolean,
  customersOnly: boolean
) {
  const mode = dryRun ? "Dry run" : "Apply";
  console.log(`${mode} sales summary:`);
  console.log(`  Customers created: ${report.createdCustomers.length}`);
  console.log(`  Customers reactivated: ${report.reactivatedCustomers.length}`);
  console.log(`  Customers updated: ${report.updatedCustomers.length}`);
  console.log(`  Customers unchanged: ${report.unchangedCustomers.length}`);

  if (!customersOnly) {
    console.log(
      `  Orders ${dryRun ? "ready" : "created"}: ${report.createdOrders.length}`
    );
    console.log(`  Orders already loaded: ${report.existingOrders.length}`);
    console.log(`  Orders skipped: ${report.skippedOrders.length}`);
  }

  if (report.skippedOrders.length > 0) {
    console.log("");
    console.log("Skipped orders:");
    for (const order of report.skippedOrders) {
      console.log(`  - ${order.label} [rows ${order.sourceRows.join(", ")}]`);
      for (const issue of order.issues) {
        console.log(`      ${issue}`);
      }
    }
  }
}

export function printResetCounts(counts: ResetCounts, dryRun: boolean) {
  const total = counts.reduce((sum, row) => sum + row.rows, 0);
  const mode = dryRun ? "Reset preview" : "Reset summary";
  console.log(`${mode} (${total} total rows):`);
  for (const { table, rows } of counts) {
    if (rows === 0) continue;
    console.log(`  ${table}: ${rows}`);
  }
  if (total === 0) {
    console.log("  (no rows to delete)");
  }
}
