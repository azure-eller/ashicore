import { expect, test } from "@playwright/test";
import { extractXeroMessage } from "@/lib/xero/errors";

test("Xero errors prefer response body detail over generic SDK message", () => {
  const error = new Error("Xero request failed.") as Error & {
    body: unknown;
    response: unknown;
  };
  const body = {
    Title: "An error occurred",
    Detail:
      "An error occurred in Xero. Check the API Status page http://status.developer.xero.com for current service status.",
    Status: 500,
    Instance: "c7222c66-72ee-4963-a961-ef73d49ea205",
  };

  error.body = body;
  error.response = {
    statusCode: 500,
    body,
  };

  expect(extractXeroMessage(error)).toBe(body.Detail);
});
