import "server-only";

import { eq } from "drizzle-orm";
import { integrationConnections } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { SHOPIFY_PROVIDER, type ShopifyConnectionSettings } from "@/lib/shopify/types";

export type ShopifyConnectionSummary = {
  tenantId: string;
  tenantName: string;
  shopDomain: string;
  connectedAt: Date;
  updatedAt: Date;
};

export async function getShopifyConnection(): Promise<ShopifyConnectionSummary | null> {
  return withAuthedOrgContext(async (tx) => {
    const [row] = await tx
      .select({
        tenantId: integrationConnections.tenantId,
        tenantName: integrationConnections.tenantName,
        settings: integrationConnections.settings,
        createdAt: integrationConnections.createdAt,
        updatedAt: integrationConnections.updatedAt,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.provider, SHOPIFY_PROVIDER))
      .limit(1);

    if (!row) return null;
    const settings = row.settings as ShopifyConnectionSettings | null;
    return {
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      shopDomain: settings?.shopDomain ?? row.tenantId,
      connectedAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

