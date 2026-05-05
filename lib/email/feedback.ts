import "server-only";

import { sendTransactionalEmail } from "@/lib/email/send";
import { getAppName } from "@/lib/email/config";

export type FeedbackScreenshot = {
  filename: string;
  contentBase64: string;
};

export type FeedbackContext = {
  organizationName: string;
  pageUrl?: string | null;
  userAgent?: string | null;
  submittedAt: Date;
};

export type SendFeedbackEmailInput = {
  message: string;
  screenshots?: FeedbackScreenshot[];
  context: FeedbackContext;
};

function getFeedbackRecipient(): string | null {
  const explicit = process.env.FEEDBACK_EMAIL?.trim();
  if (explicit) return explicit;

  const fallback = process.env.EMAIL_FROM?.trim();
  if (fallback) return fallback;

  return null;
}

function buildSubject(message: string): string {
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const snippet = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
  return snippet ? `[${getAppName()} feedback] ${snippet}` : `[${getAppName()} feedback]`;
}

function buildBody({ message, context, screenshotCount }: {
  message: string;
  context: FeedbackContext;
  screenshotCount: number;
}) {
  const lines = [
    message.trim(),
    "",
    "---",
    "Context:",
    `  Organization: ${context.organizationName}`,
    `  Page: ${context.pageUrl ?? "(not provided)"}`,
    `  User agent: ${context.userAgent ?? "(not provided)"}`,
    `  Submitted: ${context.submittedAt.toISOString()}`,
    `  Screenshots: ${screenshotCount}`,
  ];

  const text = lines.join("\n");
  const html = `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word;">${escapeHtml(text)}</pre>`;

  return { text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendFeedbackEmail(input: SendFeedbackEmailInput) {
  const recipient = getFeedbackRecipient();
  if (!recipient) {
    throw new Error(
      "Feedback recipient is not configured. Set FEEDBACK_EMAIL (or EMAIL_FROM) in the environment."
    );
  }

  const screenshots = input.screenshots ?? [];
  const { text, html } = buildBody({
    message: input.message,
    context: input.context,
    screenshotCount: screenshots.length,
  });

  await sendTransactionalEmail({
    tag: "feedback",
    to: recipient,
    subject: buildSubject(input.message),
    text,
    html,
    attachments: screenshots.length
      ? screenshots.map((shot) => ({
          filename: shot.filename,
          content: shot.contentBase64,
        }))
      : undefined,
  });
}
