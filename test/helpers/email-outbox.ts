import fs from "node:fs/promises";
import path from "node:path";
import { EMAIL_OUTBOX_DIR } from "../../lib/email/outbox";

export type EmailOutboxEntry = {
  attachments?: Array<{
    filename: string;
    content: string;
    contentType?: string;
  }>;
  bcc?: string | string[];
  createdAt: string;
  from?: string;
  html: string;
  subject: string;
  tag: string;
  text: string;
  to: string;
};

const FALLBACK_EMAIL_OUTBOX_DIR = path.resolve(__dirname, "../..", ".tmp", "email-outbox");
const EMAIL_OUTBOX_DIRS = Array.from(
  new Set([EMAIL_OUTBOX_DIR, FALLBACK_EMAIL_OUTBOX_DIR])
);

export async function waitForOutboxEmail({
  since,
  tag,
  to,
  timeoutMs = 10_000,
}: {
  since: number;
  tag: EmailOutboxEntry["tag"];
  to: string;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + timeoutMs;
  const normalizedTo = to.toLowerCase();

  while (Date.now() < deadline) {
    const entries = await readOutboxEmails();
    const match = entries
      .filter((entry) => entry.tag === tag)
      .filter((entry) => entry.to.toLowerCase() === normalizedTo)
      .find((entry) => Date.parse(entry.createdAt) >= since);

    if (match) {
      return match;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `Timed out waiting for ${tag} email to ${to}. Checked: ${EMAIL_OUTBOX_DIRS.join(", ")}.`
  );
}

export async function findOutboxEmails({
  since,
  tag,
  to,
}: {
  since: number;
  tag: EmailOutboxEntry["tag"];
  to: string;
}) {
  const normalizedTo = to.toLowerCase();
  const entries = await readOutboxEmails();
  return entries
    .filter((entry) => entry.tag === tag)
    .filter((entry) => entry.to.toLowerCase() === normalizedTo)
    .filter((entry) => Date.parse(entry.createdAt) >= since);
}

export function extractFirstUrl(value: string) {
  const match = value.match(/https?:\/\/\S+/);

  if (!match) {
    throw new Error("Could not find a URL in the email payload.");
  }

  return match[0];
}

async function readOutboxEmails() {
  const emails: EmailOutboxEntry[] = [];

  for (const dir of EMAIL_OUTBOX_DIRS) {
    const fileNames = await fs.readdir(dir).catch(() => []);

    for (const fileName of fileNames) {
      try {
        const content = await fs.readFile(path.join(dir, fileName), "utf8");
        emails.push(JSON.parse(content) as EmailOutboxEntry);
      } catch {
        // Ignore transient partial writes and keep polling.
      }
    }
  }

  return emails.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
