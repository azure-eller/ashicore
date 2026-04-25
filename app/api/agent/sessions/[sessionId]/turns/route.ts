import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { isErpAgentEnabled } from "@/lib/feature-flags";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

const DEV_AGENT_MODEL_PATTERN = /^claude-[a-z0-9-]{1,96}$/;

function getRequestedAgentProvider(headers: Headers) {
  const provider = headers.get("x-agent-provider");
  return provider === "fake" || provider === "anthropic" ? provider : null;
}

function getRequestedAgentModel(headers: Headers) {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const model = headers.get("x-agent-model")?.trim() ?? "";
  return DEV_AGENT_MODEL_PATTERN.test(model) ? model : null;
}

function encodeSseEvent(event: string, payload: unknown) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export const POST = apiHandler(async (request, context: RouteContext) => {
  if (!isErpAgentEnabled()) {
    return notFound();
  }

  const [
    { assertAgentApiAccess },
    { createAgentTurnRequestSchema },
    { runAgentTurn },
  ] = await Promise.all([
    import("@/lib/agent/erp/access"),
    import("@/lib/agent/erp/types"),
    import("@/lib/agent/erp/session-service"),
  ]);
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
          modelOverride: getRequestedAgentModel(request.headers),
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
