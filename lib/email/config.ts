import "server-only";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { APP_NAME, DEFAULT_EMAIL_FROM } from "@/lib/app-brand";
import { env } from "@/lib/env";

export { getCanonicalAppUrl };

export function getEmailSenderConfig() {
  const resendApiKey = env.RESEND_API_KEY?.trim();
  const from = getConfiguredEmailFrom();

  if (resendApiKey) {
    return { resendApiKey, from };
  }

  if (env.EMAIL_OUTBOX_ONLY === "1") {
    return null;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing RESEND_API_KEY for transactional email delivery."
    );
  }

  return null;
}

export function getConfiguredEmailFrom() {
  return env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
}

export function formatEmailFromDisplayName(
  displayName: string,
  configuredFrom = getConfiguredEmailFrom(),
) {
  const name = displayName.trim();
  if (!name) {
    return configuredFrom;
  }

  const addressMatch = configuredFrom.match(/<([^<>]+)>/);
  const address = (addressMatch?.[1] ?? configuredFrom).trim();
  const escapedName = name.replace(/["\\]/g, "");
  return `"${escapedName}" <${address}>`;
}

export function getAppName(): string {
  return env.APP_NAME?.trim() || APP_NAME;
}
