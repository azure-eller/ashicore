import { NextResponse } from "next/server";
import { z } from "zod";
import { getItems } from "@/lib/inventory/queries/items-list";
import { getInventoryLedger } from "@/app/(dashboard)/inventory/ledger/queries";
import { getStocktakes } from "@/lib/dal/stocktakes";
import { getManufacturingOrders } from "@/lib/manufacturing/queries";
import { getPurchaseOrders } from "@/lib/purchasing/queries/orders-read";
import { getSuppliers } from "@/lib/purchasing/queries/suppliers";
import {
  getCustomers,
  getPricingSchedules,
  getSalesOrders,
} from "@/lib/sales/queries";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleReadAccess } from "@/lib/dal/auth";
import type { ModuleKey } from "@/lib/authz";
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

const targetModules: Record<z.infer<typeof targetSchema>, ModuleKey> = {
  "inventory-products": "inventory",
  "inventory-materials": "inventory",
  "inventory-ledger": "inventory",
  "inventory-stocktakes": "inventory",
  "sales-orders": "sales",
  "sales-customers": "sales",
  "sales-pricing": "sales",
  "purchasing-orders": "purchasing",
  "purchasing-suppliers": "purchasing",
  "manufacturing-orders": "manufacturing",
};

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
  const searchParams = requestSearchParams(request);
  const target = targetSchema.parse(searchParams.get("target") ?? "inventory-products");
  await assertModuleReadAccess(targetModules[target], request.headers);

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
