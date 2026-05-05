import { expect, test } from "../fixtures";
import { ERP_AGENT_ENABLED } from "../../../lib/feature-flags";

const LIVE_AGENT_MODEL = process.env.LIVE_AGENT_MODEL?.trim() || "claude-haiku-4-5";
const LIVE_AGENT_PROMPT =
  "Reply with READY only. This is a connectivity smoke test. Do not use any tools.";

type ParsedSseEvent = {
  event: string;
  data: unknown;
};

function parseSseEvents(rawBody: string): ParsedSseEvent[] {
  return rawBody
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const eventLine = chunk
        .split("\n")
        .find((line) => line.startsWith("event: "));
      const dataLines = chunk
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length));

      if (!eventLine || dataLines.length === 0) {
        throw new Error(`Invalid SSE chunk: ${chunk}`);
      }

      return {
        event: eventLine.slice("event: ".length).trim(),
        data: JSON.parse(dataLines.join("\n")),
      } satisfies ParsedSseEvent;
    });
}

test.describe("Agent live smoke", () => {
  test("completes one live Anthropic turn on Haiku without stream errors", async ({
    page,
  }) => {
    test.skip(
      !ERP_AGENT_ENABLED,
      "ERP agent is disabled; see docs/erp-agent.md to re-enable."
    );
    test.skip(
      !process.env.LIVE_AGENT_SMOKE,
      "Set LIVE_AGENT_SMOKE=1 to run the live Anthropic smoke test."
    );
    test.skip(
      !process.env.ANTHROPIC_API_KEY,
      "ANTHROPIC_API_KEY is required for the live Anthropic smoke test."
    );

    await page.goto("/sales/customers");

    const createSessionResponse = await page.evaluate(async () => {
      const response = await fetch("/api/agent/sessions", {
        method: "POST",
      });

      return {
        ok: response.ok,
        status: response.status,
        body: await response.json(),
      };
    });

    expect(createSessionResponse.ok).toBe(true);
    expect(createSessionResponse.status).toBe(201);

    const sessionId =
      typeof createSessionResponse.body === "object" &&
      createSessionResponse.body != null &&
      "session" in createSessionResponse.body &&
      typeof createSessionResponse.body.session === "object" &&
      createSessionResponse.body.session != null &&
      "id" in createSessionResponse.body.session &&
      typeof createSessionResponse.body.session.id === "string"
        ? createSessionResponse.body.session.id
        : null;

    expect(sessionId).toBeTruthy();

    const turnResponse = await page.evaluate(
      async ({ model, prompt, targetSessionId }) => {
        const response = await fetch(`/api/agent/sessions/${targetSessionId}/turns`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Provider": "anthropic",
            "X-Agent-Model": model,
          },
          body: JSON.stringify({ text: prompt }),
        });

        return {
          ok: response.ok,
          status: response.status,
          body: await response.text(),
        };
      },
      {
        model: LIVE_AGENT_MODEL,
        prompt: LIVE_AGENT_PROMPT,
        targetSessionId: sessionId!,
      }
    );

    expect(turnResponse.ok).toBe(true);
    expect(turnResponse.status).toBe(200);

    const events = parseSseEvents(turnResponse.body);
    const errorEvent = events.find((event) => event.event === "error");
    const turnCompleteEvent = [...events]
      .reverse()
      .find((event) => event.event === "turn_complete");
    const assistantText = events
      .filter(
        (event): event is ParsedSseEvent & { data: { text: string } } =>
          event.event === "assistant_delta" &&
          typeof event.data === "object" &&
          event.data != null &&
          "text" in event.data &&
          typeof event.data.text === "string"
      )
      .map((event) => event.data.text)
      .join("")
      .trim();

    expect(errorEvent).toBeUndefined();
    expect(turnCompleteEvent?.data).toMatchObject({ status: "completed" });
    expect(assistantText.toUpperCase()).toContain("READY");

    const snapshotResponse = await page.evaluate(async (targetSessionId) => {
      const response = await fetch(`/api/agent/sessions/${targetSessionId}`, {
        cache: "no-store",
      });

      return {
        ok: response.ok,
        status: response.status,
        body: await response.json(),
      };
    }, sessionId);

    expect(snapshotResponse.ok).toBe(true);
    expect(snapshotResponse.status).toBe(200);
    expect(snapshotResponse.body.session.status).toBe("completed");
    expect(snapshotResponse.body.session.lastError).toBeNull();
  });
});
