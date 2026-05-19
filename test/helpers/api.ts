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
  return { status: res.status, body };
}

/**
 * PUT /api/items/:id
 */
export async function updateItem(id: string, data: Record<string, unknown>) {
  const res = await testFetch(`/api/items/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/**
 * DELETE /api/items/:id
 */
export async function deleteItem(id: string) {
  const res = await testFetch(`/api/items/${id}`, { method: "DELETE" });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
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
  unitDefinitionId: string;
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
      unitDefinitionId: data.unitDefinitionId,
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
  status?: string;
  orderDate?: string;
  shipDate?: string | null;
  requestedDate?: string | null;
  notes?: string | null;
  shipments?: Array<{
    fulfillmentType?: "delivery" | "pickup";
    scheduledDate: string | null;
    deliveryDate: string | null;
    notes?: string | null;
    lines: Array<{
      itemId: string;
      quantity: string;
    }>;
  }>;
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
      status: data.status ?? "open",
      orderDate:
        data.orderDate ??
        data.requestedDate ??
        "2026-04-15",
      shipDate: data.shipDate ?? null,
      requestedDate: data.requestedDate ?? null,
      notes: data.notes ?? null,
      lines: data.lines,
      shipments: data.shipments ?? [],
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
    shipments?: Array<{
      fulfillmentType?: "delivery" | "pickup";
      scheduledDate: string | null;
      deliveryDate: string | null;
      notes?: string | null;
      lines: Array<{
        itemId: string;
        quantity: string;
      }>;
    }>;
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
      shipments: data.shipments ?? [],
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
export async function fulfillSalesOrder(id: string) {
  const res = await testFetch(`/api/sales-orders/${id}/ship`, {
    method: "POST",
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
  groupRemainderChoices?: Array<{
    basisOutputQuantity: string;
    handling: "leave_loose" | "create_partial_group";
  }>;
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
      groupRemainderChoices: data.groupRemainderChoices ?? [],
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
  options?: { outputDisposition?: "available" | "blocked" }
) {
  const res = await testFetch(`/api/manufacturing-orders/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({
      actualQuantity,
      outputDisposition: options?.outputDisposition ?? "available",
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
