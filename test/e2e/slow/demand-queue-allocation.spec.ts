import { and, asc, eq, inArray } from "drizzle-orm";
import { test, expect, filterList } from "../fixtures";
import {
  inventoryLotBalances,
  inventoryReservationsSummary,
  salesOrders,
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

// Demand queue is the default allocation model. This spec runs serially because
// it creates competing demand for the same items and checks the visible queue math.
test.describe.configure({ mode: "serial" });

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
  const bom =
    options.bom && options.bom.length > 0
      ? options.bom
      : [
          {
            componentId: await createMaterial(`${name} Component`, unitId, "100"),
            quantity: "1",
          },
        ];
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
    bom,
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

test("demand queue preserves and allows manual stock reservations", async ({
  db,
  page,
}) => {
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
  const [salesOrder] = await db
    .select({ orderNumber: salesOrders.orderNumber })
    .from(salesOrders)
    .where(eq(salesOrders.id, salesOrderId));
  expect(salesOrder?.orderNumber).toBeTruthy();

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

  // Demand queue still allows explicit manual reservations as visible exceptions.
  expect(await readActiveAllocations(db, [salesOrderLineId])).toHaveLength(1);
  expect(await readSalesLineReservationQty(db, salesOrderLineId)).toBe(10);
  const [managedLine] = await db
    .select({ allocationManagedAt: salesOrderLines.allocationManagedAt })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.id, salesOrderLineId));
  expect(managedLine?.allocationManagedAt).not.toBeNull();

  // Manual reservation writes remain available in demand queue mode.
  const updatedSave = await testFetch("/api/allocation/save", {
    method: "POST",
    body: JSON.stringify({
      demandType: "sales_order_line",
      demandId: salesOrderLineId,
      itemId: productId,
      allocations: [
        { sourceType: "inventory_lot", sourceId: lot!.lotId, quantity: "6" },
      ],
    }),
  });
  expect(updatedSave.status).toBe(200);
  expect(await readActiveAllocations(db, [salesOrderLineId])).toHaveLength(1);
  expect(await readSalesLineReservationQty(db, salesOrderLineId)).toBe(6);

  await page.goto("/sales/orders");
  await filterList(page, "Search orders", salesOrder.orderNumber);
  const partialRow = page
    .getByRole("row")
    .filter({ hasText: salesOrder.orderNumber })
    .first();
  await expect(
    partialRow.locator('[data-slot="status-block"][data-tone="success"]', {
      hasText: "Available",
    })
  ).toBeVisible();
  await expect(
    partialRow.locator('[data-slot="status-block"][data-tone="success"]', {
      hasText: "M",
    })
  ).toBeVisible();

  const restoredSave = await testFetch("/api/allocation/save", {
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
  expect(restoredSave.status).toBe(200);
  await page.reload();
  await filterList(page, "Search orders", salesOrder.orderNumber);
  const coveredRow = page
    .getByRole("row")
    .filter({ hasText: salesOrder.orderNumber })
    .first();
  await expect(
    coveredRow.locator('[data-slot="status-block"][data-tone="success"]', {
      hasText: "Available",
    })
  ).toBeVisible();
  await expect(
    coveredRow.locator('[data-slot="status-block"][data-tone="success"]', {
      hasText: "M",
    })
  ).toBeVisible();

  // The explicit reservation remains active in the default demand queue model.
  expect(await readActiveAllocations(db, [salesOrderLineId])).toHaveLength(1);
});

test("demand queue: manufacturing ingredient demand claims component stock before sales, and expected MO output covers the remaining sales demand", async ({
  db,
  page,
}) => {
  test.setTimeout(180_000);

  const unitId = getUnitId();
  const customerId = await createCustomerLocal("Demand Queue Tote Co");

  // Tote is a sellable product, also consumed as a component of "bagged".
  const toteComponentId = await createMaterial("DQ Tote Component", unitId, "100");
  const toteId = await createSellableProduct("DQ Tote", unitId, {
    stock: "10",
    bom: [{ componentId: toteComponentId, quantity: "1" }],
  });
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
  const salesOrderId = soRes.body.id as string;
  const [salesOrder] = await db
    .select({ orderNumber: salesOrders.orderNumber })
    .from(salesOrders)
    .where(eq(salesOrders.id, salesOrderId));
  expect(salesOrder?.orderNumber).toBeTruthy();
  const salesOrderNumber = salesOrder.orderNumber;
  const salesOrderLineId = await readSalesOrderLineId(db, salesOrderId, toteId);

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

  // Manufacturing demand wins the on-hand totes; sales is left short.
  await page.goto("/sales/allocation");
  await expect(page.getByRole("heading", { name: "Allocation" })).toBeVisible();
  await expect(page.getByText("Allocate / Unallocate").first()).toBeVisible();

  await page.goto("/sales/orders");
  await filterList(page, "Search orders", salesOrderNumber);
  const shortRow = page.getByRole("row").filter({ hasText: salesOrderNumber }).first();
  await expect(
    shortRow.locator('[data-slot="status-block"][data-tone="danger"]', {
      hasText: "Not available",
    })
  ).toBeVisible();
  await expect(
    shortRow.locator('[data-slot="status-block"][data-tone="danger"]', {
      hasText: "M",
    })
  ).toHaveCount(0);

  // Now add expected supply: an open MTS MO that PRODUCES 4 totes tomorrow
  // with no tote ingredient demand of its own, and reserve that output to this
  // sales order. The marker shows the manual reservation, but the line remains
  // short until more supply exists.
  const producingMoRes = await apiCreateManufacturingOrder({
    productId: toteId,
    plannedQuantity: "4",
    plannedDate: "2026-05-23",
    ingredients: [{ itemId: toteComponentId, quantityPerUnit: "1" }],
    confirmShortage: true,
  });
  expect(producingMoRes.status, JSON.stringify(producingMoRes.body)).toBe(201);
  const producingMoId = producingMoRes.body.id as string;
  await releaseManufacturingOrder(producingMoRes.body.id as string, {
    confirmShortage: true,
  });

  const partialOutputAllocation = await testFetch(
    `/api/manufacturing-orders/${producingMoId}/output-allocation`,
    {
      method: "PUT",
      body: JSON.stringify({
        salesAllocations: [{ salesOrderLineId, quantity: "4" }],
        productionAllocations: [],
      }),
    }
  );
  expect(partialOutputAllocation.status).toBe(200);

  await page.goto("/sales/orders");
  await filterList(page, "Search orders", salesOrderNumber);
  const partialMtsRow = page.getByRole("row").filter({ hasText: salesOrderNumber }).first();
  await expect(
    partialMtsRow.locator('[data-slot="status-block"][data-tone="danger"]', {
      hasText: "Not available",
    })
  ).toBeVisible();
  await expect(
    partialMtsRow.locator('[data-slot="status-block"][data-tone="danger"]', {
      hasText: "M",
    })
  ).toBeVisible();

  // Additional MTS output covers the remainder; the same sales row becomes
  // expected on the latest required production date while retaining the marker.
  const remainderMoRes = await apiCreateManufacturingOrder({
    productId: toteId,
    plannedQuantity: "6",
    plannedDate: "2026-05-24",
    ingredients: [{ itemId: toteComponentId, quantityPerUnit: "1" }],
    confirmShortage: true,
  });
  expect(remainderMoRes.status, JSON.stringify(remainderMoRes.body)).toBe(201);
  await releaseManufacturingOrder(remainderMoRes.body.id as string, {
    confirmShortage: true,
  });

  await page.goto("/sales/orders", { waitUntil: "domcontentloaded" });
  await filterList(page, "Search orders", salesOrderNumber);
  const coveredMtsRow = page.getByRole("row").filter({ hasText: salesOrderNumber }).first();
  await expect(
    coveredMtsRow.locator('[data-slot="status-block"][data-tone="warning"]', {
      hasText: "Expected 5/24/2026",
    })
  ).toBeVisible();
  await expect(
    coveredMtsRow.locator('[data-slot="status-block"][data-tone="warning"]', {
      hasText: "M",
    })
  ).toBeVisible();

  // Sanity: demand queue only has the explicit MTS reservation.
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
  expect(activeForTote).toHaveLength(1);
});
