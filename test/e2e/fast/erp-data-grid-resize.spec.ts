import { expect, test } from "../fixtures";
import {
  createCustomer,
  createItem,
  createSalesOrder,
  getUnitId,
  testFetch,
} from "../../helpers/api";

async function collectRuntimeErrors(page: import("@playwright/test").Page) {
  const runtimeErrors: string[] = [];

  page.on("pageerror", (error) => {
    runtimeErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });

  return runtimeErrors;
}

async function resizeColumn(
  page: import("@playwright/test").Page,
  headerName: string,
  deltaX: number
) {
  const header = page.getByRole("columnheader", { name: headerName }).first();
  await expect(header).toBeVisible();

  const resizeHandle = header.locator(".ag-header-cell-resize").first();
  await expect(resizeHandle).toBeVisible();

  const initialWidth = await header.evaluate((node) =>
    node.getBoundingClientRect().width
  );
  const box = await resizeHandle.boundingBox();

  if (!box) {
    throw new Error(`Resize handle for ${headerName} did not render`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.up();

  await expect
    .poll(async () =>
      header.evaluate((node) => node.getBoundingClientRect().width)
    )
    .toBeGreaterThan(initialWidth + deltaX / 2);
}

test("sales orders AG grid renders with bounded internal viewports", async ({
  page,
}) => {
  const runtimeErrors = await collectRuntimeErrors(page);

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/sales/orders");

  await expect(page.getByLabel("Search orders")).toBeVisible();
  await expect(page.getByRole("link", { name: "New Order" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Order" })).toBeVisible();
  await expect(page.locator('[data-slot="erp-data-grid"]')).toBeVisible();
  await expect(page.locator(".ag-body-viewport")).toBeVisible();
  await expect(page.locator(".ag-body-horizontal-scroll-viewport")).toBeVisible();
  await expect(
    page.locator(".ag-row").first().or(page.getByText("No sales orders yet."))
  ).toBeVisible();

  expect(runtimeErrors).toEqual([]);
});

test("sales orders AG grid resizes left and right columns without page growth", async ({
  page,
}) => {
  const runtimeErrors = await collectRuntimeErrors(page);

  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/sales/orders");
  await expect(page.getByLabel("Search orders")).toBeVisible();

  const initialPageWidth = await page.evaluate(() => document.body.scrollWidth);

  await resizeColumn(page, "Order", 90);

  const horizontalViewport = page
    .locator('[data-slot="erp-data-grid"] .ag-body-horizontal-scroll-viewport')
    .first();
  await horizontalViewport.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await resizeColumn(page, "Delivery", 90);

  const finalPageWidth = await page.evaluate(() => document.body.scrollWidth);
  expect(finalPageWidth).toBeLessThanOrEqual(initialPageWidth + 2);
  expect(runtimeErrors).toEqual([]);
});

test("sales orders AG grid reorders open rows with the rank drag handle", async ({
  page,
}) => {
  const runtimeErrors = await collectRuntimeErrors(page);
  const suffix = Date.now();
  const unitId = getUnitId();
  const customerResult = await createCustomer({
    name: `Grid Drag Customer ${suffix}`,
  });
  expect(customerResult.status).toBe(201);

  const itemResult = await createItem({
    name: `Grid Drag Product ${suffix}`,
    itemType: "product",
    unitDefinitionId: unitId,
    sku: `GRID-DRAG-${suffix}`,
    category: "Grid Drag",
    description: null,
    defaultPurchasePrice: null,
    defaultSellingPrice: "10",
    sellable: true,
    stock: "0",
    safetyStock: "0",
    bom: [],
  });
  expect(itemResult.status).toBe(201);

  const orderIds: string[] = [];
  for (const marker of ["A", "B", "C"]) {
    const orderResult = await createSalesOrder({
      customerId: customerResult.body.id as string,
      status: "open",
      requestedDate: "2026-05-20",
      notes: `Grid drag ${marker} ${suffix}`,
      lines: [
        {
          itemId: itemResult.body.id as string,
          quantity: "1",
          unitPrice: "10",
        },
      ],
    });
    expect(orderResult.status).toBe(201);
    orderIds.push(orderResult.body.id as string);
  }
  let rankStatus = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ordersResponse = await testFetch("/api/sales-orders");
    expect(ordersResponse.status).toBe(200);
    const allOrders = (await ordersResponse.json()) as Array<{
      id: string;
      status: string;
    }>;
    const remainingOpenOrderIds = allOrders
      .filter((order) => !orderIds.includes(order.id) && order.status === "open")
      .map((order) => order.id);
    const rankResponse = await testFetch("/api/sales-orders/priority-ranks", {
      method: "PATCH",
      body: JSON.stringify({
        orderIds: [...orderIds, ...remainingOpenOrderIds],
      }),
    });
    rankStatus = rankResponse.status;
    if (rankStatus === 200) break;
    await page.waitForTimeout(100);
  }
  expect(rankStatus).toBe(200);

  await page.goto("/sales/orders");
  const resetSort = page.getByRole("button", { name: /Reset sort/i });
  if (await resetSort.isVisible()) {
    await resetSort.click();
  }

  const centerRows = page.locator(
    '[data-slot="erp-data-grid"] .ag-center-cols-container [role="row"][row-index]'
  );
  await expect(centerRows.nth(2)).toBeVisible();

  const firstRowBefore = await centerRows.nth(0).textContent();
  const secondRowBefore = await centerRows.nth(1).textContent();
  const thirdRowBefore = await centerRows.nth(2).textContent();
  expect(firstRowBefore).toContain(`Grid drag A ${suffix}`);
  expect(secondRowBefore).toContain(`Grid drag B ${suffix}`);
  expect(thirdRowBefore).toContain(`Grid drag C ${suffix}`);

  const staleOrderResult = await createSalesOrder({
    customerId: customerResult.body.id as string,
    status: "open",
    requestedDate: "2026-05-20",
    notes: `Grid drag stale ${suffix}`,
    lines: [
      {
        itemId: itemResult.body.id as string,
        quantity: "1",
        unitPrice: "10",
      },
    ],
  });
  expect(staleOrderResult.status).toBe(201);

  const firstHandle = centerRows.nth(0).locator(".ag-row-drag").first();
  const thirdRowBox = await centerRows.nth(2).boundingBox();
  const firstHandleBox = await firstHandle.boundingBox();

  if (
    !firstHandleBox ||
    !thirdRowBox ||
    !firstRowBefore ||
    !secondRowBefore ||
    !thirdRowBefore
  ) {
    throw new Error("Expected draggable first three sales order rows");
  }

  const firstHandleX = firstHandleBox.x + firstHandleBox.width / 2;
  const firstHandleY = firstHandleBox.y + firstHandleBox.height / 2;
  await page.mouse.move(firstHandleX, firstHandleY);
  await page.mouse.down();
  await page.mouse.move(firstHandleX + 24, firstHandleY, { steps: 4 });
  await page.mouse.move(
    firstHandleX + 24,
    thirdRowBox.y + thirdRowBox.height + 4,
    { steps: 8 }
  );
  await page.mouse.up();

  await expect
    .poll(async () => {
      const firstBox = await centerRows
        .filter({ hasText: `Grid drag A ${suffix}` })
        .first()
        .boundingBox();
      const thirdBox = await centerRows
        .filter({ hasText: `Grid drag C ${suffix}` })
        .first()
        .boundingBox();
      return firstBox != null && thirdBox != null && firstBox.y > thirdBox.y;
    },
      { timeout: 15_000 }
    )
    .toBe(true);

  const movedHandle = centerRows
    .filter({ hasText: `Grid drag A ${suffix}` })
    .first()
    .locator(".ag-row-drag")
    .first();
  await expect(movedHandle).toBeVisible();
  const movedHandleBox = await movedHandle.boundingBox();
  const secondMarkerRowBox = await centerRows
    .filter({ hasText: `Grid drag B ${suffix}` })
    .first()
    .boundingBox();

  if (!movedHandleBox || !secondMarkerRowBox) {
    throw new Error("Expected moved sales order row to remain draggable");
  }

  const movedHandleX = movedHandleBox.x + movedHandleBox.width / 2;
  const movedHandleY = movedHandleBox.y + movedHandleBox.height / 2;
  await page.mouse.move(movedHandleX, movedHandleY);
  await page.mouse.down();
  await page.mouse.move(movedHandleX + 24, movedHandleY, { steps: 4 });
  await page.mouse.move(
    movedHandleX + 24,
    secondMarkerRowBox.y + 2,
    { steps: 8 }
  );
  await page.mouse.up();

  await expect
    .poll(async () => {
      const firstBox = await centerRows
        .filter({ hasText: `Grid drag A ${suffix}` })
        .first()
        .boundingBox();
      const secondBox = await centerRows
        .filter({ hasText: `Grid drag B ${suffix}` })
        .first()
        .boundingBox();
      const thirdBox = await centerRows
        .filter({ hasText: `Grid drag C ${suffix}` })
        .first()
        .boundingBox();
      return (
        firstBox != null &&
        secondBox != null &&
        thirdBox != null &&
        firstBox.y < secondBox.y &&
        firstBox.y < thirdBox.y
      );
    },
      { timeout: 15_000 }
    )
    .toBe(true);
  expect(runtimeErrors).toEqual([]);
});
