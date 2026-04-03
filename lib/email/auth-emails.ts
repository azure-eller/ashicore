import "server-only";

import { sendTransactionalEmail } from "@/lib/email/send";

export async function sendAccountEmailVerificationEmail({
  email,
  url,
}: {
  email: string;
  url: string;
}) {
  await sendTransactionalEmail({
    tag: "email-verification",
    to: email,
    subject: "Confirm your email address",
    html: [
      "<p>Confirm this email address for your ERP account.</p>",
      `<p><a href="${url}">Verify email address</a></p>`,
      "<p>If the button does not work, paste this link into your browser:</p>",
      `<p>${url}</p>`,
    ].join(""),
    text: `Confirm this email address for your ERP account: ${url}`,
  });
}

export async function sendPasswordResetEmail({
  email,
  url,
}: {
  email: string;
  url: string;
}) {
  await sendTransactionalEmail({
    tag: "password-reset",
    to: email,
    subject: "Reset your ERP password",
    html: [
      "<p>We received a request to reset your ERP password.</p>",
      `<p><a href="${url}">Reset password</a></p>`,
      "<p>If you did not request this change, you can ignore this email.</p>",
      "<p>If the button does not work, paste this link into your browser:</p>",
      `<p>${url}</p>`,
    ].join(""),
    text: `Reset your ERP password: ${url}`,
  });
}
