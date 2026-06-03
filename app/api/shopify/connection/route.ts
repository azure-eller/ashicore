import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import { assertModuleWriteAccess, getAuthedMemberContext } from "@/lib/dal/auth";
import { withOrgContext } from "@/lib/db/with-org-context";
import { integrationConnections } from "@/lib/db/schema";
import { encryptXeroToken } from "@/lib/xero/token-crypto";
import { SHOPIFY_PROVIDER } from "@/lib/shopify/types";

const connectionSchema = z.object({
  shopDomain: z
    .string()
    .trim()
    .min(1, "Shop domain is required")
    .transform((value) =>
      value
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "")
        .toLowerCase()
    ),
  accessToken: z.string().trim().min(1, "Admin API token is required"),
});

function encryptTokenIfConfigured(token: string) {
  try {
    return encryptXeroToken(token);
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
    return { ciphertext: token, keyId: "plain" };
  }
}

export const PUT = apiHandler(async (request: Request) => {
  await assertModuleWriteAccess("sales", request.headers);
  const context = await getAuthedMemberContext();
  const data = await parseJsonBody(request, connectionSchema);
  const encrypted = encryptTokenIfConfigured(data.accessToken);

  await withOrgContext(context.orgId, async (tx) => {
    await tx
      .insert(integrationConnections)
      .values({
        organizationId: context.orgId,
        provider: SHOPIFY_PROVIDER,
        tenantId: data.shopDomain,
        tenantName: data.shopDomain,
        accessTokenCiphertext: encrypted.ciphertext,
        refreshTokenCiphertext: "",
        tokenEncryptionKeyId: encrypted.keyId,
        tokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
        settings: { shopDomain: data.shopDomain },
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.organizationId,
          integrationConnections.provider,
        ],
        set: {
          tenantId: data.shopDomain,
          tenantName: data.shopDomain,
          accessTokenCiphertext: encrypted.ciphertext,
          refreshTokenCiphertext: "",
          tokenEncryptionKeyId: encrypted.keyId,
          tokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
          settings: { shopDomain: data.shopDomain },
          updatedAt: new Date(),
        },
      });
  });

  return NextResponse.json({
    tenantId: data.shopDomain,
    tenantName: data.shopDomain,
    shopDomain: data.shopDomain,
  });
});
