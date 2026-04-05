import "server-only";

import { render } from "@react-email/components";
import { getCanonicalAppUrl } from "@/lib/email/config";
import { EmailVerification } from "@/lib/email/components/email-verification";
import { PasswordReset } from "@/lib/email/components/password-reset";
import { sendTransactionalEmail } from "@/lib/email/send";

function toCanonicalUrl(url: string): string {
  const parsed = new URL(url);
  const base = getCanonicalAppUrl();
  return new URL(parsed.pathname + parsed.search, base).toString();
}

export async function sendAccountEmailVerificationEmail({
  email,
  url,
}: {
  email: string;
  url: string;
}) {
  const canonicalUrl = toCanonicalUrl(url);
  const html = await render(<EmailVerification url={canonicalUrl} />);
  const text = await render(<EmailVerification url={canonicalUrl} />, {
    plainText: true,
  });

  await sendTransactionalEmail({
    tag: "email-verification",
    to: email,
    subject: "Confirm your email address",
    html,
    text,
  });
}

export async function sendPasswordResetEmail({
  email,
  url,
}: {
  email: string;
  url: string;
}) {
  const canonicalUrl = toCanonicalUrl(url);
  const html = await render(<PasswordReset url={canonicalUrl} />);
  const text = await render(<PasswordReset url={canonicalUrl} />, {
    plainText: true,
  });

  await sendTransactionalEmail({
    tag: "password-reset",
    to: email,
    subject: "Reset your password",
    html,
    text,
  });
}
