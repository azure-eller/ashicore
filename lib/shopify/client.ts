import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SHOPIFY_API_VERSION,
  type ShopifyOrdersResponse,
} from "./types";

export class ShopifyError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ShopifyError";
    this.status = status;
  }

  toResponse() {
    return NextResponse.json({ error: this.message }, { status: this.status });
  }
}

const ordersResponseSchema = z.object({
  orders: z.array(z.unknown()).default([]),
});

function shopifyErrorDetail(text: string) {
  if (!text) return "";
  try {
    const body = JSON.parse(text) as { errors?: unknown; error?: unknown };
    const message =
      typeof body.errors === "string"
        ? body.errors
        : typeof body.error === "string"
          ? body.error
          : null;
    return message ? ` ${message}` : "";
  } catch {
    return ` ${text.slice(0, 200)}`;
  }
}

function normalizeShopDomain(shopDomain: string) {
  const trimmed = shopDomain.trim();
  if (!trimmed) throw new ShopifyError("Shopify shop domain is required.", 400);
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/\/+$/, "");
  }
  return `https://${trimmed.replace(/\/+$/, "")}`;
}

export async function fetchPaidShopifyOrders(params: {
  shopDomain: string;
  accessToken: string;
  shopBaseUrl?: string | null;
}): Promise<ShopifyOrdersResponse> {
  const baseUrl = params.shopBaseUrl
    ? params.shopBaseUrl.replace(/\/+$/, "")
    : normalizeShopDomain(params.shopDomain);
  const url = new URL(`/admin/api/${SHOPIFY_API_VERSION}/orders.json`, baseUrl);
  url.searchParams.set("status", "open");
  url.searchParams.set("financial_status", "paid");
  url.searchParams.set("fulfillment_status", "unshipped");
  url.searchParams.set("limit", "250");

  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": params.accessToken,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const detail = shopifyErrorDetail(await response.text());
    throw new ShopifyError(
      `Shopify order fetch failed with HTTP ${response.status}.${detail}`,
      response.status === 401 || response.status === 403 ? 409 : 502
    );
  }

  const parsed = ordersResponseSchema.parse(await response.json());
  return { orders: parsed.orders as ShopifyOrdersResponse["orders"] };
}
