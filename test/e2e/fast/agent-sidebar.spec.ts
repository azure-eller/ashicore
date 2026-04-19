import { eq, inArray } from "drizzle-orm";
import { type Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { agentSessions } from "../../../lib/db/schema";

// The sidebar chat panel collapses its header and transcript when the composer
// is unfocused (pointer-events-none, opacity 0). Only the composer textarea
// itself remains visible. Focusing the composer expands the panel and exposes
// the header, transcript, New chat / Chat history buttons, and message bubbles.
async function expandPanel(page: Page) {
  await page.getByRole("textbox", { name: "ERP Agent message" }).focus();
}

test.describe("Agent sidebar smoke", () => {
  test("creates a persistent thread from the sidebar and restores it across page changes and refreshes", async ({
    page,
    db,
  }) => {
    const ts = Date.now();
    const prompt = `find acme-${ts}`;

    const createSessionResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/agent/sessions")
    );

    await page.goto("/sales/customers?agentProvider=fake");

    await expandPanel(page);
    await expect(page.getByRole("heading", { name: "ERP Agent" })).toBeVisible();

    const createSessionResponse = await createSessionResponsePromise;
    expect(createSessionResponse.status()).toBe(201);

    const sidebar = page.locator("[data-agent-sidebar-root]");
    await expect(sidebar).toHaveAttribute("data-agent-session-id", /.+/);
    const sessionId = await sidebar.getAttribute("data-agent-session-id");
    expect(sessionId).toBeTruthy();

    const [session] = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId!));
    expect(session.status).toBe("idle");
    expect(session.createdByUserId).toBeTruthy();

    const turnResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/agent/sessions/${sessionId}/turns`)
    );

    await page.getByRole("textbox", { name: "ERP Agent message" }).fill(prompt);
    await page.getByRole("textbox", { name: "ERP Agent message" }).press("Enter");

    await expect(sidebar.getByText(prompt)).toBeVisible();

    const turnResponse = await turnResponsePromise;
    expect(turnResponse.ok()).toBe(true);

    await page.goto("/sales/orders");
    await expandPanel(page);
    await expect(page.getByRole("heading", { name: "ERP Agent" })).toBeVisible();
    await expect(sidebar).toHaveAttribute("data-agent-session-id", sessionId!);
    await expect(sidebar.getByText(prompt)).toBeVisible();

    await page.reload();
    await expandPanel(page);
    await expect(page.getByRole("heading", { name: "ERP Agent" })).toBeVisible();
    await expect(sidebar).toHaveAttribute("data-agent-session-id", sessionId!);
    await expect(sidebar.getByText(prompt)).toBeVisible();
  });

  test("renders approval previews in the sidebar permission card", async ({ page }) => {
    await page.goto("/sales/customers?agentProvider=fake");
    await expandPanel(page);
    await expect(page.getByRole("heading", { name: "ERP Agent" })).toBeVisible();

    const sidebar = page.locator("[data-agent-sidebar-root]");
    await expect(sidebar).toHaveAttribute("data-agent-session-id", /.+/);
    const sessionId = await sidebar.getAttribute("data-agent-session-id");
    expect(sessionId).toBeTruthy();

    const response = await page.evaluate(async (targetSessionId) => {
      const turnResponse = await fetch(`/api/agent/sessions/${targetSessionId}/turns`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Provider": "fake",
        },
        body: JSON.stringify({ text: "create customer" }),
      });

      return {
        ok: turnResponse.ok,
        body: await turnResponse.text(),
      };
    }, sessionId);

    expect(response.ok).toBe(true);
    expect(response.body).toContain("event: pending_request");

    const snapshot = await page.evaluate(async (targetSessionId) => {
      const sessionResponse = await fetch(`/api/agent/sessions/${targetSessionId}`, {
        cache: "no-store",
      });

      return sessionResponse.json();
    }, sessionId);

    expect(snapshot.pendingRequest?.kind).toBe("permission");
    expect(snapshot.pendingRequest?.payload?.summary).toBe("Create a new customer.");
    expect(snapshot.pendingRequest?.payload?.preview?.kind).toBe("create");
    expect(snapshot.pendingRequest?.payload?.preview?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "name",
          after: "Fake Customer",
        }),
      ])
    );
  });

  test("starts a fresh thread from the New chat button and keeps the prior session in DB", async ({
    page,
    db,
  }) => {
    await page.goto("/sales/customers?agentProvider=fake");
    await expandPanel(page);
    await expect(page.getByRole("heading", { name: "ERP Agent" })).toBeVisible();

    const sidebar = page.locator("[data-agent-sidebar-root]");
    await expect(sidebar).toHaveAttribute("data-agent-session-id", /.+/);
    const firstSessionId = (await sidebar.getAttribute("data-agent-session-id"))!;
    expect(firstSessionId).toBeTruthy();

    const markerA = `marker-A-${Date.now()}`;

    const firstTurnPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/agent/sessions/${firstSessionId}/turns`)
    );

    await page.getByRole("textbox", { name: "ERP Agent message" }).fill(markerA);
    await page.getByRole("textbox", { name: "ERP Agent message" }).press("Enter");
    await expect(sidebar.getByText(markerA)).toBeVisible();

    const firstTurn = await firstTurnPromise;
    expect(firstTurn.ok()).toBe(true);

    // The composer stays focused after Enter, so the panel is still expanded.
    // The New chat button lives inside the expanded header.
    const newSessionPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/agent/sessions")
    );

    await page.getByRole("button", { name: "New chat" }).click();

    const newSessionResponse = await newSessionPromise;
    expect(newSessionResponse.status()).toBe(201);

    await expect(sidebar).not.toHaveAttribute("data-agent-session-id", firstSessionId);
    const secondSessionId = (await sidebar.getAttribute("data-agent-session-id"))!;
    expect(secondSessionId).toBeTruthy();
    expect(secondSessionId).not.toBe(firstSessionId);

    // Re-expand to confirm the prior marker is no longer in the fresh transcript.
    await expandPanel(page);
    await expect(sidebar.getByText(markerA)).toHaveCount(0);

    const storedSessions = await db
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(inArray(agentSessions.id, [firstSessionId, secondSessionId]));
    expect(storedSessions).toHaveLength(2);
  });

  test("restores a past thread from the chat history popover", async ({ page }) => {
    await page.goto("/sales/customers?agentProvider=fake");
    await expandPanel(page);
    await expect(page.getByRole("heading", { name: "ERP Agent" })).toBeVisible();

    const sidebar = page.locator("[data-agent-sidebar-root]");
    await expect(sidebar).toHaveAttribute("data-agent-session-id", /.+/);
    const sessionAId = (await sidebar.getAttribute("data-agent-session-id"))!;

    const markerA = `history-marker-${Date.now()}`;

    const turnPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/agent/sessions/${sessionAId}/turns`)
    );

    await page.getByRole("textbox", { name: "ERP Agent message" }).fill(markerA);
    await page.getByRole("textbox", { name: "ERP Agent message" }).press("Enter");
    await expect(sidebar.getByText(markerA)).toBeVisible();
    await turnPromise;

    await page.getByRole("button", { name: "New chat" }).click();
    await expect(sidebar).not.toHaveAttribute("data-agent-session-id", sessionAId);

    // Re-expand so the Chat history button becomes clickable again.
    await expandPanel(page);

    const historyListPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().endsWith("/api/agent/sessions")
    );

    await page.getByRole("button", { name: "Chat history" }).click();
    await historyListPromise;

    // The history popover renders in a portal outside the sidebar; search the page.
    const historyItem = page.getByRole("button", { name: new RegExp(markerA) });
    await expect(historyItem).toBeVisible();
    await historyItem.click();

    await expect(sidebar).toHaveAttribute("data-agent-session-id", sessionAId);

    // Re-expand so the restored transcript becomes visible.
    await expandPanel(page);
    await expect(sidebar.getByText(markerA)).toBeVisible();
  });
});
