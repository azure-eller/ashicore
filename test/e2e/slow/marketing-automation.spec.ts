import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { expect, test } from "../fixtures";
import {
  customerActivities,
  customerContacts,
  marketingExperiments,
} from "@/lib/db/schema";
import {
  MARKETING_GMAIL_INBOX_DIR,
  MARKETING_GMAIL_OUTBOX_DIR,
} from "@/lib/marketing/test-mode";
import {
  addCustomerContact,
  createCustomer,
  getOrgId,
} from "../../helpers/api";

async function runTick(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  now: string,
) {
  const response = await page.request.get(
    `/api/internal/marketing/tick?orgId=${getOrgId()}&now=${encodeURIComponent(now)}`,
    { headers: { Authorization: "Bearer marketing-test-secret" } },
  );
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(200);
  return body as Record<string, unknown>;
}

test.describe.configure({ mode: "serial" });

test("a bounded experiment runs autonomously and suppresses an opt-out", async ({
  page,
  db,
}) => {
  await db
    .update(marketingExperiments)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(marketingExperiments.status, "active"));
  const suffix = Date.now().toString();
  const contactIds: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const customer = await createCustomer({
      name: `Marketing Research ${suffix}-${index}`,
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const contact = await addCustomerContact(customer.body.id as string, {
      name: `Operator ${index}`,
      title: "Operations",
      email: `marketing-${suffix}-${index}@example.com`,
    });
    expect(contact.status, JSON.stringify(contact.body)).toBe(200);
    contactIds.push(contact.contactId);
  }

  const invalid = await page.request.post("/api/marketing/experiments", {
    data: {
      hypothesis: "Soil manufacturers will discuss spreadsheet-based production planning.",
      segment: "Researched soil manufacturers",
      painAngle: "Recipe inputs and raw-material availability",
      cta: "Ask how they handle it today",
      allowedClaims: [
        "Ashicore is operations software for smaller batch manufacturers.",
      ],
      contactIds: [],
    },
  });
  expect(invalid.status()).toBe(400);
  await expect(invalid.json()).resolves.toMatchObject({
    error: expect.stringContaining("array"),
  });

  const createdResponse = await page.request.post("/api/marketing/experiments", {
    data: {
      hypothesis: "Soil manufacturers will discuss spreadsheet-based production planning.",
      segment: "Researched soil manufacturers",
      painAngle: "Recipe inputs and raw-material availability",
      cta: "Ask how they handle it today",
      allowedClaims: [
        "Ashicore is operations software for smaller batch manufacturers.",
      ],
      contactIds,
    },
  });
  const created = await createdResponse.json();
  expect(createdResponse.status(), JSON.stringify(created)).toBe(201);

  const activatedResponse = await page.request.post(
    `/api/marketing/experiments/${created.id}/activate`,
  );
  expect(activatedResponse.status(), await activatedResponse.text()).toBe(200);

  const firstTickAt = new Date();
  const first = await runTick(page, firstTickAt.toISOString());
  expect(first).toMatchObject({ status: "active", sent: 3 });

  const sameDay = await runTick(
    page,
    new Date(firstTickAt.getTime() + 60_000).toISOString(),
  );
  expect(sameDay).toMatchObject({ status: "active", sent: 0 });

  const nextTickAt = new Date(firstTickAt.getTime() + 24 * 60 * 60 * 1_000);
  const nextDay = await runTick(page, nextTickAt.toISOString());
  expect(nextDay).toMatchObject({ status: "active", sent: 1 });

  const outboxFiles = await fs.readdir(MARKETING_GMAIL_OUTBOX_DIR);
  expect(outboxFiles).toHaveLength(4);
  const sent = JSON.parse(
    await fs.readFile(path.join(MARKETING_GMAIL_OUTBOX_DIR, outboxFiles[0]!), "utf8"),
  ) as { threadId: string };
  await fs.writeFile(
    path.join(MARKETING_GMAIL_INBOX_DIR, "opt-out.json"),
    JSON.stringify({
      messageId: `reply-${suffix}`,
      threadId: sent.threadId,
      from: "Operator <operator@example.com>",
      subject: "Re: production planning",
      text: "Please remove me from this list.",
    }),
  );

  const replyTick = await runTick(
    page,
    new Date(nextTickAt.getTime() + 60_000).toISOString(),
  );
  expect(replyTick).toMatchObject({ status: "active", replies: 1 });

  const [suppressed] = await db
    .select({
      suppressedAt: customerContacts.outreachSuppressedAt,
      reason: customerContacts.outreachSuppressionReason,
    })
    .from(customerContacts)
    .where(
      and(
        inArray(customerContacts.id, contactIds),
        isNotNull(customerContacts.outreachSuppressedAt),
      ),
    );
  expect(suppressed).toMatchObject({
    suppressedAt: expect.any(Date),
    reason: "opt_out",
  });

  const activities = await db
    .select({ metadata: customerActivities.marketingMetadata })
    .from(customerActivities)
    .where(eq(customerActivities.marketingExperimentId, created.id));
  expect(activities).toHaveLength(4);
  expect(activities.every((row) => row.metadata?.deliveryStatus === "sent")).toBe(true);

  const [experiment] = await db
    .select()
    .from(marketingExperiments)
    .where(eq(marketingExperiments.id, created.id));
  expect(experiment.state.contactProgress).toMatchObject({
    [contactIds[0]!]: expect.objectContaining({ sentAt: expect.any(String) }),
  });
});
