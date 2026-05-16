import "server-only";

import { sendTransactionalEmail } from "@/lib/email/send";
import { DEFAULT_EMAIL_FROM } from "@/lib/app-brand";
import { getAppName } from "@/lib/email/config";
import { escapeHtml } from "@/lib/format";

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

function getFeedbackRecipient(): string {
  const explicit = process.env.FEEDBACK_EMAIL?.trim();
  if (explicit) return explicit;

  const fallback = process.env.EMAIL_FROM?.trim();
  if (fallback) return fallback;

  return DEFAULT_EMAIL_FROM;
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
  const html = [
    '<div style="background:#f3f3f1;margin:0;padding:32px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;color:#13161b;">',
    '<div style="max-width:720px;margin:0 auto 16px;">',
    '<span style="display:inline-block;width:24px;background:#1c3d6b;color:#ffffff;font-size:13px;font-weight:700;line-height:24px;text-align:center;margin-right:10px;">a</span>',
    '<span style="font-size:17px;font-weight:700;line-height:24px;">ashicore</span>',
    "</div>",
    '<div style="background:#ffffff;border:1px solid #dcdcd6;max-width:720px;margin:0 auto;padding:24px;">',
    '<div style="color:#6a707a;font-size:12px;font-weight:700;letter-spacing:0.08em;line-height:16px;margin:0 0 12px;text-transform:uppercase;">Feedback</div>',
    `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:13px; line-height:20px; margin:0; white-space:pre-wrap; word-break:break-word;">${escapeHtml(text)}</pre>`,
    "</div>",
    "</div>",
  ].join("");

  return { text, html };
}

export async function sendFeedbackEmail(input: SendFeedbackEmailInput) {
  const recipient = getFeedbackRecipient();
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
