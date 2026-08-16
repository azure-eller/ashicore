import http from "node:http";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { and, asc, eq, inArray } from "drizzle-orm";
import { test, expect } from "../fixtures";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import {
  integrationConnections,
  integrationExternalRecords,
  inventoryDemandSummary,
  inventoryEvents,
  inventoryItemBalances,
  accountingDocumentSyncs,
  customers,
  customerContacts,
  manufacturingOrders,
  organization,
  organizationOverheadSettings,
  itemFamilies,
  items,
  itemVariantValues,
  pricingScenarioRevisions,
  pricingScenarios,
  salesOrderLines,
  salesOrders,
  variantOptions,
  variantOptionValues,
} from "../../../lib/db/schema";
import {
  classifyLines,
  computeOverhead,
  isUnresolvedType,
  isXeroReconnectStatus,
  type OverheadAccountOverrides,
} from "../../../lib/overhead/compute";
import { parseProfitAndLoss } from "../../../lib/overhead/parse";
import {
  addCustomerContact,
  createCustomer,
  createItem,
  createManufacturingOrder,
  createSalesOrder,
  createUnit,
  fulfillSalesOrder,
  getBaseUrl,
  getOrgId,
  getSessionCookie,
  getUnitId,
  testFetch,
  updateItem,
} from "../../helpers/api";
import { buildStorageState } from "../../helpers/test-env";
import {
  emptyPricingScenarioDoc,
  pricingScenarioRevisionSnapshotSchema,
} from "../../../lib/schemas/pricing-scenarios";
import { calculatePricingScenario } from "../../../lib/pricing-scenarios/calculations";
import { withAccountingConnectionFixtureLock } from "../../helpers/accounting-connection-fixture-lock";
import { evaluateSalesImportInTx } from "../../../scripts/load/engine/sync-sales-orders";
import type {
  ItemSeed,
  SalesImportConfig,
} from "../../../scripts/load/engine/types";
import type { Tx } from "../../../lib/db/with-org-context";
import { convertedShipmentQuantities } from "../../../lib/sales/quantity-basis";

const ACCOUNTING_PROVIDER_XERO = "xero";
const ACCOUNTING_PROVIDER_QUICKBOOKS = "quickbooks";
const ACCOUNTING_DOCUMENT_SALES_ORDER = "sales_order";

function editableGrid(page: Page, index = 0) {
  return page.locator('[data-slot="editable-line-data-grid"]').nth(index);
}

async function expectRows(page: Page, count: number, gridIndex = 0) {
  await expect(
    editableGrid(page, gridIndex).locator(".ag-center-cols-container .ag-row"),
  ).toHaveCount(count, { timeout: 15_000 });
}

async function editGridCell(
  page: Page,
  colId: string,
  value: string,
  rowIndex = 0,
) {
  const cell = editableGrid(page)
    .locator(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`)
    .first();
  await expect(cell).toBeVisible();
  await cell.click();
  const input = page.locator(".ag-cell-inline-editing input").first();
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press("Enter");
}

async function selectInventoryGridItem(
  page: Page,
  rowIndex: number,
  itemName: string,
) {
  const cell = editableGrid(page)
    .locator(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="itemId"]`)
    .first();
  await expect(cell).toBeVisible();
  await cell.click();
  const input = page.getByPlaceholder("Search items...");
  await expect(input).toBeVisible();
  await input.fill(itemName);
  await page
    .locator('[data-slot="combobox-item"]')
    .filter({ hasText: itemName })
    .first()
    .click();
}

function isoDaysFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function withOnlyQuickBooksConnection<T>(
  db: Parameters<Parameters<typeof test>[2]>[0]["db"],
  fn: () => Promise<T>,
) {
  return withAccountingConnectionFixtureLock(() =>
    withOnlyQuickBooksConnectionUnlocked(db, fn),
  );
}

async function withOnlyQuickBooksConnectionUnlocked<T>(
  db: Parameters<Parameters<typeof test>[2]>[0]["db"],
  fn: () => Promise<T>,
) {
  const existing = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, (await import("../../helpers/api")).getOrgId()),
        inArray(integrationConnections.provider, [
          ACCOUNTING_PROVIDER_XERO,
          ACCOUNTING_PROVIDER_QUICKBOOKS,
        ]),
      ),
    );

  const { getOrgId } = await import("../../helpers/api");
  await db
    .delete(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, getOrgId()),
        inArray(integrationConnections.provider, [
          ACCOUNTING_PROVIDER_XERO,
          ACCOUNTING_PROVIDER_QUICKBOOKS,
        ]),
      ),
    );
  await db.insert(integrationConnections).values({
    organizationId: getOrgId(),
    provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
    tenantId: `test-qb-tenant-${randomUUID()}`,
    tenantName: "Test QuickBooks",
    accessTokenCiphertext: "test-access",
    refreshTokenCiphertext: "test-refresh",
    tokenEncryptionKeyId: "test-key",
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    defaultAccountCode: "QB-SALES",
    purchaseOrderDefaultAccountCode: "QB-EXPENSE",
  });

  try {
    return await fn();
  } finally {
    await db
      .delete(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, getOrgId()),
          inArray(integrationConnections.provider, [
            ACCOUNTING_PROVIDER_XERO,
            ACCOUNTING_PROVIDER_QUICKBOOKS,
          ]),
        ),
      );
    if (existing.length > 0) {
      await db.insert(integrationConnections).values(existing);
    }
  }
}

function startShopifyServer(payload: unknown) {
  const server = http.createServer((req, res) => {
    expect(req.headers["x-shopify-access-token"]).toBe("shopify-fast-token");
    expect(req.url).toContain("/admin/api/2025-10/orders.json");
    expect(req.url).toContain("financial_status=paid");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
  });

  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Shopify test server did not bind to a port.");
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test.describe("sales demand and shipping heartbeat", () => {
  const ts = Date.now();
  const unitId = getUnitId();

  test("new sales order waits for a customer before first autosave", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const orderNumber = `SO-DEFER-${unique}`;
    const customer = await createCustomer({
      name: `Fast Deferred SO Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    await page.goto("/sales/order");
    await expect(page.getByText("New sales order")).toBeVisible();
    // The save pill states the blocker, before and after dirty edits.
    await expect(page.getByText("Customer is required").first()).toBeVisible();
    await page.getByLabel("Sales order").fill(orderNumber);
    await page.waitForTimeout(1_000);
    await expect(page.getByText("Customer is required").first()).toBeVisible();

    let rows = await db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(eq(salesOrders.orderNumber, orderNumber));
    expect(rows).toHaveLength(0);

    await page.getByPlaceholder("Search customers…").fill(customer.body.name);
    await page
      .locator('[data-slot="combobox-item"]')
      .filter({ hasText: customer.body.name })
      .first()
      .click();
    await page.waitForURL(/\/sales\/order\/[0-9a-f-]+$/);

    rows = await db
      .select({
        id: salesOrders.id,
        customerId: salesOrders.customerId,
        orderNumber: salesOrders.orderNumber,
      })
      .from(salesOrders)
      .where(eq(salesOrders.orderNumber, orderNumber));
    expect(rows).toEqual([
      {
        id: page.url().split("/").pop(),
        customerId: customer.body.id,
        orderNumber,
      },
    ]);
  });

  async function createStockedProduct(label: string, stock: string) {
    const component = await createItem({
      itemType: "material",
      name: `Fast Sales ${label} Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-SALES-${label}-COMP-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status, JSON.stringify(component.body)).toBe(201);

    const product = await createItem({
      itemType: "product",
      name: `Fast Sales ${label} Product ${ts}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-SALES-${label}-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock,
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);

    return product.body.id as string;
  }

  test("sales order creates demand without consuming physical stock", async ({
    db,
  }) => {
    const productId = await createStockedProduct("Demand", "10");

    const customer = await createCustomer({ name: `Fast Sales Customer ${ts}` });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "6", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id, quantity: salesOrderLines.quantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(line.quantity).toBe("6.0000");

    const [demand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(
        and(
          eq(inventoryDemandSummary.itemId, productId),
          eq(inventoryDemandSummary.referenceType, "sales_order_line"),
          eq(inventoryDemandSummary.referenceId, line.id)
        )
      );
    expect(demand.quantity).toBe("6.0000");

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
        availableToPromise: inventoryItemBalances.availableToPromise,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "10.0000",
      demandQty: "6.0000",
      availableToPromise: "4.0000",
    });
  });

  test("converted partial shipment rounding preserves a completable remainder", () => {
    const first = convertedShipmentQuantities({
      requestedBasis: "selling",
      requestedQuantity: "0.0002",
      salesToStockFactor: "0.3333",
      sellingRemainingQuantity: "0.0006",
      stockRemainingQuantity: "0.0002",
    });
    expect(first).toEqual({
      sellingQuantity: "0.0002",
      stockQuantity: "0.0001",
    });

    const unrepresentablePartial = convertedShipmentQuantities({
      requestedBasis: "selling",
      requestedQuantity: "0.0002",
      salesToStockFactor: "0.3333",
      sellingRemainingQuantity: "0.0004",
      stockRemainingQuantity: "0.0001",
    });
    expect(unrepresentablePartial).toEqual({
      sellingQuantity: "0.0002",
      stockQuantity: "0",
    });

    const fullRemainder = convertedShipmentQuantities({
      requestedBasis: "selling",
      requestedQuantity: "0.0004",
      salesToStockFactor: "0.3333",
      sellingRemainingQuantity: "0.0004",
      stockRemainingQuantity: "0.0001",
    });
    expect(fullRemainder).toEqual({
      sellingQuantity: "0.0004",
      stockQuantity: "0.0001",
    });
  });

  test("sales units keep commercial snapshots separate from stock demand and shipment", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const pallet = await createUnit({
      name: `Fast pallet of 3 ${unique}`,
      size: "3",
      uom: "ea",
    });
    expect(pallet.status, JSON.stringify(pallet.body)).toBe(201);

    const material = await createItem({
      itemType: "material",
      name: `Fast sales-unit material ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      salesUnitDefinitionId: pallet.body.id,
      salesToStockFactor: "3",
      sku: `FAST-SALES-UNIT-${unique}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: "1",
      defaultSellingPrice: "30",
      currentStockUnitCost: "1",
      stock: "9",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status, JSON.stringify(material.body)).toBe(201);

    const unrepresentableFactor = await updateItem(material.body.id, {
      salesUnitDefinitionId: pallet.body.id,
      salesToStockFactor: "0.00001",
    });
    expect(
      unrepresentableFactor.status,
      JSON.stringify(unrepresentableFactor.body),
    ).toBe(400);

    const tinyWeightUnit = await createUnit({
      name: `Fast tiny weight ${unique}`,
      size: "0.0001",
      uom: "kg",
    });
    expect(tinyWeightUnit.status, JSON.stringify(tinyWeightUnit.body)).toBe(201);
    const hugeWeightUnit = await createUnit({
      name: `Fast huge weight ${unique}`,
      size: "999999.9999",
      uom: "kg",
    });
    expect(hugeWeightUnit.status, JSON.stringify(hugeWeightUnit.body)).toBe(201);
    const autoOverflowMaterial = await createItem({
      itemType: "material",
      name: `Fast auto-overflow material ${unique}`,
      sellable: true,
      unitDefinitionId: tinyWeightUnit.body.id,
      sku: `FAST-AUTO-OVERFLOW-${unique}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: "1",
      defaultSellingPrice: "1",
      currentStockUnitCost: "1",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(
      autoOverflowMaterial.status,
      JSON.stringify(autoOverflowMaterial.body),
    ).toBe(201);
    const autoDerivedOverflow = await testFetch(
      `/api/item-cards/${autoOverflowMaterial.body.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          family: {
            salesUnitDefinitionId: hugeWeightUnit.body.id,
          },
        }),
      },
    );
    expect(
      autoDerivedOverflow.status,
      await autoDerivedOverflow.text(),
    ).toBe(400);

    const casePack = await createUnit({
      name: `Fast six-kilo pack ${unique}`,
      size: "6",
      uom: "kg",
    });
    expect(casePack.status, JSON.stringify(casePack.body)).toBe(201);
    const autoDerived = await testFetch(
      `/api/item-cards/${material.body.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          family: {
            salesUnitDefinitionId: casePack.body.id,
          },
          // A full card save can carry the price last read by the client. The
          // server must not let that stale value undo its conversion rescale.
          variants: [
            {
              id: material.body.id,
              defaultSellingPrice: "30",
            },
          ],
        }),
      },
    );
    const autoDerivedCard = await autoDerived.json();
    expect(autoDerived.status, JSON.stringify(autoDerivedCard)).toBe(200);
    expect(autoDerivedCard.family).toMatchObject({
      salesUnitDefinitionId: casePack.body.id,
      salesToStockFactor: "6",
    });
    expect(
      autoDerivedCard.variants.find(
        (variant: { id: string }) => variant.id === material.body.id,
      )?.defaultSellingPrice,
    ).toBe("60");

    const restoredSalesBasis = await updateItem(material.body.id, {
      salesUnitDefinitionId: pallet.body.id,
      salesToStockFactor: "3",
    });
    expect(
      restoredSalesBasis.status,
      JSON.stringify(restoredSalesBasis.body),
    ).toBe(200);
    expect(
      (
        restoredSalesBasis.body as {
          variants: Array<{ id: string; defaultSellingPrice: string | null }>;
        }
      ).variants.find((variant) => variant.id === material.body.id)
        ?.defaultSellingPrice,
    ).toBe("30");

    await page.goto(`/inventory/materials/${material.body.id}`);
    await expect(
      page.getByLabel("Default sales unit of measure"),
    ).toContainText(pallet.body.name);
    await expect(
      page.getByText(`Current: 1 ${pallet.body.name} = 3`),
    ).toBeVisible();

    const customer = await createCustomer({
      name: `Fast sales-unit customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    const smallFactorMaterial = await createItem({
      itemType: "material",
      name: `Fast small-factor material ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      salesUnitDefinitionId: casePack.body.id,
      salesToStockFactor: "0.001",
      sku: `FAST-SMALL-FACTOR-${unique}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: "1",
      defaultSellingPrice: "1",
      currentStockUnitCost: "1",
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(
      smallFactorMaterial.status,
      JSON.stringify(smallFactorMaterial.body),
    ).toBe(201);

    const importSeed: ItemSeed = {
      key: `small-factor-${unique}`,
      sku: `FAST-SMALL-FACTOR-${unique}`,
      name: `Fast small-factor material ${unique}`,
      itemType: "material",
      category: `Fast Sales ${ts}`,
      description: "",
      sellable: true,
    };
    const importConfig: SalesImportConfig = {
      orderMarkerPrefix: `[fast-sales-unit-${unique}:`,
      productAliasToSeedKey: {
        SmallFactor: importSeed.key,
      },
      customerMode: "existing-only",
      orderSeeds: [
        {
          sourceRows: [1],
          customerName: `Fast sales-unit customer ${unique}`,
          reference: "selling overflow",
          address: null,
          contact: null,
          specialInstructions: null,
          lines: [
            {
              kind: "mapped",
              product: "SmallFactor",
              quantity: "100000000",
              raw: "oversized selling quantity",
            },
          ],
        },
        {
          sourceRows: [2, 3],
          customerName: `Fast sales-unit customer ${unique}`,
          reference: "aggregate overflow",
          address: null,
          contact: null,
          specialInstructions: null,
          lines: [
            {
              kind: "mapped",
              product: "SmallFactor",
              quantity: "60000000",
              raw: "aggregate quantity part one",
            },
            {
              kind: "mapped",
              product: "SmallFactor",
              quantity: "60000000",
              raw: "aggregate quantity part two",
            },
          ],
        },
      ],
    };
    const importEvaluation = await evaluateSalesImportInTx(
      db as unknown as Tx,
      importConfig,
      new Map([[importSeed.key, importSeed]]),
      new Set([importSeed.sku!]),
    );
    expect(importEvaluation.orders).toHaveLength(2);
    expect(importEvaluation.orders[0]).toMatchObject({
      kind: "skipped",
      issues: [expect.stringContaining('Quantity "100000000" is invalid')],
    });
    expect(importEvaluation.orders[1]).toMatchObject({
      kind: "skipped",
      issues: [expect.stringContaining("Combined quantity")],
    });

    const sellingOverflow = await createSalesOrder({
      customerId: customer.body.id,
      lines: [
        {
          itemId: smallFactorMaterial.body.id,
          quantity: "100000000",
          unitPrice: "1",
        },
      ],
    });
    expect(sellingOverflow.status, JSON.stringify(sellingOverflow.body)).toBe(
      400,
    );
    const stockingOverflow = await createSalesOrder({
      customerId: customer.body.id,
      lines: [
        {
          itemId: material.body.id,
          quantity: "40000000",
          unitPrice: "30",
        },
      ],
    });
    expect(stockingOverflow.status, JSON.stringify(stockingOverflow.body)).toBe(
      400,
    );

    const order = await createSalesOrder({
      customerId: customer.body.id,
      lines: [
        {
          itemId: material.body.id,
          quantity: "2",
          unitPrice: "30",
        },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const [line] = await db
      .select({
        id: salesOrderLines.id,
        sellingUnitName: salesOrderLines.unitName,
        sellingQuantity: salesOrderLines.quantity,
        stockingUnitName: salesOrderLines.stockingUnitName,
        factor: salesOrderLines.salesToStockFactor,
        stockQuantity: salesOrderLines.stockQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(line).toMatchObject({
      sellingUnitName: pallet.body.name,
      sellingQuantity: "2.0000",
      factor: "3.0000",
      stockQuantity: "6.0000",
    });

    const [demand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(eq(inventoryDemandSummary.referenceId, line.id));
    expect(demand.quantity).toBe("6.0000");

    const initialDetailResponse = await testFetch(
      `/api/sales-orders/${order.body.id}`,
    );
    const initialDetail = await initialDetailResponse.json();
    expect(initialDetail.lines[0]).toMatchObject({
      // Legacy flat fields remain safe for stock-basis mobile clients.
      unitName: line.stockingUnitName,
      quantity: "6",
      sellingUnitName: pallet.body.name,
      sellingQuantity: "2",
      stockQuantity: "6",
      quantities: {
        contractVersion: 2,
        selling: {
          unitName: pallet.body.name,
          orderedQuantity: "2",
          salesToStockFactor: "3",
        },
        stocking: {
          unitName: line.stockingUnitName,
          orderedQuantity: "6",
        },
      },
    });
    const legacyPut = await testFetch(
      `/api/sales-orders/${order.body.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          customerId: customer.body.id,
          status: "open",
          orderDate: "2026-04-15",
          shipDate: null,
          requestedDate: null,
          notes: null,
          lines: [
            {
              id: initialDetail.lines[0].id,
              itemId: material.body.id,
              quantity: initialDetail.lines[0].quantity,
              unitPrice: initialDetail.lines[0].unitPrice,
            },
          ],
        }),
      },
    );
    expect(legacyPut.status).toBe(409);
    expect(await legacyPut.json()).toMatchObject({
      error: "Converted sales units require quantity contract version 2.",
    });
    const [lineAfterLegacyPut] = await db
      .select({
        quantity: salesOrderLines.quantity,
        stockQuantity: salesOrderLines.stockQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    expect(lineAfterLegacyPut).toEqual({
      quantity: "2.0000",
      stockQuantity: "6.0000",
    });
    const listResponse = await testFetch("/api/sales-orders");
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as Array<{
      id: string;
      lines: Array<Record<string, unknown>>;
    }>;
    const listOrder = list.find((candidate) => candidate.id === order.body.id);
    expect(listOrder?.lines[0]).toMatchObject({
      unitName: line.stockingUnitName,
      quantity: "6",
      shippedQuantity: "0",
      sellingUnitName: pallet.body.name,
      sellingQuantity: "2",
      stockQuantity: "6",
      quantities: {
        contractVersion: 2,
        selling: {
          unitName: pallet.body.name,
          orderedQuantity: "2",
          salesToStockFactor: "3",
        },
        stocking: {
          unitName: line.stockingUnitName,
          orderedQuantity: "6",
        },
      },
    });

    await expect(
      (async () => {
        await db
          .update(salesOrderLines)
          .set({
            quantity: "2.5",
            shippedQuantity: "0.5",
            cancelledQuantity: "0.25",
          })
          .where(eq(salesOrderLines.id, line.id));
      })(),
    ).rejects.toThrow();
    const [legacyUpdatedLine] = await db
      .select({
        quantity: salesOrderLines.quantity,
        shippedQuantity: salesOrderLines.shippedQuantity,
        cancelledQuantity: salesOrderLines.cancelledQuantity,
        stockQuantity: salesOrderLines.stockQuantity,
        stockShippedQuantity: salesOrderLines.stockShippedQuantity,
        stockCancelledQuantity: salesOrderLines.stockCancelledQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    expect(legacyUpdatedLine).toEqual({
      quantity: "2.0000",
      shippedQuantity: "0.0000",
      cancelledQuantity: "0.0000",
      stockQuantity: "6.0000",
      stockShippedQuantity: "0.0000",
      stockCancelledQuantity: "0.0000",
    });

    await db
      .update(salesOrderLines)
      .set({
        quantity: "2",
        stockQuantity: "6",
        shippedQuantity: "0",
        stockShippedQuantity: "0",
        cancelledQuantity: "0",
        stockCancelledQuantity: "0",
      })
      .where(eq(salesOrderLines.id, line.id));
    const [pairedUpdatedLine] = await db
      .select({
        quantity: salesOrderLines.quantity,
        stockQuantity: salesOrderLines.stockQuantity,
        stockShippedQuantity: salesOrderLines.stockShippedQuantity,
        stockCancelledQuantity: salesOrderLines.stockCancelledQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    expect(pairedUpdatedLine).toEqual({
      quantity: "2.0000",
      stockQuantity: "6.0000",
      stockShippedQuantity: "0.0000",
      stockCancelledQuantity: "0.0000",
    });

    const snapshotOrder = await createSalesOrder({
      customerId: customer.body.id,
      lines: [
        {
          itemId: material.body.id,
          quantity: "2",
          unitPrice: "30",
        },
      ],
    });
    expect(snapshotOrder.status, JSON.stringify(snapshotOrder.body)).toBe(201);
    const [snapshotLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, snapshotOrder.body.id));

    const reconfigured = await updateItem(material.body.id, {
      salesUnitDefinitionId: pallet.body.id,
      salesToStockFactor: "4",
    });
    expect(reconfigured.status, JSON.stringify(reconfigured.body)).toBe(200);

    const preservedSnapshot = await testFetch(
      `/api/sales-orders/${snapshotOrder.body.id}`,
      {
        method: "PUT",
        headers: Object.fromEntries(
          createIdempotencyHeaders(
            "updateSalesOrderWithPersistedSalesUnitSnapshot",
          ).entries(),
        ),
        body: JSON.stringify({
          customerId: customer.body.id,
          quantityContractVersion: 2,
          lines: [
            {
              id: snapshotLine.id,
              itemId: material.body.id,
              quantity: "2",
              unitPrice: "30",
            },
          ],
          confirmOversell: true,
        }),
      },
    );
    expect(
      preservedSnapshot.status,
      await preservedSnapshot.text(),
    ).toBe(200);
    const [preservedLine] = await db
      .select({
        id: salesOrderLines.id,
        factor: salesOrderLines.salesToStockFactor,
        stockQuantity: salesOrderLines.stockQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, snapshotOrder.body.id));
    expect(preservedLine).toEqual({
      id: snapshotLine.id,
      factor: "3.0000",
      stockQuantity: "6.0000",
    });

    const replacementLineId = randomUUID();
    const currentSalesBasis = await testFetch(
      `/api/sales-orders/${snapshotOrder.body.id}`,
      {
        method: "PUT",
        headers: Object.fromEntries(
          createIdempotencyHeaders(
            "updateSalesOrderWithNewSalesUnitSnapshot",
          ).entries(),
        ),
        body: JSON.stringify({
          customerId: customer.body.id,
          quantityContractVersion: 2,
          lines: [
            {
              id: replacementLineId,
              itemId: material.body.id,
              quantity: "2",
              unitPrice: "30",
            },
          ],
          confirmOversell: true,
        }),
      },
    );
    expect(currentSalesBasis.status, await currentSalesBasis.text()).toBe(200);
    const [replacementLine] = await db
      .select({
        id: salesOrderLines.id,
        factor: salesOrderLines.salesToStockFactor,
        stockQuantity: salesOrderLines.stockQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, snapshotOrder.body.id));
    expect(replacementLine).toEqual({
      id: replacementLineId,
      factor: "4.0000",
      stockQuantity: "8.0000",
    });
    const [replacementDemand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(eq(inventoryDemandSummary.referenceId, replacementLineId));
    expect(replacementDemand.quantity).toBe("8.0000");

    for (const [requestName, shipmentLine] of [
      [
        "shipSalesOrderRejectsBothQuantityBases",
        { salesOrderLineId: line.id, quantity: "1", sellingQuantity: "1" },
      ],
      ["shipSalesOrderRejectsMissingQuantityBasis", { salesOrderLineId: line.id }],
    ] as const) {
      const invalidShipment = await testFetch(
        `/api/sales-orders/${order.body.id}/ship`,
        {
          method: "POST",
          headers: Object.fromEntries(
            createIdempotencyHeaders(requestName).entries(),
          ),
          body: JSON.stringify({
            syncAccounting: false,
            lines: [shipmentLine],
          }),
        },
      );
      expect(invalidShipment.status).toBe(400);
    }

    const tinyStockShipment = await testFetch(
      `/api/sales-orders/${order.body.id}/ship`,
      {
        method: "POST",
        headers: Object.fromEntries(
          createIdempotencyHeaders(
            "shipSalesOrderRejectsZeroSellingCounterpart",
          ).entries(),
        ),
        body: JSON.stringify({
          syncAccounting: false,
          lines: [{ salesOrderLineId: line.id, quantity: "0.0001" }],
        }),
      },
    );
    expect(tinyStockShipment.status).toBe(400);
    expect(await tinyStockShipment.json()).toMatchObject({
      errors: {
        lines: [
          "Enter a quantity that converts to at least 0.0001 selling units.",
        ],
      },
    });
    const [afterRejectedTinyShipment] = await db
      .select({
        sellingShippedQuantity: salesOrderLines.shippedQuantity,
        stockShippedQuantity: salesOrderLines.stockShippedQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    expect(afterRejectedTinyShipment).toEqual({
      sellingShippedQuantity: "0.0000",
      stockShippedQuantity: "0.0000",
    });

    const ship = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: Object.fromEntries(
        createIdempotencyHeaders("shipSalesOrderWithSalesUnit").entries(),
      ),
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, sellingQuantity: "0.5" }],
      }),
    });
    expect(ship.status, await ship.text()).toBe(200);

    const [afterLine] = await db
      .select({
        factor: salesOrderLines.salesToStockFactor,
        sellingShippedQuantity: salesOrderLines.shippedQuantity,
        stockShippedQuantity: salesOrderLines.stockShippedQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    expect(afterLine).toEqual({
      factor: "3.0000",
      sellingShippedQuantity: "0.5000",
      stockShippedQuantity: "1.5000",
    });
    const [remainingDemand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(eq(inventoryDemandSummary.referenceId, line.id));
    expect(remainingDemand.quantity).toBe("4.5000");
    const consumption = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.referenceId, order.body.id),
          eq(inventoryEvents.eventType, "sales_consumption"),
        ),
      );
    expect(consumption).toEqual([{ quantity: "1.5000" }]);

    const legacyStockShipment = await testFetch(
      `/api/sales-orders/${order.body.id}/ship`,
      {
        method: "POST",
        headers: Object.fromEntries(
          createIdempotencyHeaders(
            "shipSalesOrderWithLegacyStockQuantity",
          ).entries(),
        ),
        body: JSON.stringify({
          syncAccounting: false,
          lines: [{ salesOrderLineId: line.id, quantity: "1" }],
        }),
      },
    );
    expect(
      legacyStockShipment.status,
      await legacyStockShipment.text(),
    ).toBe(200);

    const [beforeLegacyLinePatchOrder] = await db
      .select({ version: salesOrders.version })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    const [beforeLegacyLinePatchDemand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(eq(inventoryDemandSummary.referenceId, line.id));

    const legacyLinePatch = await testFetch(
      `/api/sales-orders/${order.body.id}/lines/${line.id}`,
      {
        method: "PATCH",
        headers: Object.fromEntries(
          createIdempotencyHeaders(
            "rejectLegacyConvertedSalesLineQuantityPatch",
          ).entries(),
        ),
        body: JSON.stringify({ quantity: "2.5", unitPrice: "999" }),
      },
    );
    expect(legacyLinePatch.status).toBe(409);
    expect(await legacyLinePatch.json()).toMatchObject({
      error: "Converted sales units require quantity contract version 2.",
    });
    const [afterLegacyLinePatch] = await db
      .select({
        sellingQuantity: salesOrderLines.quantity,
        stockQuantity: salesOrderLines.stockQuantity,
        unitPrice: salesOrderLines.unitPrice,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    expect(afterLegacyLinePatch).toEqual({
      sellingQuantity: "2.0000",
      stockQuantity: "6.0000",
      unitPrice: "30.00",
    });
    const [afterLegacyLinePatchOrder] = await db
      .select({ version: salesOrders.version })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    const [afterLegacyLinePatchDemand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(eq(inventoryDemandSummary.referenceId, line.id));
    expect(afterLegacyLinePatchOrder.version).toBe(
      beforeLegacyLinePatchOrder.version,
    );
    expect(afterLegacyLinePatchDemand).toEqual(beforeLegacyLinePatchDemand);

    const markerOnlyLinePatch = await testFetch(
      `/api/sales-orders/${order.body.id}/lines/${line.id}`,
      {
        method: "PATCH",
        headers: Object.fromEntries(
          createIdempotencyHeaders("rejectSalesLineVersionMarkerOnly").entries(),
        ),
        body: JSON.stringify({ quantityContractVersion: 2 }),
      },
    );
    expect(markerOnlyLinePatch.status).toBe(400);
    const [afterMarkerOnlyLinePatchOrder] = await db
      .select({ version: salesOrders.version })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(afterMarkerOnlyLinePatchOrder.version).toBe(
      beforeLegacyLinePatchOrder.version,
    );

    const priceOnlyLinePatch = await testFetch(
      `/api/sales-orders/${order.body.id}/lines/${line.id}`,
      {
        method: "PATCH",
        headers: Object.fromEntries(
          createIdempotencyHeaders("allowLegacyConvertedPriceOnlyPatch").entries(),
        ),
        body: JSON.stringify({ unitPrice: "30" }),
      },
    );
    expect(priceOnlyLinePatch.status, await priceOnlyLinePatch.text()).toBe(200);
    const [afterPriceOnlyLinePatchOrder] = await db
      .select({ version: salesOrders.version })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(afterPriceOnlyLinePatchOrder.version).toBe(
      beforeLegacyLinePatchOrder.version + 1,
    );

    const editToDeliveredQuantity = await testFetch(
      `/api/sales-orders/${order.body.id}/lines/${line.id}`,
      {
        method: "PATCH",
        headers: Object.fromEntries(
          createIdempotencyHeaders(
            "editSalesOrderToDeliveredSalesQuantity",
          ).entries(),
        ),
        body: JSON.stringify({
          quantityContractVersion: 2,
          quantity: "0.8333",
        }),
      },
    );
    const editedOrder = await editToDeliveredQuantity.json();
    expect(
      editToDeliveredQuantity.status,
      JSON.stringify(editedOrder),
    ).toBe(200);
    expect(editedOrder.lines[0].quantities).toMatchObject({
      selling: {
        orderedQuantity: "0.8333",
        shippedQuantity: "0.8333",
        remainingQuantity: "0",
      },
      stocking: {
        orderedQuantity: "2.5",
        shippedQuantity: "2.5",
        remainingQuantity: "0",
      },
    });

    const [editedLine] = await db
      .select({
        sellingOrderedQuantity: salesOrderLines.quantity,
        sellingShippedQuantity: salesOrderLines.shippedQuantity,
        stockOrderedQuantity: salesOrderLines.stockQuantity,
        stockShippedQuantity: salesOrderLines.stockShippedQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    expect(editedLine).toEqual({
      sellingOrderedQuantity: "0.8333",
      sellingShippedQuantity: "0.8333",
      stockOrderedQuantity: "2.5000",
      stockShippedQuantity: "2.5000",
    });
  });

  test("sales order reads use one default invoice sync row", async ({ db }) => {
    const productId = await createStockedProduct("DefaultInvoiceSync", "10");
    const customer = await createCustomer({
      name: `Fast Default Invoice Sync Customer ${ts}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    await db.insert(accountingDocumentSyncs).values([
      {
        organizationId: getOrgId(),
        provider: ACCOUNTING_PROVIDER_XERO,
        documentType: ACCOUNTING_DOCUMENT_SALES_ORDER,
        documentId: order.body.id,
        externalDocumentId: `xero-invoice-default-${ts}`,
        externalDocumentNumber: `INV-DEFAULT-${ts}`,
        pushStatus: "pushed",
        pushedAt: new Date(),
      },
      {
        organizationId: getOrgId(),
        provider: ACCOUNTING_PROVIDER_XERO,
        documentType: ACCOUNTING_DOCUMENT_SALES_ORDER,
        documentId: order.body.id,
        groupKey: `bol:${ts}`,
        externalDocumentId: `xero-invoice-bol-${ts}`,
        externalDocumentNumber: `INV-BOL-${ts}`,
        pushStatus: "pushed",
        pushedAt: new Date(),
      },
    ]);

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      xeroInvoiceNumber: string | null;
    }>;
    const matchingRows = salesOrderRows
      .filter((row) => row.id === order.body.id)
      .map((row) => ({
        id: row.id,
        xeroInvoiceNumber: row.xeroInvoiceNumber,
      }));
    expect(matchingRows).toEqual([
      {
        id: order.body.id,
        xeroInvoiceNumber: `INV-DEFAULT-${ts}`,
      },
    ]);

    const detailResponse = await testFetch(`/api/sales-orders/${order.body.id}`);
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      id: string;
      xeroInvoiceNumber: string | null;
    };
    expect(detail).toMatchObject({
      id: order.body.id,
      xeroInvoiceNumber: `INV-DEFAULT-${ts}`,
    });
  });

  test("sales order inline patches bump the card document version", async ({
    db,
  }) => {
    const productId = await createStockedProduct("PatchVersion", "10");
    const customer = await createCustomer({
      name: `Fast Patch Version Customer ${ts}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    const [created] = await db
      .select({ version: salesOrders.version })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(created.version).toBe(1);

    const headerPatch = await testFetch(`/api/sales-orders/${order.body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: "inline header edit" }),
    });
    expect(headerPatch.status, await headerPatch.text()).toBe(200);
    const headerBody = await headerPatch.json();
    expect(headerBody.version).toBe(2);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    const linePatch = await testFetch(
      `/api/sales-orders/${order.body.id}/lines/${line.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ quantity: "3" }),
      },
    );
    expect(linePatch.status, await linePatch.text()).toBe(200);
    const lineBody = await linePatch.json();
    expect(lineBody.version).toBe(3);

    const [updated] = await db
      .select({ version: salesOrders.version })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(updated.version).toBe(3);
  });

  test("sales order stale save returns the shared conflict envelope with the fresh order", async ({
    db,
  }) => {
    const productId = await createStockedProduct("ConflictEnvelope", "10");
    const customer = await createCustomer({
      name: `Fast Conflict Envelope Customer ${ts}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderDetailResponse = await testFetch(`/api/sales-orders/${order.body.id}`);
    expect(orderDetailResponse.status).toBe(200);
    const orderDetail = await orderDetailResponse.json();

    const basePayload = {
      orderNumber: orderDetail.orderNumber,
      customerId: customer.body.id,
      customerProjectId: null,
      status: "open",
      orderDate: "2026-05-01",
      shipDate: null,
      requestedDate: null,
      notes: null,
      shipLine1: null,
      shipLine2: null,
      shipCity: null,
      shipRegion: null,
      shipPostcode: null,
      shipCountry: null,
      billingLine1: null,
      billingLine2: null,
      billingCity: null,
      billingRegion: null,
      billingPostcode: null,
      billingCountry: null,
      shippingFeeDescription: null,
      shippingFeeAmount: "0",
      shippingFeeTaxAmount: "0",
      expectedVersion: orderDetail.version,
      lines: [
        {
          id: orderDetail.lines[0].id,
          itemId: productId,
          quantity: "2",
          listUnitPrice: "12.00",
          unitPrice: "12.00",
          taxRateId: null,
          discountPercent: "0",
          suggestedUnitPrice: null,
          pricingSourceType: null,
          pricingScheduleName: null,
          pricingBreakLabel: null,
          isPriceOverridden: false,
        },
      ],
      confirmOversell: true,
    };

    const first = await testFetch(`/api/sales-orders/${order.body.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, notes: "first sales writer" }),
    });
    expect(first.status, await first.text()).toBe(200);

    const stale = await testFetch(`/api/sales-orders/${order.body.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, notes: "stale sales writer" }),
    });
    const staleBody = await stale.json();
    expect(stale.status, JSON.stringify(staleBody)).toBe(409);
    expect(staleBody.conflict).toBe(true);
    expect(staleBody.current.notes).toBe("first sales writer");
    expect(staleBody.current.version).toBe(orderDetail.version + 1);
    expect(staleBody.order).toBeUndefined();
    expect(staleBody.kind).toBeUndefined();

    const [row] = await db
      .select({ notes: salesOrders.notes, version: salesOrders.version })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(row.notes).toBe("first sales writer");
    expect(row.version).toBe(orderDetail.version + 1);
  });

  test("sales order autosave keeps line edits made while the header save is in flight", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`Inflight ${unique}`, "20");
    const customer = await createCustomer({
      name: `Fast Sales Inflight Customer ${unique}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      shipDate: isoDaysFromNow(3),
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const notes = `SO save in flight ${unique}`;

    let delayedFirstMutation = false;
    await page.route(`**/api/sales-orders/${orderId}`, async (route) => {
      if (
        (route.request().method() === "PUT" ||
          route.request().method() === "PATCH") &&
        !delayedFirstMutation
      ) {
        delayedFirstMutation = true;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/sales/order/${orderId}`);
    const notesInput = page.getByPlaceholder("Add notes for the warehouse or customer.");
    await expect(notesInput).toBeVisible();
    await notesInput.fill(notes);
    await notesInput.blur();

    await editGridCell(page, "quantity", "7");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();

    await expect(notesInput).toHaveValue(notes);
    await expect(
      editableGrid(page).locator('.ag-row .ag-cell[col-id="quantity"]').first(),
    ).toContainText("7");

    const [row] = await db
      .select({ notes: salesOrders.notes })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(row.notes).toBe(notes);

    const [line] = await db
      .select({ quantity: salesOrderLines.quantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));
    expect(line.quantity).toBe("7.0000");
  });

  test("sales order autosave preserves an unsent blank line through a header rebase", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const existingLabel = `BlankA${unique}`;
    const newLabel = `BlankB${unique}`;
    const existingProductId = await createStockedProduct(existingLabel, "20");
    const newProductId = await createStockedProduct(newLabel, "20");
    const newProductName = `Fast Sales ${newLabel} Product ${ts}`;
    const customer = await createCustomer({
      name: `Fast Sales Blank Line Customer ${unique}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      shipDate: isoDaysFromNow(3),
      lines: [{ itemId: existingProductId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const notes = `blank line survives rebase ${unique}`;

    let delayedFirstMutation = false;
    await page.route(`**/api/sales-orders/${orderId}`, async (route) => {
      if (
        (route.request().method() === "PUT" ||
          route.request().method() === "PATCH") &&
        !delayedFirstMutation
      ) {
        delayedFirstMutation = true;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/sales/order/${orderId}`);
    await expectRows(page, 1);
    await page.getByRole("button", { name: "Add line" }).click();
    await expectRows(page, 2);

    const notesInput = page.getByPlaceholder("Add notes for the warehouse or customer.");
    await notesInput.fill(notes);
    await notesInput.blur();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expectRows(page, 2);

    const afterHeaderSave = await db
      .select({ itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));
    expect(afterHeaderSave).toHaveLength(1);
    expect(afterHeaderSave[0].itemId).toBe(existingProductId);

    await selectInventoryGridItem(page, 1, newProductName);
    await editGridCell(page, "quantity", "3", 1);
    // The pill still reads "Saved" from the header save during the line
    // edit's debounce window, so wait for the persisted row instead.
    await expect
      .poll(
        async () =>
          (
            await db
              .select({ id: salesOrderLines.id })
              .from(salesOrderLines)
              .where(eq(salesOrderLines.salesOrderId, orderId))
          ).length,
        { timeout: 30_000 },
      )
      .toBe(2);
    await page.reload();
    await expectRows(page, 2);

    const savedLines = await db
      .select({
        itemId: salesOrderLines.itemId,
        quantity: salesOrderLines.quantity,
        unitPrice: salesOrderLines.unitPrice,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, orderId));
    expect(savedLines).toHaveLength(2);
    expect(savedLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: newProductId,
          quantity: "3.0000",
        }),
      ]),
    );
  });

  test("sales order autosave surfaces same-field conflicts without overwriting and can recover", async ({
    browser,
    page,
    db,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`Conflict UI ${unique}`, "20");
    const customer = await createCustomer({
      name: `Fast Sales Conflict UI Customer ${unique}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      shipDate: isoDaysFromNow(3),
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const firstWriterNotes = `first sales writer ${randomUUID()}`;
    const staleWriterNotes = `stale sales writer ${randomUUID()}`;
    const resolvedNotes = `resolved sales writer ${randomUUID()}`;

    const secondContext = await browser.newContext({
      baseURL: getBaseUrl(),
      storageState: buildStorageState(getSessionCookie(), getBaseUrl()),
    });
    const secondPage = await secondContext.newPage();

    try {
      await page.goto(`/sales/order/${orderId}`);
      await secondPage.goto(`/sales/order/${orderId}`);

      const firstNotes = secondPage.getByPlaceholder(
        "Add notes for the warehouse or customer.",
      );
      await expect(firstNotes).toHaveValue("");
      await firstNotes.fill(firstWriterNotes);
      await firstNotes.blur();
      await expect(secondPage.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      const staleNotes = page.getByPlaceholder(
        "Add notes for the warehouse or customer.",
      );
      await expect(staleNotes).toHaveValue("");
      await staleNotes.fill(staleWriterNotes);
      await staleNotes.blur();
      await expect(
        page.getByText(
          "This record was changed elsewhere. Saving again will overwrite those changes.",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 15_000 });

      const [afterConflict] = await db
        .select({ notes: salesOrders.notes, version: salesOrders.version })
        .from(salesOrders)
        .where(eq(salesOrders.id, orderId));
      expect(afterConflict.notes).toBe(firstWriterNotes);
      expect(afterConflict.version).toBe(2);

      await staleNotes.fill(resolvedNotes);
      await staleNotes.blur();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await page.reload();
      await expect(
        page.getByPlaceholder("Add notes for the warehouse or customer."),
      ).toHaveValue(resolvedNotes);

      const [afterRecovery] = await db
        .select({ notes: salesOrders.notes, version: salesOrders.version })
        .from(salesOrders)
        .where(eq(salesOrders.id, orderId));
      expect(afterRecovery.notes).toBe(resolvedNotes);
      expect(afterRecovery.version).toBe(3);
    } finally {
      await secondContext.close();
    }
  });

  test("customer autosave rebase preserves an unsent blank contact row", async ({
    page,
  }) => {
    const customer = await createCustomer({
      name: `Fast Contact Blank Customer ${Date.now()}`,
      email: "before@example.com",
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const customerId = customer.body.id as string;
    const contact = await addCustomerContact(customerId, {
      name: "Existing Contact",
      email: "existing@example.com",
    });
    expect(contact.status, JSON.stringify(contact.body)).toBe(200);
    const email = `blank-${Date.now()}@example.com`;
    let delayedFirstSave = false;

    await page.route(`**/api/customers/${customerId}`, async (route) => {
      if (route.request().method() === "PUT" && !delayedFirstSave) {
        delayedFirstSave = true;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/sales/customers/${customerId}`);
    await expectRows(page, 1);
    await page.getByRole("button", { name: "Add contact" }).click();
    await expectRows(page, 2);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Email").blur();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expectRows(page, 2);

    const saved = await (await testFetch(`/api/customers/${customerId}`)).json();
    expect(saved.email).toBe(email);
    expect(saved.contacts).toHaveLength(1);
  });

  test("customer immediate reload keeps a just-blurred scalar autosave", async ({
    page,
    db,
  }) => {
    const customer = await createCustomer({
      name: `Fast Customer Reload ${Date.now()}`,
      email: "before@example.com",
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const customerId = customer.body.id as string;
    const email = `reload-${randomUUID()}@example.com`;

    await page.goto(`/sales/customers/${customerId}`);
    const emailInput = page.getByLabel("Email");
    await expect(emailInput).toHaveValue("before@example.com");
    await emailInput.fill(email);
    await emailInput.blur();
    await page.reload();

    await expect(page.getByLabel("Email")).toHaveValue(email, { timeout: 15_000 });
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    const [savedCustomer] = await db
      .select({ email: customers.email })
      .from(customers)
      .where(eq(customers.id, customerId));
    expect(savedCustomer.email).toBe(email);
  });

  test("customer autosave keeps contact edits made while the header save is in flight", async ({
    page,
    db,
  }) => {
    const customer = await createCustomer({
      name: `Fast Contact Inflight Customer ${Date.now()}`,
      email: "before@example.com",
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const customerId = customer.body.id as string;
    const contact = await addCustomerContact(customerId, {
      name: "Existing Contact",
      email: "existing@example.com",
    });
    expect(contact.status, JSON.stringify(contact.body)).toBe(200);
    const headerEmail = `header-${Date.now()}@example.com`;
    const contactEmail = `contact-${Date.now()}@example.com`;

    let delayedFirstPut = false;
    let markPutStarted: () => void = () => {};
    const putStarted = new Promise<void>((resolve) => {
      markPutStarted = resolve;
    });
    await page.route(`**/api/customers/${customerId}`, async (route) => {
      if (route.request().method() === "PUT" && !delayedFirstPut) {
        delayedFirstPut = true;
        markPutStarted();
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    await page.goto(`/sales/customers/${customerId}`);
    await expectRows(page, 1);

    await page.getByLabel("Email").fill(headerEmail);
    await page.getByLabel("Email").blur();
    await putStarted;

    await editGridCell(page, "email", contactEmail);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();

    await expect(page.getByLabel("Email")).toHaveValue(headerEmail);
    await expect(
      editableGrid(page).locator('.ag-row .ag-cell[col-id="email"]').first(),
    ).toContainText(contactEmail);

    const saved = await (await testFetch(`/api/customers/${customerId}`)).json();
    expect(saved.email).toBe(headerEmail);
    expect(saved.contacts).toHaveLength(1);
    expect(saved.contacts[0].email).toBe(contactEmail);

    const [savedContact] = await db
      .select({ email: customerContacts.email })
      .from(customerContacts)
      .where(eq(customerContacts.id, contact.contactId));
    expect(savedContact.email).toBe(contactEmail);
  });

  test("customer autosave surfaces same-field conflicts without overwriting and can recover", async ({
    browser,
    page,
    db,
  }) => {
    const customer = await createCustomer({
      name: `Fast Customer Conflict UI ${Date.now()}`,
      email: "before@example.com",
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const customerId = customer.body.id as string;
    const baseVersion = customer.body.version as number;
    const firstWriterEmail = `first-${randomUUID()}@example.com`;
    const staleWriterEmail = `stale-${randomUUID()}@example.com`;
    const resolvedEmail = `resolved-${randomUUID()}@example.com`;

    const secondContext = await browser.newContext({
      baseURL: getBaseUrl(),
      storageState: buildStorageState(getSessionCookie(), getBaseUrl()),
    });
    const secondPage = await secondContext.newPage();

    try {
      await page.goto(`/sales/customers/${customerId}`);
      await secondPage.goto(`/sales/customers/${customerId}`);

      const firstEmail = secondPage.getByLabel("Email");
      await expect(firstEmail).toHaveValue("before@example.com");
      await firstEmail.fill(firstWriterEmail);
      await firstEmail.blur();
      await expect(secondPage.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      const staleEmail = page.getByLabel("Email");
      await expect(staleEmail).toHaveValue("before@example.com");
      await staleEmail.fill(staleWriterEmail);
      await staleEmail.blur();
      await expect(
        page.getByText(
          "This record was changed elsewhere. Saving again will overwrite those changes.",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 15_000 });

      const [afterConflict] = await db
        .select({ email: customers.email, version: customers.version })
        .from(customers)
        .where(eq(customers.id, customerId));
      expect(afterConflict.email).toBe(firstWriterEmail);
      expect(afterConflict.version).toBe(baseVersion + 1);

      await staleEmail.fill(resolvedEmail);
      await staleEmail.blur();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await page.reload();
      await expect(page.getByLabel("Email")).toHaveValue(resolvedEmail);

      const [afterRecovery] = await db
        .select({ email: customers.email, version: customers.version })
        .from(customers)
        .where(eq(customers.id, customerId));
      expect(afterRecovery.email).toBe(resolvedEmail);
      expect(afterRecovery.version).toBe(baseVersion + 2);
    } finally {
      await secondContext.close();
    }
  });

  test("customer create replays under the same idempotency key", async ({
    db,
  }) => {
    const email = `create-replay-${randomUUID()}@example.com`;
    const payload = {
      name: `Fast Customer Create Replay ${Date.now()}`,
      customerCategoryId: null,
      email,
      phone: null,
      billingLine1: null,
      billingLine2: null,
      billingCity: null,
      billingRegion: null,
      billingPostcode: null,
      billingCountry: null,
      shipLine1: null,
      shipLine2: null,
      shipCity: null,
      shipRegion: null,
      shipPostcode: null,
      shipCountry: null,
      contacts: [],
    };
    const postCreate = () =>
      testFetch("/api/customers", {
        method: "POST",
        headers: {
          "Idempotency-Key": `fast-customer-create-replay:${email}`,
        },
        body: JSON.stringify(payload),
      });

    const first = await postCreate();
    const firstBody = await first.json();
    expect(first.status, JSON.stringify(firstBody)).toBe(201);

    const replay = await postCreate();
    const replayBody = await replay.json();
    expect(replay.status, JSON.stringify(replayBody)).toBe(201);
    expect(replayBody.id).toBe(firstBody.id);

    const rows = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, email));
    expect(rows).toHaveLength(1);
  });

  test("customer stale save returns the shared conflict envelope with the fresh customer", async ({
    db,
  }) => {
    const customer = await createCustomer({
      name: `Fast Customer Conflict ${Date.now()}`,
      email: "before@example.com",
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const customerId = customer.body.id as string;

    const detailResponse = await testFetch(`/api/customers/${customerId}`);
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    const basePayload = {
      name: detail.name,
      customerCategoryId: detail.customerCategoryId,
      accountState: detail.accountState,
      accountPriority: detail.accountPriority,
      email: detail.email,
      phone: detail.phone,
      billingLine1: detail.billingLine1,
      billingLine2: detail.billingLine2,
      billingCity: detail.billingCity,
      billingRegion: detail.billingRegion,
      billingPostcode: detail.billingPostcode,
      billingCountry: detail.billingCountry,
      shipLine1: detail.shipLine1,
      shipLine2: detail.shipLine2,
      shipCity: detail.shipCity,
      shipRegion: detail.shipRegion,
      shipPostcode: detail.shipPostcode,
      shipCountry: detail.shipCountry,
      contacts: [],
      expectedVersion: detail.version,
    };

    const first = await testFetch(`/api/customers/${customerId}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, email: "first-customer@example.com" }),
    });
    expect(first.status, await first.text()).toBe(200);

    const stale = await testFetch(`/api/customers/${customerId}`, {
      method: "PUT",
      body: JSON.stringify({ ...basePayload, email: "stale-customer@example.com" }),
    });
    const staleBody = await stale.json();
    expect(stale.status, JSON.stringify(staleBody)).toBe(409);
    expect(staleBody.conflict).toBe(true);
    expect(staleBody.current.email).toBe("first-customer@example.com");
    expect(staleBody.current.version).toBe(detail.version + 1);
    expect(staleBody.customer).toBeUndefined();
    expect(staleBody.kind).toBeUndefined();

    const [row] = await db
      .select({ email: customers.email, version: customers.version })
      .from(customers)
      .where(eq(customers.id, customerId));
    expect(row.email).toBe("first-customer@example.com");
    expect(row.version).toBe(detail.version + 1);
  });

  test("sales order duplicate replays under the same idempotency key", async ({
    db,
  }) => {
    const productId = await createStockedProduct("DuplicateNumber", "10");
    const customer = await createCustomer({
      name: `Fast Duplicate Number Customer ${ts}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderNumber: `SO-1182_${ts}`,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status).toBe(201);

    const duplicateKey = `duplicate-number-${ts}`;
    const duplicate = await testFetch(`/api/sales-orders/${order.body.id}/duplicate`, {
      method: "POST",
      headers: { "Idempotency-Key": duplicateKey },
    });
    expect(duplicate.status).toBe(201);

    const duplicatedOrder = (await duplicate.json()) as { id: string };
    const replay = await testFetch(`/api/sales-orders/${order.body.id}/duplicate`, {
      method: "POST",
      headers: { "Idempotency-Key": duplicateKey },
    });
    const duplicateReplay = (await replay.json()) as { id: string };
    expect(replay.status, JSON.stringify(duplicateReplay)).toBe(201);
    expect(duplicateReplay.id).toBe(duplicatedOrder.id);

    const [row] = await db
      .select({ orderNumber: salesOrders.orderNumber })
      .from(salesOrders)
      .where(eq(salesOrders.id, duplicatedOrder.id));

    expect(row.orderNumber).toBe(
      `SO-1182_${ts}`.slice(0, 32 - "_COPY".length) + "_COPY"
    );

    const copiedRows = await db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(eq(salesOrders.orderNumber, row.orderNumber));
    expect(copiedRows).toHaveLength(1);
  });

  test("sales order duplicate action flushes dirty autosave before cloning", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`DupUI${unique}`, "10");
    const customer = await createCustomer({
      name: `Fast Duplicate UI Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const notes = `dirty sales duplicate notes ${unique}`;

    await page.goto(`/sales/order/${orderId}`);
    const notesInput = page.getByPlaceholder("Add notes for the warehouse or customer.");
    await expect(notesInput).toBeVisible();
    await notesInput.fill(notes);

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await page.waitForURL((url) => {
      return (
        url.pathname.startsWith("/sales/order/") &&
        url.pathname !== `/sales/order/${orderId}`
      );
    });
    const duplicatedId = page.url().split("/").pop();
    expect(duplicatedId).toBeTruthy();
    expect(duplicatedId).not.toBe(orderId);

    const rows = await db
      .select({
        id: salesOrders.id,
        notes: salesOrders.notes,
        customerId: salesOrders.customerId,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.customerId, customer.body.id),
          eq(salesOrders.notes, notes),
        ),
      );
    expect(rows.map((row) => row.id).sort()).toEqual(
      [orderId, duplicatedId as string].sort(),
    );

    const lines = await db
      .select({
        salesOrderId: salesOrderLines.salesOrderId,
        itemId: salesOrderLines.itemId,
        quantity: salesOrderLines.quantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.itemId, productId));
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          salesOrderId: orderId,
          quantity: "2.0000",
        }),
        expect.objectContaining({
          salesOrderId: duplicatedId,
          quantity: "2.0000",
        }),
      ]),
    );
  });

  test("sales order status transition blocks when autosave is invalid", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`StatusBlock${unique}`, "10");
    const customer = await createCustomer({
      name: `Fast Status Block Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const orderId = order.body.id as string;
    const invalidOrderNumber = `SO-${"X".repeat(40)}-${unique}`;
    let shipCalls = 0;

    await page.route(`**/api/sales-orders/${orderId}/ship`, async (route) => {
      shipCalls += 1;
      await route.fulfill({
        status: 418,
        contentType: "application/json",
        body: JSON.stringify({ error: "ship should be blocked" }),
      });
    });

    await page.goto(`/sales/order/${orderId}`);
    await page
      .locator('input[value^="SO-"]')
      .first()
      .fill(invalidOrderNumber);

    await page.getByLabel("Change status: Not shipped").click();
    await page.getByRole("menuitem", { name: "Shipped", exact: true }).click();

    await expect(page.getByRole("alert")).toHaveText(
      "Order number must be 32 characters or fewer",
    );
    await expect(page.getByLabel("Change status: Not shipped")).toBeVisible();
    expect(shipCalls).toBe(0);

    const [saved] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, orderId));
    expect(saved.status).toBe("open");
  });

  test("sales order create-MO action stays reachable on an invalid dirty draft", async ({
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`MakeReach${unique}`, "0");
    const customer = await createCustomer({
      name: `Fast Make Reachable Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const invalidOrderNumber = `SO-${"X".repeat(40)}-${unique}`;

    await page.goto(`/sales/order/${order.body.id}`);
    await page
      .locator('input[value^="SO-"]')
      .first()
      .fill(invalidOrderNumber);

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Create manufacturing order(s)" }).click();

    await expect(
      page.getByRole("dialog", { name: "Create Manufacturing Orders" }),
    ).toBeVisible();
  });

  test("sales order create-MO action stops when autosave fails", async ({
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`MakeFail${unique}`, "0");
    const customer = await createCustomer({
      name: `Fast Make Failed Save Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    let saveCalls = 0;

    await page.route(`**/api/sales-orders/${order.body.id}`, async (route) => {
      if (
        route.request().method() === "PUT" ||
        route.request().method() === "PATCH"
      ) {
        saveCalls += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "forced autosave failure" }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`/sales/order/${order.body.id}`);
    const failedSave = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/sales-orders/${order.body.id}`) &&
        response.status() === 503,
    );
    await page
      .locator('input[value^="SO-"]')
      .first()
      .fill(`SO-AUTOSAVE-FAIL-${unique}`);

    await failedSave;
    await expect.poll(() => saveCalls, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Create manufacturing order(s)" }).click();

    await expect(
      page.getByRole("dialog", { name: "Create Manufacturing Orders" }),
    ).toBeHidden();
  });

  test("sales order line production action is reachable on the card", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`LineMake${unique}`, "0");
    const customer = await createCustomer({
      name: `Fast Line Make Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    let releaseSave!: () => void;
    const saveCanFinish = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let saveCalls = 0;

    await page.route(`**/api/sales-orders/${order.body.id}`, async (route) => {
      if (
        route.request().method() === "PUT" ||
        route.request().method() === "PATCH"
      ) {
        saveCalls += 1;
        await saveCanFinish;
      }
      await route.continue();
    });
    await page.goto(`/sales/order/${order.body.id}`);
    await editGridCell(page, "quantity", "5");
    await expect.poll(() => saveCalls, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.getByLabel("Production: Make").first().click();
    await page.getByRole("menuitem", { name: "Make to order" }).click();

    const dialog = page.getByRole("dialog", { name: "Create Manufacturing Order" });
    await expect(dialog).toBeHidden();
    releaseSave();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("cell", { name: "5", exact: true })).toBeVisible({
      timeout: 15_000,
    });

    const [line] = await db
      .select({ quantity: salesOrderLines.quantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(line.quantity).toBe("5.0000");
  });

  test("sales order line production dialog scopes open MOs to the selected line", async ({
    db,
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const component = await createItem({
      itemType: "material",
      name: `Fast Line Scope Component ${unique}`,
      unitDefinitionId: unitId,
      sku: `FAST-LINE-SCOPE-COMP-${unique}-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status, JSON.stringify(component.body)).toBe(201);
    const selectedProduct = await createItem({
      itemType: "product",
      name: `Fast Line Scope Selected Product ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-LINE-SCOPE-SELECTED-${unique}-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(selectedProduct.status, JSON.stringify(selectedProduct.body)).toBe(201);
    const otherProduct = await createItem({
      itemType: "product",
      name: `Fast Line Scope Other Product ${unique}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-LINE-SCOPE-OTHER-${unique}-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(otherProduct.status, JSON.stringify(otherProduct.body)).toBe(201);
    const customer = await createCustomer({
      name: `Fast Line Scope Customer ${unique}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [
        { itemId: selectedProduct.body.id, quantity: "2", unitPrice: "12.00" },
        { itemId: otherProduct.body.id, quantity: "3", unitPrice: "12.00" },
      ],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const lines = await db
      .select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    const otherLine = lines.find((line) => line.itemId === otherProduct.body.id);
    expect(otherLine).toBeTruthy();
    const otherLineMo = await createManufacturingOrder({
      productId: otherProduct.body.id,
      salesOrderId: order.body.id,
      salesOrderLineId: otherLine!.id,
      plannedQuantity: "3",
      plannedDate: "2026-05-01",
      ingredients: [{ itemId: component.body.id, quantityPerUnit: "1" }],
      confirmShortage: false,
    });
    expect(otherLineMo.status, JSON.stringify(otherLineMo.body)).toBe(201);

    await page.goto(`/sales/order/${order.body.id}`);
    await page.getByLabel("Production: Make").first().click();
    await page.getByRole("menuitem", { name: "Make to order" }).click();

    const dialog = page.getByRole("dialog", { name: "Create Manufacturing Order" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("No open manufacturing orders.")).toBeVisible();
    await expect(dialog.getByText(otherLineMo.body.orderNumber)).toBeHidden();
  });

  test("sales order line production action blocks when autosave is invalid", async ({
    page,
  }) => {
    const unique = randomUUID().slice(0, 8);
    const productId = await createStockedProduct(`LMB${unique}`, "0");
    const customer = await createCustomer({
      name: `Fast Line Make Block Customer ${unique}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-01",
      shipDate: "2026-05-02",
      lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const invalidOrderNumber = `SO-${"X".repeat(40)}-${unique}`;

    await page.goto(`/sales/order/${order.body.id}`);
    await page
      .locator('input[value^="SO-"]')
      .first()
      .fill(invalidOrderNumber);
    await page.getByLabel("Production: Make").first().click();
    await page.getByRole("menuitem", { name: "Make to order" }).click();

    await expect(
      page.getByRole("alert").filter({
        hasText: "Order number must be 32 characters or fewer",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Create Manufacturing Order" }),
    ).toBeHidden();
  });

  test("sales order accounting push blocks when autosave is invalid", async ({
    db,
    page,
  }) => {
    await withOnlyQuickBooksConnection(db, async () => {
      const unique = randomUUID().slice(0, 8);
      const productId = await createStockedProduct(`AcctBlk${unique}`, "10");
      const customer = await createCustomer({
        name: `Fast Accounting Blocked Customer ${unique}`,
      });
      expect(customer.status).toBe(201);

      const order = await createSalesOrder({
        customerId: customer.body.id,
        orderDate: "2026-05-01",
        shipDate: "2026-05-02",
        lines: [{ itemId: productId, quantity: "2", unitPrice: "12.00" }],
      });
      expect(order.status, JSON.stringify(order.body)).toBe(201);
      const invalidOrderNumber = `SO-${"X".repeat(40)}-${unique}`;
      let pushCalls = 0;

      await page.route(
        `**/api/sales-orders/${order.body.id}/accounting-push`,
        async (route) => {
          pushCalls += 1;
          await route.fulfill({
            status: 418,
            contentType: "application/json",
            body: JSON.stringify({ error: "accounting push should be blocked" }),
          });
        },
      );

      await page.goto(`/sales/order/${order.body.id}`);
      await page
        .locator('input[value^="SO-"]')
        .first()
        .fill(invalidOrderNumber);

      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Send invoice to QuickBooks" }).click();

      await expect(
        page.getByRole("alert").filter({
          hasText: "Order number must be 32 characters or fewer",
        }),
      ).toHaveText("Order number must be 32 characters or fewer");
      expect(pushCalls).toBe(0);
    });
  });

  test("Shopify paid-order import creates sales demand and records external order", async ({
    db,
  }) => {
    const productId = await createStockedProduct("ShopifyImport", "10");
    const shopifyCase = await createUnit({
      name: `Fast Shopify case ${ts}`,
      size: "3",
      uom: "ea",
    });
    expect(shopifyCase.status, JSON.stringify(shopifyCase.body)).toBe(201);
    const configured = await updateItem(productId, {
      salesUnitDefinitionId: shopifyCase.body.id,
      salesToStockFactor: "3",
    });
    expect(configured.status, JSON.stringify(configured.body)).toBe(200);
    const customer = await createCustomer({
      name: `Fast Shopify Customer ${ts}`,
      email: `fast-shopify-${ts}@example.com`,
    });
    expect(customer.status).toBe(201);

    await db
      .insert(integrationConnections)
      .values({
        organizationId: getOrgId(),
        provider: "shopify",
        tenantId: `fast-shop-${ts}.myshopify.com`,
        tenantName: `Fast Shop ${ts}`,
        accessTokenCiphertext: "shopify-fast-token",
        refreshTokenCiphertext: "",
        tokenEncryptionKeyId: "plain",
        tokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
        settings: { shopDomain: `fast-shop-${ts}.myshopify.com` },
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.organizationId,
          integrationConnections.provider,
        ],
        set: {
          tenantId: `fast-shop-${ts}.myshopify.com`,
          tenantName: `Fast Shop ${ts}`,
          accessTokenCiphertext: "shopify-fast-token",
          refreshTokenCiphertext: "",
          tokenEncryptionKeyId: "plain",
          tokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
          settings: { shopDomain: `fast-shop-${ts}.myshopify.com` },
          updatedAt: new Date(),
        },
      });

    const shopifyOrderId = `fast-${ts}`;
    const tinyShopifyOrderId = `fast-tiny-${ts}`;
    const preciseShopifyOrderId = `fast-precise-${ts}`;
    const server = await startShopifyServer({
      orders: [
        {
          id: shopifyOrderId,
          name: `#${ts}`,
          created_at: "2026-05-20T18:30:00Z",
          financial_status: "paid",
          fulfillment_status: null,
          email: `fast-shopify-${ts}@example.com`,
          customer: { id: `customer-${ts}` },
          shipping_address: { address1: "10 Market St" },
          line_items: [
            {
              id: `line-${ts}`,
              sku: `FAST-SALES-ShopifyImport-${ts}`,
              quantity: 2,
              fulfillable_quantity: 2,
              price: "12.00",
            },
          ],
        },
        {
          id: tinyShopifyOrderId,
          name: `#TINY-${ts}`,
          created_at: "2026-05-20T18:31:00Z",
          financial_status: "paid",
          fulfillment_status: null,
          email: `fast-shopify-${ts}@example.com`,
          customer: { id: `customer-${ts}` },
          line_items: [
            {
              id: `line-tiny-${ts}`,
              sku: `FAST-SALES-ShopifyImport-${ts}`,
              quantity: 0.00001,
              fulfillable_quantity: 0.00001,
              price: "12.00",
            },
          ],
        },
        {
          id: preciseShopifyOrderId,
          name: `#PRECISE-${ts}`,
          created_at: "2026-05-20T18:32:00Z",
          financial_status: "paid",
          fulfillment_status: null,
          email: `fast-shopify-${ts}@example.com`,
          customer: { id: `customer-${ts}` },
          line_items: [
            {
              id: `line-precise-${ts}`,
              sku: `FAST-SALES-ShopifyImport-${ts}`,
              quantity: 1.23456,
              fulfillable_quantity: 1.23456,
              price: "12.00",
            },
          ],
        },
      ],
    });

    try {
      const response = await testFetch("/api/shopify/import/orders", {
        method: "POST",
        body: JSON.stringify({ shopBaseUrl: server.baseUrl }),
      });
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ created: 1, skipped: 0 });
      expect(body.errors).toEqual([
        expect.stringContaining("Quantity must be at least 0.0001"),
        expect.stringContaining("Quantity supports up to 4 decimal places"),
      ]);

      const [order] = await db
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(eq(salesOrders.orderNumber, `SHOP-${ts}`));
      expect(order).toBeTruthy();

      const [line] = await db
        .select({
          id: salesOrderLines.id,
          quantity: salesOrderLines.quantity,
          stockQuantity: salesOrderLines.stockQuantity,
          factor: salesOrderLines.salesToStockFactor,
          unitName: salesOrderLines.unitName,
          unitPrice: salesOrderLines.unitPrice,
          lineSubtotal: salesOrderLines.lineSubtotal,
          lineTotal: salesOrderLines.lineTotal,
        })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.salesOrderId, order.id));
      expect(line.quantity).toBe("2.0000");
      expect(line.stockQuantity).toBe("6.0000");
      expect(line.factor).toBe("3.0000");
      expect(line.unitName).toBe(shopifyCase.body.name);
      expect(line.unitPrice).toBe("12.00");
      expect(line.lineSubtotal).toBe("24.00");
      expect(line.lineTotal).toBe("24.00");

      const [demand] = await db
        .select({ quantity: inventoryDemandSummary.quantity })
        .from(inventoryDemandSummary)
        .where(
          and(
            eq(inventoryDemandSummary.itemId, productId),
            eq(inventoryDemandSummary.referenceType, "sales_order_line"),
            eq(inventoryDemandSummary.referenceId, line.id)
          )
        );
      expect(demand.quantity).toBe("6.0000");

      const [external] = await db
        .select({ localRecordId: integrationExternalRecords.localRecordId })
        .from(integrationExternalRecords)
        .where(
          and(
            eq(integrationExternalRecords.provider, "shopify"),
            eq(integrationExternalRecords.entityType, "sales_order"),
            eq(integrationExternalRecords.externalId, shopifyOrderId)
          )
        );
      expect(external.localRecordId).toBe(order.id);

      const rejectedExternalRows = await db
        .select({ externalId: integrationExternalRecords.externalId })
        .from(integrationExternalRecords)
        .where(
          and(
            eq(integrationExternalRecords.provider, "shopify"),
            eq(integrationExternalRecords.entityType, "sales_order"),
            inArray(integrationExternalRecords.externalId, [
              tinyShopifyOrderId,
              preciseShopifyOrderId,
            ]),
          ),
        );
      expect(rejectedExternalRows).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  test("shipping consumes stock once and closes the order", async ({ db }) => {
    const productId = await createStockedProduct("Ship", "5");

    const customer = await createCustomer({ name: `Fast Ship Customer ${ts}` });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "5", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const shipKey = `ship-once-${ts}`;
    const ship = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: { "Idempotency-Key": shipKey },
      body: JSON.stringify({}),
    });
    expect(ship.status).toBe(200);
    const replay = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: { "Idempotency-Key": shipKey },
      body: JSON.stringify({}),
    });
    expect(replay.status, await replay.text()).toBe(200);

    const events = await db
      .select({ quantity: inventoryEvents.quantity })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, productId),
          eq(inventoryEvents.eventType, "sales_consumption")
        )
      );
    expect(events).toHaveLength(1);
    expect(events[0].quantity).toBe("5.0000");

    const [lineState] = await db
      .select({
        shippedQuantity: salesOrderLines.shippedQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(lineState.shippedQuantity).toBe("5.0000");

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "0.0000",
      demandQty: "0.0000",
    });

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(savedOrder.status).toBe("done");
  });

  test("partial shipping updates shipped quantity and leaves remaining demand", async ({
    db,
  }) => {
    const productId = await createStockedProduct("PartialShip", "8");

    const customer = await createCustomer({ name: `Fast Partial Ship Customer ${ts}` });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "8", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    const ship = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: Object.fromEntries(createIdempotencyHeaders("shipSalesOrder").entries()),
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(savedOrder.status).toBe("open");

    const [lineState] = await db
      .select({
        shippedQuantity: salesOrderLines.shippedQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    expect(lineState.shippedQuantity).toBe("3.0000");

    const [balance] = await db
      .select({
        onHandQty: inventoryItemBalances.onHandQty,
        demandQty: inventoryItemBalances.demandQty,
      })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance).toMatchObject({
      onHandQty: "5.0000",
      demandQty: "5.0000",
    });
  });

  test("BOL selected quantities render for an open order without changing the order", async ({
    db,
  }) => {
    const productId = await createStockedProduct("Bol", "10");
    const secondProductId = await createStockedProduct("BolSecond", "10");

    const customer = await createCustomer({ name: `Fast BOL Customer ${ts}` });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      notes: "Load from the north bay.",
      lines: [
        { itemId: productId, quantity: "10", unitPrice: "15.00" },
        { itemId: secondProductId, quantity: "5", unitPrice: "9.00" },
      ],
    });
    expect(order.status).toBe(201);

    const [line, secondLine] = await db
      .select({
        id: salesOrderLines.id,
        quantity: salesOrderLines.quantity,
        shippedQuantity: salesOrderLines.shippedQuantity,
        cancelledQuantity: salesOrderLines.cancelledQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id))
      .orderBy(asc(salesOrderLines.sortOrder));
    expect(line).toBeTruthy();
    expect(secondLine).toBeTruthy();

    const selectedResponse = await testFetch(
      `/api/sales-orders/${order.body.id}/bol?line=${line.id}:6`
    );
    expect(selectedResponse.status, await selectedResponse.text()).toBe(200);
    expect(selectedResponse.headers.get("content-type")).toContain("application/pdf");
    const selectedPdf = await selectedResponse.text();

    const explicitBothResponse = await testFetch(
      `/api/sales-orders/${order.body.id}/bol?line=${line.id}:6&line=${secondLine.id}:5`
    );
    expect(explicitBothResponse.status, await explicitBothResponse.text()).toBe(200);
    const explicitBothPdf = await explicitBothResponse.text();
    expect(selectedPdf).not.toEqual(explicitBothPdf);

    const fallbackResponse = await testFetch(`/api/sales-orders/${order.body.id}/bol`);
    expect(fallbackResponse.status, await fallbackResponse.text()).toBe(200);
    expect(fallbackResponse.headers.get("content-type")).toContain("application/pdf");
    const fallbackPdf = await fallbackResponse.text();
    expect(selectedPdf).not.toEqual(fallbackPdf);

    const overRemaining = await testFetch(
      `/api/sales-orders/${order.body.id}/bol?line=${line.id}:11`
    );
    expect(overRemaining.status).toBe(400);
    expect(await overRemaining.json()).toMatchObject({
      error: "BOL quantity cannot exceed remaining quantity.",
    });

    const [after] = await db
      .select({
        quantity: salesOrderLines.quantity,
        shippedQuantity: salesOrderLines.shippedQuantity,
        cancelledQuantity: salesOrderLines.cancelledQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    expect(after).toEqual({
      quantity: line.quantity,
      shippedQuantity: line.shippedQuantity,
      cancelledQuantity: line.cancelledQuantity,
    });
  });

  test("cancel remaining closes a partially shipped order and releases demand", async ({
    db,
  }) => {
    const productId = await createStockedProduct("ShortClose", "8");

    const customer = await createCustomer({
      name: `Fast Short Close Customer ${ts}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "8", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));

    const ship = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: Object.fromEntries(createIdempotencyHeaders("shipSalesOrder").entries()),
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    const close = await testFetch(
      `/api/sales-orders/${order.body.id}/cancel-remaining`,
      {
        method: "POST",
        headers: Object.fromEntries(
          createIdempotencyHeaders("cancelRemainingSalesOrder").entries()
        ),
        body: JSON.stringify({}),
      }
    );
    expect(close.status, await close.text()).toBe(200);

    const [savedOrder] = await db
      .select({
        status: salesOrders.status,
        priorityRank: salesOrders.priorityRank,
        shippedAt: salesOrders.shippedAt,
      })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(savedOrder.status).toBe("done");
    expect(savedOrder.priorityRank).toBeNull();
    expect(savedOrder.shippedAt).toBeNull();

    const [lineState] = await db
      .select({
        shippedQuantity: salesOrderLines.shippedQuantity,
        cancelledQuantity: salesOrderLines.cancelledQuantity,
      })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    expect(lineState).toMatchObject({
      shippedQuantity: "3.0000",
      cancelledQuantity: "5.0000",
    });

    const [balance] = await db
      .select({ demandQty: inventoryItemBalances.demandQty })
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, productId));
    expect(balance.demandQty).toBe("0.0000");

    const oversizedDoneBol = await testFetch(
      `/api/sales-orders/${order.body.id}/bol?line=${line.id}:999999`
    );
    expect(oversizedDoneBol.status).toBe(400);
    expect(await oversizedDoneBol.json()).toMatchObject({
      error: "BOL quantity cannot exceed shipped quantity.",
    });

    const accountingPush = await testFetch(
      `/api/sales-orders/${order.body.id}/accounting-push`,
      {
        method: "POST",
        headers: Object.fromEntries(
          createIdempotencyHeaders("retryXeroPushForSalesOrder").entries()
        ),
        body: JSON.stringify({}),
      }
    );
    expect(accountingPush.status).toBe(409);
    expect(await accountingPush.json()).toMatchObject({
      error:
        "This order has cancelled remaining items. Review the shipped quantities before sending an accounting invoice.",
    });

    const legacyXeroPush = await testFetch(
      `/api/sales-orders/${order.body.id}/xero-push`,
      {
        method: "POST",
        headers: Object.fromEntries(
          createIdempotencyHeaders("retryXeroPushForSalesOrderLegacy").entries()
        ),
        body: JSON.stringify({}),
      }
    );
    expect(legacyXeroPush.status).toBe(409);
    expect(await legacyXeroPush.json()).toMatchObject({
      error:
        "This order has cancelled remaining items. Review the shipped quantities before sending an accounting invoice.",
    });

  });

  test("cancel remaining rejects orders already pushed to accounting", async ({
    db,
  }) => {
    const productId = await createStockedProduct("ShortClosePushed", "8");
    const customer = await createCustomer({
      name: `Fast Short Close Pushed Customer ${ts}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "8", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    const ship = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: Object.fromEntries(createIdempotencyHeaders("shipSalesOrder").entries()),
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    await db.insert(accountingDocumentSyncs).values({
      organizationId: getOrgId(),
      provider: ACCOUNTING_PROVIDER_QUICKBOOKS,
      documentType: ACCOUNTING_DOCUMENT_SALES_ORDER,
      documentId: order.body.id,
      externalDocumentId: `qb-invoice-${ts}`,
      pushStatus: "pushed",
      pushedAt: new Date(),
    });

    const close = await testFetch(
      `/api/sales-orders/${order.body.id}/cancel-remaining`,
      {
        method: "POST",
        headers: Object.fromEntries(
          createIdempotencyHeaders("cancelRemainingPushedSalesOrder").entries()
        ),
        body: JSON.stringify({}),
      }
    );
    expect(close.status).toBe(409);
    expect(await close.json()).toMatchObject({
      error:
        "This order has already been pushed to accounting. Accounting history must be preserved.",
    });

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    const [lineState] = await db
      .select({ cancelledQuantity: salesOrderLines.cancelledQuantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    expect(savedOrder.status).toBe("open");
    expect(lineState.cancelledQuantity).toBe("0.0000");
  });

  test("cancel remaining rejects orders with linked open manufacturing orders", async ({
    db,
  }) => {
    const component = await createItem({
      itemType: "material",
      name: `Fast Sales ShortCloseMto Component ${ts}`,
      unitDefinitionId: unitId,
      sku: `FAST-SALES-SHORT-CLOSE-MTO-COMP-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: "2.00",
      defaultSellingPrice: null,
      stock: "100",
      safetyStock: "0",
      bom: [],
    });
    expect(component.status, JSON.stringify(component.body)).toBe(201);
    const product = await createItem({
      itemType: "product",
      name: `Fast Sales ShortCloseMto Product ${ts}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-SALES-SHORT-CLOSE-MTO-${ts}`,
      category: `Fast Sales ${ts}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "12.00",
      stock: "8",
      safetyStock: "0",
      bom: [{ componentId: component.body.id, quantity: "1" }],
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);
    const productId = product.body.id as string;
    const customer = await createCustomer({
      name: `Fast Short Close MTO Customer ${ts}`,
    });
    expect(customer.status).toBe(201);
    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-03",
      shipDate: "2026-05-04",
      lines: [{ itemId: productId, quantity: "8", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    const ship = await testFetch(`/api/sales-orders/${order.body.id}/ship`, {
      method: "POST",
      headers: Object.fromEntries(createIdempotencyHeaders("shipLinkedMtoSalesOrder").entries()),
      body: JSON.stringify({
        syncAccounting: false,
        lines: [{ salesOrderLineId: line.id, quantity: "3" }],
      }),
    });
    expect(ship.status).toBe(200);

    const manufacturingOrder = await createManufacturingOrder({
      productId,
      salesOrderId: order.body.id,
      salesOrderLineId: line.id,
      plannedQuantity: "8",
      plannedDate: "2026-05-03",
      ingredients: [
        {
          itemId: component.body.id,
          defaultItemId: component.body.id,
          quantityPerUnit: "1",
        },
      ],
      confirmShortage: false,
    });
    expect(manufacturingOrder.status, JSON.stringify(manufacturingOrder.body)).toBe(
      201
    );

    const close = await testFetch(
      `/api/sales-orders/${order.body.id}/cancel-remaining`,
      {
        method: "POST",
        headers: Object.fromEntries(
          createIdempotencyHeaders("cancelRemainingLinkedMtoSalesOrder").entries()
        ),
        body: JSON.stringify({}),
      }
    );
    expect(close.status).toBe(400);
    expect(await close.json()).toMatchObject({
      error:
        "Cancel the linked manufacturing order before closing remaining sales demand.",
    });

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    const [lineState] = await db
      .select({ cancelledQuantity: salesOrderLines.cancelledQuantity })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.id, line.id));
    const [linkedOrder] = await db
      .select({ status: manufacturingOrders.status })
      .from(manufacturingOrders)
      .where(eq(manufacturingOrders.id, manufacturingOrder.body.id));
    expect(savedOrder.status).toBe("open");
    expect(lineState.cancelledQuantity).toBe("0.0000");
    expect(linkedOrder.status).toBe("open");
  });

  test("shipping warns before taking demand-queue stock from another order", async ({
    db,
  }) => {
    const productId = await createStockedProduct("QueueShip", "50");
    const customer = await createCustomer({ name: `Fast Queue Ship Customer ${ts}` });
    expect(customer.status).toBe(201);

    const reservedOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-05",
      shipDate: "2026-05-10",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(reservedOrder.status).toBe(201);
    const shippingOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-05",
      shipDate: "2026-05-06",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(shippingOrder.status).toBe(201);

    const [reservedLine] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, reservedOrder.body.id));
    const [demand] = await db
      .select({ quantity: inventoryDemandSummary.quantity })
      .from(inventoryDemandSummary)
      .where(eq(inventoryDemandSummary.referenceId, reservedLine.id));
    expect(demand.quantity).toBe("50.0000");

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      fulfillmentSummary?: { salesItemsState?: string };
    }>;
    expect(
      salesOrderRows.find((row) => row.id === reservedOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("available");
    expect(
      salesOrderRows.find((row) => row.id === shippingOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("not_available");

    const shippingShip = await fulfillSalesOrder(shippingOrder.body.id);
    expect(shippingShip.status).toBe(409);
    expect(shippingShip.body.negativeStock).toMatchObject({
      itemId: productId,
      reason: "queue_conflict",
      claimedByHigherPriority: 50,
    });
    expect(shippingShip.body.negativeStock.conflicts[0]).toMatchObject({
      referenceType: "sales_order",
      referenceId: reservedOrder.body.id,
      quantity: 50,
    });

    const reservedShip = await fulfillSalesOrder(reservedOrder.body.id);
    expect(reservedShip.status, JSON.stringify(reservedShip.body)).toBe(200);
  });

  test("shipping a managed line can use demand-queue available stock", async ({
    db,
  }) => {
    const productId = await createStockedProduct("ManagedQueueShip", "20");
    const customer = await createCustomer({
      name: `Fast Managed Queue Ship Customer ${ts}`,
    });
    expect(customer.status).toBe(201);

    const order = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-07",
      shipDate: "2026-05-08",
      lines: [{ itemId: productId, quantity: "20", unitPrice: "15.00" }],
    });
    expect(order.status).toBe(201);

    const [line] = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, order.body.id));
    await db
      .update(salesOrderLines)
      .set({ allocationManagedAt: new Date() })
      .where(eq(salesOrderLines.id, line.id));

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      fulfillmentSummary?: { salesItemsState?: string };
    }>;
    expect(
      salesOrderRows.find((row) => row.id === order.body.id)?.fulfillmentSummary
        ?.salesItemsState
    ).toBe("available");

    const ship = await fulfillSalesOrder(order.body.id);
    expect(ship.status).toBe(200);

    const [savedOrder] = await db
      .select({ status: salesOrders.status })
      .from(salesOrders)
      .where(eq(salesOrders.id, order.body.id));
    expect(savedOrder.status).toBe("done");
  });

  test("shipping a lower-priority order warns before taking demand-queue stock", async () => {
    const conflictTs = Date.now().toString(36);
    const productId = await createStockedProduct(`QCS${conflictTs}`, "50");
    const customer = await createCustomer({
      name: `Fast Queue Conflict Ship Customer ${conflictTs}`,
    });
    expect(customer.status).toBe(201);

    const higherPriorityOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-07",
      shipDate: "2026-05-08",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(higherPriorityOrder.status, JSON.stringify(higherPriorityOrder.body)).toBe(
      201
    );
    const lowerPriorityOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: "2026-05-07",
      shipDate: "2026-05-10",
      lines: [{ itemId: productId, quantity: "50", unitPrice: "15.00" }],
    });
    expect(lowerPriorityOrder.status, JSON.stringify(lowerPriorityOrder.body)).toBe(
      201
    );

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      fulfillmentSummary?: { salesItemsState?: string };
    }>;
    expect(
      salesOrderRows.find((row) => row.id === higherPriorityOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("available");
    expect(
      salesOrderRows.find((row) => row.id === lowerPriorityOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("not_available");

    const lowerPriorityDetailResponse = await testFetch(
      `/api/sales-orders/${lowerPriorityOrder.body.id}`
    );
    expect(lowerPriorityDetailResponse.status).toBe(200);
    const lowerPriorityDetail = (await lowerPriorityDetailResponse.json()) as {
      fulfillmentSummary?: { salesItemsState?: string };
      lines?: Array<{
        fulfillmentSummary?: { salesItemsState?: string };
        demandQueueShortQty?: string;
      }>;
    };
    expect(lowerPriorityDetail.fulfillmentSummary?.salesItemsState).toBe(
      "not_available"
    );
    expect(lowerPriorityDetail.lines?.[0]?.fulfillmentSummary?.salesItemsState).toBe(
      "not_available"
    );
    expect(lowerPriorityDetail.lines?.[0]?.demandQueueShortQty).toBe("50");

    const ship = await fulfillSalesOrder(lowerPriorityOrder.body.id);
    expect(ship.status).toBe(409);
    expect(ship.body.negativeStock).toMatchObject({
      itemId: productId,
      reason: "queue_conflict",
      claimedByHigherPriority: 50,
    });
    expect(ship.body.negativeStock.conflicts[0]).toMatchObject({
      referenceType: "sales_order",
      referenceId: higherPriorityOrder.body.id,
      quantity: 50,
    });
  });

  test("shipping warns before taking future-eligible stock claimed by manufacturing", async () => {
    const conflictTs = Date.now().toString(36);
    const agedComponent = await createItem({
      itemType: "material",
      name: `Fast Aged Claim Component ${conflictTs}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-AGED-CLAIM-COMP-${conflictTs}`,
      category: `Fast Sales ${conflictTs}`,
      description: null,
      defaultPurchasePrice: "7.00",
      defaultSellingPrice: "15.00",
      stock: "10",
      safetyStock: "0",
      bom: [],
    });
    expect(agedComponent.status, JSON.stringify(agedComponent.body)).toBe(201);

    const finishedProduct = await createItem({
      itemType: "product",
      name: `Fast Aged Claim Finished ${conflictTs}`,
      sellable: true,
      unitDefinitionId: unitId,
      sku: `FAST-AGED-CLAIM-FIN-${conflictTs}`,
      category: `Fast Sales ${conflictTs}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "25.00",
      stock: "0",
      safetyStock: "0",
      bom: [
        {
          componentId: agedComponent.body.id,
          quantity: "1",
          minimumLotAgeDays: 3,
        },
      ],
    });
    expect(finishedProduct.status, JSON.stringify(finishedProduct.body)).toBe(201);

    const manufacturingOrder = await createManufacturingOrder({
      productId: finishedProduct.body.id,
      plannedQuantity: "10",
      plannedDate: isoDaysFromNow(4),
      ingredients: [{ itemId: agedComponent.body.id, quantityPerUnit: "1" }],
      confirmShortage: false,
    });
    expect(
      manufacturingOrder.status,
      JSON.stringify(manufacturingOrder.body)
    ).toBe(201);

    const customer = await createCustomer({
      name: `Fast Aged Claim Customer ${conflictTs}`,
    });
    expect(customer.status).toBe(201);

    const salesOrder = await createSalesOrder({
      customerId: customer.body.id,
      orderDate: isoDaysFromNow(0),
      shipDate: isoDaysFromNow(1),
      lines: [{ itemId: agedComponent.body.id, quantity: "10", unitPrice: "15.00" }],
    });
    expect(salesOrder.status, JSON.stringify(salesOrder.body)).toBe(201);

    const salesOrdersResponse = await testFetch("/api/sales-orders");
    expect(salesOrdersResponse.status).toBe(200);
    const salesOrderRows = (await salesOrdersResponse.json()) as Array<{
      id: string;
      fulfillmentSummary?: { salesItemsState?: string };
    }>;
    expect(
      salesOrderRows.find((row) => row.id === salesOrder.body.id)
        ?.fulfillmentSummary?.salesItemsState
    ).toBe("not_available");

    const ship = await fulfillSalesOrder(salesOrder.body.id);
    expect(ship.status).toBe(409);
    expect(ship.body.negativeStock).toMatchObject({
      itemId: agedComponent.body.id,
      reason: "queue_conflict",
      claimedByHigherPriority: 10,
    });
    expect(ship.body.negativeStock.conflicts[0]).toMatchObject({
      referenceType: "manufacturing_order",
      referenceId: manufacturingOrder.body.id,
      quantity: 10,
    });
  });

  test("QuickBooks invoice sync rejects taxable sales orders before external API", async ({
    db,
  }) => {
    await withOnlyQuickBooksConnection(db, async () => {
      const unique = Date.now().toString(36);
      const productId = await createStockedProduct(`QBTax${unique}`, "10");
      const customer = await createCustomer({
        name: `Fast QuickBooks Tax Customer ${unique}`,
      });
      expect(customer.status).toBe(201);
      const order = await createSalesOrder({
        customerId: customer.body.id,
        orderDate: "2026-05-09",
        shipDate: "2026-05-10",
        lines: [{ itemId: productId, quantity: "2", unitPrice: "15.00" }],
      });
      expect(order.status, JSON.stringify(order.body)).toBe(201);
      await db
        .update(salesOrderLines)
        .set({ taxRatePercent: "5" })
        .where(eq(salesOrderLines.salesOrderId, order.body.id));

      const response = await testFetch(
        `/api/sales-orders/${order.body.id}/accounting-push`,
        { method: "POST" },
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe(
        "QuickBooks tax mapping is not available yet. Remove tax from this order before sending it to QuickBooks.",
      );

      const rows = await db
        .select()
        .from(accountingDocumentSyncs)
        .where(
          and(
            eq(accountingDocumentSyncs.provider, ACCOUNTING_PROVIDER_QUICKBOOKS),
            eq(
              accountingDocumentSyncs.documentType,
              ACCOUNTING_DOCUMENT_SALES_ORDER,
            ),
            eq(accountingDocumentSyncs.documentId, order.body.id),
          ),
        );
      expect(rows).toHaveLength(0);
    });
  });

});

const pricingSeamTs = Date.now();

async function pricingSeamFetch(path: string, options: RequestInit = {}) {
  const res = await testFetch(path, options);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function setPricingSeamEntitlements(
  db: Parameters<Parameters<typeof test>[2]>[0]["db"],
  plugins: string[]
) {
  await db
    .update(organization)
    .set({ entitlements: plugins })
    .where(eq(organization.id, getOrgId()));
}

test.describe("pricing scenario document seam", () => {
  test.describe.configure({ mode: "serial" });

  test("prices unassigned operations at their individual fallback rates", () => {
    const productId = randomUUID();
    const calculation = calculatePricingScenario({
      baseline: {
        leafItems: [],
        resources: [],
        products: [{
          itemId: productId,
          name: "Fallback Labor Product",
          sku: null,
          unitName: null,
          baselineCurrentPrice: "50.00",
        }],
      },
      usageTerms: [{
        productId,
        materialTerms: [],
        laborTerms: [
          { resourceId: null, hoursPerUnit: "1", fallbackRatePerHour: "10" },
          { resourceId: null, hoursPerUnit: "1", fallbackRatePerHour: "20" },
        ],
        issues: [],
      }],
      doc: {
        ...emptyPricingScenarioDoc(),
        productIds: [productId],
      },
    });

    expect(calculation.products[0].labor).toHaveLength(2);
    expect(calculation.products[0].result).toEqual(expect.objectContaining({
      withheld: false,
      sellAt: "30.00",
    }));
  });

  test("outbound freight is a shipment total shared across the tote count", () => {
    const productId = randomUUID();
    const calculation = calculatePricingScenario({
      baseline: {
        leafItems: [],
        resources: [],
        products: [{
          itemId: productId,
          name: "Freight Product",
          sku: null,
          unitName: null,
          baselineCurrentPrice: null,
        }],
      },
      usageTerms: [{
        productId,
        materialTerms: [],
        laborTerms: [{ resourceId: null, hoursPerUnit: "1", fallbackRatePerHour: "100" }],
        issues: [],
      }],
      doc: {
        ...emptyPricingScenarioDoc(),
        productIds: [productId],
        overheadPercent: "25",
        targetProfitPercent: "25",
        products: [{
          itemId: productId,
          currentPrice: null,
          outboundFreightCost: "760",
          outboundFreightTotes: "76",
        }],
      },
    });

    // $760 over 76 totes = $10/tote freight; labor 100 + 10 = 110 cost to recover;
    // share model 110 / (1 - 0.25 - 0.25) = 220.00.
    const product = calculation.products[0];
    expect(product.outboundFreight).toBe("10");
    expect(product.buckets.costToRecover).toBe("110.00");
    expect(product.result).toEqual(expect.objectContaining({
      withheld: false,
      sellAt: "220.00",
    }));
  });

  test("saves are version-guarded and revisions are insert-only frozen snapshots", async ({
    db,
  }) => {
    await setPricingSeamEntitlements(db, ["pricing_scenarios"]);

    const materialName = `Seam Material ${pricingSeamTs}`;
    const material = await createItem({
      itemType: "material",
      name: materialName,
      unitDefinitionId: getUnitId(),
      sku: `SEAM-MAT-${pricingSeamTs}`,
      category: `Seam ${pricingSeamTs}`,
      description: null,
      defaultPurchasePrice: "30.00",
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });
    expect(material.status).toBe(201);
    const productName = `Seam Product ${pricingSeamTs}`;
    const product = await createItem({
      itemType: "product",
      name: productName,
      unitDefinitionId: getUnitId(),
      sku: `SEAM-PROD-${pricingSeamTs}`,
      category: `Seam ${pricingSeamTs}`,
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: "100.00",
      stock: "0",
      safetyStock: "0",
      bom: [{ componentId: material.body.id, quantity: "2" }],
    });
    expect(product.status).toBe(201);
    const productId = product.body.id as string;

    // Create is the first save: client id, version 1.
    const scenarioId = randomUUID();
    const created = await pricingSeamFetch("/api/pricing-scenarios", {
      method: "POST",
      body: JSON.stringify({
        id: scenarioId,
        name: "Seam scenario",
        doc: {
          ...emptyPricingScenarioDoc(),
          productIds: [productId],
          overheadPercent: "20",
          targetProfitPercent: "30",
        },
      }),
    });
    expect(created.status).toBe(201);
    expect(created.body.scenario.version).toBe(1);

    // Version-guarded save bumps; a stale save gets the canonical envelope
    // and mutates nothing.
    const saved = await pricingSeamFetch(`/api/pricing-scenarios/${scenarioId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Seam scenario",
        doc: created.body.scenario.doc,
        expectedVersion: 1,
      }),
    });
    expect(saved.status).toBe(200);
    expect(saved.body.scenario.version).toBe(2);

    const stale = await pricingSeamFetch(`/api/pricing-scenarios/${scenarioId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Stale write",
        doc: created.body.scenario.doc,
        expectedVersion: 1,
      }),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.conflict).toBe(true);
    expect(stale.body.current.scenario.version).toBe(2);
    expect(stale.body.current.scenario.name).toBe("Seam scenario");

    // Commit freezes live baseline + doc. Share model: overhead and target margin are
    // both slices of price, so 2 x 30 = 60 cost, sell at 60 / (1 - 0.2 - 0.3) = 120.00.
    const rev1 = await pricingSeamFetch(`/api/pricing-scenarios/${scenarioId}/revisions`, {
      method: "POST",
      body: JSON.stringify({ note: "baseline" }),
    });
    expect(rev1.status).toBe(201);
    expect(rev1.body.revision.revisionNumber).toBe(1);
    expect(rev1.body.revision.snapshot.products[0].result.sellAt).toBe("120.00");
    expect(rev1.body.revision.snapshot.products[0].currentPriceSource).toBe(
      "baseline"
    );

    const productFamilyId = randomUUID();
    const productOptionId = randomUUID();
    const productValueId = randomUUID();
    const productVariantLabel = "20 litre";
    await db.insert(itemFamilies).values({
      id: productFamilyId,
      organizationId: getOrgId(),
      itemType: "product",
      name: productName,
      unitDefinitionId: getUnitId(),
    });
    await db.insert(variantOptions).values({
      id: productOptionId,
      organizationId: getOrgId(),
      familyId: productFamilyId,
      name: "Size",
      code: `size-${pricingSeamTs}`,
    });
    await db.insert(variantOptionValues).values({
      id: productValueId,
      organizationId: getOrgId(),
      optionId: productOptionId,
      label: productVariantLabel,
      code: `20-litre-${pricingSeamTs}`,
    });
    await db
      .update(items)
      .set({ familyId: productFamilyId })
      .where(eq(items.id, productId));
    await db.insert(itemVariantValues).values({
      organizationId: getOrgId(),
      itemId: productId,
      optionId: productOptionId,
      optionValueId: productValueId,
    });

    const materialFamilyId = randomUUID();
    const materialOptionId = randomUUID();
    const materialValueId = randomUUID();
    const materialVariantLabel = "Fine";
    await db.insert(itemFamilies).values({
      id: materialFamilyId,
      organizationId: getOrgId(),
      itemType: "material",
      name: materialName,
      unitDefinitionId: getUnitId(),
    });
    await db.insert(variantOptions).values({
      id: materialOptionId,
      organizationId: getOrgId(),
      familyId: materialFamilyId,
      name: "Grade",
      code: `grade-${pricingSeamTs}`,
    });
    await db.insert(variantOptionValues).values({
      id: materialValueId,
      organizationId: getOrgId(),
      optionId: materialOptionId,
      label: materialVariantLabel,
      code: `fine-${pricingSeamTs}`,
    });
    await db
      .update(items)
      .set({ familyId: materialFamilyId })
      .where(eq(items.id, material.body.id));
    await db.insert(itemVariantValues).values({
      organizationId: getOrgId(),
      itemId: material.body.id,
      optionId: materialOptionId,
      optionValueId: materialValueId,
    });

    // The scenario list must surface the latest committed revision number. A
    // correlated subquery returns NULL under RLS, so this reads it separately.
    const listAfterCommit = await pricingSeamFetch("/api/pricing-scenarios");
    const listedRow = listAfterCommit.body.scenarios.find(
      (row: { id: string }) => row.id === scenarioId
    );
    expect(listedRow.latestRevisionNumber).toBe(1);

    // ERP drift moves the live baseline but never a committed snapshot.
    const drift = await updateItem(material.body.id as string, {
      defaultPurchasePrice: "45.00",
    });
    expect([200, 201]).toContain(drift.status);

    const detail = await pricingSeamFetch(`/api/pricing-scenarios/${scenarioId}`);
    const leaf = detail.body.baseline.leafItems.find(
      (row: { itemId: string }) => row.itemId === material.body.id
    );
    expect(Number(leaf.baselinePrice)).toBeCloseTo(45, 6);

    const rev1After = await pricingSeamFetch(
      `/api/pricing-scenarios/${scenarioId}/revisions/${rev1.body.revision.id}`
    );
    expect(rev1After.body.revision.snapshot.products[0].result.sellAt).toBe("120.00");
    expect(rev1After.body.revision.snapshot.products[0].name).toBe(
      `${productName} / ${productVariantLabel}`,
    );
    expect(rev1After.body.revision.snapshot.products[0].materials[0].name).toBe(
      `${materialName} / ${materialVariantLabel}`,
    );
    const [storedLegacyRevision] = await db
      .select({ snapshot: pricingScenarioRevisions.snapshot })
      .from(pricingScenarioRevisions)
      .where(eq(pricingScenarioRevisions.id, rev1.body.revision.id));
    expect(storedLegacyRevision.snapshot.products[0].name).toBe(productName);
    expect(storedLegacyRevision.snapshot.products[0].materials[0].name).toBe(
      materialName,
    );

    const rev2 = await pricingSeamFetch(`/api/pricing-scenarios/${scenarioId}/revisions`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(rev2.body.revision.revisionNumber).toBe(2);
    expect(rev2.body.revision.snapshot.products[0].result.sellAt).toBe("180.00");

    // Soft delete hides the scenario but keeps its revision history.
    const removed = await pricingSeamFetch(`/api/pricing-scenarios/${scenarioId}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    const [scenarioRow] = await db
      .select({ deletedAt: pricingScenarios.deletedAt })
      .from(pricingScenarios)
      .where(eq(pricingScenarios.id, scenarioId));
    expect(scenarioRow.deletedAt).not.toBeNull();
    const revisionRows = await db
      .select({ id: pricingScenarioRevisions.id })
      .from(pricingScenarioRevisions)
      .where(eq(pricingScenarioRevisions.scenarioId, scenarioId));
    expect(revisionRows).toHaveLength(2);

    // The beta gate answers 402 for unentitled orgs on every route.
    await setPricingSeamEntitlements(db, []);
    const lockedList = await pricingSeamFetch("/api/pricing-scenarios");
    expect(lockedList.status).toBe(402);
    await setPricingSeamEntitlements(db, ["pricing_scenarios"]);
  });

  test("revision snapshots stay readable across calculation-model versions", () => {
    // Revisions are immutable history: a snapshot committed under a retired
    // model (older calculationVersion, since-removed fields) must still parse.
    const legacy = {
      calculationVersion: "sales-share-v1",
      capturedAt: "2026-06-05T00:00:00.000Z",
      globals: { overheadPercent: "35", targetProfitPercent: "35" },
      products: [
        {
          itemId: "11111111-1111-4111-8111-111111111111",
          name: "Legacy",
          sku: null,
          materials: [
            {
              itemId: "22222222-2222-4222-8222-222222222222",
              name: "Coir",
              sku: null,
              quantityPerUnit: "1",
              unitPrice: "1300",
              inboundFreight: "0",
              handling: "9.17",
              priceSource: "override",
              costPerUnit: "1309.17",
            },
          ],
          labor: [],
          buckets: {
            materials: "1300",
            inboundFreight: "0",
            handling: "9.17",
            labor: "0",
            directCost: "1309.17",
            costToRecover: "1309.17",
          },
          outboundFreight: "0",
          currentPrice: "1500",
          currentPriceSource: "baseline",
          result: {
            withheld: false,
            sellAt: "4363.90",
            newCost: "1309.17",
            overheadDollars: "1527.37",
            profitDollars: "1527.37",
            currentMargin: "-74.61",
          },
        },
      ],
    };
    const parsed = pricingScenarioRevisionSnapshotSchema.parse(legacy);
    expect(parsed.calculationVersion).toBe("sales-share-v1");
    expect(parsed.products[0].result).toMatchObject({ sellAt: "4363.90" });
  });
});

const OVERHEAD_PL_FIXTURE = {
  reports: [
    {
      reportID: "ProfitAndLoss",
      rows: [
        {
          rowType: "Section",
          title: "Income",
          rows: [
            {
              rowType: "Row",
              cells: [
                { value: "Sales", attributes: [{ id: "account", value: "rev-1" }] },
                { value: "200000.00" },
              ],
            },
            { rowType: "SummaryRow", cells: [{ value: "Total Income" }, { value: "200000.00" }] },
          ],
        },
        {
          rowType: "Section",
          title: "Less Cost of Sales",
          rows: [
            {
              rowType: "Row",
              cells: [
                { value: "Materials", attributes: [{ id: "account", value: "dc-1" }] },
                { value: "80000.00" },
              ],
            },
          ],
        },
        {
          rowType: "Section",
          title: "Less Operating Expenses",
          rows: [
            {
              rowType: "Row",
              cells: [
                { value: "Rent", attributes: [{ id: "account", value: "oh-1" }] },
                { value: "36000.00" },
              ],
            },
            {
              rowType: "Row",
              cells: [
                { value: "Admin Wages", attributes: [{ id: "account", value: "oh-2" }] },
                { value: "24000.00" },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const OVERHEAD_ACCOUNT_TYPES = new Map<string, string | null>([
  ["rev-1", "REVENUE"],
  ["dc-1", "DIRECTCOSTS"],
  ["oh-1", "OVERHEADS"],
  ["oh-2", "OVERHEADS"],
]);

test.describe("overhead settings seam", () => {
  test.describe.configure({ mode: "serial" });

  test("derives overhead % from a Xero P&L: pool ÷ revenue, direct excluded, overrides applied", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines = parseProfitAndLoss(OVERHEAD_PL_FIXTURE as any);
    // Section subtotals are skipped; only the four account rows survive.
    expect(lines).toHaveLength(4);

    const base = computeOverhead(
      classifyLines(lines, OVERHEAD_ACCOUNT_TYPES),
      { periodStart: "2025-07-01", periodEnd: "2026-06-30" }
    );
    // rent 36000 + wages 24000 = 60000 pool; revenue 200000; direct 80000 excluded.
    expect(base.overheadPercent).toBe("30.00");

    const overridden = computeOverhead(
      classifyLines(lines, OVERHEAD_ACCOUNT_TYPES, { "oh-2": "excluded" }),
      { periodStart: "2025-07-01", periodEnd: "2026-06-30" }
    );
    expect(overridden.overheadPercent).toBe("18.00");
  });

  test("normalizes a signed Xero expense group without turning credits into costs", () => {
    const classified = classifyLines(
      [
        { accountId: "sales", name: "Sales", amount: "2943844.84" },
        { accountId: "rent", name: "Rent", amount: "-1000000.00", normalizationSign: -1 },
        { accountId: "admin", name: "Admin", amount: "-408060.94", normalizationSign: -1 },
        { accountId: "rebate", name: "Expense rebate", amount: "1200.00", normalizationSign: -1 },
      ],
      new Map([
        ["sales", "REVENUE"],
        ["rent", "OVERHEADS"],
        ["admin", "EXPENSE"],
        ["rebate", "EXPENSE"],
      ])
    );

    const result = computeOverhead(classified, {
      periodStart: "2025-08-01",
      periodEnd: "2026-07-31",
    });

    expect(result.overheadPool).toBe("1406860.94");
    expect(result.overheadPercent).toBe("47.79");
  });

  test("uses the expense section total to normalize mixed debit and credit rows", () => {
    const fixture = {
      reports: [
        {
          rows: [
            {
              rowType: "Section",
              title: "Less Operating Expenses",
              rows: [
                {
                  rowType: "Row",
                  cells: [
                    { value: "Rent", attributes: [{ id: "account", value: "rent" }] },
                    { value: "36000.00" },
                  ],
                },
                {
                  rowType: "Row",
                  cells: [
                    { value: "Rebate", attributes: [{ id: "account", value: "rebate" }] },
                    { value: "(1200.00)" },
                  ],
                },
                {
                  rowType: "SummaryRow",
                  cells: [{ value: "Total Operating Expenses" }, { value: "34800.00" }],
                },
              ],
            },
          ],
        },
      ],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines = parseProfitAndLoss(fixture as any);

    expect(lines).toEqual([
      { accountId: "rent", name: "Rent", amount: "36000", normalizationSign: 1 },
      { accountId: "rebate", name: "Rebate", amount: "-1200", normalizationSign: 1 },
    ]);
  });

  test("preserves a net expense credit from a signed Xero expense group", () => {
    const classified = classifyLines(
      [
        { accountId: "sales", name: "Sales", amount: "10000.00" },
        { accountId: "rent", name: "Rent", amount: "-1000.00", normalizationSign: -1 },
        { accountId: "refund", name: "Expense refund", amount: "1200.00", normalizationSign: -1 },
      ],
      new Map([
        ["sales", "REVENUE"],
        ["rent", "OVERHEADS"],
        ["refund", "EXPENSE"],
      ])
    );

    const result = computeOverhead(classified, {
      periodStart: "2025-08-01",
      periodEnd: "2026-07-31",
    });

    expect(result.overheadPool).toBe("-200.00");
    expect(result.overheadPercent).toBe("-2.00");
  });

  test("does not infer expense sign from user-authored overhead overrides", () => {
    const classified = classifyLines(
      [
        { accountId: "sales", name: "Sales", amount: "10000.00" },
        { accountId: "rent", name: "Rent", amount: "1000.00" },
        { accountId: "rebate", name: "Rebate income", amount: "-100.00" },
      ],
      new Map([
        ["sales", "REVENUE"],
        ["rent", "OVERHEADS"],
        ["rebate", "OTHERINCOME"],
      ]),
      { rebate: "overhead" }
    );

    const result = computeOverhead(classified, {
      periodStart: "2025-08-01",
      periodEnd: "2026-07-31",
    });

    expect(result.overheadPool).toBe("900.00");
    expect(result.overheadPercent).toBe("9.00");
  });

  test("reads accounting-style negative amounts instead of dropping the account", () => {
    const fixture = {
      reports: [
        {
          reportID: "ProfitAndLoss",
          rows: [
            {
              rowType: "Section",
              title: "Less Operating Expenses",
              rows: [
                {
                  rowType: "Row",
                  cells: [
                    { value: "Rent", attributes: [{ id: "account", value: "oh-1" }] },
                    { value: "36000.00" },
                  ],
                },
                {
                  rowType: "Row",
                  cells: [
                    { value: "Rebate", attributes: [{ id: "account", value: "oh-neg" }] },
                    { value: "(1,200.00)" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines = parseProfitAndLoss(fixture as any);
    // Both rows survive; the parenthesised amount reads as a negative, not
    // dropped as unparseable (which would silently omit the account).
    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.accountId === "oh-neg")?.amount).toBe("-1200");
  });

  test("treats every Xero authorization failure as a reconnect, not a dead end", () => {
    // A dead/revoked refresh token (401) and a missing connection (409) are as
    // recoverable as a missing report scope (403): all three must reach the
    // reconnect prompt. Previously only 403 did, so an expired token surfaced a
    // raw error with no way for the operator to re-authorise.
    expect(isXeroReconnectStatus(401)).toBe(true);
    expect(isXeroReconnectStatus(403)).toBe(true);
    expect(isXeroReconnectStatus(409)).toBe(true);
    // Genuine failures must NOT be disguised as a reconnect prompt.
    expect(isXeroReconnectStatus(500)).toBe(false);
    expect(isXeroReconnectStatus(502)).toBe(false);
    expect(isXeroReconnectStatus(null)).toBe(false);
  });

  test("flags an account with an unrecognized type and excludes it by default", () => {
    const classified = classifyLines(
      [
        { accountId: "rev-1", name: "Sales", amount: "100000.00" },
        { accountId: "mystery", name: "Suspense", amount: "5000.00" },
      ],
      new Map<string, string | null>([
        ["rev-1", "REVENUE"],
        ["mystery", "BANKREV"],
      ])
    );
    const mystery = classified.find((line) => line.accountId === "mystery");
    expect(mystery?.classification).toBe("excluded");
    expect(isUnresolvedType("BANKREV")).toBe(true);
    expect(isUnresolvedType(null)).toBe(true);
    expect(isUnresolvedType("REVENUE")).toBe(false);
    expect(isUnresolvedType("overheads")).toBe(false);
  });

  test("saved overhead default reads back without retained Xero P&L detail", async ({ db }) => {
    await setPricingSeamEntitlements(db, ["pricing_scenarios"]);

    // Seed a derived rate directly (the compute path itself needs a live Xero
    // connection, which CI can't provide; this guards the persistence + read + RLS).
    const seededSettings = {
      overheadPercent: "30.0000",
      periodStart: "2025-07-01",
      periodEnd: "2026-06-30",
      accountOverrides: {
        "oh-2": "excluded",
      } satisfies OverheadAccountOverrides,
    };
    await db
      .insert(organizationOverheadSettings)
      .values({
        organizationId: getOrgId(),
        ...seededSettings,
      })
      .onConflictDoUpdate({
        target: organizationOverheadSettings.organizationId,
        set: { ...seededSettings, updatedAt: new Date() },
      });

    const read = await testFetch("/api/overhead-settings");
    expect(read.status).toBe(200);
    const body = await read.json();
    expect(body.overheadPercent).toBe("30");
    expect(body.periodStart).toBe("2025-07-01");
    expect(body.accountOverrides).toEqual({ "oh-2": "excluded" });
    expect(body).not.toHaveProperty("derivation");
    expect(body).not.toHaveProperty("overheadPool");
    expect(body).not.toHaveProperty("revenueTotal");

    // Beta gate: unentitled orgs get 402 from the overhead settings API too.
    await setPricingSeamEntitlements(db, []);
    const locked = await testFetch("/api/overhead-settings");
    expect(locked.status).toBe(402);
    await setPricingSeamEntitlements(db, ["pricing_scenarios"]);
    // No cleanup delete: the row is upsert-only (feature never deletes), and the
    // upsert above makes re-runs deterministic.
  });
});
