/**
 * Seeds the "Riverstone Coffee Roasters" documentation demo org (slug docs-demo)
 * and drives a spread of purchase orders through their statuses, so the docs
 * screenshot pass has clean, deterministic data to capture.
 *
 * Catalog/suppliers/opening-stock go through the loader engine (which routes
 * stock through the inventory kernel). Purchase orders go through the canonical
 * REST API exactly as the app and mobile do — no direct table writes.
 *
 *   ERP_ALLOW_UNSAFE_WORKTREE=1 tsx scripts/seed-docs-demo.ts
 *
 * Requires a running dev server (pnpm boot writes .tmp/agent-session.json).
 */
import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const SESSION_PATH = ".tmp/agent-session.json";
const OUT_PATH = ".tmp/docs-demo-env.json";
const ORG_SLUG = "docs-demo";
const ORG_NAME = "Riverstone Coffee Roasters";
const EMAIL = process.env.TEST_EMAIL ?? "test@test.com";
const PASSWORD = process.env.TEST_PASSWORD ?? "TestPassword123!";

function baseUrl(): string {
  const session = JSON.parse(readFileSync(SESSION_PATH, "utf8")) as { baseUrl: string };
  return session.baseUrl;
}

class CookieJar {
  private jar = new Map<string, string>();
  capture(res: Response) {
    for (const cookie of res.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) this.jar.set(name, value);
    }
  }
  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function req(
  url: string,
  jar: CookieJar,
  init: { method?: string; body?: unknown; idempotent?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: new URL(url).origin,
    cookie: jar.header(),
  };
  if (init.idempotent) headers["Idempotency-Key"] = randomUUID();
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  jar.capture(res);
  return res;
}

async function json(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.url}\n${text}`);
  return text ? JSON.parse(text) : null;
}

const FREIGHT_COST = {
  costType: "shipping",
  amount: "180.00",
  distributionMethod: "by_value",
  reference: "Ocean freight",
};

// Ensure the given PO carries a by-value freight additional cost, so the docs
// "Additional costs" section has something to screenshot. Idempotent.
async function ensureFreightCost(url: string, jar: CookieJar, poId: string) {
  const po = (await json(await req(`${url}/api/purchase-orders/${poId}`, jar))) as {
    version: number;
    supplierId: string;
    expectedDate: string | null;
    notes: string | null;
    shippingCost: string | null;
    lines: Array<{ id: string; itemId: string; quantityOrdered: string; unitCost: string; taxRateId: string | null }>;
    additionalCosts: Array<unknown>;
  };
  if ((po.additionalCosts ?? []).length > 0) return;
  await json(
    await req(`${url}/api/purchase-orders/${poId}`, jar, {
      method: "PUT",
      idempotent: true,
      body: {
        supplierId: po.supplierId,
        expectedDate: po.expectedDate ? po.expectedDate.slice(0, 10) : null,
        notes: po.notes,
        shippingCost: po.shippingCost ?? "0",
        lines: po.lines.map((l) => ({
          id: l.id,
          itemId: l.itemId,
          quantityOrdered: l.quantityOrdered,
          unitCost: l.unitCost,
          taxRateId: l.taxRateId ?? null,
        })),
        additionalCosts: [FREIGHT_COST],
        expectedVersion: po.version,
      },
    }),
  );
  console.log(`added freight additional cost to ${poId}`);
}

async function main() {
  const url = baseUrl();
  const jar = new CookieJar();

  // 1. Authenticate (MFA disabled in dev). Boot already created this user.
  const signIn = await req(`${url}/api/auth/sign-in/email`, jar, {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  await json(signIn);
  console.log("signed in");

  // 2. Create or reuse the docs-demo org.
  const list = (await json(await req(`${url}/api/auth/organization/list`, jar))) as
    | Array<{ id: string; slug: string }>
    | null;
  let orgId = list?.find((o) => o.slug === ORG_SLUG)?.id ?? null;
  if (!orgId) {
    const created = (await json(
      await req(`${url}/api/auth/organization/create`, jar, {
        method: "POST",
        body: { name: ORG_NAME, slug: ORG_SLUG },
      }),
    )) as { id: string };
    orgId = created.id;
    console.log(`created org ${ORG_SLUG} (${orgId})`);
  } else {
    console.log(`reusing org ${ORG_SLUG} (${orgId})`);
  }

  // 3. Make docs-demo the active org for this session's API writes.
  await json(
    await req(`${url}/api/auth/organization/set-active`, jar, {
      method: "POST",
      body: { organizationId: orgId },
    }),
  );
  console.log("active org set");

  // 4. Seed catalog / suppliers / opening stock via the loader engine.
  const { applyChanges } = await import("./load/engine/apply");
  const { docsDemoLoaderConfig } = await import("./load/docs-demo/index");
  const report = await applyChanges(orgId, docsDemoLoaderConfig, "docs-demo-seed", "docs-demo-opening");
  console.log(
    `catalog: +${report.createdItems.length} items, +${report.createdSuppliers.length} suppliers, +${report.stockLotsCreated.length} lots`,
  );

  // 5. Resolve supplier + item ids for PO lines.
  const suppliers = (await json(await req(`${url}/api/suppliers`, jar))) as Array<{
    id: string;
    name: string;
    code: string | null;
  }>;
  const items = (await json(await req(`${url}/api/items`, jar))) as Array<{
    id: string;
    sku: string | null;
    name: string;
  }>;
  const supplierByCode = (code: string) => {
    const s = suppliers.find((x) => x.code === code);
    if (!s) throw new Error(`supplier ${code} not found`);
    return s.id;
  };
  const itemBySku = (sku: string) => {
    const i = items.find((x) => x.sku === sku);
    if (!i) throw new Error(`item ${sku} not found`);
    return i.id;
  };

  // Skip PO creation if this org already has them (idempotent re-runs).
  const existing = (await json(await req(`${url}/api/purchase-orders`, jar))) as Array<{
    id: string;
    status: string;
  }>;
  if (existing.length > 0) {
    console.log(`purchase orders already present (${existing.length}); skipping PO creation`);
    const ordered = existing.find((o) => o.status === "ordered");
    if (ordered) await ensureFreightCost(url, jar, ordered.id);
    writeOut(url, orgId, jar);
    return;
  }

  // 6. Create POs and drive them to their target statuses via the REST API.
  type LineSpec = { sku: string; quantityOrdered: string; unitCost: string };
  async function createPO(
    supplierCode: string,
    expectedDate: string,
    notes: string,
    lines: LineSpec[],
    additionalCosts: Array<Record<string, string>> = [],
  ) {
    const body = {
      supplierId: supplierByCode(supplierCode),
      expectedDate,
      notes,
      shippingCost: "0",
      lines: lines.map((l) => ({
        itemId: itemBySku(l.sku),
        quantityOrdered: l.quantityOrdered,
        unitCost: l.unitCost,
      })),
      additionalCosts,
    };
    const order = (await json(
      await req(`${url}/api/purchase-orders`, jar, { method: "POST", body }),
    )) as { id: string; orderNumber: string };
    return order;
  }
  async function submit(id: string) {
    await json(
      await req(`${url}/api/purchase-orders/${id}/submit`, jar, {
        method: "POST",
        body: { syncAccounting: false, sendEmail: false },
        idempotent: true,
      }),
    );
  }
  async function lineIds(id: string): Promise<Array<{ id: string; itemId: string }>> {
    const detail = (await json(await req(`${url}/api/purchase-orders/${id}`, jar))) as {
      lines: Array<{ id: string; itemId: string }>;
    };
    return detail.lines;
  }
  async function receive(id: string, received: Array<{ lineId: string; quantityReceived: string }>) {
    await json(
      await req(`${url}/api/purchase-orders/${id}/receive`, jar, {
        method: "POST",
        body: { lines: received, confirmOverReceipt: false },
        idempotent: true,
      }),
    );
  }

  // Draft — green coffee top-up, left unsubmitted.
  const draft = await createPO("CROWN", "2026-07-15", "Q3 green coffee top-up", [
    { sku: "RVS-GRN-BRA-CERR", quantityOrdered: "207", unitCost: "6.80" },
    { sku: "RVS-GRN-GUA-ANTI", quantityOrdered: "69", unitCost: "9.40" },
  ]);
  console.log(`draft ${draft.orderNumber}`);

  // Ordered — single-origin lot on the way, with a by-value freight cost so the
  // docs "Additional costs" section has data to show.
  const ordered = await createPO(
    "COOP-HUILA",
    "2026-07-08",
    "Colombia Huila — washed lot",
    [{ sku: "RVS-GRN-COL-HUILA", quantityOrdered: "276", unitCost: "8.50" }],
    [FREIGHT_COST],
  );
  await submit(ordered.id);
  console.log(`ordered ${ordered.orderNumber}`);

  // Partially received — half the Ethiopia lot landed.
  const partial = await createPO("YCFCU", "2026-06-20", "Ethiopia Yirgacheffe — washed", [
    { sku: "RVS-GRN-ETH-YIRG", quantityOrdered: "138", unitCost: "11.20" },
  ]);
  await submit(partial.id);
  const partialLines = await lineIds(partial.id);
  await receive(partial.id, [{ lineId: partialLines[0].id, quantityReceived: "69" }]);
  console.log(`partial ${partial.orderNumber}`);

  // Received — packaging order fully landed.
  const received = await createPO("CASCADE-PKG", "2026-06-12", "Retail packaging restock", [
    { sku: "RVS-PKG-BAG-250", quantityOrdered: "5000", unitCost: "0.42" },
    { sku: "RVS-PKG-BOX-12", quantityOrdered: "400", unitCost: "1.10" },
  ]);
  await submit(received.id);
  const receivedLines = await lineIds(received.id);
  await receive(
    received.id,
    receivedLines.map((l) => ({
      lineId: l.id,
      quantityReceived: l.itemId === itemBySku("RVS-PKG-BAG-250") ? "5000" : "400",
    })),
  );
  console.log(`received ${received.orderNumber}`);

  writeOut(url, orgId, jar);
}

function writeOut(url: string, orgId: string, jar: CookieJar) {
  writeFileSync(
    OUT_PATH,
    JSON.stringify({ baseUrl: url, organizationId: orgId, slug: ORG_SLUG, cookie: jar.header() }, null, 2),
  );
  console.log(`wrote ${OUT_PATH}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
