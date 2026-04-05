import "server-only";
import { getCanonicalAppUrl } from "@/lib/app-url";

export { getCanonicalAppUrl };

export function getEmailSenderConfig() {
  const resendApiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (resendApiKey && from) {
    return { resendApiKey, from };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing RESEND_API_KEY or EMAIL_FROM for transactional email delivery."
    );
  }

  return null;
}

export function getAppName(): string {
  return process.env.APP_NAME ?? "ERP";
}
