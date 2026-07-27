import "server-only";

import { XeroClient } from "xero-node";
import { and, eq } from "drizzle-orm";
import { integrationConnections } from "@/lib/db/schema";
import { withOrgContext, type Tx } from "@/lib/db/with-org-context";
import { env } from "@/lib/env";
import { XeroError, redactXeroError } from "./errors";
import {
  decryptXeroToken,
  encryptXeroToken,
  getXeroTokenEncryptionKeyId,
} from "./token-crypto";
import {
  accountingAuditErrorMetadata,
  tryRecordAccountingAuditEvent,
} from "@/lib/accounting/audit-events";

const REQUIRED_SCOPES = [
  "accounting.contacts",
  "accounting.invoices",
  "accounting.transactions",
  // Read-only Profit & Loss and chart-of-accounts access for the overhead
  // calculator. Existing connections stay missing these until the user
  // reconnects; the overhead tab detects the 403 and prompts a reconnect.
  "accounting.reports.read",
  "accounting.settings.read",
  "offline_access",
];
const XERO_SIGNUP_IDENTITY_SCOPES = ["openid", "profile", "email"];
const XERO_PROVIDER = "xero";

export function getXeroScopes() {
  return [...REQUIRED_SCOPES];
}

export function getXeroSignupScopes() {
  return [...XERO_SIGNUP_IDENTITY_SCOPES, ...REQUIRED_SCOPES];
}

function requireEnv(
  name: "XERO_CLIENT_ID" | "XERO_CLIENT_SECRET" | "XERO_REDIRECT_URI",
): string {
  const value = env[name];
  if (!value) {
    throw new XeroError(`${name} is not configured.`, 500);
  }
  return value;
}

export function createXeroClient(scopes = REQUIRED_SCOPES): XeroClient {
  return new XeroClient({
    clientId: requireEnv("XERO_CLIENT_ID"),
    clientSecret: requireEnv("XERO_CLIENT_SECRET"),
    redirectUris: [requireEnv("XERO_REDIRECT_URI")],
    scopes,
    state: "",
  });
}

export function createXeroSignupClient(): XeroClient {
  return createXeroClient(getXeroSignupScopes());
}

type ConnectionRow = typeof integrationConnections.$inferSelect;
type StoredTokenPair = {
  accessToken: string;
  refreshToken: string;
};

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
        eq(integrationConnections.provider, XERO_PROVIDER)
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
  const accessToken = encryptXeroToken(params.accessToken);
  const refreshToken = encryptXeroToken(params.refreshToken);
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
        eq(integrationConnections.provider, XERO_PROVIDER)
      )
    );
}

function resolveStoredTokenPair(row: ConnectionRow): StoredTokenPair {
  return {
    accessToken: decryptXeroToken(
      row.accessTokenCiphertext,
      row.tokenEncryptionKeyId
    ),
    refreshToken: decryptXeroToken(
      row.refreshTokenCiphertext,
      row.tokenEncryptionKeyId
    ),
  };
}

function tokenSetToPersistable(
  tokenSet: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    expires_in?: number;
  },
  fallbackRefreshToken?: string
) {
  const accessToken = tokenSet.access_token;
  // Xero rotates refresh tokens on every refresh, but a few OAuth flows
  // don't return a new one when nothing changed. Fall back to the old
  // refresh token so we don't accidentally throw away a still-valid grant.
  const refreshToken = tokenSet.refresh_token ?? fallbackRefreshToken;

  if (!accessToken || !refreshToken) {
    throw new XeroError("Xero returned an incomplete token set.", 502);
  }

  const expiresAt = tokenSet.expires_at
    ? new Date(tokenSet.expires_at * 1000)
    : new Date(Date.now() + (tokenSet.expires_in ?? 1800) * 1000);

  return { accessToken, refreshToken, expiresAt };
}

/** Xero access tokens live ~30 min. Refresh proactively at the 25-min mark
 *  so callers never race against expiry, and a transient failure has a
 *  ~5-min retry window before the access token actually dies. */
const PROACTIVE_REFRESH_THRESHOLD_SECONDS = 5 * 60;

function isPermanentRefreshFailure(error: unknown): boolean {
  // openid-client surfaces token-endpoint errors with `error: "invalid_grant"`
  // when the refresh token has been revoked, used twice, or expired. Anything
  // else (network blips, 5xx, timeouts) is treated as transient — we do NOT
  // tell the user to reconnect on those.
  const code =
    (error as { error?: string })?.error ??
    (error as { code?: string })?.code;
  if (code === "invalid_grant") return true;

  const status =
    (error as { response?: { statusCode?: number } })?.response?.statusCode ??
    (error as { statusCode?: number })?.statusCode;
  // Some OAuth servers return 400 with an invalid_grant body; others surface
  // it as 401. Treat both as permanent only if we couldn't see the code.
  if (code == null && (status === 400 || status === 401)) return true;

  return false;
}

async function refreshOnce(
  client: XeroClient,
  fallbackRefreshToken: string
) {
  // xero-node's refreshToken() is the one method that doesn't lazy-init
  // the underlying openid-client. Without explicit initialize(), the
  // refresh call throws `Cannot read properties of undefined (reading
  // 'refresh')`. Other methods (apiCallback, buildConsentUrl, ...) all
  // call initialize() internally, so this is a known SDK gap, not a
  // race in our code.
  await client.initialize();

  const refreshed = await client.refreshToken();
  return tokenSetToPersistable(refreshed, fallbackRefreshToken);
}

/**
 * Load the Xero connection for the given org and refresh its access token
 * if it is expired or within 5 minutes of expiry. The connection row is locked
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
    const storedTokens = resolveStoredTokenPair(existing);

    const expiresInSeconds = Math.floor(
      (existing.tokenExpiresAt.getTime() - Date.now()) / 1000
    );

    client.setTokenSet({
      access_token: storedTokens.accessToken,
      refresh_token: storedTokens.refreshToken,
      expires_in: Math.max(expiresInSeconds, 0),
      token_type: "Bearer",
      scope: REQUIRED_SCOPES.join(" "),
    });

    const shouldRefresh =
      expiresInSeconds <= PROACTIVE_REFRESH_THRESHOLD_SECONDS;

    if (shouldRefresh) {
      try {
        // Validate encryption config before consuming Xero's rotating refresh token.
        getXeroTokenEncryptionKeyId();
        const persistable = await refreshOnce(
          client,
          storedTokens.refreshToken
        );
        await persistTokenSet(tx, orgId, persistable);
      } catch (error) {
        console.error("Xero token refresh failed:", {
          name: (error as Error)?.name,
          oauthError: (error as { error?: string })?.error,
          status:
            (error as { response?: { statusCode?: number } })?.response
              ?.statusCode ?? (error as { statusCode?: number })?.statusCode,
        });
        await tryRecordAccountingAuditEvent({
          organizationId: orgId,
          actor: { type: "process", processName: "xero_token_refresh" },
          eventType: "xero_token_refresh",
          outcome: "failure",
          source: "lib/xero/client:getAuthedXeroClient",
          tenantId: existing.tenantId,
          tenantName: existing.tenantName,
          metadata: {
            permanent: isPermanentRefreshFailure(error),
            ...accountingAuditErrorMetadata(error),
          },
        });

        if (isPermanentRefreshFailure(error)) {
          throw new XeroError(
            "Xero refresh token is no longer valid. Reconnect Xero in settings.",
            401,
            { validationErrors: extractValidationErrors(error) }
          );
        }

        // Transient. The stored access token might still work for the next
        // ~5 min thanks to the proactive refresh window. Surface as 503
        // (try again) instead of 401 so the UI doesn't push the user toward
        // a needless reconnect.
        throw new XeroError(
          "Could not reach Xero to refresh the access token. Try again in a moment.",
          503
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
    authorizedTenants: Array<{ tenantId: string; tenantName: string }>;
  }
) {
  await withOrgContext(orgId, async (tx) => {
    const accessToken = encryptXeroToken(params.accessToken);
    const refreshToken = encryptXeroToken(params.refreshToken);
    await tx
      .insert(integrationConnections)
      .values({
        organizationId: orgId,
        provider: XERO_PROVIDER,
        tenantId: params.tenantId,
        tenantName: params.tenantName,
        accessTokenCiphertext: accessToken.ciphertext,
        refreshTokenCiphertext: refreshToken.ciphertext,
        tokenEncryptionKeyId: refreshToken.keyId,
        tokenExpiresAt: params.expiresAt,
        authorizedTenants: params.authorizedTenants,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.organizationId,
          integrationConnections.provider,
        ],
        set: {
          tenantId: params.tenantId,
          tenantName: params.tenantName,
          accessTokenCiphertext: accessToken.ciphertext,
          refreshTokenCiphertext: refreshToken.ciphertext,
          tokenEncryptionKeyId: refreshToken.keyId,
          tokenExpiresAt: params.expiresAt,
          authorizedTenants: params.authorizedTenants,
          updatedAt: new Date(),
        },
      });
  });
}

export { tokenSetToPersistable };
export type XeroConnectionRow = ConnectionRow;
