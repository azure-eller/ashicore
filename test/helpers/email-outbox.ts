import fs from "node:fs/promises";
import path from "node:path";

export type EmailOutboxEntry = {
  createdAt: string;
  html: string;
  subject: string;
  tag: string;
  text: string;
  to: string;
};

const EMAIL_OUTBOX_DIR = path.join(process.cwd(), ".tmp", "email-outbox");

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
    const entries = await readOutboxEmails().catch(() => []);
    const match = entries
      .filter((entry) => entry.tag === tag)
      .filter((entry) => entry.to.toLowerCase() === normalizedTo)
      .find((entry) => Date.parse(entry.createdAt) >= since);

    if (match) {
      return match;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Timed out waiting for ${tag} email to ${to}.`);
}

export function extractFirstUrl(value: string) {
  const match = value.match(/https?:\/\/\S+/);

  if (!match) {
    throw new Error("Could not find a URL in the email payload.");
  }

  return match[0];
}

async function readOutboxEmails() {
  const fileNames = await fs.readdir(EMAIL_OUTBOX_DIR);

  const emails = await Promise.all(
    fileNames.map(async (fileName) => {
      const content = await fs.readFile(path.join(EMAIL_OUTBOX_DIR, fileName), "utf8");
      return JSON.parse(content) as EmailOutboxEntry;
    })
  );

  return emails.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
