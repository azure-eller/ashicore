/**
 * Live QuickBooks Online smoke test against the connected sandbox company.
 *
 * Prereqs:
 *   - `AGENT_DEV_PORT=3000 pnpm boot`
 *   - test/.test-env.json present
 *   - test org connected to QuickBooks sandbox
 *
 * Usage:
 *   pnpm quickbooks:smoke
 */

import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

const SMOKE_REQUEST_TIMEOUT_MS = 120_000;

type Cookies = string;
type ApiOptions = RequestInit & { idempotencyKey?: string };

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
    signal: rest.signal ?? AbortSignal.timeout(SMOKE_REQUEST_TIMEOUT_MS),
    headers: { ...headers, ...Object.fromEntries(new Headers(optionHeaders)) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} -> ${res.status}: ${
        text.slice(0, 500) || "(empty)"
      }`
    );
  }
  return JSON.parse(text || "null") as T;
}

async function rawAppFetch(
  baseUrl: string,
  cookies: Cookies,
  path: string,
  options: RequestInit = {}
) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    redirect: "manual",
    signal: options.signal ?? AbortSignal.timeout(SMOKE_REQUEST_TIMEOUT_MS),
    headers: {
      Cookie: cookies,
      Origin: baseUrl,
      ...options.headers,
    },
  });
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

type Account = {
  code: string;
  name: string;
  type: string | null;
  class: string | null;
};

type AccountingSettings = {
  provider: string;
  tenantId: string;
  tenantName: string;
  tokenExpiresAt: string;
  defaultAccountCode: string | null;
  purchaseOrderDefaultAccountCode: string | null;
};

async function pickAccounts(baseUrl: string, cookies: Cookies) {
  const { accounts } = await apiFetch<{ accounts: Account[] }>(
    baseUrl,
    cookies,
    "/api/accounting/connections/quickbooks/accounts"
  );
  const sales =
    accounts.find((account) => account.type === "Income") ??
    accounts.find((account) => account.class === "Revenue");
  const purchase =
    accounts.find((account) => account.type === "Expense") ??
    accounts.find((account) => account.type === "Cost of Goods Sold") ??
    accounts.find((account) => account.class === "Expense");

  if (!sales) throw new Error("No QuickBooks income account found.");
  if (!purchase) throw new Error("No QuickBooks expense account found.");
  return { sales, purchase };
}

async function ensureQuickBooksSettings(baseUrl: string, cookies: Cookies) {
  const picks = await pickAccounts(baseUrl, cookies);
  const settings = await apiFetch<AccountingSettings>(
    baseUrl,
    cookies,
    "/api/accounting/connections/quickbooks/settings",
    {
      method: "PUT",
      body: JSON.stringify({
        defaultAccountCode: picks.sales.code,
        purchaseOrderDefaultAccountCode: picks.purchase.code,
      }),
    }
  );
  if (settings.provider !== "quickbooks") {
    throw new Error(`Expected QuickBooks settings, got ${settings.provider}.`);
  }
  if (settings.defaultAccountCode !== picks.sales.code) {
    throw new Error("QuickBooks sales default account did not persist.");
  }
  if (settings.purchaseOrderDefaultAccountCode !== picks.purchase.code) {
    throw new Error("QuickBooks purchase default account did not persist.");
  }
  console.log(
    `QuickBooks defaults applied: sales=${picks.sales.name}, purchase=${picks.purchase.name}`
  );
  return picks;
}

async function verifyQuickBooksOAuthAppRoutes(baseUrl: string, cookies: Cookies) {
  const connect = await rawAppFetch(
    baseUrl,
    cookies,
    "/api/quickbooks/connect"
  );
  if (connect.status !== 307) {
    throw new Error(`QuickBooks connect returned ${connect.status}, expected 307.`);
  }
  const location = connect.headers.get("location");
  if (!location) {
    throw new Error("QuickBooks connect did not return an Intuit redirect.");
  }
  const authUrl = new URL(location);
  if (authUrl.hostname !== "appcenter.intuit.com") {
    throw new Error(`QuickBooks connect redirected to ${authUrl.hostname}.`);
  }
  if (authUrl.searchParams.get("client_id") !== process.env.QUICKBOOKS_CLIENT_ID) {
    throw new Error("QuickBooks connect redirect used the wrong client id.");
  }
  if (
    authUrl.searchParams.get("redirect_uri") !==
    process.env.QUICKBOOKS_REDIRECT_URI
  ) {
    throw new Error("QuickBooks connect redirect used the wrong callback URI.");
  }
  if (
    authUrl.searchParams.get("scope") !==
    "com.intuit.quickbooks.accounting"
  ) {
    throw new Error("QuickBooks connect redirect used the wrong OAuth scope.");
  }
  if (!authUrl.searchParams.get("state")) {
    throw new Error("QuickBooks connect redirect did not include OAuth state.");
  }
  if (!connect.headers.get("set-cookie")?.includes("quickbooks_oauth_state=")) {
    throw new Error("QuickBooks connect did not set the OAuth state cookie.");
  }

  const mismatch = await rawAppFetch(
    baseUrl,
    cookies,
    "/api/quickbooks/callback?state=wrong&code=dummy&realmId=dummy"
  );
  if (mismatch.status !== 307) {
    throw new Error(`QuickBooks callback mismatch returned ${mismatch.status}, expected 307.`);
  }
  const mismatchLocation = mismatch.headers.get("location") ?? "";
  if (!mismatchLocation.includes("error=quickbooks_state_mismatch")) {
    throw new Error("QuickBooks callback did not reject mismatched OAuth state.");
  }
  console.log("  ✓ QuickBooks OAuth app routes verified");
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
    idempotencyKey: `qb-smoke:item:${suffix}:${ts}`,
    body: JSON.stringify({
      itemType: "material",
      name: `TEST-QB-${suffix}-${ts}`,
      sku: `TEST-QB-${suffix}-${ts}`,
      category: "Test",
      description: `QuickBooks smoke-test material ${suffix}`,
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

async function createCustomer(
  baseUrl: string,
  cookies: Cookies,
  ts: number,
  overrides: { name?: string; email?: string } = {}
) {
  type Customer = { id: string };
  return apiFetch<Customer>(baseUrl, cookies, "/api/customers", {
    method: "POST",
    idempotencyKey: `qb-smoke:customer:${ts}`,
    body: JSON.stringify({
      name: overrides.name ?? `TEST-QB-CUST-${ts}`,
      email: overrides.email ?? `test+qb-${ts}@example.com`,
      billingLine1: "1 Test Street",
      billingCity: "Testville",
      billingPostcode: "12345",
      billingCountry: "US",
    }),
  });
}

async function createSupplier(
  baseUrl: string,
  cookies: Cookies,
  ts: number,
  overrides: { name?: string; email?: string } = {}
) {
  type Supplier = { id: string };
  return apiFetch<Supplier>(baseUrl, cookies, "/api/suppliers", {
    method: "POST",
    idempotencyKey: `qb-smoke:supplier:${ts}`,
    body: JSON.stringify({
      name: overrides.name ?? `TEST-QB-SUP-${ts}`,
      email: overrides.email ?? `test+qb-sup-${ts}@example.com`,
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
  purchaseBillExternalId?: string | null;
  purchaseBillExternalNumber?: string | null;
  purchaseBillStatus?: string | null;
  purchaseBillError?: string | null;
};

async function createSalesOrder(
  baseUrl: string,
  cookies: Cookies,
  unitId: string,
  ts: number,
  customerOverrides: { name?: string; email?: string } = {}
) {
  const item = await createMaterial(baseUrl, cookies, unitId, ts, "SALES");
  const customer = await createCustomer(baseUrl, cookies, ts, customerOverrides);
  const created = await apiFetch<{ id: string }>(
    baseUrl,
    cookies,
    "/api/sales-orders",
    {
      method: "POST",
      idempotencyKey: `qb-smoke:so:${ts}`,
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
    idempotencyKey: `qb-smoke:confirm:${created.id}:${ts}`,
  });
  return apiFetch<OrderDetail>(
    baseUrl,
    cookies,
    `/api/sales-orders/${created.id}`
  );
}

async function createPurchaseOrder(
  baseUrl: string,
  cookies: Cookies,
  unitId: string,
  ts: number,
  supplierOverrides: { name?: string; email?: string } = {}
) {
  const item = await createMaterial(baseUrl, cookies, unitId, ts, "PO");
  const supplier = await createSupplier(baseUrl, cookies, ts, supplierOverrides);
  const created = await apiFetch<{ id: string }>(
    baseUrl,
    cookies,
    "/api/purchase-orders",
    {
      method: "POST",
      idempotencyKey: `qb-smoke:po:${ts}`,
      body: JSON.stringify({
        supplierId: supplier.id,
        expectedDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        lines: [{ itemId: item.id, quantityOrdered: "50", unitCost: "10" }],
      }),
    }
  );
  await apiFetch(baseUrl, cookies, `/api/purchase-orders/${created.id}/submit`, {
    method: "POST",
    body: JSON.stringify({}),
    idempotencyKey: `qb-smoke:po-submit:${created.id}:${ts}`,
  });
  return apiFetch<OrderDetail>(
    baseUrl,
    cookies,
    `/api/purchase-orders/${created.id}`
  );
}

function getQuickBooksApiBaseUrl() {
  return process.env.QUICKBOOKS_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

async function getQuickBooksSmokeConnection(orgId: string) {
  const [{ and, eq }, { decryptXeroToken }, { integrationConnections }, { withOrgContext }] =
    await Promise.all([
      import("drizzle-orm"),
      import("@/lib/xero/token-crypto"),
      import("@/lib/db/schema"),
      import("@/lib/db/with-org-context"),
    ]);
  return withOrgContext(orgId, async (tx) => {
    const [connection] = await tx
      .select({
        accessTokenCiphertext: integrationConnections.accessTokenCiphertext,
        realmId: integrationConnections.tenantId,
        tokenEncryptionKeyId: integrationConnections.tokenEncryptionKeyId,
        tokenExpiresAt: integrationConnections.tokenExpiresAt,
      })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, "quickbooks")
        )
      );
    if (!connection) {
      throw new Error("QuickBooks is not connected for this organization.");
    }
    return {
      accessToken: decryptXeroToken(
        connection.accessTokenCiphertext,
        connection.tokenEncryptionKeyId
      ),
      realmId: connection.realmId,
      tokenExpiresAt: connection.tokenExpiresAt,
    };
  });
}

async function forceQuickBooksAccessTokenExpiry(orgId: string) {
  const [{ and, eq }, { integrationConnections }, { withOrgContext }] =
    await Promise.all([
      import("drizzle-orm"),
      import("@/lib/db/schema"),
      import("@/lib/db/with-org-context"),
    ]);
  const expiredAt = new Date(Date.now() - 60 * 1000);
  await withOrgContext(orgId, async (tx) => {
    await tx
      .update(integrationConnections)
      .set({ tokenExpiresAt: expiredAt, updatedAt: new Date() })
      .where(
        and(
          eq(integrationConnections.organizationId, orgId),
          eq(integrationConnections.provider, "quickbooks")
        )
      );
  });
  return expiredAt;
}

async function getQuickBooksSyncPayload(params: {
  orgId: string;
  documentType: "sales_order" | "purchase_bill";
  documentId: string;
}) {
  const [{ and, eq }, { accountingDocumentSyncs }, { withOrgContext }] =
    await Promise.all([
      import("drizzle-orm"),
      import("@/lib/db/schema"),
      import("@/lib/db/with-org-context"),
    ]);
  return withOrgContext(params.orgId, async (tx) => {
    const [sync] = await tx
      .select({ payload: accountingDocumentSyncs.pushPayloadSnapshot })
      .from(accountingDocumentSyncs)
      .where(
        and(
          eq(accountingDocumentSyncs.organizationId, params.orgId),
          eq(accountingDocumentSyncs.provider, "quickbooks"),
          eq(accountingDocumentSyncs.documentType, params.documentType),
          eq(accountingDocumentSyncs.documentId, params.documentId)
        )
      );
    return (sync?.payload ?? null) as Record<string, unknown> | null;
  });
}

async function quickBooksQuery<T>(orgId: string, query: string) {
  return quickBooksDirectRequest<T>(
    orgId,
    `/query?query=${encodeURIComponent(query)}`
  );
}

async function quickBooksDirectRequest<T>(
  orgId: string,
  endpoint: string,
  init: RequestInit = {}
) {
  const connection = await getQuickBooksSmokeConnection(orgId);
  const response = await fetch(
    `${getQuickBooksApiBaseUrl()}/v3/company/${connection.realmId}${endpoint}`,
    {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(SMOKE_REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${connection.accessToken}`,
        ...init.headers,
      },
    }
  );
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      body?.Fault?.Error?.[0]?.Message ??
        body?.Fault?.Error?.[0]?.Detail ??
        `QuickBooks query failed with ${response.status}.`
    );
  }
  return body as T;
}

async function createQuickBooksCustomer(orgId: string, ts: number) {
  const email = `test+qb-existing-cust-${ts}@example.com`;
  const body = await quickBooksDirectRequest<{
    Customer?: { Id?: string; DisplayName?: string };
  }>(orgId, "/customer", {
    method: "POST",
    body: JSON.stringify({
      DisplayName: `TEST-QB-EXISTING-CUST-${ts}`,
      PrimaryEmailAddr: { Address: email },
    }),
  });
  if (!body.Customer?.Id) {
    throw new Error("QuickBooks did not return an existing customer id.");
  }
  return {
    id: body.Customer.Id,
    name: body.Customer.DisplayName ?? `TEST-QB-EXISTING-CUST-${ts}`,
    email,
  };
}

async function createQuickBooksVendor(orgId: string, ts: number) {
  const email = `test+qb-existing-vendor-${ts}@example.com`;
  const body = await quickBooksDirectRequest<{
    Vendor?: { Id?: string; DisplayName?: string };
  }>(orgId, "/vendor", {
    method: "POST",
    body: JSON.stringify({
      DisplayName: `TEST-QB-EXISTING-VENDOR-${ts}`,
      PrimaryEmailAddr: { Address: email },
    }),
  });
  if (!body.Vendor?.Id) {
    throw new Error("QuickBooks did not return an existing vendor id.");
  }
  return {
    id: body.Vendor.Id,
    name: body.Vendor.DisplayName ?? `TEST-QB-EXISTING-VENDOR-${ts}`,
    email,
  };
}

async function createQuickBooksServiceItem(
  orgId: string,
  params: { name: string; sku: string; incomeAccountCode: string }
) {
  const body = await quickBooksDirectRequest<{
    Item?: { Id?: string; Name?: string };
  }>(orgId, "/item", {
    method: "POST",
    body: JSON.stringify({
      Name: params.name,
      Sku: params.sku,
      Description: params.name,
      Type: "Service",
      IncomeAccountRef: { value: params.incomeAccountCode },
      TrackQtyOnHand: false,
    }),
  });
  if (!body.Item?.Id) {
    throw new Error("QuickBooks did not return a service item id.");
  }
  return {
    id: body.Item.Id,
    name: body.Item.Name ?? params.name,
  };
}

async function createQuickBooksInvoice(
  orgId: string,
  params: {
    docNumber: string;
    customerRef: { id: string; name: string };
    itemRef: { id: string; name: string };
  }
) {
  const body = await quickBooksDirectRequest<{
    Invoice?: { Id?: string; DocNumber?: string };
  }>(orgId, "/invoice", {
    method: "POST",
    body: JSON.stringify({
      DocNumber: params.docNumber,
      TxnDate: new Date().toISOString().slice(0, 10),
      CustomerRef: {
        value: params.customerRef.id,
        name: params.customerRef.name,
      },
      PrivateNote: params.docNumber,
      GlobalTaxCalculation: "NotApplicable",
      Line: [
        {
          DetailType: "SalesItemLineDetail",
          Description: params.itemRef.name,
          Amount: 200,
          SalesItemLineDetail: {
            ItemRef: {
              value: params.itemRef.id,
              name: params.itemRef.name,
            },
            Qty: 10,
            UnitPrice: 20,
            TaxCodeRef: { value: "NON" },
          },
        },
      ],
    }),
  });
  if (!body.Invoice?.Id) {
    throw new Error("QuickBooks did not return an invoice id.");
  }
  return {
    id: body.Invoice.Id,
    number: body.Invoice.DocNumber ?? params.docNumber,
  };
}

async function createQuickBooksBill(
  orgId: string,
  params: {
    docNumber: string;
    purchaseOrderNumber: string;
    vendorRef: { id: string; name: string };
    accountCode: string;
    lineDescription: string;
  }
) {
  const body = await quickBooksDirectRequest<{
    Bill?: { Id?: string; DocNumber?: string };
  }>(orgId, "/bill", {
    method: "POST",
    body: JSON.stringify({
      DocNumber: params.docNumber,
      TxnDate: new Date().toISOString().slice(0, 10),
      VendorRef: {
        value: params.vendorRef.id,
        name: params.vendorRef.name,
      },
      PrivateNote: params.purchaseOrderNumber,
      Line: [
        {
          DetailType: "AccountBasedExpenseLineDetail",
          Description: params.lineDescription,
          Amount: 500,
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: params.accountCode },
          },
        },
      ],
    }),
  });
  if (!body.Bill?.Id) {
    throw new Error("QuickBooks did not return a bill id.");
  }
  return {
    id: body.Bill.Id,
    number: body.Bill.DocNumber ?? params.docNumber,
  };
}

function qbString(value: string) {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

async function countInvoices(orgId: string, docNumber: string) {
  const data = await quickBooksQuery<{
    QueryResponse?: {
      Invoice?: Array<{
        Id?: string;
        DocNumber?: string;
        PrivateNote?: string;
        CustomerRef?: { value?: string; name?: string };
        Line?: Array<{
          DetailType?: string;
          Description?: string;
          Amount?: number;
          SalesItemLineDetail?: {
            ItemRef?: { value?: string; name?: string };
            Qty?: number;
            UnitPrice?: number;
          };
        }>;
      }>;
    };
  }>(
    orgId,
    `select * from Invoice where DocNumber = ${qbString(docNumber)}`
  );
  return data.QueryResponse?.Invoice ?? [];
}

async function countBills(orgId: string, docNumber: string) {
  const data = await quickBooksQuery<{
    QueryResponse?: {
      Bill?: Array<{
        Id?: string;
        DocNumber?: string;
        PrivateNote?: string;
        TxnDate?: string;
        VendorRef?: { value?: string; name?: string };
        Line?: Array<{
          DetailType?: string;
          Description?: string;
          Amount?: number;
          AccountBasedExpenseLineDetail?: {
            AccountRef?: { value?: string; name?: string };
          };
          Qty?: number;
          UnitPrice?: number;
        }>;
      }>;
    };
  }>(orgId, `select * from Bill where DocNumber = ${qbString(docNumber)}`);
  return data.QueryResponse?.Bill ?? [];
}

async function main() {
  const auth = await loadAuth();
  const ts = Date.now();
  console.log("─── OAuth app routes ───────────────────────");
  await verifyQuickBooksOAuthAppRoutes(auth.baseUrl, auth.cookies);

  const accounts = await ensureQuickBooksSettings(auth.baseUrl, auth.cookies);

  console.log("─── Connection refresh ─────────────────────");
  const expiredAt = await forceQuickBooksAccessTokenExpiry(auth.orgId);
  const refreshedAccounts = await pickAccounts(auth.baseUrl, auth.cookies);
  const refreshedConnection = await getQuickBooksSmokeConnection(auth.orgId);
  if (refreshedConnection.tokenExpiresAt <= expiredAt) {
    throw new Error("QuickBooks access token expiry was not refreshed.");
  }
  if (!refreshedAccounts.sales || !refreshedAccounts.purchase) {
    throw new Error("QuickBooks accounts were not available after token refresh.");
  }
  console.log("  ✓ QuickBooks token refresh verified");

  console.log("─── Sales invoice ──────────────────────────");
  const existingCustomer = await createQuickBooksCustomer(auth.orgId, ts);
  const salesOrder = await createSalesOrder(
    auth.baseUrl,
    auth.cookies,
    auth.unitId,
    ts,
    {
      name: `TEST-QB-ERP-CUST-${ts}`,
      email: existingCustomer.email,
    }
  );
  console.log(`  • Sales order created: ${salesOrder.orderNumber}`);
  await apiFetch(
    auth.baseUrl,
    auth.cookies,
    `/api/sales-orders/${salesOrder.id}/accounting-push`,
    { method: "POST", body: JSON.stringify({}) }
  );
  const afterSales = await apiFetch<OrderDetail>(
    auth.baseUrl,
    auth.cookies,
    `/api/sales-orders/${salesOrder.id}`
  );
  if (afterSales.xeroPushStatus !== "pushed" || !afterSales.xeroInvoiceId) {
    throw new Error(
      `Sales invoice was not pushed. status=${afterSales.xeroPushStatus}, error=${afterSales.xeroPushError}`
    );
  }
  const invoicesBeforeRetry = await countInvoices(auth.orgId, salesOrder.orderNumber);
  if (invoicesBeforeRetry.length !== 1) {
    throw new Error(`Expected 1 QuickBooks invoice, found ${invoicesBeforeRetry.length}.`);
  }
  const invoice = invoicesBeforeRetry[0];
  if (invoice.PrivateNote !== salesOrder.orderNumber) {
    throw new Error("QuickBooks invoice memo does not match the sales order number.");
  }
  const invoicePayload = await getQuickBooksSyncPayload({
    orgId: auth.orgId,
    documentType: "sales_order",
    documentId: salesOrder.id,
  });
  if (!invoicePayload || "DueDate" in invoicePayload) {
    throw new Error("ERP invoice payload should let QuickBooks own due date and payment terms.");
  }
  if (invoice.CustomerRef?.value !== existingCustomer.id) {
    throw new Error("QuickBooks invoice did not reuse the existing customer matched by email.");
  }
  const invoiceLine = invoice.Line?.find(
    (line) => line.DetailType === "SalesItemLineDetail"
  );
  if (
    invoiceLine?.SalesItemLineDetail?.Qty !== 10 ||
    invoiceLine.SalesItemLineDetail.UnitPrice !== 20 ||
    invoiceLine.Amount !== 200
  ) {
    throw new Error("QuickBooks invoice line quantity/rate/amount did not match the sales order.");
  }
  if (
    invoiceLine?.SalesItemLineDetail?.ItemRef?.name !==
    `TEST-QB-SALES-${ts}`
  ) {
    throw new Error("QuickBooks invoice line item was not matched by ERP SKU.");
  }
  await apiFetch(
    auth.baseUrl,
    auth.cookies,
    `/api/sales-orders/${salesOrder.id}/accounting-push`,
    { method: "POST", body: JSON.stringify({}) }
  );
  const invoicesAfterRetry = await countInvoices(auth.orgId, salesOrder.orderNumber);
  if (invoicesAfterRetry.length !== 1) {
    throw new Error(`Invoice retry created duplicates (${invoicesAfterRetry.length}).`);
  }
  console.log(`  ✓ QuickBooks invoice verified: ${salesOrder.orderNumber}`);

  console.log("─── Sales invoice adoption ─────────────────");
  const adoptionCustomer = await createQuickBooksCustomer(auth.orgId, ts + 2);
  const adoptionSalesOrder = await createSalesOrder(
    auth.baseUrl,
    auth.cookies,
    auth.unitId,
    ts + 2,
    {
      name: `TEST-QB-ERP-CUST-${ts + 2}`,
      email: adoptionCustomer.email,
    }
  );
  const adoptionItem = await createQuickBooksServiceItem(auth.orgId, {
    name: `TEST-QB-SALES-${ts + 2}`,
    sku: `TEST-QB-SALES-${ts + 2}`,
    incomeAccountCode: accounts.sales.code,
  });
  const preexistingInvoice = await createQuickBooksInvoice(auth.orgId, {
    docNumber: adoptionSalesOrder.orderNumber,
    customerRef: adoptionCustomer,
    itemRef: adoptionItem,
  });
  await apiFetch(
    auth.baseUrl,
    auth.cookies,
    `/api/sales-orders/${adoptionSalesOrder.id}/accounting-push`,
    { method: "POST", body: JSON.stringify({}) }
  );
  const afterAdoptedSales = await apiFetch<OrderDetail>(
    auth.baseUrl,
    auth.cookies,
    `/api/sales-orders/${adoptionSalesOrder.id}`
  );
  if (afterAdoptedSales.xeroInvoiceId !== preexistingInvoice.id) {
    throw new Error("ERP did not adopt the pre-existing QuickBooks invoice.");
  }
  const adoptedInvoices = await countInvoices(
    auth.orgId,
    adoptionSalesOrder.orderNumber
  );
  if (adoptedInvoices.length !== 1) {
    throw new Error(`Invoice adoption created duplicates (${adoptedInvoices.length}).`);
  }
  console.log(`  ✓ Existing QuickBooks invoice adopted: ${preexistingInvoice.number}`);

  console.log("─── Purchase bill ──────────────────────────");
  const existingVendor = await createQuickBooksVendor(auth.orgId, ts);
  const purchaseOrder = await createPurchaseOrder(
    auth.baseUrl,
    auth.cookies,
    auth.unitId,
    ts + 1,
    {
      name: `TEST-QB-ERP-SUP-${ts}`,
      email: existingVendor.email,
    }
  );
  const billNumber = `QBB-${String(ts).slice(-12)}`;
  await apiFetch(
    auth.baseUrl,
    auth.cookies,
    `/api/purchase-orders/${purchaseOrder.id}/accounting-bill`,
    {
      method: "POST",
      idempotencyKey: `qb-smoke:bill:${purchaseOrder.id}:${ts}`,
      body: JSON.stringify({
        invoiceNumber: billNumber,
        billDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date().toISOString().slice(0, 10),
        reference: purchaseOrder.orderNumber,
        accountingPurchaseAccountCode: accounts.purchase.code,
        confirmAdditionalCostsOmitted: true,
      }),
    }
  );
  const afterPo = await apiFetch<OrderDetail>(
    auth.baseUrl,
    auth.cookies,
    `/api/purchase-orders/${purchaseOrder.id}`
  );
  if (afterPo.purchaseBillStatus !== "pushed" || !afterPo.purchaseBillExternalId) {
    throw new Error(
      `Purchase bill was not pushed. status=${afterPo.purchaseBillStatus}, error=${afterPo.purchaseBillError}`
    );
  }
  const billsBeforeRetry = await countBills(auth.orgId, billNumber);
  if (billsBeforeRetry.length !== 1) {
    throw new Error(`Expected 1 QuickBooks bill, found ${billsBeforeRetry.length}.`);
  }
  const bill = billsBeforeRetry[0];
  if (bill.PrivateNote !== purchaseOrder.orderNumber) {
    throw new Error("QuickBooks bill memo does not match the purchase order number.");
  }
  if (bill.VendorRef?.value !== existingVendor.id) {
    throw new Error("QuickBooks bill did not reuse the existing vendor matched by email.");
  }
  if (bill.TxnDate !== new Date().toISOString().slice(0, 10)) {
    throw new Error("QuickBooks bill date does not match the purchase order created date.");
  }
  const billLine = bill.Line?.find(
    (line) => line.DetailType === "AccountBasedExpenseLineDetail"
  );
  if (
    billLine?.Description !== `TEST-QB-PO-${ts + 1} (TEST-QB-PO-${ts + 1})` ||
    billLine.Amount !== 500 ||
    !billLine.AccountBasedExpenseLineDetail?.AccountRef?.value ||
    billLine.Qty != null ||
    billLine.UnitPrice != null
  ) {
    throw new Error("QuickBooks bill line fields did not match Katana-style PO bill mapping.");
  }
  await apiFetch(
    auth.baseUrl,
    auth.cookies,
    `/api/purchase-orders/${purchaseOrder.id}/accounting-bill`,
    {
      method: "POST",
      idempotencyKey: `qb-smoke:bill-retry:${purchaseOrder.id}:${ts}`,
      body: JSON.stringify({
        invoiceNumber: billNumber,
        billDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date().toISOString().slice(0, 10),
        reference: purchaseOrder.orderNumber,
        accountingPurchaseAccountCode: accounts.purchase.code,
        confirmAdditionalCostsOmitted: true,
      }),
    }
  );
  const billsAfterRetry = await countBills(auth.orgId, billNumber);
  if (billsAfterRetry.length !== 1) {
    throw new Error(`Bill retry created duplicates (${billsAfterRetry.length}).`);
  }
  console.log(`  ✓ QuickBooks bill verified: ${billNumber}`);

  console.log("─── Purchase bill adoption ─────────────────");
  const adoptionVendor = await createQuickBooksVendor(auth.orgId, ts + 3);
  const adoptionPurchaseOrder = await createPurchaseOrder(
    auth.baseUrl,
    auth.cookies,
    auth.unitId,
    ts + 3,
    {
      name: `TEST-QB-ERP-SUP-${ts + 3}`,
      email: adoptionVendor.email,
    }
  );
  const adoptionBillNumber = `QBA-${String(ts).slice(-12)}`;
  const preexistingBill = await createQuickBooksBill(auth.orgId, {
    docNumber: adoptionBillNumber,
    purchaseOrderNumber: adoptionPurchaseOrder.orderNumber,
    vendorRef: adoptionVendor,
    accountCode: accounts.purchase.code,
    lineDescription: `TEST-QB-PO-${ts + 3} (TEST-QB-PO-${ts + 3})`,
  });
  await apiFetch(
    auth.baseUrl,
    auth.cookies,
    `/api/purchase-orders/${adoptionPurchaseOrder.id}/accounting-bill`,
    {
      method: "POST",
      idempotencyKey: `qb-smoke:bill-adopt:${adoptionPurchaseOrder.id}:${ts}`,
      body: JSON.stringify({
        invoiceNumber: adoptionBillNumber,
        billDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date().toISOString().slice(0, 10),
        reference: adoptionPurchaseOrder.orderNumber,
        accountingPurchaseAccountCode: accounts.purchase.code,
        confirmAdditionalCostsOmitted: true,
      }),
    }
  );
  const afterAdoptedPo = await apiFetch<OrderDetail>(
    auth.baseUrl,
    auth.cookies,
    `/api/purchase-orders/${adoptionPurchaseOrder.id}`
  );
  if (afterAdoptedPo.purchaseBillExternalId !== preexistingBill.id) {
    throw new Error("ERP did not adopt the pre-existing QuickBooks bill.");
  }
  const adoptedBills = await countBills(auth.orgId, adoptionBillNumber);
  if (adoptedBills.length !== 1) {
    throw new Error(`Bill adoption created duplicates (${adoptedBills.length}).`);
  }
  console.log(`  ✓ Existing QuickBooks bill adopted: ${preexistingBill.number}`);

  console.log("");
  console.log("QuickBooks smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
