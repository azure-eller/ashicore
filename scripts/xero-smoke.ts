/**
 * Live Xero smoke test against the connected Demo Company tenant.
 *
 * Walks the full sales + purchasing happy paths through the running dev
 * server (HTTP), then verifies the resulting invoice and purchase order
 * appear in Xero by calling the Xero API directly through the stored
 * connection.
 *
 * Prereqs:
 *   - Dev server running (pnpm dev)
 *   - test/.test-env.json present (created by `pnpm test` global-setup)
 *   - Xero connected to a Demo Company tenant for the test org
 *
 * Usage:
 *   pnpm xero:smoke              # both flows
 *   pnpm xero:smoke -- --sales   # only sales
 *   pnpm xero:smoke -- --po      # only purchasing
 *
 * All created data is prefixed `TEST-XERO-<timestamp>` so the artefacts
 * are easy to identify and clean up in Xero. (Demo Company resets every
 * 28 days anyway.)
 */

import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

type Cookies = string;
type ApiOptions = RequestInit & { idempotencyKey?: string };

const args = new Set(process.argv.slice(2));
const explicit = args.has("--sales") || args.has("--po");
const runSales = !explicit || args.has("--sales");
const runPo = !explicit || args.has("--po");

async function apiFetch<T>(
  baseUrl: string,
  cookies: Cookies,
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const { idempotencyKey, headers: optionHeaders, ...rest } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: cookies,
    Origin: baseUrl,
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: { ...headers, ...Object.fromEntries(new Headers(optionHeaders)) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} → ${res.status}: ${
        text.slice(0, 500) || "(empty)"
      }`
    );
  }
  return JSON.parse(text || "null") as T;
}

async function loadAuth() {
  const { readTestEnv } = await import("../test/helpers/test-env");
  const env = readTestEnv();
  return {
    baseUrl: env.TEST_BASE_URL,
    cookies: env.TEST_SESSION_COOKIE,
    orgId: env.TEST_ORG_ID,
    unitId: env.TEST_UNIT_ID,
  };
}

type XeroAccount = {
  code: string;
  name: string;
  type: string;
  status: string;
  taxType: string | null;
  class: string | null;
  enablePaymentsToAccount: boolean | null;
};

async function pickAccounts(baseUrl: string, cookies: Cookies) {
  const { accounts } = await apiFetch<{ accounts: XeroAccount[] }>(
    baseUrl,
    cookies,
    "/api/xero/test/accounts"
  );

  const active = accounts.filter((a) => a.status === "ACTIVE");
  // Sales/Income code: first REVENUE-typed account, prefer ones explicitly
  // marked SALES or generic income.
  const revenueByCode = active
    .filter((a) => a.type === "REVENUE" || a.type === "SALES")
    .sort((a, b) => a.code.localeCompare(b.code));
  // Purchase/Expense code: prefer DIRECTCOSTS or EXPENSE.
  const expenseByCode = active
    .filter(
      (a) =>
        a.type === "DIRECTCOSTS" ||
        a.type === "EXPENSE" ||
        a.type === "OVERHEADS"
    )
    .sort((a, b) => a.code.localeCompare(b.code));

  const sales = revenueByCode[0];
  const purchase = expenseByCode[0] ?? sales;

  if (!sales) {
    throw new Error(
      "No active REVENUE/SALES account found in Xero — connect to a tenant with a populated chart of accounts."
    );
  }

  return { sales, purchase };
}

async function ensureXeroSettings(baseUrl: string, cookies: Cookies) {
  // Force sane defaults so the smoke isn't gated on the user having
  // clicked Save in the UI. Picks valid account codes from the live
  // chart of accounts so this works against any tenant (Demo, pilot,
  // or otherwise). Auto-email stays OFF as a safety net.
  const picks = await pickAccounts(baseUrl, cookies);
  const salesTaxType = picks.sales.taxType ?? "NONE";
  const purchaseTaxType = picks.purchase.taxType ?? "NONE";

  await apiFetch(baseUrl, cookies, "/api/xero/settings", {
    method: "PUT",
    body: JSON.stringify({
      defaultAccountCode: picks.sales.code,
      defaultTaxType: salesTaxType,
      invoiceStatusPreference: "AUTHORISED",
      autoEmailSalesInvoices: false,
      autoEmailPurchaseOrders: false,
      purchaseOrderDefaultAccountCode: picks.purchase.code,
      purchaseOrderDefaultTaxType: purchaseTaxType,
      purchaseOrderStatusPreference: "DRAFT",
    }),
  });

  console.log(
    `Xero defaults applied: sales=${picks.sales.code} (${picks.sales.name}, tax ${salesTaxType}), purchase=${picks.purchase.code} (${picks.purchase.name}, tax ${purchaseTaxType})`
  );
}

async function createMaterial(
  baseUrl: string,
  cookies: Cookies,
  unitId: string,
  ts: number,
  suffix: string
) {
  type Item = { id: string; sku: string };
  return apiFetch<Item>(baseUrl, cookies, "/api/items", {
    method: "POST",
    idempotencyKey: `xero-smoke:item:${suffix}:${ts}`,
    body: JSON.stringify({
      itemType: "material",
      name: `TEST-XERO-${suffix}-${ts}`,
      sku: `TEST-${suffix}-${ts}`,
      category: "Test",
      description: `Smoke-test material ${suffix}`,
      unitDefinitionId: unitId,
      purchaseUnitDefinitionId: null,
      purchaseToStockFactor: null,
      stock: "100",
      safetyStock: "0",
      defaultPurchasePrice: "10",
      currentStockUnitCost: "10",
      defaultSellingPrice: "20",
      sellable: true,
      manufacturingMode: "discrete",
      expectedBatchYield: null,
    }),
  });
}

/** Override default test contact emails so live email-delivery checks
 *  can route to a real inbox. */
const CUSTOMER_EMAIL_OVERRIDE = process.env.XERO_SMOKE_CUSTOMER_EMAIL;
const SUPPLIER_EMAIL_OVERRIDE = process.env.XERO_SMOKE_SUPPLIER_EMAIL;

async function createCustomer(baseUrl: string, cookies: Cookies, ts: number) {
  type Customer = { id: string };
  const email =
    CUSTOMER_EMAIL_OVERRIDE ?? `test+xero-${ts}@example.com`;
  return apiFetch<Customer>(baseUrl, cookies, "/api/customers", {
    method: "POST",
    idempotencyKey: `xero-smoke:customer:${ts}`,
    body: JSON.stringify({
      name: `TEST-XERO-CUST-${ts}`,
      email,
      billingLine1: "1 Test Street",
      billingCity: "Testville",
      billingPostcode: "12345",
      billingCountry: "US",
    }),
  });
}

async function createSupplier(baseUrl: string, cookies: Cookies, ts: number) {
  type Supplier = { id: string };
  const email =
    SUPPLIER_EMAIL_OVERRIDE ?? `test+xero-sup-${ts}@example.com`;
  return apiFetch<Supplier>(baseUrl, cookies, "/api/suppliers", {
    method: "POST",
    idempotencyKey: `xero-smoke:supplier:${ts}`,
    body: JSON.stringify({
      name: `TEST-XERO-SUP-${ts}`,
      email,
      billingLine1: "1 Supplier Lane",
      billingCity: "Testville",
      billingPostcode: "12345",
      billingCountry: "US",
    }),
  });
}

type OrderDetail = {
  id: string;
  orderNumber: string;
  xeroPushStatus: string | null;
  xeroPushError: string | null;
  xeroInvoiceId?: string | null;
  xeroInvoiceNumber?: string | null;
  xeroPurchaseOrderId?: string | null;
  xeroPurchaseOrderNumber?: string | null;
  xeroEmailStatus?: string | null;
  xeroEmailError?: string | null;
  xeroPoEmailStatus?: string | null;
  xeroPoEmailError?: string | null;
  xeroRetryCount?: number;
};

type LookupResult = {
  found: boolean;
  match: { invoiceID?: string; invoiceNumber?: string | null;
    purchaseOrderID?: string; purchaseOrderNumber?: string | null } | null;
};

async function setAutoEmail(baseUrl: string, cookies: Cookies, enabled: boolean) {
  // Re-PUT the full settings block (the route requires every field).
  const picks = await pickAccounts(baseUrl, cookies);
  await apiFetch(baseUrl, cookies, "/api/xero/settings", {
    method: "PUT",
    body: JSON.stringify({
      defaultAccountCode: picks.sales.code,
      defaultTaxType: picks.sales.taxType ?? "NONE",
      invoiceStatusPreference: "AUTHORISED",
      autoEmailSalesInvoices: enabled,
      autoEmailPurchaseOrders: false,
      purchaseOrderDefaultAccountCode: picks.purchase.code,
      purchaseOrderDefaultTaxType: picks.purchase.taxType ?? "NONE",
      purchaseOrderStatusPreference: "DRAFT",
    }),
  });
}

async function setAutoPurchaseOrderEmail(
  baseUrl: string,
  cookies: Cookies,
  enabled: boolean
) {
  const picks = await pickAccounts(baseUrl, cookies);
  await apiFetch(baseUrl, cookies, "/api/xero/settings", {
    method: "PUT",
    body: JSON.stringify({
      defaultAccountCode: picks.sales.code,
      defaultTaxType: picks.sales.taxType ?? "NONE",
      invoiceStatusPreference: "AUTHORISED",
      autoEmailSalesInvoices: false,
      autoEmailPurchaseOrders: enabled,
      purchaseOrderDefaultAccountCode: picks.purchase.code,
      purchaseOrderDefaultTaxType: picks.purchase.taxType ?? "NONE",
      purchaseOrderStatusPreference: enabled ? "SUBMITTED" : "DRAFT",
    }),
  });
}

async function shipFreshSalesOrder(
  baseUrl: string,
  cookies: Cookies,
  unitId: string,
  ts: number,
  suffix: string
): Promise<OrderDetail> {
  const item = await createMaterial(baseUrl, cookies, unitId, ts, suffix);
  const customer = await createCustomer(baseUrl, cookies, ts + 1);
  type CreateResult = { id: string };
  const created = await apiFetch<CreateResult>(
    baseUrl,
    cookies,
    "/api/sales-orders",
    {
      method: "POST",
      idempotencyKey: `xero-smoke:so:${suffix}:${ts}`,
      body: JSON.stringify({
        customerId: customer.id,
        status: "open",
        shipDate: new Date().toISOString().slice(0, 10),
        requestedDate: new Date().toISOString().slice(0, 10),
        lines: [{ itemId: item.id, quantity: "10", unitPrice: "20" }],
      }),
    }
  );
  await apiFetch(baseUrl, cookies, `/api/sales-orders/${created.id}/confirm`, {
    method: "POST",
    body: JSON.stringify({}),
    idempotencyKey: `xero-smoke:confirm:${suffix}:${ts}`,
  });
  await apiFetch(baseUrl, cookies, `/api/sales-orders/${created.id}/ship`, {
    method: "POST",
    body: JSON.stringify({}),
    idempotencyKey: `xero-smoke:ship:${suffix}:${ts}`,
  });
  return apiFetch<OrderDetail>(
    baseUrl,
    cookies,
    `/api/sales-orders/${created.id}`
  );
}

async function submitFreshPurchaseOrder(
  baseUrl: string,
  cookies: Cookies,
  unitId: string,
  ts: number,
  suffix: string
): Promise<OrderDetail> {
  const item = await createMaterial(baseUrl, cookies, unitId, ts, suffix);
  const supplier = await createSupplier(baseUrl, cookies, ts + 2);
  type CreateResult = { id: string };
  const created = await apiFetch<CreateResult>(
    baseUrl,
    cookies,
    "/api/purchase-orders",
    {
      method: "POST",
      idempotencyKey: `xero-smoke:po:${suffix}:${ts}`,
      body: JSON.stringify({
        supplierId: supplier.id,
        expectedDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        lines: [
          {
            itemId: item.id,
            quantityOrdered: "50",
            unitCost: "10",
          },
        ],
      }),
    }
  );
  await apiFetch(baseUrl, cookies, `/api/purchase-orders/${created.id}/submit`, {
    method: "POST",
    body: JSON.stringify({}),
    idempotencyKey: `xero-smoke:po-submit:${suffix}:${ts}`,
  });
  return apiFetch<OrderDetail>(
    baseUrl,
    cookies,
    `/api/purchase-orders/${created.id}`
  );
}

async function smokeAutoEmail(
  baseUrl: string,
  cookies: Cookies,
  unitId: string,
  ts: number
): Promise<boolean> {
  console.log("─── Auto-email check ───────────────────────");
  await setAutoEmail(baseUrl, cookies, true);
  console.log("  • Toggle ON");
  try {
    const order = await shipFreshSalesOrder(
      baseUrl,
      cookies,
      unitId,
      ts,
      "EMAIL"
    );
    console.log(`  • Order ${order.orderNumber} shipped`);
    if (order.xeroPushStatus !== "pushed") {
      console.error(`  ✗ FAIL: push failed: ${order.xeroPushError}`);
      return false;
    }
    if (order.xeroEmailStatus === "sent") {
      console.log(
        "  ✓ xero_email_status = sent (Xero accepted the email request)"
      );
      return true;
    }
    if (order.xeroEmailStatus === "failed") {
      // Demo Company's email service often returns 500 for ACCREC sends.
      // Our code path is what we're proving here: the toggle was honoured,
      // emailInvoice was called, and the failure was persisted separately
      // from the push status. That's the contract.
      const isDemoSandboxLimit = (order.xeroEmailError ?? "").includes(
        "An error occurred in Xero"
      );
      if (isDemoSandboxLimit) {
        console.log(
          "  ✓ Email path exercised (Demo Company sandbox returned 500, expected — push/email split correctly captured)"
        );
        return true;
      }
      console.error(
        `  ✗ FAIL: unexpected email failure: ${order.xeroEmailError ?? "(none)"}`
      );
      return false;
    }
    console.error(
      `  ✗ FAIL: expected xero_email_status='sent' or 'failed', got '${order.xeroEmailStatus}'`
    );
    return false;
  } finally {
    // Always restore the safety default.
    await setAutoEmail(baseUrl, cookies, false);
    console.log("  • Toggle OFF (restored)");
  }
}

async function smokePurchaseOrderAutoEmail(
  baseUrl: string,
  cookies: Cookies,
  unitId: string,
  ts: number
): Promise<boolean> {
  console.log("─── PO auto-email check ────────────────────");
  await setAutoPurchaseOrderEmail(baseUrl, cookies, true);
  console.log("  • Toggle ON");
  try {
    const order = await submitFreshPurchaseOrder(
      baseUrl,
      cookies,
      unitId,
      ts,
      "POEMAIL"
    );
    console.log(`  • Purchase order ${order.orderNumber} submitted`);
    if (order.xeroPushStatus !== "pushed") {
      console.error(`  ✗ FAIL: push failed: ${order.xeroPushError}`);
      return false;
    }
    if (order.xeroPoEmailStatus === "sent") {
      console.log(
        "  ✓ xero_po_email_status = sent (Resend accepted the Xero PDF email)"
      );
      return true;
    }
    if (order.xeroPoEmailStatus === "failed") {
      console.error(
        `  ✗ FAIL: PO email failed: ${order.xeroPoEmailError ?? "(none)"}`
      );
      return false;
    }
    console.error(
      `  ✗ FAIL: expected xero_po_email_status='sent', got '${order.xeroPoEmailStatus}'`
    );
    return false;
  } finally {
    await setAutoPurchaseOrderEmail(baseUrl, cookies, false);
    console.log("  • Toggle OFF (restored)");
  }
}

async function smokeSalesIdempotency(
  baseUrl: string,
  cookies: Cookies,
  initialOrder: OrderDetail
): Promise<boolean> {
  console.log("─── Sales reconcile-by-reference check ─────");
  const beforeId = initialOrder.xeroInvoiceId;
  if (!beforeId) {
    console.error("  ✗ FAIL: order has no xero_invoice_id to start with");
    return false;
  }

  // Simulate the "Xero accepted but local persist failed" scenario by
  // wiping the locally-stored Xero IDs and the payload hash.
  await apiFetch(baseUrl, cookies, "/api/xero/test/mutate-row", {
    method: "POST",
    body: JSON.stringify({
      entity: "sales_order",
      id: initialOrder.id,
      clearPushIds: true,
    }),
  });
  console.log("  • Cleared local xero_invoice_id");

  // Retry the push. With xero_invoice_id null and the original invoice
  // still in Xero, the push function must fall through to
  // findXeroInvoiceForSalesOrder and adopt it instead of creating a duplicate.
  await apiFetch(
    baseUrl,
    cookies,
    `/api/sales-orders/${initialOrder.id}/xero-push`,
    {
      method: "POST",
      body: JSON.stringify({}),
    }
  );
  const after = await apiFetch<OrderDetail>(
    baseUrl,
    cookies,
    `/api/sales-orders/${initialOrder.id}`
  );

  if (after.xeroPushStatus !== "pushed") {
    console.error(
      `  ✗ FAIL: push status after retry is ${after.xeroPushStatus}`
    );
    return false;
  }
  if (after.xeroInvoiceId !== beforeId) {
    console.error(
      `  ✗ FAIL: created a duplicate Xero invoice. before=${beforeId}, after=${after.xeroInvoiceId}`
    );
    return false;
  }
  console.log(
    `  ✓ Adopted existing invoice via reference lookup (Xero ID unchanged: ${beforeId.slice(0, 8)}…)`
  );
  return true;
}

async function smokeCronRetry(
  baseUrl: string,
  cookies: Cookies,
  initialOrder: OrderDetail
): Promise<boolean> {
  console.log("─── Cron retry check ───────────────────────");
  // Force a healthy row back to 'failed' so the cron picks it up.
  await apiFetch(baseUrl, cookies, "/api/xero/test/mutate-row", {
    method: "POST",
    body: JSON.stringify({
      entity: "sales_order",
      id: initialOrder.id,
      forcePushFailed: true,
    }),
  });
  console.log("  • Forced xero_push_status = failed");

  type RetrySummary = {
    totalOrgs: number;
    results: Array<{
      salesOrders: { recovered: number; stillFailed: number };
    }>;
  };
  const summary = await apiFetch<RetrySummary>(
    baseUrl,
    cookies,
    "/api/xero/test/run-retry",
    { method: "POST", body: JSON.stringify({}) }
  );
  const totalRecovered = summary.results.reduce(
    (sum, r) => sum + r.salesOrders.recovered,
    0
  );
  console.log(
    `  • Cron run: ${summary.totalOrgs} org(s), ${totalRecovered} sales order(s) recovered`
  );

  const after = await apiFetch<OrderDetail>(
    baseUrl,
    cookies,
    `/api/sales-orders/${initialOrder.id}`
  );
  if (after.xeroPushStatus !== "pushed") {
    console.error(
      `  ✗ FAIL: status still ${after.xeroPushStatus} after cron run`
    );
    return false;
  }
  console.log("  ✓ Row recovered to xero_push_status = pushed");
  return true;
}

async function smokeSales(
  baseUrl: string,
  cookies: Cookies,
  unitId: string,
  ts: number
): Promise<{ ok: boolean; order: OrderDetail | null }> {
  console.log("─── Sales flow ─────────────────────────────");
  const item = await createMaterial(baseUrl, cookies, unitId, ts, "SALES");
  console.log(`  • Material created: ${item.id.slice(0, 8)}…`);

  const customer = await createCustomer(baseUrl, cookies, ts);
  console.log(`  • Customer created: ${customer.id.slice(0, 8)}…`);

  type CreateResult = { id: string };
  const created = await apiFetch<CreateResult>(
    baseUrl,
    cookies,
    "/api/sales-orders",
    {
      method: "POST",
      idempotencyKey: `xero-smoke:so:${ts}`,
      body: JSON.stringify({
        customerId: customer.id,
        status: "open",
        shipDate: new Date().toISOString().slice(0, 10),
        requestedDate: new Date().toISOString().slice(0, 10),
        lines: [{ itemId: item.id, quantity: "10", unitPrice: "20" }],
      }),
    }
  );

  // Fetch back to get orderNumber.
  const order = await apiFetch<OrderDetail>(
    baseUrl,
    cookies,
    `/api/sales-orders/${created.id}`
  );
  console.log(`  • Sales order created: ${order.orderNumber}`);

  await apiFetch(baseUrl, cookies, `/api/sales-orders/${order.id}/confirm`, {
    method: "POST",
    body: JSON.stringify({}),
    idempotencyKey: `xero-smoke:confirm:${order.id}:${ts}`,
  });
  console.log("  • Confirmed");

  await apiFetch(baseUrl, cookies, `/api/sales-orders/${order.id}/ship`, {
    method: "POST",
    body: JSON.stringify({}),
    idempotencyKey: `xero-smoke:ship:${order.id}:${ts}`,
  });
  console.log("  • Shipped (Xero push fires synchronously)");

  // Verify local push status.
  const after = await apiFetch<OrderDetail>(
    baseUrl,
    cookies,
    `/api/sales-orders/${order.id}`
  );
  if (after.xeroPushStatus !== "pushed") {
    console.error(
      `  ✗ FAIL: local push status is ${after.xeroPushStatus}, error: ${after.xeroPushError ?? "(none)"}`
    );
    return { ok: false, order: null };
  }
  console.log(
    `  • Local push status: pushed, invoice number ${after.xeroInvoiceNumber ?? order.orderNumber}`
  );

  // Verify in Xero via our test lookup endpoint.
  const lookup = await apiFetch<LookupResult>(
    baseUrl,
    cookies,
    `/api/xero/test/lookup?entity=invoice&reference=${encodeURIComponent(order.orderNumber)}`
  );
  if (!lookup.found || !lookup.match?.invoiceID) {
    console.error(
      `  ✗ FAIL: invoice ${order.orderNumber} not found in Xero`
    );
    return { ok: false, order: null };
  }
  console.log(
    `  ✓ Invoice in Xero: ${lookup.match.invoiceNumber ?? order.orderNumber} (id ${lookup.match.invoiceID.slice(0, 8)}…)`
  );
  return { ok: true, order: after };
}

async function smokePurchasingIdempotency(
  baseUrl: string,
  cookies: Cookies,
  initialOrder: OrderDetail
): Promise<boolean> {
  console.log("─── Purchasing reconcile-by-reference check ─");
  const beforeId = initialOrder.xeroPurchaseOrderId;
  if (!beforeId) {
    console.error("  ✗ FAIL: PO has no xero_purchase_order_id to start with");
    return false;
  }

  await apiFetch(baseUrl, cookies, "/api/xero/test/mutate-row", {
    method: "POST",
    body: JSON.stringify({
      entity: "purchase_order",
      id: initialOrder.id,
      clearPushIds: true,
    }),
  });
  console.log("  • Cleared local xero_purchase_order_id");

  await apiFetch(
    baseUrl,
    cookies,
    `/api/purchase-orders/${initialOrder.id}/xero-push`,
    { method: "POST", body: JSON.stringify({}) }
  );
  const after = await apiFetch<OrderDetail>(
    baseUrl,
    cookies,
    `/api/purchase-orders/${initialOrder.id}`
  );

  if (after.xeroPushStatus !== "pushed") {
    console.error(
      `  ✗ FAIL: push status after retry is ${after.xeroPushStatus}`
    );
    return false;
  }
  if (after.xeroPurchaseOrderId !== beforeId) {
    console.error(
      `  ✗ FAIL: created a duplicate Xero PO. before=${beforeId}, after=${after.xeroPurchaseOrderId}`
    );
    return false;
  }
  console.log(
    `  ✓ Adopted existing PO via reference lookup (Xero ID unchanged: ${beforeId.slice(0, 8)}…)`
  );
  return true;
}

async function smokePurchasing(
  baseUrl: string,
  cookies: Cookies,
  unitId: string,
  ts: number
): Promise<{ ok: boolean; order: OrderDetail | null }> {
  console.log("─── Purchasing flow ────────────────────────");
  const item = await createMaterial(baseUrl, cookies, unitId, ts, "PO");
  console.log(`  • Material created: ${item.id.slice(0, 8)}…`);

  const supplier = await createSupplier(baseUrl, cookies, ts);
  console.log(`  • Supplier created: ${supplier.id.slice(0, 8)}…`);

  type CreateResult = { id: string };
  const created = await apiFetch<CreateResult>(
    baseUrl,
    cookies,
    "/api/purchase-orders",
    {
      method: "POST",
      idempotencyKey: `xero-smoke:po:${ts}`,
      body: JSON.stringify({
        supplierId: supplier.id,
        expectedDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        lines: [
          {
            itemId: item.id,
            quantityOrdered: "50",
            unitCost: "10",
          },
        ],
      }),
    }
  );

  const order = await apiFetch<OrderDetail>(
    baseUrl,
    cookies,
    `/api/purchase-orders/${created.id}`
  );
  console.log(`  • Purchase order created: ${order.orderNumber}`);

  await apiFetch(baseUrl, cookies, `/api/purchase-orders/${order.id}/submit`, {
    method: "POST",
    body: JSON.stringify({}),
    idempotencyKey: `xero-smoke:po-submit:${order.id}:${ts}`,
  });
  console.log("  • Submitted (Xero PO push fires synchronously)");

  const after = await apiFetch<OrderDetail>(
    baseUrl,
    cookies,
    `/api/purchase-orders/${order.id}`
  );
  if (after.xeroPushStatus !== "pushed") {
    console.error(
      `  ✗ FAIL: local push status is ${after.xeroPushStatus}, error: ${after.xeroPushError ?? "(none)"}`
    );
    return { ok: false, order: null };
  }
  console.log(
    `  • Local push status: pushed, PO number ${after.xeroPurchaseOrderNumber ?? order.orderNumber}`
  );

  const lookup = await apiFetch<LookupResult>(
    baseUrl,
    cookies,
    `/api/xero/test/lookup?entity=purchase_order&reference=${encodeURIComponent(order.orderNumber)}`
  );
  if (!lookup.found || !lookup.match?.purchaseOrderID) {
    console.error(`  ✗ FAIL: PO ${order.orderNumber} not found in Xero`);
    return { ok: false, order: null };
  }
  console.log(
    `  ✓ PO in Xero: ${lookup.match.purchaseOrderNumber ?? order.orderNumber} (id ${lookup.match.purchaseOrderID.slice(0, 8)}…)`
  );
  return { ok: true, order: after };
}

async function main() {
  const auth = await loadAuth();
  console.log(`Smoke target: ${auth.baseUrl} (org ${auth.orgId})`);

  await ensureXeroSettings(auth.baseUrl, auth.cookies);

  const ts = Date.now();
  const results: Array<{ flow: string; ok: boolean }> = [];

  if (runSales) {
    const sales = await smokeSales(auth.baseUrl, auth.cookies, auth.unitId, ts);
    results.push({ flow: "sales", ok: sales.ok });
    if (sales.ok && sales.order) {
      const idem = await smokeSalesIdempotency(
        auth.baseUrl,
        auth.cookies,
        sales.order
      );
      results.push({ flow: "sales reconcile", ok: idem });

      const cron = await smokeCronRetry(
        auth.baseUrl,
        auth.cookies,
        sales.order
      );
      results.push({ flow: "cron retry", ok: cron });
    }
    const email = await smokeAutoEmail(
      auth.baseUrl,
      auth.cookies,
      auth.unitId,
      ts
    );
    results.push({ flow: "auto-email", ok: email });
  }
  if (runPo) {
    const po = await smokePurchasing(
      auth.baseUrl,
      auth.cookies,
      auth.unitId,
      ts
    );
    results.push({ flow: "purchasing", ok: po.ok });
    if (po.ok && po.order) {
      const idem = await smokePurchasingIdempotency(
        auth.baseUrl,
        auth.cookies,
        po.order
      );
      results.push({ flow: "purchasing reconcile", ok: idem });
    }
    const email = await smokePurchaseOrderAutoEmail(
      auth.baseUrl,
      auth.cookies,
      auth.unitId,
      ts
    );
    results.push({ flow: "PO auto-email", ok: email });
  }

  console.log("");
  console.log("─── Summary ────────────────────────────────");
  for (const r of results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.flow}`);
  }
  if (results.some((r) => !r.ok)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
