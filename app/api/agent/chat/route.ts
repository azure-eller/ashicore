import { randomUUID } from "node:crypto";
import { z } from "zod";
import { jsonError } from "@/lib/api/responses";
import { parseJsonBody } from "@/lib/api/request-body";
import { AuthorizationError } from "@/lib/authz";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import {
  createDashboardChatResponse,
  dashboardChatRequestSchema,
} from "@/lib/agent/chat/ui-message-adapter";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-headers";
import { captureAppError } from "@/lib/observability/sentry";

export const runtime = "nodejs";
export const maxDuration = 300;

function errorResponse(message: string, status: number, requestId: string) {
  const response = jsonError(message, status, { requestId });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export async function POST(request: Request) {
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? randomUUID();

  try {
    const [context, body] = await Promise.all([
      getAuthedApiMemberContext(request.headers),
      parseJsonBody(request, dashboardChatRequestSchema),
    ]);

    return createDashboardChatResponse({
      messages: body.messages,
      organizationName: context.organizationName,
      pageContext: body.context,
      chatId: body.id,
      member: {
        userId: context.userId,
        orgId: context.orgId,
        memberId: context.memberId,
        assignedRoles: context.assignedRoles,
      },
      abortSignal: request.signal,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, error.status, requestId);
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return errorResponse("Invalid chat request.", 400, requestId);
    }

    captureAppError(error, {
      requestId,
      route: "/api/agent/chat",
      method: "POST",
      runtime: process.env.NEXT_RUNTIME ?? "nodejs",
      source: "agent_chat_route",
    });

    return errorResponse("Internal server error", 500, requestId);
  }
}
