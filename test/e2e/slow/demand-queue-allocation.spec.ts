import { and, asc, eq, inArray } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  inventoryLotBalances,
  inventoryReservationsSummary,
  salesOrderLines,
  stockAllocations,
} from "../../../lib/db/schema";
import {
  createCustomer as apiCreateCustomer,
  createItem,
  createManufacturingOrder as apiCreateManufacturingOrder,
  createSalesOrder as apiCreateSalesOrder,
  getOrgId,
  getUnitId,
  releaseManufacturingOrder,
  testFetch,
} from "../../helpers/api";
import type { TestDb } from "../fixtures";

// This spec mutates ORG-WIDE state: switching to demand_queue cancels every
// active allocation in the org. It runs serially and always restores manual
// mode in afterEach so it cannot leak into other specs sharing the test org.
test.describe.configure({ mode: "serial" });

async function setAllocationMode(mode: "manual" | "demand_queue") {
  const res = await testFetch("/api/organization/settings", {
    method: "PATCH",
    body: JSON.stringify({ allocationMode: mode }),
  });
  const body = await res.json().catch(() => null);
  expect(res.status, JSON.stringify(body)).toBe(200);
  expect(body?.allocationMode).toBe(mode);
}

async function createCustomerLocal(name: string): Promise<string> {
  const res = await apiCreateCustomer({ name, email: null, phone: null });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function createSellableProduct(
  name: string,
  unitId: string,
  options: {
    stock?: string;
    bom?: Array<{ componentId: string; quantity: string }>;
  } = {}
): Promise<string> {
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const res = await createItem({
    name: `${name} ${ts}`,
    itemType: "product",
    sellable: true,
    unitDefinitionId: unitId,
    sku: `DQ-${ts}`,
    category: `DemandQueue ${ts}`,
    description: null,
    defaultPurchasePrice: null,
    defaultSellingPrice: "10.00",
    stock: options.stock ?? "0",
    safetyStock: "0",
    bom: options.bom ?? [],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function createMaterial(
  name: string,
  unitId: string,
  stock = "100"
): Promise<string> {
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const res = await createItem({
    name: `${name} ${ts}`,
    itemType: "material",
    unitDefinitionId: unitId,
    sku: `DQM-${ts}`,
    category: `DemandQueue ${ts}`,
    description: null,
    defaultPurchasePrice: "1.00",
    defaultSellingPrice: null,
    stock,
    safetyStock: "0",
    bom: [],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function readSalesOrderLineId(
  db: TestDb,
  salesOrderId: string,
  itemId: string
): Promise<string> {
  const [line] = await db
    .select({ id: salesOrderLines.id })
    .from(salesOrderLines)
    .where(
      and(
        eq(salesOrderLines.salesOrderId, salesOrderId),
        eq(salesOrderLines.itemId, itemId)
      )
    )
    .orderBy(asc(salesOrderLines.sortOrder));
  expect(line, "expected a sales order line").toBeTruthy();
  return line!.id;
}

async function readActiveAllocations(db: TestDb, demandIds: string[]) {
  if (demandIds.length === 0) return [];
  return db
    .select({
      id: stockAllocations.id,
      status: stockAllocations.status,
      demandId: stockAllocations.demandId,
    })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, getOrgId()),
        inArray(stockAllocations.demandId, demandIds),
        eq(stockAllocations.status, "active")
      )
    );
}

async function readSalesLineReservationQty(
  db: TestDb,
  salesOrderLineId: string
): Promise<number> {
  const rows = await db
    .select({ quantity: inventoryReservationsSummary.quantity })
    .from(inventoryReservationsSummary)
    .where(
      and(
        eq(inventoryReservationsSummary.organizationId, getOrgId()),
        eq(inventoryReservationsSummary.referenceType, "sales_order_line"),
        eq(inventoryReservationsSummary.referenceId, salesOrderLineId)
      )
    );
  return rows.reduce((sum, row) => sum + Number(row.quantity ?? "0"), 0);
}

test.afterEach(async () => {
  // Always restore manual mode so this spec never leaks org-wide state.
  await setAllocationMode("manual");
});

test("switching to demand queue releases active allocations and reservations, and switch-back stays clean", async ({
  db,
}) => {
  await setAllocationMode("manual");

  const unitId = getUnitId();
  const customerId = await createCustomerLocal("Demand Queue Co");
  const productId = await createSellableProduct("DQ Release Widget", unitId, {
    stock: "10",
  });

  const soRes = await apiCreateSalesOrder({
    customerId,
    lines: [{ itemId: productId, quantity: "10", unitPrice: "10.00" }],
    confirmOversell: true,
  });
  expect(soRes.status, JSON.stringify(soRes.body)).toBe(201);
  const salesOrderId = soRes.body.id as string;
  const salesOrderLineId = await readSalesOrderLineId(db, salesOrderId, productId);

  const [lot] = await db
    .select({ lotId: inventoryLotBalances.lotId })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.organizationId, getOrgId()),
        eq(inventoryLotBalances.itemId, productId),
        eq(inventoryLotBalances.disposition, "available")
      )
    );
  expect(lot, "expected an available lot for the product").toBeTruthy();

  // Manual allocation: pin 10 units of the lot to the sales line.
  const saveRes = await testFetch("/api/allocation/save", {
    method: "POST",
    body: JSON.stringify({
      demandType: "sales_order_line",
      demandId: salesOrderLineId,
      itemId: productId,
      allocations: [
        { sourceType: "inventory_lot", sourceId: lot!.lotId, quantity: "10" },
      ],
    }),
  });
  const saveBody = await saveRes.json().catch(() => null);
  expect(saveRes.status, JSON.stringify(saveBody)).toBe(200);

  // Manual mode: allocation is active and the reservation is set.
  expect(await readActiveAllocations(db, [salesOrderLineId])).toHaveLength(1);
  expect(await readSalesLineReservationQty(db, salesOrderLineId)).toBe(10);

  // Switch into demand queue → release everything.
  await setAllocationMode("demand_queue");
  expect(await readActiveAllocations(db, [salesOrderLineId])).toHaveLength(0);
  expect(await readSalesLineReservationQty(db, salesOrderLineId)).toBe(0);

  // The cancelled history is preserved for audit.
  const cancelled = await db
    .select({ id: stockAllocations.id })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, getOrgId()),
        eq(stockAllocations.demandId, salesOrderLineId),
        eq(stockAllocations.status, "cancelled")
      )
    );
  expect(cancelled.length).toBeGreaterThanOrEqual(1);

  // Switching back to manual restores nothing: still zero active allocations.
  await setAllocationMode("manual");
  expect(await readActiveAllocations(db, [salesOrderLineId])).toHaveLength(0);
});

test("demand queue: manufacturing ingredient demand claims component stock before sales, and expected MO output covers the remaining sales demand", async ({
  db,
  page,
}) => {
  const unitId = getUnitId();
  const customerId = await createCustomerLocal("Demand Queue Tote Co");

  // Tote is a sellable product, also consumed as a component of "bagged".
  const toteId = await createSellableProduct("DQ Tote", unitId, { stock: "10" });
  const baggedId = await createSellableProduct("DQ Bagged", unitId, {
    stock: "0",
    bom: [{ componentId: toteId, quantity: "1" }],
  });

  // Sales order competing for the same totes.
  const soRes = await apiCreateSalesOrder({
    customerId,
    lines: [{ itemId: toteId, quantity: "10", unitPrice: "10.00" }],
    confirmOversell: true,
  });
  expect(soRes.status, JSON.stringify(soRes.body)).toBe(201);

  // MO that consumes 10 totes as an ingredient (manufacturing demand).
  const consumingMoRes = await apiCreateManufacturingOrder({
    productId: baggedId,
    plannedQuantity: "10",
    plannedDate: "2026-05-22",
    ingredients: [{ itemId: toteId, quantityPerUnit: "1" }],
    confirmShortage: true,
  });
  expect(consumingMoRes.status, JSON.stringify(consumingMoRes.body)).toBe(201);
  await releaseManufacturingOrder(consumingMoRes.body.id as string, {
    confirmShortage: true,
  });

  await setAllocationMode("demand_queue");

  // Manufacturing demand wins the on-hand totes; sales is left short.
  await page.goto("/sales/allocation");
  await expect(page.getByText("Allocation · Demand queue")).toBeVisible();
  // Manual allocator entry point must not be present in demand_queue mode.
  await expect(page.getByText("Allocate / Unallocate")).toHaveCount(0);

  const summaryRow = page
    .getByRole("row")
    .filter({ hasText: "DQ Tote" })
    .first();
  // Claimed by manufacturing covers all 10 on-hand; nothing left to sell; short.
  await expect(summaryRow).toContainText("10");

  // Now add expected supply: a second open MO that PRODUCES 10 totes tomorrow
  // with no tote ingredient demand of its own.
  const filler = await createMaterial("DQ Filler", unitId, "100");
  const producingMoRes = await apiCreateManufacturingOrder({
    productId: toteId,
    plannedQuantity: "10",
    plannedDate: "2026-05-23",
    ingredients: [{ itemId: filler, quantityPerUnit: "1" }],
    confirmShortage: true,
  });
  expect(producingMoRes.status, JSON.stringify(producingMoRes.body)).toBe(201);
  await releaseManufacturingOrder(producingMoRes.body.id as string, {
    confirmShortage: true,
  });

  // The sales line is now covered by expected production (no longer short),
  // surfaced as "Expected <date>" for the producing MO's deadline (tomorrow).
  await page.reload();
  await expect(page.getByText("Allocation · Demand queue")).toBeVisible();
  const coveredSummary = page
    .getByRole("row")
    .filter({ hasText: "DQ Tote" })
    .first();
  await expect(coveredSummary).toBeVisible();
  await expect(page.getByText("Expected 5/23/2026").first()).toBeVisible();

  // Sanity: the org has no active allocations while in demand_queue mode.
  const activeForTote = await db
    .select({ id: stockAllocations.id })
    .from(stockAllocations)
    .where(
      and(
        eq(stockAllocations.organizationId, getOrgId()),
        eq(stockAllocations.itemId, toteId),
        eq(stockAllocations.status, "active")
      )
    );
  expect(activeForTote).toHaveLength(0);
});
