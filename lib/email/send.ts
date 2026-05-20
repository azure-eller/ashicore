import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { getEmailSenderConfig } from "@/lib/email/config";
import { EMAIL_OUTBOX_DIR, EMAIL_OUTBOX_MODE_FLAG } from "@/lib/email/outbox";

export type TransactionalEmailAttachment = {
  filename: string;
  /** Base64-encoded content. */
  content: string;
};

export type TransactionalEmailInput = {
  tag:
    | "email-verification"
    | "mfa-code"
    | "password-reset"
    | "team-invite"
    | "purchase-order"
    | "invoice"
    | "daily-manufacturing-report";
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: TransactionalEmailAttachment[];
  idempotencyKey?: string;
};

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

  const filePath = path.join(
    EMAIL_OUTBOX_DIR,
    `${Date.now()}-${email.tag}-${sanitizeFileSegment(email.to)}.json`
  );

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
    "utf8"
  );

  console.info(`[email:${email.tag}] Wrote local email delivery to ${filePath}`);
}

export async function sendTransactionalEmail(email: TransactionalEmailInput) {
  const senderConfig = getEmailSenderConfig();

  if (!senderConfig || (await shouldWriteEmailOutbox())) {
    await writeEmailOutbox(email);
    return;
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
      from: senderConfig.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: email.attachments?.map((file) => ({
        filename: file.filename,
        content: file.content,
      })),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to send ${email.tag} email: ${body || response.statusText}`);
  }
}
