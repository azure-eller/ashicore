import { execFileSync } from "node:child_process";
import { asc, eq } from "drizzle-orm";
import { trimScaleNullable } from "../../../lib/db/numeric";
import {
  inventoryItemBalances,
  inventoryLotBalances,
  items,
  purchaseOrderLines,
  purchaseOrders,
  stocktakeItems,
  stocktakeLotItems,
} from "../../../lib/db/schema";
import {
  createItem,
  getOrgId,
  getUnitId,
  testFetch,
  updateItem,
} from "../../helpers/api";
import { expect, test } from "../fixtures";

test.describe("Material current stock unit cost story", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const orgId = getOrgId();
  const unitId = getUnitId();
  const supplierName = `Cost Basis Supplier ${ts}`;
  const weightedCategory = `Cost Basis Weighted ${ts}`;
  const fallbackCategory = `Cost Basis Fallback ${ts}`;

  let supplierId = "";
  let explicitMaterialId = "";
  let explicitMaterialName = "";
  let openingBalanceMaterialId = "";
  let openingBalanceMaterialName = "";
  let weightedMaterialId = "";
  let weightedMaterialName = "";
  let fallbackMaterialId = "";
  let fallbackMaterialName = "";

  function buildCountPayload(
    lineId: string,
    lotLines: Array<{ id: string; expectedQty: string }>,
    countedQty: string,
  ) {
    if (lotLines.length === 0) {
      return {
        lines: [{ lineId, countedQty }],
        lotLines: [],
      };
    }

    let remaining = Number(countedQty);
    return {
      lines: [],
      lotLines: lotLines.map((line, index) => {
        const isLast = index === lotLines.length - 1;
        const lineCount = isLast ? remaining : Number(line.expectedQty);
        remaining -= lineCount;
        return {
          lotLineId: line.id,
          countedQty: String(lineCount),
        };
      }),
    };
  }

  test("creates a material with an explicit current stock unit cost via API", async ({
    db,
  }) => {
    explicitMaterialName = `Current Cost Material ${ts}`;

    // The card UI's /new flow only takes a name; richer creation paths
    // (currentStockUnitCost, defaultPurchasePrice, etc.) go through the
    // POST /api/items API endpoint that the card calls behind the scenes
    // for legacy ingestion.
    const createResponse = await createItem({
      name: explicitMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: null,
      category: null,
      description: null,
      currentStockUnitCost: "1.234567",
      defaultPurchasePrice: null,
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    if (createResponse.status !== 201) {
      throw new Error(
        `Expected 201 from createItem, got ${createResponse.status}: ${JSON.stringify(createResponse.body)}`,
      );
    }
    explicitMaterialId = createResponse.body.id;

    const [material] = await db
      .select({
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(eq(items.id, explicitMaterialId));

    expect(material.currentStockUnitCost).toBe("1.234567");
  });

  test("overrides the current stock unit cost via the API", async ({ db }) => {
    const overrideResponse = await testFetch(
      `/api/items/${explicitMaterialId}/current-stock-unit-cost`,
      {
        method: "PUT",
        body: JSON.stringify({ currentStockUnitCost: "2.500000" }),
      },
    );
    expect(overrideResponse.status).toBe(200);

    const [material] = await db
      .select({
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(eq(items.id, explicitMaterialId));

    expect(material.currentStockUnitCost).toBe("2.5");
  });

  test("seeds the current stock unit cost from an opening balance", async ({ db }) => {
    openingBalanceMaterialName = `Opening Balance Material ${ts}`;

    const createResponse = await createItem({
      name: openingBalanceMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `OPEN-COST-${ts}`,
      category: `Opening Cost ${ts}`,
      description: "Opening balance cost seed material",
      defaultPurchasePrice: null,
      currentStockUnitCost: null,
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    expect(createResponse.status).toBe(201);
    openingBalanceMaterialId = createResponse.body.id;

    const [beforeOpeningBalance] = await db
      .select({
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(eq(items.id, openingBalanceMaterialId));
    expect(beforeOpeningBalance.currentStockUnitCost).toBeNull();

    const seedOpeningBalanceScript = [
      'import { sql } from "drizzle-orm";',
      'import { db } from "./lib/db";',
      'import { seedOpeningBalanceInTx } from "./lib/inventory/kernel";',
      '(async () => {',
      '  const orgId = process.env.TEST_OPENING_ORG_ID;',
      '  const itemId = process.env.TEST_OPENING_ITEM_ID;',
      '  const lotNumber = `OPEN-${process.env.TEST_OPENING_TS}`;',
      '  if (!orgId || !itemId) throw new Error("Missing opening balance env");',
      '  await db.transaction(async (tx) => {',
      '    await tx.execute(sql`SELECT set_config(\'app.current_org_id\', ${orgId}, true)`);',
      '    await seedOpeningBalanceInTx(tx, {',
      '      organizationId: orgId,',
      '      itemId,',
      '      quantity: 12,',
      '      unitCost: "0.875",',
      '      actorUserId: "playwright",',
      '      idempotencyKey: `opening-balance-cost:${itemId}`,',
      '      lotNumber,',
      '    });',
      '  });',
      '})();',
    ].join("\n");

    execFileSync("pnpm", ["exec", "tsx", "--eval", seedOpeningBalanceScript], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, "--conditions=react-server"]
          .filter(Boolean)
          .join(" "),
        TEST_OPENING_ORG_ID: orgId,
        TEST_OPENING_ITEM_ID: openingBalanceMaterialId,
        TEST_OPENING_TS: String(ts),
      },
      stdio: "pipe",
    });

    const [material] = await db
      .select({
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(eq(items.id, openingBalanceMaterialId));
    expect(material.currentStockUnitCost).toBe("0.875");

    const [lotBalance] = await db
      .select()
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, openingBalanceMaterialId));
    expect(lotBalance.unitCost).toBe("0.875000");
  });

  test("averages receipt cost per item, preserves historical lot cost, and replaces after stockout", async ({
    db,
  }) => {
    test.slow();

    const supplierResponse = await testFetch("/api/suppliers", {
      method: "POST",
      body: JSON.stringify({
        name: supplierName,
        code: null,
        contactName: null,
        email: null,
        phone: null,
        billingLine1: null,
        billingLine2: null,
        billingCity: null,
        billingRegion: null,
        billingPostcode: null,
        billingCountry: null,
        paymentTerms: null,
        notes: null,
      }),
    });
    const supplierBody = await supplierResponse.json();
    expect(supplierResponse.status).toBe(201);
    supplierId = supplierBody.id;

    weightedMaterialName = `Weighted Receipt Material ${ts}`;
    const weightedCreate = await createItem({
      name: weightedMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `WEIGHTED-COST-${ts}`,
      category: weightedCategory,
      description: "Receipt average cost material",
      purchaseToStockFactor: "3",
      defaultPurchasePrice: "1.00",
      currentStockUnitCost: null,
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    expect(weightedCreate.status).toBe(201);
    weightedMaterialId = weightedCreate.body.id;

    const po1Create = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId,
        expectedDate: null,
        notes: null,
        lines: [
          {
            itemId: weightedMaterialId,
            quantityOrdered: "3",
            unitCost: "1",
          },
        ],
      }),
    });
    const po1Body = await po1Create.json();
    expect(po1Create.status).toBe(201);

    const [po1Line] = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, po1Body.id));

    const po1Submit = await testFetch(`/api/purchase-orders/${po1Body.id}/submit`, {
      method: "POST",
    });
    expect(po1Submit.status).toBe(200);

    const po1Receive = await testFetch(`/api/purchase-orders/${po1Body.id}/receive`, {
      method: "POST",
      body: JSON.stringify({
        lines: [
          {
            lineId: po1Line.id,
            quantityReceived: "3",
          },
        ],
      }),
    });
    expect(po1Receive.status).toBe(200);

    const [afterPo1Item] = await db
      .select({
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(eq(items.id, weightedMaterialId));
    expect(afterPo1Item.currentStockUnitCost).toBe("0.333333");

    const po1LotBalances = await db
      .select()
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, weightedMaterialId))
      .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId));
    expect(po1LotBalances).toHaveLength(1);
    expect(po1LotBalances[0].unitCost).toBe("0.333333");

    const po2Create = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId,
        expectedDate: null,
        notes: null,
        lines: [
          {
            itemId: weightedMaterialId,
            quantityOrdered: "2",
            unitCost: "2",
          },
        ],
      }),
    });
    const po2Body = await po2Create.json();
    expect(po2Create.status).toBe(201);

    const [po2Line] = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, po2Body.id));

    const po2Submit = await testFetch(`/api/purchase-orders/${po2Body.id}/submit`, {
      method: "POST",
    });
    expect(po2Submit.status).toBe(200);

    const po2Receive = await testFetch(`/api/purchase-orders/${po2Body.id}/receive`, {
      method: "POST",
      body: JSON.stringify({
        lines: [
          {
            lineId: po2Line.id,
            quantityReceived: "2",
          },
        ],
      }),
    });
    expect(po2Receive.status).toBe(200);

    const [afterPo2Item] = await db
      .select({
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(eq(items.id, weightedMaterialId));
    expect(afterPo2Item.currentStockUnitCost).toBe("0.466667");

    const po2LotBalances = await db
      .select()
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, weightedMaterialId))
      .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId));
    expect(po2LotBalances).toHaveLength(2);
    expect(po2LotBalances[0].unitCost).toBe("0.333333");
    expect(po2LotBalances[1].unitCost).toBe("0.666667");

    const stockoutUpdate = await updateItem(weightedMaterialId, {
      name: weightedMaterialName,
      sku: `WEIGHTED-COST-${ts}`,
      category: weightedCategory,
      description: "Receipt average cost material",
      purchaseToStockFactor: "3",
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      safetyStock: "0",
      stock: "0",
      bom: [],
    });
    expect(stockoutUpdate.status).toBe(200);

    const [afterStockoutItem] = await db
      .select({
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(eq(items.id, weightedMaterialId));
    expect(afterStockoutItem.currentStockUnitCost).toBe("0.466667");

    const [stockoutBalance] = await db
      .select()
      .from(inventoryItemBalances)
      .where(eq(inventoryItemBalances.itemId, weightedMaterialId));
    expect(stockoutBalance.onHandQty).toBe("0.0000");

    const po3Create = await testFetch("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId,
        expectedDate: null,
        notes: null,
        lines: [
          {
            itemId: weightedMaterialId,
            quantityOrdered: "1",
            unitCost: "1.5",
          },
        ],
      }),
    });
    const po3Body = await po3Create.json();
    expect(po3Create.status).toBe(201);

    const [po3Line] = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, po3Body.id));

    const po3Submit = await testFetch(`/api/purchase-orders/${po3Body.id}/submit`, {
      method: "POST",
    });
    expect(po3Submit.status).toBe(200);

    const po3Receive = await testFetch(`/api/purchase-orders/${po3Body.id}/receive`, {
      method: "POST",
      body: JSON.stringify({
        lines: [
          {
            lineId: po3Line.id,
            quantityReceived: "1",
          },
        ],
      }),
    });
    expect(po3Receive.status).toBe(200);

    const [afterPo3Item] = await db
      .select({
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(eq(items.id, weightedMaterialId));
    expect(afterPo3Item.currentStockUnitCost).toBe("0.5");

    const finalLotBalances = await db
      .select()
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, weightedMaterialId))
      .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId));
    expect(finalLotBalances[0].unitCost).toBe("0.333333");
    expect(finalLotBalances[2].unitCost).toBe("0.500000");

    const [receivedOrder] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, po3Body.id));
    expect(receivedOrder.status).toBe("received");
  });

  test("does not rewrite current stock unit cost for stocktake gains or losses", async ({
    db,
  }) => {
    test.slow();

    const gainStocktake = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Cost Gain Stocktake ${ts}`,
        scope: `material:category:${weightedCategory}`,
        notes: null,
      }),
    });
    const gainStocktakeBody = await gainStocktake.json();
    expect(gainStocktake.status).toBe(201);

    const [gainLine] = await db
      .select()
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, gainStocktakeBody.id));
    const gainLotLines = await db
      .select({
        id: stocktakeLotItems.id,
        expectedQty: stocktakeLotItems.expectedQty,
      })
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, gainLine.id))
      .orderBy(asc(stocktakeLotItems.sortOrder));

    const saveGain = await testFetch(`/api/stocktakes/${gainStocktakeBody.id}`, {
      method: "PUT",
      body: JSON.stringify(buildCountPayload(gainLine.id, gainLotLines, "5")),
    });
    expect(saveGain.status).toBe(200);

    const completeGain = await testFetch(`/api/stocktakes/${gainStocktakeBody.id}/complete`, {
      method: "POST",
      body: JSON.stringify({ confirmStale: false }),
    });
    expect(completeGain.status).toBe(200);

    const [afterGainItem] = await db
      .select({
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(eq(items.id, weightedMaterialId));
    expect(afterGainItem.currentStockUnitCost).toBe("0.5");

    const lossStocktake = await testFetch("/api/stocktakes", {
      method: "POST",
      body: JSON.stringify({
        name: `Cost Loss Stocktake ${ts}`,
        scope: `material:category:${weightedCategory}`,
        notes: null,
      }),
    });
    const lossStocktakeBody = await lossStocktake.json();
    expect(lossStocktake.status).toBe(201);

    const [lossLine] = await db
      .select()
      .from(stocktakeItems)
      .where(eq(stocktakeItems.stocktakeId, lossStocktakeBody.id));
    const lossLotLines = await db
      .select({
        id: stocktakeLotItems.id,
        expectedQty: stocktakeLotItems.expectedQty,
      })
      .from(stocktakeLotItems)
      .where(eq(stocktakeLotItems.stocktakeItemId, lossLine.id))
      .orderBy(asc(stocktakeLotItems.sortOrder));

    const saveLoss = await testFetch(`/api/stocktakes/${lossStocktakeBody.id}`, {
      method: "PUT",
      body: JSON.stringify(buildCountPayload(lossLine.id, lossLotLines, "4")),
    });
    expect(saveLoss.status).toBe(200);

    const completeLoss = await testFetch(`/api/stocktakes/${lossStocktakeBody.id}/complete`, {
      method: "POST",
      body: JSON.stringify({ confirmStale: false }),
    });
    expect(completeLoss.status).toBe(200);

    const [afterLossItem] = await db
      .select({
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(eq(items.id, weightedMaterialId));
    expect(afterLossItem.currentStockUnitCost).toBe("0.5");
  });

  test("seeds current stock unit cost for default-priced initial stock", async ({
    db,
  }) => {
    const initialStockMaterialName = `Initial Fallback Cost Material ${ts}`;

    const initialStockCreate = await createItem({
      name: initialStockMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `INITIAL-FALLBACK-COST-${ts}`,
      category: fallbackCategory,
      description: "Initial stock fallback cost material",
      purchaseToStockFactor: "325",
      defaultPurchasePrice: "250",
      currentStockUnitCost: null,
      defaultSellingPrice: null,
      stock: "5",
      safetyStock: "0",
      bom: [],
    });

    expect(initialStockCreate.status).toBe(201);

    const initialStockMaterialId = initialStockCreate.body.id;
    const initialStockLotBalances = await db
      .select()
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, initialStockMaterialId))
      .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId));
    expect(initialStockLotBalances).toHaveLength(1);
    expect(initialStockLotBalances[0].unitCost).toBe("0.769231");

    const [initialStockItem] = await db
      .select({
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(eq(items.id, initialStockMaterialId));
    expect(initialStockItem.currentStockUnitCost).toBe("0.769231");
  });

  test("uses the default purchase price fallback for manual positive stock without rewriting the item cost", async ({
    db,
  }) => {
    fallbackMaterialName = `Fallback Cost Material ${ts}`;

    const fallbackCreate = await createItem({
      name: fallbackMaterialName,
      itemType: "material",
      unitDefinitionId: unitId,
      sku: `FALLBACK-COST-${ts}`,
      category: fallbackCategory,
      description: "Fallback cost material",
      purchaseToStockFactor: "325",
      defaultPurchasePrice: "250",
      currentStockUnitCost: null,
      defaultSellingPrice: null,
      stock: "0",
      safetyStock: "0",
      bom: [],
    });

    expect(fallbackCreate.status).toBe(201);
    fallbackMaterialId = fallbackCreate.body.id;

    const fallbackIncrease = await updateItem(fallbackMaterialId, {
      name: fallbackMaterialName,
      sku: `FALLBACK-COST-${ts}`,
      category: fallbackCategory,
      description: "Fallback cost material",
      purchaseToStockFactor: "325",
      defaultPurchasePrice: "250",
      defaultSellingPrice: null,
      manufacturingMode: "discrete",
      expectedBatchYield: null,
      safetyStock: "0",
      stock: "5",
      bom: [],
    });
    expect(fallbackIncrease.status).toBe(200);

    const fallbackLotBalances = await db
      .select()
      .from(inventoryLotBalances)
      .where(eq(inventoryLotBalances.itemId, fallbackMaterialId))
      .orderBy(asc(inventoryLotBalances.receivedAt), asc(inventoryLotBalances.lotId));
    expect(fallbackLotBalances).toHaveLength(1);
    expect(fallbackLotBalances[0].unitCost).toBe("0.769231");

    const [fallbackItem] = await db
      .select({
        currentStockUnitCost: trimScaleNullable(items.currentStockUnitCost).as(
          "currentStockUnitCost"
        ),
      })
      .from(items)
      .where(eq(items.id, fallbackMaterialId));
    expect(fallbackItem.currentStockUnitCost).toBe("0.769231");
  });
});
