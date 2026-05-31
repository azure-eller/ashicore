import { apiHandler } from "@/lib/api/handler";
import { jsonError, jsonFlag } from "@/lib/api/responses";
import { auth } from "@/lib/auth";
import {
  generateOtp,
  getMobileMfaChallenge,
  hashOtp,
  OTP_TTL_MS,
} from "@/lib/auth/mobile-mfa";
import { sendMfaCodeEmail } from "@/lib/email/auth-emails";

export const runtime = "nodejs";

export const POST = apiHandler(async (request) => {
  const challenge = await getMobileMfaChallenge(request);

  if (!challenge) {
    return jsonError(
      "MFA verification has expired. Sign in again to request a new code.",
      401
    );
  }

  const code = generateOtp();
  const context = await auth.$context;
  const identifier = `2fa-otp-${challenge.key}`;

  // Better Auth's send-otp endpoint can report success after email delivery
  // fails. Own the send path so the UI only shows success after Resend accepts.
  await context.internalAdapter.deleteVerificationByIdentifier(identifier);
  await context.internalAdapter.createVerificationValue({
    value: `${hashOtp(code)}:0`,
    identifier,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  await sendMfaCodeEmail({
    email: challenge.email,
    code,
  });

  return jsonFlag("status");
});
