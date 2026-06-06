import { NextResponse } from "next/server";
import { z } from "zod";
import { getItems } from "@/app/(dashboard)/inventory/queries";
import { getInventoryLedger } from "@/app/(dashboard)/inventory/ledger/queries";
import { getStocktakes } from "@/lib/dal/stocktakes";
import { getManufacturingOrders } from "@/app/(dashboard)/manufacturing/queries";
import { getPurchaseOrders, getSuppliers } from "@/app/(dashboard)/purchasing/queries";
import {
  getCustomers,
  getPricingSchedules,
  getSalesOrders,
} from "@/app/(dashboard)/sales/queries";
import { apiHandler } from "@/lib/api/handler";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import { inventoryLedgerFiltersSchema } from "@/lib/schemas/inventory-ledger";
import { collectObservedOperations } from "@/lib/observability/request-log";
import { requestSearchParams } from "@/lib/routing/search-params";

export const runtime = "nodejs";

const targetSchema = z.enum([
  "inventory-products",
  "inventory-materials",
  "inventory-ledger",
  "inventory-stocktakes",
  "sales-orders",
  "sales-customers",
  "sales-pricing",
  "purchasing-orders",
  "purchasing-suppliers",
  "manufacturing-orders",
]);

function summarizeResult(result: unknown) {
  if (Array.isArray(result)) {
    return { rowCount: result.length };
  }

  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return {
      rowCount: Array.isArray(rows) ? rows.length : null,
      totalCount:
        "totalCount" in result
          ? (result as { totalCount?: unknown }).totalCount
          : null,
    };
  }

  return {};
}

async function runTarget(target: z.infer<typeof targetSchema>) {
  switch (target) {
    case "inventory-products":
      return getItems({ itemType: "product" });
    case "inventory-materials":
      return getItems({ itemType: "material" });
    case "inventory-ledger":
      return getInventoryLedger(inventoryLedgerFiltersSchema.parse({ page: 1, pageSize: 50 }));
    case "inventory-stocktakes":
      return getStocktakes();
    case "sales-orders":
      return getSalesOrders();
    case "sales-customers":
      return getCustomers();
    case "sales-pricing":
      return getPricingSchedules();
    case "purchasing-orders":
      return getPurchaseOrders();
    case "purchasing-suppliers":
      return getSuppliers();
    case "manufacturing-orders":
      return getManufacturingOrders();
  }
}

export const GET = apiHandler(async (request) => {
  await getAuthedApiMemberContext(request.headers);

  const searchParams = requestSearchParams(request);
  const target = targetSchema.parse(searchParams.get("target") ?? "inventory-products");

  const report = await collectObservedOperations(async () => {
    return runTarget(target);
  });

  return NextResponse.json({
    target,
    durationMs: report.durationMs,
    summary: summarizeResult(report.result),
    events: report.events,
  });
});
