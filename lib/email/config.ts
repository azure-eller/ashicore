import "server-only";

export function getCanonicalAppUrl() {
  if (process.env.BETTER_AUTH_URL) {
    return process.env.BETTER_AUTH_URL;
  }

  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing BETTER_AUTH_URL or NEXT_PUBLIC_APP_URL — cannot generate auth email links in production."
    );
  }

  if (process.env.PORT) {
    return `http://localhost:${process.env.PORT}`;
  }

  return "http://localhost:3000";
}

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
