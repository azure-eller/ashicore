import { and, eq } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  bomRevisionComponents,
  bomRevisions,
  customers,
  importFiles,
  importCommitRecords,
  inventoryEvents,
  items,
  onboardingSessions,
  organization,
  suppliers,
  user,
} from "../../../lib/db/schema";
import { FREE_SKU_LIMIT } from "../../../lib/billing/types";
import { getBaseUrl, getSessionCookie, testFetch } from "../../helpers/api";
import { expectResponse, uniqueName } from "./story-helpers";

type ImportPackage = {
  version: "1";
  openingStockAsOf: string;
  units: Array<{ tempId: string; name: string; size: string; uom: string }>;
  suppliers: Array<Record<string, unknown>>;
  customers: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  openingStock: Array<Record<string, unknown>>;
  boms: Array<Record<string, unknown>>;
  unresolvedQuestions: Array<Record<string, unknown>>;
};

async function createSession() {
  const onboarding = await testFetch("/api/onboarding/session", {
    method: "POST",
    body: JSON.stringify({ selectedPlan: "free", currentStep: "import" }),
  });
  expectResponse(onboarding, 200);

  const form = new FormData();
  form.append(
    "file",
    new File(["source,rows\nfixture,reviewed\n"], "reviewed-import.csv", {
      type: "text/csv",
    }),
  );

  const response = await fetch(`${getBaseUrl()}/api/onboarding/imports`, {
    method: "POST",
    headers: { Cookie: getSessionCookie() },
    body: form,
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { session: { id: string } };
  return body.session.id;
}

async function reviewAndApprove(params: {
  sessionId: string;
  includeBoms: boolean;
  pkg: ImportPackage;
}) {
  const patch = await testFetch(`/api/onboarding/imports/${params.sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({
      openingStockAsOf: params.pkg.openingStockAsOf,
      includeBoms: params.includeBoms,
      package: params.pkg,
    }),
  });
  expectResponse(patch, 200);
  const patchBody = await patch.json();
  expect(patchBody.preview.blockingIssueCount).toBe(0);

  const approve = await testFetch(
    `/api/onboarding/imports/${params.sessionId}/approve`,
    {
      method: "POST",
      body: JSON.stringify({ previewHash: patchBody.preview.hash }),
    },
  );
  expectResponse(approve, 200);
  return approve.json();
}

function productsPackage(count: number, skuPrefix: string): ImportPackage {
  return {
    version: "1",
    openingStockAsOf: "2026-06-01",
    units: [{ tempId: "unit-each", name: "Each", size: "1", uom: "ea" }],
    suppliers: [],
    customers: [],
    items: Array.from({ length: count }, (_, index) => ({
      tempId: `item-${index}`,
      itemType: "product",
      name: `${skuPrefix} Item ${index}`,
      sku: `${skuPrefix}-${index}`,
      unitRef: "unit-each",
      sellable: true,
      defaultSellingPrice: "10.00",
      lotTrackingMode: "tracked",
      match: { suggestion: "create" },
      provenance: [{ fileId: "fixture", location: `row ${index}` }],
      confidence: 1,
    })),
    openingStock: [],
    boms: [],
    unresolvedQuestions: [],
  };
}

test.describe("onboarding import operating story", () => {
  test.describe.configure({ mode: "serial" });

  const ts = Date.now();
  const supplierCode = `IMP-SUP-${ts}`;
  const materialSku = `IMP-MAT-${ts}`;
  const productSku = `IMP-PROD-${ts}`;
  let materialId: string;
  let productId: string;
  let supplierId: string;
  let customerId: string;

  test("new signup gets one MFA grace session before sign-in requires setup", async ({
    page,
    db,
  }) => {
    await page.context().clearCookies();
    const baseUrl = getBaseUrl();
    const suffix = Date.now();
    const email = `onboarding-mfa-${suffix}@example.com`;
    const password = "TestPassword123!";

    const signUp = await page.context().request.post(`${baseUrl}/api/auth/sign-up/email`, {
      data: {
        name: "Onboarding MFA",
        email,
        password,
      },
      headers: { Origin: baseUrl },
    });
    expect(signUp.status()).toBe(200);

    const [createdUser] = await db
      .select({
        id: user.id,
        mfaGraceUsed: user.mfaGraceUsed,
        twoFactorEnabled: user.twoFactorEnabled,
      })
      .from(user)
      .where(eq(user.email, email));
    expect(createdUser).toMatchObject({
      mfaGraceUsed: false,
      twoFactorEnabled: false,
    });

    await page.context().clearCookies();
    const signIn = await page.context().request.post(`${baseUrl}/api/auth/sign-in/email`, {
      data: {
        email,
        password,
      },
      headers: { Origin: baseUrl },
    });
    expect(signIn.status()).toBe(200);

    const [signedInUser] = await db
      .select({
        id: user.id,
        mfaGraceUsed: user.mfaGraceUsed,
        twoFactorEnabled: user.twoFactorEnabled,
      })
      .from(user)
      .where(eq(user.email, email));
    expect(signedInUser).toMatchObject({
      mfaGraceUsed: true,
      twoFactorEnabled: false,
    });
  });

  test("freshly-created owner reaches onboarding through the real route", async ({
    page,
  }) => {
    await page.context().clearCookies();
    const baseUrl = getBaseUrl();
    const suffix = Date.now();
    const email = `onboarding-owner-${suffix}@example.com`;
    const password = "TestPassword123!";
    const organizationName = `Onboarding Owner ${suffix}`;
    const organizationSlug = `onboarding-owner-${suffix}`;

    const signUp = await page.context().request.post(`${baseUrl}/api/auth/sign-up/email`, {
      data: {
        name: "Onboarding Owner",
        email,
        password,
      },
      headers: { Origin: baseUrl },
    });
    expect(signUp.status()).toBe(200);

    const createOrg = await page.context().request.post(
      `${baseUrl}/api/auth/organization/create`,
      {
        data: {
          name: organizationName,
          slug: organizationSlug,
        },
        headers: { Origin: baseUrl },
      },
    );
    expect(createOrg.status()).toBe(200);
    const createdOrg = await createOrg.json();
    const organizationId =
      typeof createdOrg?.id === "string" ? createdOrg.id : createdOrg?.organization?.id;
    expect(organizationId).toEqual(expect.any(String));

    const setActive = await page.context().request.post(
      `${baseUrl}/api/auth/organization/set-active`,
      {
        data: { organizationId },
        headers: { Origin: baseUrl },
      },
    );
    expect(setActive.status()).toBe(200);

    const response = await page.goto("/onboarding?plan=free");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.locator("body")).toContainText(/onboarding|import/i);
  });

  test("reviewed import creates trading partners, item cards, opening stock, and a BOM", async ({
    db,
  }) => {
    const materialName = uniqueName("Onboarding Story Material");
    const productName = uniqueName("Onboarding Story Product");
    const sessionId = await createSession();

    const [onboarding] = await db
      .select({
        importSessionId: onboardingSessions.importSessionId,
        status: onboardingSessions.status,
        currentStep: onboardingSessions.currentStep,
      })
      .from(onboardingSessions)
      .where(eq(onboardingSessions.importSessionId, sessionId));
    expect(onboarding).toMatchObject({
      importSessionId: sessionId,
      status: "importing",
      currentStep: "extract",
    });

    await reviewAndApprove({
      sessionId,
      includeBoms: true,
      pkg: {
        version: "1",
        openingStockAsOf: "2026-06-01",
        units: [
          { tempId: "unit-each", name: "Each", size: "1", uom: "ea" },
          { tempId: "unit-lb", name: "Pound", size: "1", uom: "lb" },
        ],
        suppliers: [
          {
            tempId: "supplier-main",
            name: uniqueName("Onboarding Story Supplier"),
            code: supplierCode,
            contactName: "Pat Supplier",
            email: "supplier@example.com",
            phone: "555-0101",
            match: { suggestion: "create" },
            provenance: [{ fileId: "fixture", location: "supplier row" }],
            confidence: 1,
          },
        ],
        customers: [
          {
            tempId: "customer-main",
            name: uniqueName("Onboarding Story Customer"),
            email: "buyer@example.com",
            phone: "555-0102",
            match: { suggestion: "create" },
            provenance: [{ fileId: "fixture", location: "customer row" }],
            confidence: 1,
          },
        ],
        items: [
          {
            tempId: "material-main",
            itemType: "material",
            name: materialName,
            sku: materialSku,
            unitRef: "unit-lb",
            defaultSupplierRef: "supplier-main",
            purchaseUnitRef: "unit-lb",
            purchaseToStockFactor: "1",
            defaultPurchasePrice: "3.25",
            lotTrackingMode: "tracked",
            match: { suggestion: "create" },
            provenance: [{ fileId: "fixture", location: "material row" }],
            confidence: 1,
          },
          {
            tempId: "product-main",
            itemType: "product",
            name: productName,
            sku: productSku,
            unitRef: "unit-each",
            sellable: true,
            defaultSellingPrice: "24.00",
            lotTrackingMode: "tracked",
            match: { suggestion: "create" },
            provenance: [{ fileId: "fixture", location: "product row" }],
            confidence: 1,
          },
        ],
        openingStock: [
          {
            itemRef: "material-main",
            quantity: "8",
            unitCost: "3.25",
            lotNumber: "OPENING-STORY",
            receivedAt: "2026-06-01",
            provenance: [{ fileId: "fixture", location: "stock row" }],
            confidence: 1,
          },
        ],
        boms: [
          {
            productRef: "product-main",
            outputQuantity: "1",
            outputUnitRef: "unit-each",
            components: [
              {
                itemRef: "material-main",
                quantity: "2",
                unitRef: "unit-lb",
                basis: "per_unit",
              },
            ],
            provenance: [{ fileId: "fixture", location: "bom row" }],
            confidence: 1,
          },
        ],
        unresolvedQuestions: [],
      },
    });

    const [supplier] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.code, supplierCode));
    supplierId = supplier.id;

    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, "buyer@example.com"));
    customerId = customer.id;

    const [material] = await db
      .select({ id: items.id, defaultPurchasePrice: items.defaultPurchasePrice })
      .from(items)
      .where(eq(items.sku, materialSku));
    materialId = material.id;
    expect(material.defaultPurchasePrice).toBe("3.2500");

    const [product] = await db
      .select({ id: items.id, sellable: items.sellable })
      .from(items)
      .where(eq(items.sku, productSku));
    productId = product.id;
    expect(product.sellable).toBe(true);

    const [opening] = await db
      .select({ quantity: inventoryEvents.quantity, unitCost: inventoryEvents.unitCost })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, materialId),
          eq(inventoryEvents.eventType, "opening_balance"),
        ),
      );
    expect(opening).toMatchObject({
      quantity: "8.0000",
      unitCost: "3.250000",
    });

    const [revision] = await db
      .select({
        id: bomRevisions.id,
        recipeBasis: bomRevisions.recipeBasis,
        outputQuantity: bomRevisions.outputQuantity,
      })
      .from(bomRevisions)
      .where(eq(bomRevisions.productId, productId));
    expect(revision).toMatchObject({
      recipeBasis: "unit",
      outputQuantity: "1.0000",
    });

    const [component] = await db
      .select({ componentId: bomRevisionComponents.componentId, quantity: bomRevisionComponents.quantity })
      .from(bomRevisionComponents)
      .where(eq(bomRevisionComponents.bomRevisionId, revision.id));
    expect(component).toMatchObject({
      componentId: materialId,
      quantity: "2.0000",
    });

    const records = await db
      .select({ recordType: importCommitRecords.recordType })
      .from(importCommitRecords)
      .where(eq(importCommitRecords.sessionId, sessionId));
    expect(records.map((record) => record.recordType).sort()).toContain("item");

    const files = await db
      .select({ deletedAt: importFiles.deletedAt, extractedPackage: importFiles.extractedPackage })
      .from(importFiles)
      .where(eq(importFiles.sessionId, sessionId));
    expect(files).toHaveLength(1);
    expect(files[0].deletedAt).toBeTruthy();
    expect(files[0].extractedPackage).toBeNull();
  });

  test("re-import updates matched rows and skips rows the reviewer excluded", async ({ db }) => {
    const sessionId = await createSession();
    const updatedMaterialName = uniqueName("Onboarding Story Material Updated");
    const skippedCustomerName = uniqueName("Skipped New Customer");

    await reviewAndApprove({
      sessionId,
      includeBoms: false,
      pkg: {
        version: "1",
        openingStockAsOf: "2026-06-01",
        units: [{ tempId: "unit-lb", name: "Pound", size: "1", uom: "lb" }],
        suppliers: [
          {
            tempId: "supplier-main",
            name: "Ignored Supplier Name",
            code: supplierCode,
            phone: "555-0199",
            match: { suggestion: "update" },
            provenance: [{ fileId: "fixture", location: "supplier update" }],
            confidence: 1,
          },
        ],
        customers: [
          {
            tempId: "customer-main",
            name: "Ignored Customer Name",
            email: "ignored@example.com",
            match: { suggestion: "skip", existingId: customerId },
            provenance: [{ fileId: "fixture", location: "customer skip" }],
            confidence: 1,
          },
          {
            tempId: "customer-skip-new",
            name: skippedCustomerName,
            email: "skip-new@example.com",
            match: { suggestion: "create" },
            review: { selected: false },
            provenance: [{ fileId: "fixture", location: "customer skip new" }],
            confidence: 1,
          },
        ],
        items: [
          {
            tempId: "material-main",
            itemType: "material",
            name: updatedMaterialName,
            sku: materialSku,
            unitRef: "unit-lb",
            defaultSupplierRef: "supplier-main",
            purchaseUnitRef: "unit-lb",
            purchaseToStockFactor: "1",
            defaultPurchasePrice: "4.50",
            lotTrackingMode: "tracked",
            match: { suggestion: "update" },
            provenance: [{ fileId: "fixture", location: "material update" }],
            confidence: 1,
          },
          {
            tempId: "product-main",
            itemType: "product",
            name: "Skipped Product Change",
            sku: productSku,
            unitRef: "unit-lb",
            sellable: true,
            match: { suggestion: "skip", existingId: productId },
            provenance: [{ fileId: "fixture", location: "product skip" }],
            confidence: 1,
          },
          {
            tempId: "product-skip-new",
            itemType: "product",
            name: uniqueName("Skipped New Product"),
            sku: `SKIP-PROD-${ts}`,
            unitRef: "unit-lb",
            sellable: true,
            match: { suggestion: "create" },
            review: { selected: false },
            provenance: [{ fileId: "fixture", location: "product skip new" }],
            confidence: 1,
          },
        ],
        openingStock: [
          {
            itemRef: "material-main",
            quantity: "99",
            unitCost: "9.99",
            lotNumber: "REIMPORT-SHOULD-SKIP",
            receivedAt: "2026-06-01",
            provenance: [{ fileId: "fixture", location: "opening stock skip" }],
            confidence: 1,
          },
        ],
        boms: [],
        unresolvedQuestions: [],
      },
    });

    const [supplier] = await db
      .select({ id: suppliers.id, phone: suppliers.phone })
      .from(suppliers)
      .where(eq(suppliers.code, supplierCode));
    expect(supplier).toMatchObject({ id: supplierId, phone: "555-0199" });

    const [material] = await db
      .select({
        id: items.id,
        name: items.name,
        defaultPurchasePrice: items.defaultPurchasePrice,
      })
      .from(items)
      .where(eq(items.sku, materialSku));
    expect(material).toMatchObject({
      id: materialId,
      name: updatedMaterialName,
      defaultPurchasePrice: "4.5000",
    });

    const openingEvents = await db
      .select({ id: inventoryEvents.id })
      .from(inventoryEvents)
      .where(
        and(
          eq(inventoryEvents.itemId, materialId),
          eq(inventoryEvents.eventType, "opening_balance"),
        ),
      );
    expect(openingEvents).toHaveLength(1);

    const [product] = await db
      .select({ id: items.id, name: items.name })
      .from(items)
      .where(eq(items.id, productId));
    expect(product.name).not.toBe("Skipped Product Change");

    const skippedRows = await db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.sku, `SKIP-PROD-${ts}`));
    expect(skippedRows).toHaveLength(0);

    const skippedCustomers = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.name, skippedCustomerName));
    expect(skippedCustomers).toHaveLength(0);
  });

  test("worker-completed validated import approves without a manual revalidate", async ({ db }) => {
    const sessionId = await createSession();
    const sku = `WORKER-APPROVE-${ts}`;
    const pkg: ImportPackage = {
      version: "1",
      openingStockAsOf: "2026-06-01",
      units: [{ tempId: "unit-each", name: "Each", size: "1", uom: "ea" }],
      suppliers: [],
      customers: [],
      items: [
        {
          tempId: "worker-item",
          itemType: "product",
          name: uniqueName("Worker Approved Product"),
          sku,
          unitRef: "unit-each",
          sellable: true,
          defaultSellingPrice: "12.00",
          lotTrackingMode: "tracked",
          match: { suggestion: "create" },
          provenance: [{ fileId: "worker", location: "row 1" }],
          confidence: 1,
          review: { selected: true },
        },
      ],
      openingStock: [],
      boms: [],
      unresolvedQuestions: [],
    };

    const workerSecret =
      process.env.ONBOARDING_IMPORT_CRON_SECRET ?? process.env.CRON_SECRET;
    expect(workerSecret).toBeTruthy();

    await db
      .update(importFiles)
      .set({
        extractionStatus: "extracted",
        extractedPackage: pkg,
        extractedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(importFiles.sessionId, sessionId));

    const worker = await testFetch("/api/internal/process-imports", {
      headers: { Authorization: `Bearer ${workerSecret}` },
    });
    expectResponse(worker, 200);
    const workerBody = await worker.json();
    expect(workerBody.completedSessions).toBe(1);

    const review = await testFetch(`/api/onboarding/imports/${sessionId}`);
    expectResponse(review, 200);
    const reviewBody = await review.json();
    expect(reviewBody.preview).toMatchObject({
      status: "validated",
      blockingIssueCount: 0,
    });

    const approve = await testFetch(`/api/onboarding/imports/${sessionId}/approve`, {
      method: "POST",
      body: JSON.stringify({ previewHash: reviewBody.preview.hash }),
    });
    expectResponse(approve, 200);
    const approveBody = await approve.json();
    expect(approveBody.committed).toBe(true);
    expect(approveBody.commitSummary.items).toBe(1);

    const [created] = await db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.sku, sku));
    expect(created?.id).toBeTruthy();
  });

  test("paid intent holds commit until payment; free intent enforces the SKU cap", async ({
    page,
    db,
  }) => {
    const baseUrl = getBaseUrl();
    const req = page.context().request;
    const suffix = Date.now();
    const headers = { Origin: baseUrl };
    const password = "TestPassword123!";

    async function freshOrg(label: string) {
      await page.context().clearCookies();
      const email = `onb-${label}-${suffix}@example.com`;
      const signUp = await req.post(`${baseUrl}/api/auth/sign-up/email`, {
        data: { name: label, email, password },
        headers,
      });
      expect(signUp.status()).toBe(200);
      const createOrg = await req.post(`${baseUrl}/api/auth/organization/create`, {
        data: { name: `${label} ${suffix}`, slug: `${label}-${suffix}` },
        headers,
      });
      expect(createOrg.status()).toBe(200);
      const created = await createOrg.json();
      const organizationId =
        typeof created?.id === "string" ? created.id : created?.organization?.id;
      const setActive = await req.post(`${baseUrl}/api/auth/organization/set-active`, {
        data: { organizationId },
        headers,
      });
      expect(setActive.status()).toBe(200);
      return organizationId as string;
    }

    async function uploadImport(selectedPlan: "free" | "paid") {
      const session = await req.post(`${baseUrl}/api/onboarding/session`, {
        data: { selectedPlan, currentStep: "import" },
        headers,
      });
      expect(session.status()).toBe(200);
      const upload = await req.post(`${baseUrl}/api/onboarding/imports`, {
        multipart: {
          file: {
            name: "import.csv",
            mimeType: "text/csv",
            buffer: Buffer.from("source,rows\nfixture,reviewed\n"),
          },
        },
      });
      expect(upload.status()).toBe(201);
      return (await upload.json()).session.id as string;
    }

    function patchPackage(sessionId: string, pkg: ImportPackage) {
      return req.fetch(`${baseUrl}/api/onboarding/imports/${sessionId}`, {
        method: "PATCH",
        headers,
        data: { openingStockAsOf: pkg.openingStockAsOf, includeBoms: false, package: pkg },
      });
    }

    // Free intent over the cap is surfaced as a blocking SKU-limit issue at review.
    await freshOrg("freecap");
    const freeSession = await uploadImport("free");
    const overCap = await patchPackage(
      freeSession,
      productsPackage(FREE_SKU_LIMIT + 1, `FCAP-${suffix}`),
    );
    expect(overCap.status()).toBe(200);
    const overBody = await overCap.json();
    expect(
      overBody.preview.issues.some((issue: { message: string }) =>
        /SKU limit/i.test(issue.message),
      ),
    ).toBe(true);
    expect(overBody.preview.blockingIssueCount).toBeGreaterThan(0);

    // Paid intent: nothing commits until the org is actually paid.
    const paidOrg = await freshOrg("paidcommit");
    const paidSession = await uploadImport("paid");
    const cleanPkg = productsPackage(1, `PCAP-${suffix}`);
    const patched = await patchPackage(paidSession, cleanPkg);
    expect(patched.status()).toBe(200);
    const patchedBody = await patched.json();
    expect(patchedBody.preview.blockingIssueCount).toBe(0);

    // Approve is refused before payment (nothing is written to the DB).
    const earlyApprove = await req.post(
      `${baseUrl}/api/onboarding/imports/${paidSession}/approve`,
      { headers, data: { previewHash: patchedBody.preview.hash } },
    );
    expect(earlyApprove.status()).toBe(402);

    // Once payment lands (simulated by flipping the org to core), finalize commits.
    await db
      .update(organization)
      .set({ plan: "core", status: "active" })
      .where(eq(organization.id, paidOrg));

    const finalize = await req.post(
      `${baseUrl}/api/onboarding/imports/${paidSession}/finalize`,
      { headers, data: {} },
    );
    expect(finalize.status()).toBe(200);
    const finalizeBody = await finalize.json();
    expect(finalizeBody.committed).toBe(true);
    expect(finalizeBody.commitSummary.items).toBe(1);
  });
});
