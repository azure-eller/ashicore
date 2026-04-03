import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { getEmailSenderConfig } from "@/lib/email/config";

export type TransactionalEmailInput = {
  tag: "email-verification" | "password-reset" | "team-invite";
  to: string;
  subject: string;
  html: string;
  text: string;
};

const EMAIL_OUTBOX_DIR = path.join(process.cwd(), ".tmp", "email-outbox");

function sanitizeFileSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

  if (process.env.EMAIL_OUTBOX_ONLY === "1" || !senderConfig) {
    await writeEmailOutbox(email);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${senderConfig.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: senderConfig.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to send ${email.tag} email: ${body || response.statusText}`);
  }
}
