import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/request-body";
import {
  getCurrentOnboardingSession,
  patchOnboardingSessionSchema,
  startOnboardingSessionSchema,
  startOrResumeOnboardingSession,
  updateOnboardingSession,
} from "@/lib/onboarding/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const session = await getCurrentOnboardingSession();
  return NextResponse.json({ session });
});

export const POST = apiHandler(async (request) => {
  const input = await parseJsonBody(request, startOnboardingSessionSchema);
  const session = await startOrResumeOnboardingSession(input);
  return NextResponse.json({ session });
});

export const PATCH = apiHandler(async (request) => {
  const input = await parseJsonBody(request, patchOnboardingSessionSchema);
  const session = await updateOnboardingSession(input);
  return NextResponse.json({ session });
});

