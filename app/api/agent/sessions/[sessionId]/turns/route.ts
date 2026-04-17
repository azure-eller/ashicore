import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertModuleWriteAccess } from "@/lib/dal/auth";
import { createAgentTurnRequestSchema } from "@/lib/agent/erp/types";
import { runAgentTurn } from "@/lib/agent/erp/session-service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

function getRequestedAgentProvider(headers: Headers) {
  const provider = headers.get("x-agent-provider");
  return provider === "fake" || provider === "anthropic" ? provider : null;
}

function encodeSseEvent(event: string, payload: unknown) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export const POST = apiHandler(async (request, context: RouteContext) => {
  const actor = await assertModuleWriteAccess("sales", request.headers);
  const { sessionId } = await context.params;
  const body = createAgentTurnRequestSchema.parse(await request.json());
  const abortController = new AbortController();

  request.signal.addEventListener("abort", () => abortController.abort(), {
    once: true,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runAgentTurn({
          sessionId,
          actor: {
            userId: actor.userId,
            orgId: actor.orgId,
            assignedRoles: actor.assignedRoles,
          },
          input: body,
          signal: abortController.signal,
          providerOverride: getRequestedAgentProvider(request.headers),
        })) {
          controller.enqueue(encodeSseEvent(event.event, event.payload));
        }
      } catch (error) {
        console.error("Agent turn failed:", error);
        controller.enqueue(
          encodeSseEvent("error", {
            message: "The agent turn failed. Please try again.",
          })
        );
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});
