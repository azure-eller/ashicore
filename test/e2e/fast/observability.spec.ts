import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
  classifyError,
  sanitizeSentryEvent,
} from "@/lib/observability/sentry";
import { XeroError } from "@/lib/xero/errors";

test("classifies safe Postgres metadata without raw DB text", () => {
  const error = Object.assign(new Error("column customers.secret_token does not exist"), {
    code: "42703",
    schema: "inventory",
    table: "items",
    column: "missing_column",
    detail: "raw detail must not leak",
    where: "raw where must not leak",
    query: "select * from customers",
  });

  const classification = classifyError(error);

  expect(classification.kind).toBe("postgres");
  expect(classification.domain).toBe("db");
  expect(classification.contexts?.db).toEqual({
    code: "42703",
    safe_message: "Undefined column.",
    schema: "inventory",
    table: "items",
    column: "missing_column",
  });
  expect(JSON.stringify(classification)).not.toContain("raw detail");
  expect(JSON.stringify(classification)).not.toContain("select *");
});

test("classifies unique violations with constraint only", () => {
  const error = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint: "items_sku_unique",
  });

  const classification = classifyError(error);

  expect(classification.kind).toBe("unique_violation");
  expect(classification.domain).toBe("db");
  expect(classification.contexts?.db).toEqual({
    code: "23505",
    safe_message: "Unique constraint violation.",
    constraint: "items_sku_unique",
  });
});

test("classifies Zod errors by field names only", () => {
  const schema = z.object({
    email: z.string().email(),
    quantity: z.string().min(1),
  });
  const result = schema.safeParse({ email: "bad", quantity: "" });

  expect(result.success).toBe(false);
  if (result.success) return;

  const classification = classifyError(result.error);
  expect(classification.kind).toBe("validation");
  expect(classification.domain).toBe("validation");
  expect(classification.contexts?.validation).toEqual({
    fields: ["email", "quantity"],
  });
  expect(JSON.stringify(classification)).not.toContain("bad");
});

test("classifies Xero and network errors safely", () => {
  const xero = classifyError(new XeroError("token abc failed", 502));
  expect(xero.kind).toBe("http_502");
  expect(xero.domain).toBe("external_service");
  expect(xero.contexts?.external_service).toEqual({
    service: "xero",
    status: 502,
  });

  const network = classifyError(new Error("fetch failed: ECONNREFUSED"));
  expect(network.kind).toBe("connection");
  expect(network.domain).toBe("network");
  expect(network.contexts?.network).toEqual({
    connection_class: "connection",
  });
});

test("sanitizes sensitive event fields and strips query strings", () => {
  const event = sanitizeSentryEvent({
    request: {
      url: "https://ashicore.app/api/items?token=secret",
      data: { password: "secret" },
      headers: {
        authorization: "Bearer secret",
        cookie: "session=secret",
        referer: "https://ashicore.app/sales?customer=Acme",
      },
    },
    tags: {
      sku: "ABC-123",
      route: "/api/items?sku=ABC-123",
    },
    contexts: {
      app_debug: {
        customer_notes: "private",
        path: "/api/items?note=private",
      },
    },
    extra: {
      responseBody: "private",
      nested: {
        quantity: "10",
      },
    },
    breadcrumbs: [
      {
        data: {
          comments: "private",
          url: "/api/items?sku=ABC-123",
        },
      },
    ],
    user: {
      id: "user_123",
      email: "person@example.com",
    },
    transaction: "/api/items?sku=ABC-123",
  });

  expect(event.request?.data).toBeUndefined();
  expect(event.request?.url).toBe("https://ashicore.app/api/items");
  expect(event.request?.headers?.authorization).toBe("[Filtered]");
  expect(event.request?.headers?.cookie).toBe("[Filtered]");
  expect(event.request?.headers?.referer).toBe("https://ashicore.app/sales");
  expect(event.tags?.sku).toBe("[Filtered]");
  expect(event.tags?.route).toBe("/api/items");
  expect(event.contexts?.app_debug).toEqual({
    customer_notes: "[Filtered]",
    path: "/api/items",
  });
  expect(event.extra?.responseBody).toBe("[Filtered]");
  expect(event.extra?.nested).toEqual({ quantity: "[Filtered]" });
  expect(event.breadcrumbs?.[0]?.data).toEqual({
    comments: "[Filtered]",
    url: "/api/items",
  });
  expect(event.user).toEqual({ id: "user_123" });
  expect(event.transaction).toBe("/api/items");
});
