import "server-only";

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { marketingMailboxes } from "@/lib/db/schema";
import { withOrgContext } from "@/lib/db/with-org-context";
import { DomainError } from "@/lib/errors/domain-error";
import { env } from "@/lib/env";
import { decryptGoogleToken, encryptGoogleToken } from "./token-crypto";
import {
  MARKETING_GMAIL_INBOX_DIR,
  MARKETING_GMAIL_OUTBOX_DIR,
} from "./test-mode";
import { isMarketingTestMode } from "./runtime-policy";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

type GmailTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

export type GmailInboundMessage = {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  text: string;
  historyId?: string;
};

function googleOAuthConfig() {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new DomainError("Google OAuth is not configured.", 503);
  }
  return { clientId, clientSecret, redirectUri };
}

async function tokenRequest(body: URLSearchParams) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json().catch(() => ({}))) as GmailTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new DomainError(
      `Google OAuth failed: ${data.error_description ?? data.error ?? response.statusText}`,
      502,
    );
  }
  return data;
}

export function buildGoogleConsentUrl(state: string) {
  const { clientId, redirectUri } = googleOAuthConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
    ].join(" "),
  );
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeGoogleCode(code: string) {
  const { clientId, clientSecret, redirectUri } = googleOAuthConfig();
  return tokenRequest(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code,
    }),
  );
}

async function gmailFetch<T>(accessToken: string, route: string, init?: RequestInit) {
  const response = await fetch(`${GMAIL_API}${route}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new DomainError(`Gmail request failed: ${detail || response.statusText}`, 502);
  }
  return (await response.json()) as T;
}

export async function getGmailProfile(accessToken: string) {
  return gmailFetch<{ emailAddress: string; historyId: string }>(
    accessToken,
    "/profile",
  );
}

export async function saveMarketingMailbox(args: {
  orgId: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}) {
  const profile = await getGmailProfile(args.accessToken);
  const access = encryptGoogleToken(args.accessToken);
  const refresh = encryptGoogleToken(args.refreshToken);
  if (access.keyId !== refresh.keyId) {
    throw new DomainError("Google token encryption key changed during connection.", 500);
  }
  const expiresAt = new Date(Date.now() + args.expiresIn * 1_000);

  return withOrgContext(args.orgId, async (tx) => {
    const [saved] = await tx
      .insert(marketingMailboxes)
      .values({
        organizationId: args.orgId,
        userId: args.userId,
        email: profile.emailAddress.toLowerCase(),
        accessTokenCiphertext: access.ciphertext,
        refreshTokenCiphertext: refresh.ciphertext,
        tokenEncryptionKeyId: access.keyId,
        tokenExpiresAt: expiresAt,
        historyId: profile.historyId,
        disabledAt: null,
      })
      .onConflictDoUpdate({
        target: marketingMailboxes.organizationId,
        set: {
          userId: args.userId,
          email: profile.emailAddress.toLowerCase(),
          accessTokenCiphertext: access.ciphertext,
          refreshTokenCiphertext: refresh.ciphertext,
          tokenEncryptionKeyId: access.keyId,
          tokenExpiresAt: expiresAt,
          historyId: profile.historyId,
          disabledAt: null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: marketingMailboxes.id, email: marketingMailboxes.email });
    return saved!;
  }, { userId: args.userId });
}

async function activeAccessToken(orgId: string) {
  return withOrgContext(orgId, async (tx) => {
    const [mailbox] = await tx
      .select()
      .from(marketingMailboxes)
      .where(
        and(
          eq(marketingMailboxes.organizationId, orgId),
          isNull(marketingMailboxes.disabledAt),
        ),
      );
    if (!mailbox) throw new DomainError("Founder Gmail mailbox is not connected.", 409);

    if (mailbox.tokenExpiresAt.getTime() > Date.now() + 60_000) {
      return {
        accessToken: decryptGoogleToken(
          mailbox.accessTokenCiphertext,
          mailbox.tokenEncryptionKeyId,
        ),
        mailbox,
      };
    }

    const config = googleOAuthConfig();
    const refreshToken = decryptGoogleToken(
      mailbox.refreshTokenCiphertext,
      mailbox.tokenEncryptionKeyId,
    );
    const refreshed = await tokenRequest(
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    );
    const encryptedAccess = encryptGoogleToken(refreshed.access_token!);
    const encryptedRefresh = encryptGoogleToken(
      refreshed.refresh_token ?? refreshToken,
    );
    if (encryptedAccess.keyId !== encryptedRefresh.keyId) {
      throw new DomainError("Google token encryption key changed during refresh.", 500);
    }
    const tokenExpiresAt = new Date(Date.now() + (refreshed.expires_in ?? 3_600) * 1_000);
    await tx
      .update(marketingMailboxes)
      .set({
        accessTokenCiphertext: encryptedAccess.ciphertext,
        refreshTokenCiphertext: encryptedRefresh.ciphertext,
        tokenEncryptionKeyId: encryptedAccess.keyId,
        tokenExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(marketingMailboxes.id, mailbox.id));
    return { accessToken: refreshed.access_token!, mailbox: { ...mailbox, tokenExpiresAt } };
  });
}

function safeHeader(value: string) {
  if (/\r|\n/.test(value)) throw new DomainError("Email headers cannot contain newlines.");
  return value;
}

function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function mimeMessage(args: {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string;
}) {
  const headers = [
    `From: ${safeHeader(args.from)}`,
    `To: ${safeHeader(args.to)}`,
    `Subject: ${safeHeader(args.subject)}`,
    `Message-ID: <${args.messageId}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  if (args.inReplyTo) {
    headers.push(`In-Reply-To: <${safeHeader(args.inReplyTo)}>`, `References: <${safeHeader(args.inReplyTo)}>`);
  }
  return `${headers.join("\r\n")}\r\n\r\n${args.text}`;
}

export async function sendGmailMessage(args: {
  orgId: string;
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  threadId?: string;
  inReplyTo?: string;
}) {
  const stableId = `${createHash("sha256").update(args.idempotencyKey).digest("hex").slice(0, 32)}@ashicore.app`;
  if (await isMarketingTestMode()) {
    await fs.mkdir(MARKETING_GMAIL_OUTBOX_DIR, { recursive: true });
    const filePath = path.join(
      MARKETING_GMAIL_OUTBOX_DIR,
      `${createHash("sha256").update(args.idempotencyKey).digest("hex")}.json`,
    );
    const value = {
      ...args,
      messageId: stableId,
      threadId: args.threadId ?? randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), { flag: "wx" }).catch(
      async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    return { id: stableId, threadId: value.threadId, rfcMessageId: stableId };
  }

  const { accessToken, mailbox } = await activeAccessToken(args.orgId);
  const existing = await gmailFetch<{
    messages?: Array<{ id: string; threadId: string }>;
  }>(accessToken, `/messages?q=${encodeURIComponent(`rfc822msgid:${stableId}`)}`);
  if (existing.messages?.[0]) {
    return { ...existing.messages[0], rfcMessageId: stableId };
  }
  const sent = await gmailFetch<{ id: string; threadId: string }>(accessToken, "/messages/send", {
    method: "POST",
    body: JSON.stringify({
      raw: base64Url(
        mimeMessage({
          from: mailbox.email,
          to: args.to,
          subject: args.subject,
          text: args.text,
          messageId: stableId,
          inReplyTo: args.inReplyTo,
        }),
      ),
      threadId: args.threadId,
    }),
  });
  return { ...sent, rfcMessageId: stableId };
}

function decodeBody(payload: {
  body?: { data?: string };
  parts?: Array<{ mimeType?: string; body?: { data?: string }; parts?: unknown[] }>;
}): string {
  const direct = payload.body?.data;
  if (direct) return Buffer.from(direct, "base64url").toString("utf8");
  for (const part of payload.parts ?? []) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf8");
    }
  }
  return "";
}

export async function readNewGmailMessages(orgId: string) {
  if (await isMarketingTestMode()) {
    const names = await fs.readdir(MARKETING_GMAIL_INBOX_DIR).catch(() => []);
    return { messages: await Promise.all(
      names.filter((name) => name.endsWith(".json")).map(async (name) =>
        JSON.parse(
          await fs.readFile(path.join(MARKETING_GMAIL_INBOX_DIR, name), "utf8"),
        ) as GmailInboundMessage,
      ),
    ) };
  }

  const { accessToken, mailbox } = await activeAccessToken(orgId);
  if (!mailbox.historyId) return { messages: [] };
  type GmailHistoryPage = {
    historyId?: string;
    history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>;
    nextPageToken?: string;
  };
  const historyRows: NonNullable<GmailHistoryPage["history"]> = [];
  let latestHistoryId = mailbox.historyId;
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      startHistoryId: mailbox.historyId,
      historyTypes: "messageAdded",
      labelId: "INBOX",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const page = await gmailFetch<GmailHistoryPage>(accessToken, `/history?${query}`);
    historyRows.push(...(page.history ?? []));
    latestHistoryId = page.historyId ?? latestHistoryId;
    pageToken = page.nextPageToken;
  } while (pageToken);
  const ids = [
    ...new Set(
      historyRows.flatMap((row) =>
        (row.messagesAdded ?? []).map((entry) => entry.message.id),
      ),
    ),
  ];
  const messages = await Promise.all(
    ids.map(async (id): Promise<GmailInboundMessage> => {
      const message = await gmailFetch<{
        id: string;
        threadId: string;
        historyId?: string;
        payload: {
          headers?: Array<{ name: string; value: string }>;
          body?: { data?: string };
          parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
        };
      }>(accessToken, `/messages/${id}?format=full`);
      const headers = new Map(
        (message.payload.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]),
      );
      return {
        messageId: message.id,
        threadId: message.threadId,
        historyId: message.historyId,
        from: headers.get("from") ?? "",
        subject: headers.get("subject") ?? "",
        text: decodeBody(message.payload),
      };
    }),
  );
  return { messages, historyId: latestHistoryId };
}

export async function acknowledgeGmailHistory(orgId: string, historyId: string) {
  return withOrgContext(orgId, (tx) =>
    tx
      .update(marketingMailboxes)
      .set({
        historyId,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(marketingMailboxes.organizationId, orgId)),
  );
}

export async function disableMarketingMailbox(orgId: string, userId: string) {
  return withOrgContext(orgId, (tx) =>
    tx
      .update(marketingMailboxes)
      .set({ disabledAt: new Date(), updatedAt: new Date() })
      .where(eq(marketingMailboxes.organizationId, orgId)),
    { userId },
  );
}
