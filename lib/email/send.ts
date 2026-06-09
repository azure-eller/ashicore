import "server-only";

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getEmailSenderConfig } from "@/lib/email/config";
import { EMAIL_OUTBOX_DIR, EMAIL_OUTBOX_MODE_FLAG } from "@/lib/email/outbox";

export type TransactionalEmailAttachment = {
  filename: string;
  /** Base64-encoded content. */
  content: string;
  contentType?: string;
};

export type TransactionalEmailInput = {
  tag:
    | "email-verification"
    | "mfa-code"
    | "password-reset"
    | "team-invite"
    | "purchase-order"
    | "invoice"
    | "internal-alert";
  from?: string;
  to: string;
  replyTo?: string;
  bcc?: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments?: TransactionalEmailAttachment[];
  idempotencyKey?: string;
};

export type TransactionalEmailResult =
  | { delivery: "sent" }
  | { delivery: "outbox"; filePath: string };

function sanitizeFileSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function shouldWriteEmailOutbox() {
  if (process.env.EMAIL_OUTBOX_ONLY === "1") {
    return true;
  }

  try {
    await fs.access(EMAIL_OUTBOX_MODE_FLAG);
    return true;
  } catch {
    return false;
  }
}

async function writeEmailOutbox(email: TransactionalEmailInput) {
  await fs.mkdir(EMAIL_OUTBOX_DIR, { recursive: true });

  const fileNamePrefix = email.idempotencyKey
    ? createHash("sha256").update(email.idempotencyKey).digest("hex").slice(0, 16)
    : String(Date.now());
  const filePath = path.join(
    EMAIL_OUTBOX_DIR,
    `${fileNamePrefix}-${email.tag}-${sanitizeFileSegment(email.to)}.json`
  );

  try {
    await fs.writeFile(
      filePath,
      JSON.stringify(
        {
          ...email,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      ),
      { encoding: "utf8", flag: email.idempotencyKey ? "wx" : "w" }
    );
  } catch (error) {
    if (
      email.idempotencyKey &&
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      return filePath;
    }

    throw error;
  }

  console.info(`[email:${email.tag}] Wrote local email delivery to ${filePath}`);
  return filePath;
}

export async function sendTransactionalEmail(
  email: TransactionalEmailInput,
  options: { allowOutboxDelivery?: boolean } = {},
): Promise<TransactionalEmailResult> {
  const senderConfig = getEmailSenderConfig();

  if (!senderConfig || (await shouldWriteEmailOutbox())) {
    if (options.allowOutboxDelivery === false) {
      throw new Error(
        "Live email delivery is not configured for this dev server. No email was sent.",
      );
    }

    const filePath = await writeEmailOutbox(email);
    return { delivery: "outbox", filePath };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${senderConfig.resendApiKey}`,
    "Content-Type": "application/json",
  };
  if (email.idempotencyKey) {
    headers["Idempotency-Key"] = email.idempotencyKey;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: email.from ?? senderConfig.from,
      to: email.to,
      reply_to: email.replyTo,
      bcc: email.bcc,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: email.attachments?.map((file) => ({
        filename: file.filename,
        content: file.content,
        content_type: file.contentType,
      })),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to send ${email.tag} email: ${body || response.statusText}`);
  }

  return { delivery: "sent" };
}
