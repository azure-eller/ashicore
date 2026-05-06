import "server-only";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { APP_NAME, DEFAULT_EMAIL_FROM } from "@/lib/app-brand";

export { getCanonicalAppUrl };

export function getEmailSenderConfig() {
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;

  if (resendApiKey) {
    return { resendApiKey, from };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing RESEND_API_KEY for transactional email delivery."
    );
  }

  return null;
}

export function getAppName(): string {
  return process.env.APP_NAME?.trim() || APP_NAME;
}
