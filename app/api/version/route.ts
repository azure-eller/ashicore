import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, unauthenticated, no org data: reports which commit the responding
// server was built from so a merge can be confirmed live in production.
export async function GET() {
  return NextResponse.json(
    {
      commitSha: env.VERCEL_GIT_COMMIT_SHA ?? null,
      environment: env.VERCEL_ENV ?? null,
      deploymentId: env.VERCEL_DEPLOYMENT_ID ?? null,
      checkedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
