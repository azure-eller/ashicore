import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  buildAutofixBranchName,
  buildAutofixPrBody,
  buildAutofixPrTitle,
  normalizeAgentDebugPacket,
  parseSentryWebhookPayload,
  processSentryAutofix,
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
          { key: "route", value: "/api/sales-orders/1/ship?token=secret" },
          { key: "method", value: "POST" },
        ],
        contexts: {
          app_debug: {
            route: "/api/sales-orders/1/ship?customer=Acme",
            authorization: "Bearer secret",
            customer_notes: "private",
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
            body: { password: "secret" },
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
  expect(JSON.stringify(packet)).not.toContain("private");
  expect(JSON.stringify(packet)).not.toContain("password");
  expect(JSON.stringify(packet)).not.toContain("quantity");
  expect(JSON.stringify(packet)).not.toContain("select secret");
  expect(buildAutofixPrBody(packet)).not.toContain("Bearer secret");
  expect(buildAutofixPrBody(packet)).not.toContain("?customer=Acme");
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
          api_path: "/api/sales-orders/1?customer=Acme",
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

test("dedupes open PRs and does not tag Codex twice", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, init });

    if (requestUrl.includes("/issues/123456789/events/")) {
      return jsonResponse([
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
      ]);
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
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
