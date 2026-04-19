import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { assertAgentApiAccess } from "@/lib/agent/erp/access";
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
  const actor = await assertAgentApiAccess(request.headers);
  const { sessionId } = await context.params;
  const body = createAgentTurnRequestSchema.parse(await request.json());
  const abortController = new AbortController();

  request.signal.addEventListener("abort", () => abortController.abort(), {
    once: true,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamClosed = false;
      const closeStream = () => {
        if (streamClosed) {
          return;
        }

        streamClosed = true;
        try {
          controller.close();
        } catch {
          // Ignore closed-stream races from client disconnects.
        }
      };
      const enqueueEvent = (event: string, payload: unknown) => {
        if (streamClosed || abortController.signal.aborted) {
          return false;
        }

        try {
          controller.enqueue(encodeSseEvent(event, payload));
          return true;
        } catch {
          streamClosed = true;
          abortController.abort();
          return false;
        }
      };

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
          if (!enqueueEvent(event.event, event.payload)) {
            break;
          }
        }
      } catch (error) {
        console.error("Agent turn failed:", error);
        enqueueEvent("error", {
            message: "The agent turn failed. Please try again.",
        });
      } finally {
        closeStream();
      }
    },
    cancel() {
      abortController.abort();
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
