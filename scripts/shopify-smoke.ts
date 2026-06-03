/**
 * Live Shopify smoke test against a development store.
 *
 * Prereqs:
 *   - Dev server running (`pnpm boot` or `pnpm review`)
 *   - test/.test-env.json or test/.review-env.json present
 *   - SHOPIFY_TEST_SHOP_DOMAIN set in .env.local
 *   - Either SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET
 *     set in .env.local. Dev Dashboard apps must be installed on the target store
 *     before the client credentials grant can issue an API token.
 *   - At least one paid, unfulfilled Shopify order with a SKU line
 *
 * Usage:
 *   pnpm shopify:smoke
 *   pnpm shopify:smoke -- --review
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadWorktreeEnv } from "./load-worktree-env";

loadWorktreeEnv();

const args = new Set(process.argv.slice(2));
const useReview = args.has("--review");

type AuthEnv = {
  TEST_SESSION_COOKIE: string;
  TEST_UNIT_ID?: string;
  TEST_BASE_URL: string;
};

type ShopifyOrderLine = {
  sku?: string | null;
  title?: string | null;
  price?: string | null;
  quantity?: number | string | null;
  fulfillable_quantity?: number | string | null;
};

type ShopifyOrder = {
  id: number | string;
  name?: string | null;
  line_items?: ShopifyOrderLine[];
};

type ApiOptions = RequestInit & { idempotencyKey?: string };

function readAuthEnv(): AuthEnv {
  const file = useReview ? "test/.review-env.json" : "test/.test-env.json";
  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`${file} not found. Run pnpm boot or pnpm review first.`);
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as AuthEnv;
}

async function apiFetch<T>(
  auth: AuthEnv,
  route: string,
  options: ApiOptions = {}
): Promise<T> {
  const { idempotencyKey, headers: optionHeaders, ...rest } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: auth.TEST_SESSION_COOKIE,
    Origin: auth.TEST_BASE_URL,
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await fetch(`${auth.TEST_BASE_URL}${route}`, {
    ...rest,
    headers: { ...headers, ...Object.fromEntries(new Headers(optionHeaders)) },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${route} -> ${response.status}: ${
        text.slice(0, 500) || "(empty)"
      }`
    );
  }
  return JSON.parse(text || "null") as T;
}

function idempotencyKey(label: string) {
  return `shopify-smoke:${createHash("sha256")
    .update(label)
    .digest("hex")
    .slice(0, 24)}`;
}

async function fetchShopifyOrders(shopDomain: string, token: string) {
  const url = new URL(
    `https://${shopDomain}/admin/api/2025-10/orders.json`
  );
  url.searchParams.set("status", "open");
  url.searchParams.set("financial_status", "paid");
  url.searchParams.set("fulfillment_status", "unshipped");
  url.searchParams.set("limit", "10");

  const response = await fetch(url, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!response.ok) {
    const text = await response.text();
    let details = "";
    try {
      const body = JSON.parse(text) as { errors?: unknown; error?: unknown };
      const message =
        typeof body.errors === "string"
          ? body.errors
          : typeof body.error === "string"
            ? body.error
            : null;
      if (message) details = ` ${message}`;
    } catch {
      details = text ? ` ${text.slice(0, 200)}` : "";
    }
    throw new Error(
      `Shopify Admin API order probe failed with HTTP ${response.status}.${details} ` +
        "Check SHOPIFY_ADMIN_ACCESS_TOKEN and read_orders scope."
    );
  }
  const body = (await response.json()) as { orders?: ShopifyOrder[] };
  return body.orders ?? [];
}

async function fetchShopifyAccessToken(shopDomain: string) {
  const directToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (directToken) return directToken;

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Set SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET in .env.local."
    );
  }

  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const title = /<title>(.*?)<\/title>/.exec(text)?.[1];
    throw new Error(
      `Shopify token request failed with HTTP ${response.status}${
        title ? ` (${title})` : ""
      }. Confirm the Dev Dashboard app is installed on ${shopDomain}.`
    );
  }

  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("Shopify token response did not include access_token.");
  }
  return body.access_token;
}

function firstImportableLine(order: ShopifyOrder) {
  return (order.line_items ?? []).find((line) => {
    const sku = line.sku?.trim();
    const quantity = Number(line.fulfillable_quantity ?? line.quantity);
    const price = Number(line.price);
    return sku && Number.isFinite(quantity) && quantity > 0 && price > 0;
  });
}

function shopifyOrderNumber(order: ShopifyOrder) {
  const raw = order.name?.trim() || String(order.id);
  return `SHOP-${raw.replace(/^#+/, "")}`.slice(0, 32);
}

async function ensureSmokeUnit(auth: AuthEnv) {
  const unit = await apiFetch<{ id: string }>(auth, "/api/units", {
    method: "POST",
    idempotencyKey: idempotencyKey("unit:shopify-smoke-each"),
    body: JSON.stringify({
      name: "Shopify Smoke Each",
      uom: "ea",
      size: "1",
    }),
  });
  return unit.id;
}

async function ensureMatchingProduct(auth: AuthEnv, sku: string, price: string) {
  const products = await apiFetch<Array<{ id: string; sku: string | null }>>(
    auth,
    "/api/items?itemType=product"
  );
  const existing = products.find(
    (item) => item.sku?.toUpperCase() === sku.toUpperCase()
  );
  if (existing) return existing.id;

  const suffix = Date.now();
  const unitDefinitionId = await ensureSmokeUnit(auth);
  const component = await apiFetch<{ id: string }>(auth, "/api/items", {
    method: "POST",
    idempotencyKey: idempotencyKey(`component:${sku}:${suffix}`),
    body: JSON.stringify({
      itemType: "material",
      name: `Shopify Smoke Component ${suffix}`,
      unitDefinitionId,
      sku: `SHOPIFY-SMOKE-COMP-${suffix}`,
      category: "Shopify Smoke",
      description: null,
      defaultPurchasePrice: "1.00",
      defaultSellingPrice: null,
      stock: "10",
      safetyStock: "0",
      bom: [],
    }),
  });

  const product = await apiFetch<{ id: string }>(auth, "/api/items", {
    method: "POST",
    idempotencyKey: idempotencyKey(`product:${sku}:${suffix}`),
    body: JSON.stringify({
      itemType: "product",
      name: `Shopify Smoke Product ${suffix}`,
      sellable: true,
      unitDefinitionId,
      sku,
      category: "Shopify Smoke",
      description: null,
      defaultPurchasePrice: null,
      defaultSellingPrice: price,
      stock: "10",
      safetyStock: "0",
      bom: [{ componentId: component.id, quantity: "1" }],
    }),
  });
  return product.id;
}

async function main() {
  const shopDomain = process.env.SHOPIFY_TEST_SHOP_DOMAIN;
  if (!shopDomain) {
    throw new Error("Set SHOPIFY_TEST_SHOP_DOMAIN in .env.local.");
  }

  const auth = readAuthEnv();
  const token = await fetchShopifyAccessToken(shopDomain);
  const orders = await fetchShopifyOrders(shopDomain, token);
  const order = orders.find((candidate) => firstImportableLine(candidate));
  if (!order) {
    throw new Error(
      "No paid, unfulfilled Shopify order with an importable SKU line was found."
    );
  }
  const line = firstImportableLine(order)!;
  const sku = line.sku!.trim();

  await ensureMatchingProduct(auth, sku, line.price ?? "1.00");

  await apiFetch(auth, "/api/shopify/connection", {
    method: "PUT",
    body: JSON.stringify({ shopDomain, accessToken: token }),
  });

  const firstImport = await apiFetch<{
    created: number;
    skipped: number;
    errors: string[];
  }>(auth, "/api/shopify/import/orders", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (firstImport.errors.length > 0) {
    throw new Error(`Shopify import returned errors: ${firstImport.errors.join("; ")}`);
  }

  const expectedOrderNumber = shopifyOrderNumber(order);
  const salesOrders = await apiFetch<Array<{ orderNumber: string }>>(
    auth,
    "/api/sales-orders"
  );
  if (!salesOrders.some((salesOrder) => salesOrder.orderNumber === expectedOrderNumber)) {
    throw new Error(`ERP sales order ${expectedOrderNumber} was not found after import.`);
  }

  const secondImport = await apiFetch<{
    created: number;
    skipped: number;
    errors: string[];
  }>(auth, "/api/shopify/import/orders", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (secondImport.created !== 0) {
    throw new Error("Duplicate Shopify import created another sales order.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        shopDomain,
        shopifyOrder: order.name ?? String(order.id),
        erpOrderNumber: expectedOrderNumber,
        sku,
        firstImport,
        secondImport,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
