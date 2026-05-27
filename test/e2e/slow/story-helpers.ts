import { and, asc, eq } from "drizzle-orm";
import { expect, filterList, type TestDb } from "../fixtures";
import {
  inventoryLotBalances,
  salesOrderLines,
  salesOrders,
} from "../../../lib/db/schema";
import {
  createCustomer,
  createItem,
  createManufacturingOrder,
  createSalesOrder,
  getUnitId,
  releaseManufacturingOrder,
  testFetch,
} from "../../helpers/api";

export const unitId = getUnitId();

export function uniqueName(prefix: string) {
  return `${prefix} ${Date.now()} ${Math.floor(Math.random() * 10000)}`;
}

export function expectResponse(
  response: { status: number; body?: unknown },
  status = 201
) {
  expect(response.status, JSON.stringify(response.body ?? null)).toBe(status);
}

export async function createMaterialFixture(params: {
  name: string;
  stock?: string;
  cost?: string;
  category?: string;
}) {
  const name = uniqueName(params.name);
  const response = await createItem({
    itemType: "material",
    name,
    unitDefinitionId: unitId,
    sku: `SLOW-MAT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    category: params.category ?? "Slow Story",
    description: null,
    defaultPurchasePrice: params.cost ?? "2.00",
    defaultSellingPrice: null,
    stock: params.stock ?? "0",
    safetyStock: "0",
    bom: [],
  });
  expectResponse(response);
  return { id: response.body.id as string, name };
}

export async function createSellableProductFixture(params: {
  name: string;
  stock?: string;
  price?: string;
  bom?: Array<{ componentId: string; quantity: string }>;
  category?: string;
}) {
  const name = uniqueName(params.name);
  const response = await createItem({
    itemType: "product",
    name,
    sellable: true,
    unitDefinitionId: unitId,
    sku: `SLOW-PROD-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    category: params.category ?? "Slow Story",
    description: null,
    defaultPurchasePrice: null,
    defaultSellingPrice: params.price ?? "20.00",
    stock: params.stock ?? "0",
    safetyStock: "0",
    bom: params.bom ?? [],
  });
  expectResponse(response);
  return { id: response.body.id as string, name };
}

export async function createCustomerFixture(params: {
  name: string;
  customerCategoryId?: string | null;
  email?: string | null;
  shipLine1?: string | null;
  shipCity?: string | null;
  shipRegion?: string | null;
  shipPostcode?: string | null;
}) {
  const name = uniqueName(params.name);
  const response = await createCustomer({
    name,
    customerCategoryId: params.customerCategoryId ?? null,
    email: params.email ?? null,
    phone: null,
    shipLine1: params.shipLine1 ?? "100 Story Lane",
    shipCity: params.shipCity ?? "Paonia",
    shipRegion: params.shipRegion ?? "CO",
    shipPostcode: params.shipPostcode ?? "81428",
    shipCountry: "US",
  });
  expectResponse(response);
  return { id: response.body.id as string, name };
}

export async function createConfirmedSalesOrder(params: {
  customerId: string;
  productId: string;
  quantity: string;
  unitPrice?: string;
  shipDate?: string;
}) {
  const response = await createSalesOrder({
    customerId: params.customerId,
    status: "open",
    orderDate: "2026-06-01",
    shipDate: params.shipDate ?? "2026-06-03",
    requestedDate: params.shipDate ?? "2026-06-03",
    confirmOversell: true,
    lines: [
      {
        itemId: params.productId,
        quantity: params.quantity,
        unitPrice: params.unitPrice ?? "20.00",
      },
    ],
  });
  expectResponse(response);
  return response.body.id as string;
}

export async function readSalesOrder(db: TestDb, orderId: string) {
  const [order] = await db
    .select()
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId));
  expect(order).toBeTruthy();
  return order!;
}

export async function readSalesOrderLine(
  db: TestDb,
  salesOrderId: string,
  itemId: string
) {
  const [line] = await db
    .select()
    .from(salesOrderLines)
    .where(
      and(
        eq(salesOrderLines.salesOrderId, salesOrderId),
        eq(salesOrderLines.itemId, itemId)
      )
    )
    .orderBy(asc(salesOrderLines.sortOrder));
  expect(line).toBeTruthy();
  return line!;
}

export async function pickAllIngredients(orderId: string) {
  const execution = await testFetch(`/api/manufacturing-orders/${orderId}/execution`);
  expect(execution.status).toBe(200);
  const body = await execution.json();
  expect(Array.isArray(body.ingredients)).toBe(true);
  expect(body.ingredients.length).toBeGreaterThan(0);

  for (const ingredient of body.ingredients ?? []) {
    const pick = await testFetch(
      `/api/manufacturing-orders/${orderId}/ingredients/${ingredient.id}/pick`,
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );
    expect(pick.status).toBe(200);
  }
}

export async function createReleasedManufacturingOrder(params: {
  productId: string;
  componentId: string;
  plannedQuantity: string;
  quantityPerUnit: string;
  confirmShortage?: boolean;
}) {
  const order = await createManufacturingOrder({
    productId: params.productId,
    plannedQuantity: params.plannedQuantity,
    plannedDate: "2026-06-05",
    ingredients: [
      {
        itemId: params.componentId,
        quantityPerUnit: params.quantityPerUnit,
      },
    ],
    confirmShortage: params.confirmShortage ?? false,
  });
  expectResponse(order);

  const release = await releaseManufacturingOrder(order.body.id, {
    confirmShortage: params.confirmShortage ?? false,
  });
  expect(release.status, JSON.stringify(release.body)).toBe(200);
  return order.body.id as string;
}

export async function readAvailableLotId(db: TestDb, itemId: string) {
  const [lot] = await db
    .select({ lotId: inventoryLotBalances.lotId })
    .from(inventoryLotBalances)
    .where(
      and(
        eq(inventoryLotBalances.itemId, itemId),
        eq(inventoryLotBalances.disposition, "available")
      )
    )
    .orderBy(asc(inventoryLotBalances.createdAt));
  expect(lot).toBeTruthy();
  return lot!.lotId;
}

export async function searchOrderList(page: Parameters<typeof filterList>[0], orderNumber: string) {
  await page.goto("/sales/orders");
  await filterList(page, "Search orders", orderNumber);
  return page.getByRole("row").filter({ hasText: orderNumber }).first();
}
