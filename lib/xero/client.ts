import "server-only";

import { XeroClient } from "xero-node";
import { eq } from "drizzle-orm";
import { xeroConnections } from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import { XeroError, redactXeroError } from "./errors";

const REQUIRED_SCOPES = [
  "accounting.contacts",
  "accounting.invoices",
  "offline_access",
];

export function getXeroScopes() {
  return [...REQUIRED_SCOPES];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new XeroError(`${name} is not configured.`, 500);
  }
  return value;
}

export function createXeroClient(): XeroClient {
  return new XeroClient({
    clientId: requireEnv("XERO_CLIENT_ID"),
    clientSecret: requireEnv("XERO_CLIENT_SECRET"),
    redirectUris: [requireEnv("XERO_REDIRECT_URI")],
    scopes: REQUIRED_SCOPES,
    state: "",
  });
}

type ConnectionRow = typeof xeroConnections.$inferSelect;

async function loadLockedConnection(
  tx: Tx,
  orgId: string
): Promise<ConnectionRow | null> {
  const [row] = await tx
    .select()
    .from(xeroConnections)
    .where(eq(xeroConnections.organizationId, orgId))
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
  await tx
    .update(xeroConnections)
    .set({
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      tokenExpiresAt: params.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(xeroConnections.organizationId, orgId));
}

function tokenSetToPersistable(tokenSet: {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
}) {
  const accessToken = tokenSet.access_token;
  const refreshToken = tokenSet.refresh_token;

  if (!accessToken || !refreshToken) {
    throw new XeroError("Xero returned an incomplete token set.", 502);
  }

  const expiresAt = tokenSet.expires_at
    ? new Date(tokenSet.expires_at * 1000)
    : new Date(Date.now() + (tokenSet.expires_in ?? 1800) * 1000);

  return { accessToken, refreshToken, expiresAt };
}

/**
 * Load the Xero connection for the given org and refresh its access token
 * if it is expired or within 60s of expiry. The connection row is locked
 * FOR UPDATE so two concurrent callers cannot both consume the same
 * refresh token.
 */
export async function getAuthedXeroClient(orgId: string): Promise<{
  client: XeroClient;
  tenantId: string;
  tenantName: string;
  connection: ConnectionRow;
}> {
  return withOrgContext(orgId, async (tx) => {
    const existing = await loadLockedConnection(tx, orgId);
    if (!existing) {
      throw new XeroError("Xero is not connected for this organization.", 409);
    }

    const client = createXeroClient();

    const expiresInSeconds = Math.floor(
      (existing.tokenExpiresAt.getTime() - Date.now()) / 1000
    );

    client.setTokenSet({
      access_token: existing.accessToken,
      refresh_token: existing.refreshToken,
      expires_in: Math.max(expiresInSeconds, 0),
      token_type: "Bearer",
      scope: REQUIRED_SCOPES.join(" "),
    });

    const shouldRefresh = expiresInSeconds <= 60;

    if (shouldRefresh) {
      try {
        const refreshed = await client.refreshToken();
        const persistable = tokenSetToPersistable(refreshed);
        await persistTokenSet(tx, orgId, persistable);
      } catch (error) {
        throw new XeroError(
          "Failed to refresh the Xero access token. Reconnect Xero in settings.",
          401,
          { validationErrors: extractValidationErrors(error) }
        );
      }
    }

    return {
      client,
      tenantId: existing.tenantId,
      tenantName: existing.tenantName,
      connection: existing,
    };
  });
}

export function extractValidationErrors(
  error: unknown
): Array<{ property: string; message: string }> {
  const redacted = redactXeroError(error) as unknown;
  if (!redacted || typeof redacted !== "object") return [];

  const body =
    (redacted as { response?: { body?: unknown } }).response?.body ??
    (redacted as { body?: unknown }).body ??
    null;

  if (!body || typeof body !== "object") return [];

  const elements =
    (body as { Elements?: Array<{ ValidationErrors?: Array<{ Message?: string }> }> })
      .Elements ?? [];
  const out: Array<{ property: string; message: string }> = [];
  for (const element of elements) {
    for (const ve of element.ValidationErrors ?? []) {
      if (ve.Message) {
        out.push({ property: "", message: ve.Message });
      }
    }
  }

  return out;
}

export async function upsertXeroConnection(
  orgId: string,
  params: {
    tenantId: string;
    tenantName: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }
) {
  await withOrgContext(orgId, async (tx) => {
    await tx
      .insert(xeroConnections)
      .values({
        organizationId: orgId,
        tenantId: params.tenantId,
        tenantName: params.tenantName,
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        tokenExpiresAt: params.expiresAt,
      })
      .onConflictDoUpdate({
        target: xeroConnections.organizationId,
        set: {
          tenantId: params.tenantId,
          tenantName: params.tenantName,
          accessToken: params.accessToken,
          refreshToken: params.refreshToken,
          tokenExpiresAt: params.expiresAt,
          updatedAt: new Date(),
        },
      });
  });
}

export { tokenSetToPersistable };
export type XeroConnectionRow = ConnectionRow;
