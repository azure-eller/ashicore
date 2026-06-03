import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
import { readTestEnv } from "./test-env";

type TestEnv = ReturnType<typeof readTestEnv>;

let _env: TestEnv | null = null;

export interface TestResponse {
  headers: Headers;
  ok: boolean;
  status: number;
  // Test helpers intentionally keep JSON payloads loose across many endpoints.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json(): Promise<any>;
  text(): Promise<string>;
}

function getTestEnv(): TestEnv {
  if (_env) return _env;
  _env = readTestEnv();
  return _env!;
}

export function getBaseUrl() {
  return getTestEnv().TEST_BASE_URL;
}

export function getSessionCookie() {
  return getTestEnv().TEST_SESSION_COOKIE;
}

export function getOrgId() {
  return getTestEnv().TEST_ORG_ID;
}

export function getUnitId() {
  return getTestEnv().TEST_UNIT_ID;
}

function buildResponse(
  status: number,
  headers: Headers,
  bodyText: string
): TestResponse {
  return {
    headers,
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return JSON.parse(bodyText);
    },
    async text() {
      return bodyText;
    },
  };
}

async function performRequest(
  url: string,
  options: RequestInit
): Promise<TestResponse> {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;
  const body =
    typeof options.body === "string" || options.body == null
      ? options.body ?? undefined
      : String(options.body);
  const headers = new Headers(options.headers);

  if (body != null && !headers.has("Content-Length")) {
    headers.set("Content-Length", Buffer.byteLength(body).toString());
  }

  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: options.method ?? "GET",
        headers: Object.fromEntries(headers.entries()),
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const responseHeaders = new Headers();

          Object.entries(response.headers).forEach(([key, value]) => {
            if (Array.isArray(value)) {
              value.forEach((entry) => responseHeaders.append(key, entry));
              return;
            }

            if (value != null) {
              responseHeaders.set(key, value);
            }
          });

          resolve(
            buildResponse(
              response.statusCode ?? 0,
              responseHeaders,
              Buffer.concat(chunks).toString("utf8")
            )
          );
        });
      }
    );

    request.on("error", reject);

    if (body) {
      request.write(body);
    }

    request.end();
  });
}

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

/**
 * Make an authenticated fetch to the API.
 */
export async function testFetch(
  path: string,
  options: RequestInit = {}
): Promise<TestResponse> {
  const base = getBaseUrl();
  const method = (options.method ?? "GET").toUpperCase();
  const bodyFingerprint =
    typeof options.body === "string"
      ? `:${createHash("sha256").update(options.body).digest("hex").slice(0, 16)}`
      : "";
  const requestHeaders =
    method === "GET" || method === "HEAD"
      ? new Headers(options.headers)
      : createIdempotencyHeaders(
          `test:${method}:${path}${bodyFingerprint}`,
          options.headers
        );
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await performRequest(`${base}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Origin: base,
          Cookie: getSessionCookie(),
          ...Object.fromEntries(requestHeaders.entries()),
        },
      });
    } catch (error) {
      lastError = error;

      if (attempt === 3) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Inventory helpers
// ---------------------------------------------------------------------------

/**
 * POST /api/items
 */
export async function createItem(data: Record<string, unknown>) {
  const res = await testFetch("/api/items", {
    method: "POST",
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  const item =
    body && typeof body === "object" && "item" in body
      ? (body as { item?: unknown }).item
      : body && typeof body === "object" && "data" in body
        ? (body as { data?: unknown }).data
        : body;
  return { status: res.status, body: item };
}

export async function updateItem(id: string, data: Record<string, unknown>) {
  let latest: { status: number; body: unknown } = { status: 200, body: { id } };
  const snapshotAtStart = await getItemSnapshot(id);

  const familyPayload = pickDefined(data, [
    "name",
    "category",
    "description",
    "unitDefinitionId",
    "defaultSupplierId",
    "purchaseUnitDefinitionId",
    "purchaseToStockFactor",
  ]);
  if (snapshotAtStart?.itemType === "product") {
    delete familyPayload.defaultSupplierId;
    delete familyPayload.purchaseUnitDefinitionId;
    delete familyPayload.purchaseToStockFactor;
  }
  if (Object.keys(familyPayload).length > 0) {
    latest = await jsonMutation(`/api/item-cards/${id}`, "PATCH", familyPayload);
    if (latest.status >= 400) return latest;
  }

  const variantPayload = pickDefined(data, [
    "sku",
    "registeredBarcode",
    "internalBarcode",
    "supplierItemCode",
    "defaultLeadTimeDays",
    "minimumOrderQuantity",
    "defaultSellingPrice",
    "defaultPurchasePrice",
    "currentStockUnitCost",
    "safetyStock",
    "sellable",
  ]);
  if (Object.keys(variantPayload).length > 0) {
    latest = await jsonMutation(`/api/item-cards/${id}/variant`, "PATCH", variantPayload);
    if (latest.status >= 400) return latest;
  }

  if (Array.isArray(data.bom) || Array.isArray(data.operationCosts)) {
    const snapshot = await getItemSnapshot(id);
    if (!snapshot) return { status: 404, body: { error: "Item not found" } };

    const bom = normalizeBomRows(data.bom);
    const operationCosts = Array.isArray(data.operationCosts)
      ? data.operationCosts
      : [];

    if (
      snapshot.itemType !== "product" &&
      (bom.length > 0 || operationCosts.length > 0)
    ) {
      return {
        status: 400,
        body: { error: "BOM revisions are only valid on products." },
      };
    }

    if (snapshot.itemType === "product") {
      latest = await jsonMutation(`/api/items/${id}/bom-revisions`, "POST", {
        bom,
        operationCosts,
        note: data.revisionNote ?? null,
      });
      if (latest.status >= 400) return latest;
      latest = { ...latest, status: 200 };
    }
  }

  if (data.stock != null) {
    latest = await setStockTarget(id, String(data.stock), data);
    if (latest.status >= 400) return latest;
  }

  return latest;
}

/**
 * DELETE /api/items/:id
 */
export async function deleteItem(id: string) {
  const res = await testFetch(`/api/items/${id}`, { method: "DELETE" });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function jsonMutation(path: string, method: "PATCH" | "POST" | "PUT", body: unknown) {
  const res = await testFetch(path, {
    method,
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => null);
  return { status: res.status, body: responseBody };
}

function pickDefined(source: Record<string, unknown>, keys: string[]) {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      picked[key] = source[key];
    }
  }
  return picked;
}

function normalizeBomRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const input = row as Record<string, unknown>;
    return {
      ...input,
      componentId: input.componentId ?? input.itemId,
      quantity: input.quantity ?? input.quantityPerUnit,
    };
  });
}

async function getItemSnapshot(id: string) {
  const itemRows = await getItemRows();
  return itemRows.find((item) => item.id === id) ?? null;
}

async function getItemRows() {
  const itemRes = await testFetch("/api/items");
  const body = await itemRes.json().catch(() => []);
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body?.data)
        ? body.data
        : [];
  return rows as Array<{
    id: string;
    itemType: string;
    lotTrackingMode?: "tracked" | "untracked";
    stock: string;
    currentStockUnitCost?: string | null;
    estimatedUnitCost?: string | null;
  }>;
}

async function setStockTarget(
  id: string,
  targetQuantity: string,
  data: Record<string, unknown>,
) {
  const target = Number(targetQuantity);
  if (!Number.isFinite(target) || target < 0) {
    return { status: 400, body: { errors: { stock: ["Must be a non-negative number"] } } };
  }

  const itemRows = await getItemRows();
  const item = itemRows.find((row) => row.id === id) ?? null;
  const current = Number(item?.stock ?? "0");
  const delta = Math.round((target - current) * 10000) / 10000;
  if (delta === 0) return { status: 200, body: { id } };
  const isLotTracked = item?.lotTrackingMode !== "untracked";

  if (delta > 0) {
    return jsonMutation(`/api/items/${id}/initial-stock`, "POST", {
      quantity: String(delta),
      costPerUnit: resolveStockAdjustmentUnitCost(data, itemRows),
      occurredAt: new Date().toISOString(),
      note: null,
    });
  }

  if (!isLotTracked) {
    return jsonMutation(`/api/items/${id}/stock-adjustments`, "POST", {
      reason: "Test stock target",
      newQuantity: targetQuantity,
    });
  }

  const lotsRes = await testFetch(`/api/items/${id}/lots`);
  const lots = (await lotsRes.json().catch(() => [])) as Array<{ id: string; quantity: string }>;
  if (!lotsRes.ok) return { status: lotsRes.status, body: lots };

  let remaining = Math.abs(delta);
  const lotAdjustments: Array<{ lotId: string; newQuantity: string }> = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const currentLotQty = Number(lot.quantity);
    if (!Number.isFinite(currentLotQty) || currentLotQty <= 0) continue;
    const deduction = Math.min(currentLotQty, remaining);
    const nextQuantity = Math.round((currentLotQty - deduction) * 10000) / 10000;
    lotAdjustments.push({ lotId: lot.id, newQuantity: String(nextQuantity) });
    remaining = Math.round((remaining - deduction) * 10000) / 10000;
  }

  if (remaining > 0) {
    return { status: 400, body: { errors: { stock: ["Not enough lot stock to reduce."] } } };
  }
  return jsonMutation(`/api/items/${id}/stock-adjustments`, "POST", {
    reason: "Test stock target",
    lots: lotAdjustments,
  });
}

function resolveStockAdjustmentUnitCost(
  data: Record<string, unknown>,
  itemRows: Array<{
    id: string;
    currentStockUnitCost?: string | null;
    estimatedUnitCost?: string | null;
  }>,
) {
  if (typeof data.currentStockUnitCost === "string" && data.currentStockUnitCost.trim()) {
    return normalizeTestNumber(Number(data.currentStockUnitCost));
  }

  if (
    typeof data.defaultPurchasePrice === "string" &&
    typeof data.purchaseToStockFactor === "string"
  ) {
    const price = Number(data.defaultPurchasePrice);
    const factor = Number(data.purchaseToStockFactor);
    if (Number.isFinite(price) && Number.isFinite(factor) && factor > 0) {
      return normalizeTestNumber(price / factor);
    }
  }

  const bom = normalizeBomRows(data.bom);
  if (bom.length > 0) {
    let total = 0;
    for (const row of bom) {
      const componentId = row.componentId;
      const quantity = Number(row.quantity);
      const component = itemRows.find((item) => item.id === componentId);
      const unitCost = Number(component?.currentStockUnitCost ?? component?.estimatedUnitCost);
      if (!component || !Number.isFinite(quantity) || !Number.isFinite(unitCost)) {
        return null;
      }
      total += quantity * unitCost;
    }

    if (Number.isFinite(total) && total >= 0) {
      return normalizeTestNumber(total);
    }
  }

  return null;
}

function normalizeTestNumber(value: number) {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

/**
 * POST /api/units
 */
export async function createUnit(data: {
  name: string;
  size: string;
  uom: string;
}) {
  const res = await testFetch("/api/units", {
    method: "POST",
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Customer helpers
// ---------------------------------------------------------------------------

type CustomerAddressInput = {
  billingLine1?: string | null;
  billingLine2?: string | null;
  billingCity?: string | null;
  billingRegion?: string | null;
  billingPostcode?: string | null;
  billingCountry?: string | null;
  shipLine1?: string | null;
  shipLine2?: string | null;
  shipCity?: string | null;
  shipRegion?: string | null;
  shipPostcode?: string | null;
  shipCountry?: string | null;
};

function customerAddressPayload(data: CustomerAddressInput) {
  return {
    billingLine1: data.billingLine1 ?? null,
    billingLine2: data.billingLine2 ?? null,
    billingCity: data.billingCity ?? null,
    billingRegion: data.billingRegion ?? null,
    billingPostcode: data.billingPostcode ?? null,
    billingCountry: data.billingCountry ?? null,
    shipLine1: data.shipLine1 ?? null,
    shipLine2: data.shipLine2 ?? null,
    shipCity: data.shipCity ?? null,
    shipRegion: data.shipRegion ?? null,
    shipPostcode: data.shipPostcode ?? null,
    shipCountry: data.shipCountry ?? null,
  };
}

/**
 * POST /api/customers
 */
export async function createCustomer(data: {
  name: string;
  customerCategoryId?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
} & CustomerAddressInput) {
  const res = await testFetch("/api/customers", {
    method: "POST",
    body: JSON.stringify({
      name: data.name,
      customerCategoryId: data.customerCategoryId ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      ...customerAddressPayload(data),
      notes: data.notes ?? null,
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function updateCustomer(id: string, data: {
  name: string;
  customerCategoryId?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
} & CustomerAddressInput) {
  const res = await testFetch(`/api/customers/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: data.name,
      customerCategoryId: data.customerCategoryId ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      ...customerAddressPayload(data),
      notes: data.notes ?? null,
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function createCustomerCategory(data: {
  name: string;
  description?: string | null;
}) {
  const res = await testFetch("/api/customer-categories", {
    method: "POST",
    body: JSON.stringify({
      name: data.name,
      description: data.description ?? null,
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function createPricingSchedule(data: {
  name: string;
  customerCategoryId?: string | null;
  itemScope?: "all" | "category" | "variant" | "selected";
  itemIds?: string[];
  notes?: string | null;
  breaks: Array<{
    minQuantity: string;
    maxQuantity?: string | null;
    discountPercent: string;
  }>;
}) {
  const res = await testFetch("/api/pricing-schedules", {
    method: "POST",
    body: JSON.stringify({
      name: data.name,
      customerCategoryId: data.customerCategoryId ?? null,
      itemScope:
        data.itemScope ??
        ((data.itemIds?.length ?? 0) > 0 ? "selected" : "all"),
      itemIds: data.itemIds ?? [],
      notes: data.notes ?? null,
      breaks: data.breaks.map((pricingBreak) => ({
        minQuantity: pricingBreak.minQuantity,
        maxQuantity: pricingBreak.maxQuantity ?? null,
        discountPercent: pricingBreak.discountPercent,
      })),
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Supplier helpers
// ---------------------------------------------------------------------------

type SupplierAddressInput = {
  billingLine1?: string | null;
  billingLine2?: string | null;
  billingCity?: string | null;
  billingRegion?: string | null;
  billingPostcode?: string | null;
  billingCountry?: string | null;
};

/**
 * POST /api/suppliers
 */
export async function createSupplier(data: {
  name: string;
  code?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
} & SupplierAddressInput) {
  const res = await testFetch("/api/suppliers", {
    method: "POST",
    body: JSON.stringify({
      name: data.name,
      code: data.code ?? null,
      contactName: data.contactName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      billingLine1: data.billingLine1 ?? null,
      billingLine2: data.billingLine2 ?? null,
      billingCity: data.billingCity ?? null,
      billingRegion: data.billingRegion ?? null,
      billingPostcode: data.billingPostcode ?? null,
      billingCountry: data.billingCountry ?? null,
      paymentTerms: data.paymentTerms ?? null,
      notes: data.notes ?? null,
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Sales order helpers
// ---------------------------------------------------------------------------

/**
 * POST /api/sales-orders
 */
export async function createSalesOrder(data: {
  orderNumber?: string | null;
  customerId: string;
  customerProjectId?: string | null;
  status?: string;
  orderDate?: string;
  shipDate?: string | null;
  requestedDate?: string | null;
  notes?: string | null;
  lines: Array<{
    itemId: string;
    quantity: string;
    unitPrice: string;
  }>;
  confirmOversell?: boolean;
}) {
  const res = await testFetch("/api/sales-orders", {
    method: "POST",
    body: JSON.stringify({
      ...(data.orderNumber !== undefined ? { orderNumber: data.orderNumber } : {}),
      customerId: data.customerId,
      customerProjectId: data.customerProjectId ?? null,
      status: data.status ?? "open",
      orderDate:
        data.orderDate ??
        data.requestedDate ??
        "2026-04-15",
      shipDate: data.shipDate ?? null,
      requestedDate: data.requestedDate ?? null,
      notes: data.notes ?? null,
      lines: data.lines,
      confirmOversell: data.confirmOversell ?? true,
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/**
 * PUT /api/sales-orders/:id
 */
export async function updateSalesOrder(
  id: string,
  data: {
    orderNumber?: string | null;
    customerId: string;
    status?: string;
    orderDate?: string;
    shipDate?: string | null;
    requestedDate?: string | null;
    notes?: string | null;
    lines: Array<{
      itemId: string;
      quantity: string;
      unitPrice: string;
    }>;
    confirmOversell?: boolean;
  }
) {
  const res = await testFetch(`/api/sales-orders/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...(data.orderNumber !== undefined ? { orderNumber: data.orderNumber } : {}),
      customerId: data.customerId,
      status: data.status ?? "open",
      orderDate:
        data.orderDate ??
        data.requestedDate ??
        "2026-04-15",
      shipDate: data.shipDate ?? null,
      requestedDate: data.requestedDate ?? null,
      notes: data.notes ?? null,
      lines: data.lines,
      confirmOversell: data.confirmOversell ?? true,
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/**
 * POST /api/sales-orders/:id/confirm
 */
export async function confirmSalesOrder(
  id: string,
  options?: { confirmOversell?: boolean }
) {
  const res = await testFetch(`/api/sales-orders/${id}/confirm`, {
    method: "POST",
    body: JSON.stringify({
      confirmOversell: options?.confirmOversell ?? false,
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/**
 * POST /api/sales-orders/:id/ship
 */
export async function fulfillSalesOrder(
  id: string,
  options?: {
    confirmNegativeStock?: boolean;
    completeLinkedManufacturing?: boolean;
  }
) {
  const res = await testFetch(`/api/sales-orders/${id}/ship`, {
    method: "POST",
    body: JSON.stringify(options ?? {}),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Purchase order helpers
// ---------------------------------------------------------------------------

/**
 * POST /api/purchase-orders
 */
export async function createPurchaseOrder(data: {
  supplierId: string;
  expectedDate?: string | null;
  notes?: string | null;
  lines: Array<{
    itemId: string;
    quantityOrdered: string;
    unitCost: string;
  }>;
}) {
  const res = await testFetch("/api/purchase-orders", {
    method: "POST",
    body: JSON.stringify({
      supplierId: data.supplierId,
      expectedDate: data.expectedDate ?? null,
      notes: data.notes ?? null,
      lines: data.lines,
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/**
 * POST /api/purchase-orders/:id/submit
 */
export async function submitPurchaseOrder(id: string) {
  const res = await testFetch(`/api/purchase-orders/${id}/submit`, {
    method: "POST",
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/**
 * POST /api/purchase-orders/:id/receive
 */
export async function receivePurchaseOrder(
  id: string,
  data: {
    lines: Array<{
      lineId: string;
      quantityReceived: string;
      disposition?: "available" | "blocked";
    }>;
  }
) {
  const res = await testFetch(`/api/purchase-orders/${id}/receive`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Manufacturing order helpers
// ---------------------------------------------------------------------------

/**
 * POST /api/manufacturing-orders
 */
export async function createManufacturingOrder(data: {
  productId: string;
  salesOrderId?: string | null;
  salesOrderLineId?: string | null;
  plannedQuantity: string;
  plannedDate?: string | null;
  notes?: string | null;
  ingredients: Array<{ itemId: string; quantityPerUnit: string }>;
  confirmShortage?: boolean;
}) {
  const res = await testFetch("/api/manufacturing-orders", {
    method: "POST",
    body: JSON.stringify({
      productId: data.productId,
      salesOrderId: data.salesOrderId ?? null,
      salesOrderLineId: data.salesOrderLineId ?? null,
      plannedQuantity: data.plannedQuantity,
      plannedDate: data.plannedDate ?? null,
      notes: data.notes ?? null,
      ingredients: data.ingredients,
      confirmShortage: data.confirmShortage ?? false,
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/**
 * POST /api/manufacturing-orders/:id/release
 */
export async function releaseManufacturingOrder(
  id: string,
  options?: { confirmShortage?: boolean }
) {
  const res = await testFetch(`/api/manufacturing-orders/${id}/release`, {
    method: "POST",
    body: JSON.stringify({
      confirmShortage: options?.confirmShortage ?? false,
    }),
  });
  const body = await res.json().catch(() => null);
  if (res.status === 404) {
    const current = await testFetch(`/api/manufacturing-orders/${id}`);
    const currentBody = await current.json().catch(() => null);
    if (current.status === 200 && currentBody?.status === "open") {
      return { status: 200, body: currentBody };
    }
  }
  return { status: res.status, body };
}

/**
 * POST /api/manufacturing-orders/:id/complete
 */
export async function completeManufacturingOrder(
  id: string,
  actualQuantity: string,
  options?: { outputDisposition?: "available" | "blocked"; confirmNegativeStock?: boolean }
) {
  const res = await testFetch(`/api/manufacturing-orders/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({
      actualQuantity,
      outputDisposition: options?.outputDisposition ?? "available",
      confirmNegativeStock: options?.confirmNegativeStock ?? false,
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Planning helpers
// ---------------------------------------------------------------------------

export async function getPlanningSnapshot() {
  const res = await testFetch("/api/planning");
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function createPlanningPurchaseOrderDraft(data: Record<string, unknown>) {
  const res = await testFetch("/api/planning/actions/purchase-order", {
    method: "POST",
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function createPlanningManufacturingOrderDraft(
  data: Record<string, unknown>
) {
  const res = await testFetch("/api/planning/actions/manufacturing-order", {
    method: "POST",
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
