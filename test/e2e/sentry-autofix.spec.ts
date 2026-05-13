import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  buildAutofixBranchName,
  buildAutofixPrBody,
  buildAutofixPrTitle,
  normalizeAgentDebugPacket,
  parseSentryWebhookPayload,
  processSentryAutofix,
  replaceAutofixPacketBlock,
  verifySentryAutofixRequest,
} from "@/lib/observability/sentry-autofix";

const config = {
  sentryWebhookSecret: "webhook-secret",
  sentryAuthToken: "sentry-token",
  sentryOrg: "7050technologies",
  sentryWebProject: "javascript-nextjs",
  sentryAndroidProject: "ashicore-android",
  githubToken: "github-token",
  githubWebRepo: "azure-eller/erp",
  githubAndroidRepo: "azure-eller/erp-android",
};

test("verifies bearer and Sentry HMAC webhook auth", () => {
  const body = JSON.stringify({ ok: true });
  const signature = createHmac("sha256", config.sentryWebhookSecret).update(body).digest("hex");

  expect(
    verifySentryAutofixRequest({
      body,
      headers: new Headers({ authorization: `Bearer ${config.sentryWebhookSecret}` }),
      secret: config.sentryWebhookSecret,
    })
  ).toBe(true);
  expect(
    verifySentryAutofixRequest({
      body,
      headers: new Headers({ "sentry-hook-signature": signature }),
      secret: config.sentryWebhookSecret,
    })
  ).toBe(true);
  expect(
    verifySentryAutofixRequest({
      body,
      headers: new Headers({ "sentry-hook-signature": "bad" }),
      secret: config.sentryWebhookSecret,
    })
  ).toBe(false);
});

test("parses Sentry alert payloads and strips query strings", () => {
  const parsed = parseSentryWebhookPayload({
    data: {
      issue: {
        id: "123456789",
        permalink: "https://sentry.io/issues/123456789/?project=1",
        project: { slug: "javascript-nextjs" },
      },
      event: {
        event_id: "event-1",
      },
    },
  });

  expect(parsed).toEqual({
    issueId: "123456789",
    eventId: "event-1",
    project: "javascript-nextjs",
    issueUrl: "https://sentry.io/issues/123456789/",
  });
});

test("normalizes safe web packet fields and redacts sensitive contexts", () => {
  const packet = normalizeAgentDebugPacket({
    parsed: {
      issueId: "123456789",
      eventId: "event-1",
      project: "javascript-nextjs",
      issueUrl: "https://sentry.io/issues/123456789/?project=1",
    },
    config,
    details: {
      issue: {
        title: "Undefined column",
        culprit: "ship order",
        project: { slug: "javascript-nextjs" },
      },
      event: {
        tags: [
          { key: "error.kind", value: "postgres" },
          { key: "error.domain", value: "db" },
          { key: "module", value: "sales" },
          { key: "operation", value: "sales_order.ship" },
          { key: "source", value: "api_handler" },
          { key: "request_id", value: "req_123" },
          { key: "release_sha", value: "abc123" },
          { key: "environment", value: "production" },
          { key: "route", value: "https://customer.example.com/api/sales-orders/1/ship?token=secret" },
          { key: "method", value: "POST" },
        ],
        contexts: {
          app_debug: {
            route: "https://customer.example.com/api/sales-orders/1/ship?customer=Acme",
            authorization: "Bearer secret",
            customer_notes: "private note",
            sku: "SKU-123",
            quantity: "10",
            safe_flag: true,
          },
          db: {
            code: "42703",
            table: "sales_orders",
            query_kind: "select",
            sql: "select secret",
          },
          request: {
            body: { password: "hunter2" },
          },
        },
      },
    },
  });

  expect(packet.repo.fullName).toBe("azure-eller/erp");
  expect(packet.repo.branchName).toBe("agent/sentry-123456789-sales-order-ship");
  expect(packet.app.route).toBe("/api/sales-orders/1/ship");
  expect(packet.app.requestId).toBe("req_123");
  expect(packet.safeContexts).toEqual({
    app_debug: {
      route: "/api/sales-orders/1/ship",
      safe_flag: true,
    },
    db: {
      code: "42703",
      table: "sales_orders",
      query_kind: "select",
    },
  });
  expect(JSON.stringify(packet)).not.toContain("Bearer secret");
  expect(JSON.stringify(packet)).not.toContain("private note");
  expect(JSON.stringify(packet)).not.toContain("password");
  expect(JSON.stringify(packet)).not.toContain("quantity");
  expect(JSON.stringify(packet)).not.toContain("select secret");
  expect(JSON.stringify(packet)).not.toContain("SKU-123");
  const body = buildAutofixPrBody(packet);
  expect(body).toContain("<!-- sentry-autofix-packet:start -->");
  expect(body).toContain("<!-- sentry-autofix-packet:end -->");
  expect(body).not.toContain("Bearer secret");
  expect(body).not.toContain("select secret");
  expect(body).not.toContain("hunter2");
  expect(body).not.toContain("customer=Acme");
  expect(body).not.toContain("project=1");
  expect(body).not.toContain("private note");
  expect(body).not.toContain("SKU-123");
  expect(body).not.toContain("https://customer.example.com");
});

test("routes Android project packets to the Android repo", () => {
  const packet = normalizeAgentDebugPacket({
    parsed: {
      issueId: "987654321",
      project: "ashicore-android",
    },
    config,
    details: {
      issue: {
        title: "HTTP 500",
        project: { slug: "ashicore-android" },
      },
      event: {
        tags: {
          "error.kind": "http_500",
          "error.domain": "api",
          source: "android_api",
          api_path: "https://vendor.example.test/api/sales-orders/1?customer=Acme",
          method: "GET",
          http_status: "500",
          screen: "SalesOrderDetail",
        },
      },
    },
  });

  expect(packet.app.platform).toBe("android");
  expect(packet.repo.fullName).toBe("azure-eller/erp-android");
  expect(packet.app.apiPath).toBe("/api/sales-orders/1");
  expect(buildAutofixPrTitle(packet)).toBe("[Sentry Autofix] SalesOrderDetail: http_500");
  expect(buildAutofixPrBody(packet)).toContain("./gradlew assembleDebug");
});

test("builds stable branch names with attempt suffixes", () => {
  expect(
    buildAutofixBranchName({
      issueId: "123",
      slugSource: "sales_order.ship: postgres_missing_column",
    })
  ).toBe("agent/sentry-123-sales-order-ship-postgres-missing-column");
  expect(
    buildAutofixBranchName({
      issueId: "123",
      slugSource: "sales_order.ship",
      attempt: 2,
    })
  ).toBe("agent/sentry-123-attempt-2-sales-order-ship");
});

test("replaces only the packet block in an existing PR body", () => {
  const packet = normalizeAgentDebugPacket({
    parsed: { issueId: "123456789", project: "javascript-nextjs" },
    config,
    details: {
      issue: { title: "Undefined column", project: { slug: "javascript-nextjs" } },
      event: {
        tags: {
          "error.kind": "postgres",
          "error.domain": "db",
          source: "api_handler",
          route: "/api/sales-orders/1/ship",
          request_id: "req_new",
        },
      },
    },
  });
  const existing = `${buildAutofixPrBody({
    ...packet,
    app: { ...packet.app, requestId: "req_old" },
  })}

## Codex Findings

Root cause: preserve me.
Tests run: preserve these too.`;

  const updated = replaceAutofixPacketBlock(existing, packet);

  expect(updated).toContain("Request ID: req_new");
  expect(updated).not.toContain("Request ID: req_old");
  expect(updated).toContain("Root cause: preserve me.");
  expect(updated).toContain("Tests run: preserve these too.");
});

test("dedupes open PRs and does not tag Codex twice", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, init });

    if (requestUrl.includes("/issues/123456789/events/")) {
      return jsonResponse({
        data: [
          {
            event_id: "event-2",
            tags: {
              "error.kind": "postgres",
              "error.domain": "db",
              source: "api_handler",
              route: "/api/sales-orders/1?token=secret",
              request_id: "req_2",
            },
          },
        ],
      });
    }
    if (requestUrl.includes("/issues/123456789/")) {
      return jsonResponse({
        title: "Undefined column",
        project: { slug: "javascript-nextjs" },
        permalink: "https://sentry.io/issues/123456789/",
      });
    }
    if (requestUrl.includes("/search/issues")) {
      return jsonResponse({
        items: [
          {
            number: 44,
            state: "open",
            body: "Sentry issue ID: 123456789",
            html_url: "https://github.com/azure-eller/erp/pull/44",
          },
        ],
      });
    }
    if (requestUrl.endsWith("/issues/44/comments") && init?.method !== "POST") {
      return jsonResponse([{ body: "@codex already working" }]);
    }
    if (requestUrl.includes("/contents/.autofix/sentry/123456789.md") && init?.method !== "PUT") {
      return jsonResponse({ sha: "marker-sha" });
    }
    if (requestUrl.endsWith("/pulls/44")) {
      return jsonResponse({
        number: 44,
        state: "open",
        html_url: "https://github.com/azure-eller/erp/pull/44",
        head: { ref: "agent/sentry-123456789-undefined-column" },
        body: `${buildAutofixPrBody(
          normalizeAgentDebugPacket({
            parsed: { issueId: "123456789", project: "javascript-nextjs" },
            config,
            details: {
              issue: { title: "Undefined column", project: { slug: "javascript-nextjs" } },
              event: { tags: { request_id: "req_old", source: "api_handler" } },
            },
          })
        )}

## Codex Findings

Root cause: keep this.`,
      });
    }
    if (requestUrl.endsWith("/issues/44/comments") && init?.method === "POST") {
      return jsonResponse({ id: 1 });
    }
    if (init?.method === "PUT") return jsonResponse({ content: {} });

    return jsonResponse({});
  };

  const result = await processSentryAutofix({
    config,
    fetchImpl: fetchImpl as typeof fetch,
    payload: {
      data: {
        issue: { id: "123456789", project: { slug: "javascript-nextjs" } },
      },
    },
  });

  expect(result.action).toBe("updated");
  const postedComments = calls.filter(
    (call) => call.url.endsWith("/issues/44/comments") && call.init?.method === "POST"
  );
  expect(postedComments).toHaveLength(1);
  expect(JSON.stringify(postedComments[0].init?.body)).not.toContain("@codex");
  expect(calls.some((call) => call.url.includes("/pulls") && call.init?.method === "POST")).toBe(false);
  const prPatch = calls.find((call) => call.url.endsWith("/pulls/44") && call.init?.method === "PATCH");
  expect(JSON.stringify(prPatch?.init?.body)).toContain("Root cause: keep this.");
  expect(JSON.stringify(prPatch?.init?.body)).toContain("req_2");
});

test("creates branches with slash-separated Git ref paths", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, init });

    if (requestUrl.includes("/issues/555/events/")) {
      return jsonResponse([
        {
          event_id: "event-555",
          tags: {
            source: "api_handler",
            operation: "sales_order.ship",
          },
        },
      ]);
    }
    if (requestUrl.includes("/issues/555/")) {
      return jsonResponse({
        title: "Ship failed",
        project: { slug: "javascript-nextjs" },
        permalink: "https://sentry.io/issues/555/?project=1",
      });
    }
    if (requestUrl.includes("/search/issues")) return jsonResponse({ items: [] });
    if (requestUrl.includes("/git/ref/heads/agent/sentry-555-sales-order-ship")) {
      return jsonResponse({}, 404);
    }
    if (requestUrl.endsWith("/git/ref/heads/main")) {
      return jsonResponse({ object: { sha: "main-sha" } });
    }
    if (requestUrl.endsWith("/git/refs") && init?.method === "POST") {
      return jsonResponse({ ref: "refs/heads/agent/sentry-555-sales-order-ship" });
    }
    if (requestUrl.includes("/contents/.autofix/sentry/555.md")) {
      if (init?.method === "PUT") return jsonResponse({ content: {} });
      return jsonResponse({}, 404);
    }
    if (requestUrl.endsWith("/pulls")) {
      return jsonResponse({
        number: 55,
        state: "open",
        html_url: "https://github.com/azure-eller/erp/pull/55",
      });
    }
    if (requestUrl.includes("/labels") || requestUrl.endsWith("/issues/55/comments")) {
      return jsonResponse({});
    }
    return jsonResponse({});
  };

  await processSentryAutofix({
    config,
    fetchImpl: fetchImpl as typeof fetch,
    payload: {
      data: {
        issue: { id: "555", project: { slug: "javascript-nextjs" } },
      },
    },
  });

  expect(calls.some((call) => call.url.includes("/git/ref/heads/agent/sentry-555-sales-order-ship"))).toBe(true);
  expect(calls.some((call) => call.url.includes("/git/ref/heads/agent%2Fsentry-555-sales-order-ship"))).toBe(false);
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
