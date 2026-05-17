import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { integrationConnections } from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import {
  ACCOUNTING_PROVIDER_QUICKBOOKS,
  type AccountingProvider,
} from "@/lib/accounting/constants";
import {
  decryptAccountingToken,
  encryptAccountingToken,
  getAccountingTokenEncryptionKeyId,
} from "@/lib/accounting/token-crypto";

const QUICKBOOKS_PROVIDER: AccountingProvider = ACCOUNTING_PROVIDER_QUICKBOOKS;
const QUICKBOOKS_SCOPE = "com.intuit.quickbooks.accounting";
const QUICKBOOKS_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QUICKBOOKS_TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

type ConnectionRow = typeof integrationConnections.$inferSelect;

export class QuickBooksError extends Error {
  constructor(
    message: string,
    public status = 500
  ) {
    super(message);
    this.name = "QuickBooksError";
  }

  toResponse() {
    return NextResponse.json({ error: this.message }, { status: this.status });
  }
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new QuickBooksError(`${name} is not configured.`, 500);
  }
  return value;
}

function getQuickBooksEnvironment() {
  return process.env.QUICKBOOKS_ENVIRONMENT === "production"
    ? "production"
    : "sandbox";
}

function getQuickBooksApiBaseUrl() {
  return getQuickBooksEnvironment() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

function buildBasicAuthHeader() {
  return `Basic ${Buffer.from(
    `${requireEnv("QUICKBOOKS_CLIENT_ID")}:${requireEnv("QUICKBOOKS_CLIENT_SECRET")}`
  ).toString("base64")}`;
}

export function buildQuickBooksAuthorizationUrl(state: string) {
  const url = new URL(QUICKBOOKS_AUTH_URL);
  url.searchParams.set("client_id", requireEnv("QUICKBOOKS_CLIENT_ID"));
  url.searchParams.set("redirect_uri", requireEnv("QUICKBOOKS_REDIRECT_URI"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QUICKBOOKS_SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeToken(params: URLSearchParams) {
  const response = await fetch(QUICKBOOKS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: buildBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;

  if (!response.ok) {
    throw new QuickBooksError(
      body?.error_description ?? body?.error ?? "QuickBooks token exchange failed.",
      response.status
    );
  }
  if (!body?.access_token || !body.refresh_token) {
    throw new QuickBooksError("QuickBooks returned an incomplete token set.", 502);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
  };
}

export async function exchangeQuickBooksAuthorizationCode(params: {
  code: string;
  realmId: string;
}) {
  return exchangeToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: requireEnv("QUICKBOOKS_REDIRECT_URI"),
    })
  );
}

async function loadLockedConnection(
  tx: Tx,
  orgId: string
): Promise<ConnectionRow | null> {
  const [row] = await tx
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, orgId),
        eq(integrationConnections.provider, QUICKBOOKS_PROVIDER)
      )
    )
    .for("update");
  return row ?? null;
}

async function persistTokenSet(
  tx: Tx,
  orgId: string,
  params: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }
) {
  const accessToken = encryptAccountingToken(params.accessToken);
  const refreshToken = encryptAccountingToken(params.refreshToken);
  await tx
    .update(integrationConnections)
    .set({
      accessTokenCiphertext: accessToken.ciphertext,
      refreshTokenCiphertext: refreshToken.ciphertext,
      tokenEncryptionKeyId: refreshToken.keyId,
      tokenExpiresAt: params.expiresAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrationConnections.organizationId, orgId),
        eq(integrationConnections.provider, QUICKBOOKS_PROVIDER)
      )
    );
}

export async function upsertQuickBooksConnection(
  orgId: string,
  params: {
    realmId: string;
    companyName?: string | null;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }
) {
  await withOrgContext(orgId, async (tx) => {
    const accessToken = encryptAccountingToken(params.accessToken);
    const refreshToken = encryptAccountingToken(params.refreshToken);
    await tx
      .insert(integrationConnections)
      .values({
        organizationId: orgId,
        provider: QUICKBOOKS_PROVIDER,
        tenantId: params.realmId,
        tenantName: params.companyName ?? `QuickBooks ${params.realmId}`,
        accessTokenCiphertext: accessToken.ciphertext,
        refreshTokenCiphertext: refreshToken.ciphertext,
        tokenEncryptionKeyId: refreshToken.keyId,
        tokenExpiresAt: params.expiresAt,
        authorizedTenants: [
          {
            tenantId: params.realmId,
            tenantName: params.companyName ?? `QuickBooks ${params.realmId}`,
          },
        ],
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.organizationId,
          integrationConnections.provider,
        ],
        set: {
          tenantId: params.realmId,
          tenantName: params.companyName ?? `QuickBooks ${params.realmId}`,
          accessTokenCiphertext: accessToken.ciphertext,
          refreshTokenCiphertext: refreshToken.ciphertext,
          tokenEncryptionKeyId: refreshToken.keyId,
          tokenExpiresAt: params.expiresAt,
          authorizedTenants: [
            {
              tenantId: params.realmId,
              tenantName: params.companyName ?? `QuickBooks ${params.realmId}`,
            },
          ],
          updatedAt: new Date(),
        },
      });
  });
}

async function refreshQuickBooksToken(
  refreshToken: string
) {
  return exchangeToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
  );
}

export async function getAuthedQuickBooksConnection(orgId: string) {
  return withOrgContext(orgId, async (tx) => {
    const existing = await loadLockedConnection(tx, orgId);
    if (!existing) {
      throw new QuickBooksError("QuickBooks is not connected for this organization.", 409);
    }

    const accessToken = decryptAccountingToken(
      existing.accessTokenCiphertext,
      existing.tokenEncryptionKeyId
    );
    const refreshToken = decryptAccountingToken(
      existing.refreshTokenCiphertext,
      existing.tokenEncryptionKeyId
    );
    const expiresInMs = existing.tokenExpiresAt.getTime() - Date.now();
    if (expiresInMs <= 5 * 60 * 1000) {
      getAccountingTokenEncryptionKeyId();
      const refreshed = await refreshQuickBooksToken(refreshToken);
      await persistTokenSet(tx, orgId, refreshed);
      return {
        accessToken: refreshed.accessToken,
        realmId: existing.tenantId,
        companyName: existing.tenantName,
        connection: existing,
      };
    }

    return {
      accessToken,
      realmId: existing.tenantId,
      companyName: existing.tenantName,
      connection: existing,
    };
  });
}

export async function quickBooksRequest<T>(
  orgId: string,
  endpoint: string,
  init?: RequestInit
) {
  const authed = await getAuthedQuickBooksConnection(orgId);
  const response = await fetch(
    `${getQuickBooksApiBaseUrl()}/v3/company/${authed.realmId}${endpoint}`,
    {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${authed.accessToken}`,
        ...init?.headers,
      },
    }
  );
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new QuickBooksError(
      body?.Fault?.Error?.[0]?.Message ??
        body?.Fault?.Error?.[0]?.Detail ??
        `QuickBooks API error ${response.status}.`,
      response.status
    );
  }
  return body as T;
}
