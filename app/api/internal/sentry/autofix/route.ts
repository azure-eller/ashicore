import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { AuthorizationError } from "@/lib/authz";
import {
  getSentryAutofixConfig,
  processSentryAutofix,
  SentryAutofixError,
  verifySentryAutofixRequest,
} from "@/lib/observability/sentry-autofix";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = apiHandler(async (request: Request) => {
  const body = await request.text();
  let config: ReturnType<typeof getSentryAutofixConfig>;

  try {
    config = getSentryAutofixConfig();
  } catch (error) {
    if (error instanceof SentryAutofixError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  if (
    !verifySentryAutofixRequest({
      body,
      headers: request.headers,
      secret: config.sentryWebhookSecret,
    })
  ) {
    throw new AuthorizationError("Invalid Sentry autofix token.", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await processSentryAutofix({ payload, config });
    return NextResponse.json({
      ok: true,
      action: result.action,
      pullRequest: {
        number: result.pr.number,
        url: result.pr.html_url,
      },
      sentryIssueId: result.packet.sentry.issueId,
      repo: result.packet.repo.fullName,
      branch: result.packet.repo.branchName,
    });
  } catch (error) {
    if (error instanceof SentryAutofixError && error.status < 500) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
});
