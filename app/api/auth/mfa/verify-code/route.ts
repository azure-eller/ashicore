import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { parseOptionalJsonBody } from "@/lib/api/request-body";
import { jsonError } from "@/lib/api/responses";
import { auth } from "@/lib/auth";
import { getMobileMfaChallenge, otpMatches } from "@/lib/auth/mobile-mfa";
import { requestUrl } from "@/lib/routing/search-params";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 5;
const verifyCodeBodySchema = z
  .object({
    code: z.unknown().optional(),
    trustDevice: z.unknown().optional(),
  })
  .nullish();

export const POST = apiHandler(async (request) => {
  const body = await parseOptionalJsonBody(request, verifyCodeBodySchema, null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const trustDevice = body?.trustDevice === true;

  if (!/^\d{6}$/.test(code)) {
    return jsonError("Enter the 6-digit code.");
  }

  const challenge = await getMobileMfaChallenge(request);

  if (!challenge) {
    return NextResponse.json(
      { error: "MFA verification has expired. Sign in again to request a new code." },
      { status: 401 }
    );
  }

  const context = await auth.$context;
  const identifier = `2fa-otp-${challenge.key}`;
  const verification = await context.internalAdapter.findVerificationValue(identifier);
  const [storedOtp, counter = "0"] = verification?.value?.split(":") ?? [];

  if (!verification || verification.expiresAt < new Date()) {
    if (verification) {
      await context.internalAdapter.deleteVerificationByIdentifier(identifier);
    }

    return NextResponse.json(
      { error: "Code expired. Send a new email code." },
      { status: 400 }
    );
  }

  const attemptCount = Number.parseInt(counter, 10) || 0;

  if (attemptCount >= MAX_ATTEMPTS) {
    await context.internalAdapter.deleteVerificationByIdentifier(identifier);

    return NextResponse.json(
      { error: "Too many attempts. Send a new email code." },
      { status: 400 }
    );
  }

  if (!storedOtp || !otpMatches(storedOtp, code)) {
    await context.internalAdapter.updateVerificationByIdentifier(identifier, {
      value: `${storedOtp}:${attemptCount + 1}`,
    });

    return jsonError("Incorrect code.", 401);
  }

  const userWithMfaFlag = challenge.user as typeof challenge.user & {
    twoFactorEnabled?: boolean | null;
  };

  if (!userWithMfaFlag.twoFactorEnabled) {
    await context.internalAdapter.updateUser(challenge.user.id, {
      twoFactorEnabled: true,
    });
  }

  const url = requestUrl(request);
  const upstream = await fetch(new URL("/api/auth/two-factor/verify-otp", url), {
    method: "POST",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      origin: request.headers.get("origin") ?? url.origin,
      "content-type": "application/json",
    },
    body: JSON.stringify({ code, trustDevice }),
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
});
