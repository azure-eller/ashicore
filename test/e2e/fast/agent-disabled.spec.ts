import { test, expect } from "../fixtures";
import { ERP_AGENT_ENABLED } from "../../../lib/feature-flags";

test.describe("ERP agent disabled state", () => {
  test.skip(ERP_AGENT_ENABLED, "ERP agent is enabled; disabled-state coverage does not apply.");

  test("hides the sidebar agent and blocks agent API access", async ({ page }) => {
    const agentRequests: string[] = [];

    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/agent/")) {
        agentRequests.push(request.url());
      }
    });

    await page.goto("/sales/customers");

    await expect(page.getByRole("textbox", { name: "ERP Agent message" })).toHaveCount(0);
    expect(agentRequests).toHaveLength(0);

    const response = await page.evaluate(async () => {
      const apiResponse = await fetch("/api/agent/sessions", {
        method: "POST",
      });

      return {
        status: apiResponse.status,
        body: await apiResponse.json(),
      };
    });

    expect(response).toMatchObject({
      status: 404,
      body: { error: "Not found" },
    });
  });
});
