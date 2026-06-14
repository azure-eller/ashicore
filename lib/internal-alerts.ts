import "server-only";

import { sendTransactionalEmail } from "@/lib/email/send";
import { env } from "@/lib/env";

type AlertField = {
  label: string;
  value: string | number | boolean | Date | null | undefined;
};

type FounderAlertInput = {
  kind:
    | "free_signup"
    | "checkout_started"
    | "subscription_active"
    | "subscription_attention"
    | "feature_gate_hit";
  subject: string;
  fields: AlertField[];
  idempotencyKey?: string;
};

function alertRecipients() {
  return (env.ASHICORE_ALERT_EMAILS ?? env.INTERNAL_ALERT_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatValue(value: AlertField["value"]) {
  if (value === null || value === undefined || value === "") {
    return "n/a";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function renderText(fields: AlertField[]) {
  return fields
    .map((field) => `${field.label}: ${formatValue(field.value)}`)
    .join("\n");
}

function renderHtml(fields: AlertField[]) {
  const rows = fields
    .map((field) => {
      const label = escapeHtml(field.label);
      const value = escapeHtml(formatValue(field.value));
      return `<tr><th align="left" style="padding:6px 12px 6px 0;">${label}</th><td style="padding:6px 0;">${value}</td></tr>`;
    })
    .join("");

  return `<table>${rows}</table>`;
}

export async function sendFounderAlert(input: FounderAlertInput) {
  const recipients = alertRecipients();
  if (recipients.length === 0) {
    return;
  }

  try {
    await sendTransactionalEmail({
      tag: "internal-alert",
      to: recipients[0],
      bcc: recipients.slice(1),
      subject: input.subject,
      text: renderText(input.fields),
      html: renderHtml(input.fields),
      idempotencyKey: input.idempotencyKey,
    });
  } catch (error) {
    console.error("Failed to send founder alert.", {
      kind: input.kind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
