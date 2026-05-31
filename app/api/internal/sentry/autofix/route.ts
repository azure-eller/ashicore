import { apiHandler } from "@/lib/api/handler";
import { jsonError, jsonOk } from "@/lib/api/responses";
import { AuthorizationError } from "@/lib/authz";
import { requestSearchParams } from "@/lib/routing/search-params";
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
  const token = requestSearchParams(request).get("token");
  let config: ReturnType<typeof getSentryAutofixConfig>;

  try {
    config = getSentryAutofixConfig();
  } catch (error) {
    if (error instanceof SentryAutofixError) {
      return jsonError(error.message, 503);
    }
    throw error;
  }

  if (
    !verifySentryAutofixRequest({
      body,
      headers: request.headers,
      secret: config.sentryWebhookSecret,
      token,
    })
  ) {
    throw new AuthorizationError("Invalid Sentry autofix token.", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return jsonError("Invalid JSON");
  }

  try {
    const result = await processSentryAutofix({ payload, config });
    return jsonOk({
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
      return jsonError(error.message, error.status);
    }
    throw error;
  }
});
