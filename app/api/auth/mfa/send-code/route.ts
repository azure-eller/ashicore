import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { auth } from "@/lib/auth";
import { sendMfaCodeEmail } from "@/lib/email/auth-emails";

export const runtime = "nodejs";

const OTP_DIGITS = 6;
const OTP_TTL_MS = 3 * 60 * 1000;
const TWO_FACTOR_COOKIE_NAME = "two_factor";

function hashOtp(code: string) {
  return createHash("sha256").update(code).digest("base64url");
}

function generateOtp() {
  let code = "";

  for (let i = 0; i < OTP_DIGITS; i += 1) {
    code += randomInt(0, 10).toString();
  }

  return code;
}

function parseCookies(cookieHeader: string | null) {
  const cookies = new Map<string, string>();

  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (key && !cookies.has(key)) {
      cookies.set(key, decodeURIComponent(value));
    }
  }

  return cookies;
}

async function verifySignedCookieValue(value: string, secret: string) {
  const signatureStart = value.lastIndexOf(".");

  if (signatureStart < 1) {
    return null;
  }

  const signedValue = value.slice(0, signatureStart);
  const signature = value.slice(signatureStart + 1);
  const expectedSignature = createHmac("sha256", secret)
    .update(signedValue)
    .digest("base64");

  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (actual.length !== expected.length) {
    return null;
  }

  return timingSafeEqual(actual, expected) ? signedValue : null;
}

async function getTwoFactorChallenge(request: Request) {
  const context = await auth.$context;
  const twoFactorCookie = context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
  const cookies = parseCookies(request.headers.get("cookie"));
  const cookieValue = cookies.get(twoFactorCookie.name);

  if (!cookieValue) {
    return null;
  }

  const signedValue = await verifySignedCookieValue(cookieValue, context.secret);

  if (!signedValue) {
    return null;
  }

  const verification = await context.internalAdapter.findVerificationValue(signedValue);

  if (!verification || verification.expiresAt < new Date()) {
    return null;
  }

  const user = await context.internalAdapter.findUserById(verification.value);

  if (!user?.email) {
    return null;
  }

  return {
    email: user.email,
    key: signedValue,
  };
}

async function getAuthenticatedChallenge(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user.email) {
    return null;
  }

  return {
    email: session.user.email,
    key: `${session.user.id}!${session.session.id}`,
  };
}

export const POST = apiHandler(async (request) => {
  const challenge =
    (await getAuthenticatedChallenge(request)) ??
    (await getTwoFactorChallenge(request));

  if (!challenge) {
    return NextResponse.json(
      { error: "MFA verification has expired. Sign in again to request a new code." },
      { status: 401 }
    );
  }

  const code = generateOtp();
  const context = await auth.$context;

  await context.internalAdapter.createVerificationValue({
    value: `${hashOtp(code)}:0`,
    identifier: `2fa-otp-${challenge.key}`,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  await sendMfaCodeEmail({
    email: challenge.email,
    code,
  });

  return NextResponse.json({ status: true });
});
