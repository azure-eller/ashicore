import { list } from "@vercel/blob";
import type { Page } from "@playwright/test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { test, expect } from "../fixtures";
import {
  customerContacts,
  customerCorrespondence,
  customerCorrespondenceAttendees,
  customerProjectFiles,
  customerProjects,
  customers as salesCustomers,
} from "../../../lib/db/schema";
import { testFetch, updateCustomer } from "../../helpers/api";

const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

function idFromUrl(url: string) {
  return url.split("/").filter(Boolean).at(-1) ?? "";
}

async function createCustomerFromCard(page: Page, name: string) {
  await page.goto("/sales/customer");
  await expect(page.getByRole("heading", { name: "New customer" })).toBeVisible();

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().endsWith("/api/customers")
    ),
    (async () => {
      await page.getByLabel("Customer name").fill(name);
      await page.getByLabel("Customer name").blur();
    })(),
  ]);
  expect(response.status()).toBe(201);
  await page.waitForURL(/\/sales\/customers\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return idFromUrl(page.url());
}

async function addContact(
  customerId: string,
  contact: {
    name: string;
    title: string;
    email: string;
    phone: string;
    roles: Array<"Primary" | "Shipping recipient" | "Invoicing recipient" | "Billing CC" | "On-site contact">;
    notes: string;
  }
) {
  const response = await testFetch(`/api/customers/${customerId}/contacts`, {
    method: "POST",
    body: JSON.stringify({
      name: contact.name,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      addressEntryId: null,
      roles: contact.roles.map((role) => {
        if (role === "Primary") return "primary";
        if (role === "Shipping recipient") return "shipping";
        if (role === "Invoicing recipient") return "invoicing";
        if (role === "Billing CC") return "billing";
        return "field";
      }),
      notes: contact.notes,
    }),
  });
  expect(response.status).toBe(201);
}

async function createProject(
  customerId: string,
  project: {
    name: string;
    summary: string;
    status?: string;
  }
) {
  const response = await testFetch(`/api/customers/${customerId}/projects`, {
    method: "POST",
    body: JSON.stringify({
      name: project.name,
      status: (project.status ?? "Planning").toLowerCase().replace(" ", "_"),
      startDate: null,
      targetEndDate: null,
      summary: project.summary,
    }),
  });
  expect(response.status).toBe(201);
}

async function uploadFile(
  page: Page,
  customerId: string,
  projectId: string,
  file: { name: string; content: string; mimeType: string }
) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        res.url().endsWith(`/api/customers/${customerId}/projects/${projectId}/files`)
    ),
    page.locator('input[type="file"]').setInputFiles({
      name: file.name,
      mimeType: file.mimeType,
      buffer: Buffer.from(file.content),
    }),
  ]);
  expect(response.status()).toBe(201);
  await expect(page.getByText(file.name)).toBeVisible();
}

test.describe("Customer CRM detail flow", () => {
  test.describe.configure({ mode: "serial" });

  const run = Date.now();
  const customerName = `Example Construction CRM ${run}`;
  const projectName = `Example Construction Phase 2 ${run}`;
  let customerId = "";
  let projectId = "";
  let uploadedFileIds: string[] = [];
  let uploadedStorageKeys: string[] = [];

  test("creates the customer CRM workspace from the UI", async ({ page, db }) => {
    test.slow();

    customerId = await createCustomerFromCard(page, customerName);
    const updateResult = await updateCustomer(customerId, {
      name: customerName,
      email: `seven-castles-${run}@example.com`,
      phone: "555-7000",
      billingLine1: "700 Castle Road",
      billingCity: "Paonia",
      billingRegion: "CO",
      billingPostcode: "81428",
      notes: "CRM slow story account.",
    });
    expect(updateResult.status, JSON.stringify(updateResult.body)).toBe(200);
    await page.reload();
    await expect(page.getByLabel("Email")).toHaveValue(`seven-castles-${run}@example.com`);

    const [customer] = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.name, customerName));
    expect(customer.email).toBe(`seven-castles-${run}@example.com`);
    expect(customer.billingRegion).toBe("CO");
    expect(customer.notes).toBe("CRM slow story account.");

    await addContact(customerId, {
      name: `Spencer Primary ${run}`,
      title: "Project lead",
      email: `spencer-primary-${run}@example.com`,
      phone: "555-7100",
      roles: ["Primary", "Shipping recipient"],
      notes: "Needs delivery and field updates.",
    });
    await addContact(customerId, {
      name: `Morgan Billing ${run}`,
      title: "Controller",
      email: `morgan-billing-${run}@example.com`,
      phone: "555-7200",
      roles: ["Invoicing recipient", "Billing CC"],
      notes: "Receives invoices only.",
    });
    await addContact(customerId, {
      name: `Casey Field ${run}`,
      title: "Site supervisor",
      email: `casey-field-${run}@example.com`,
      phone: "555-7300",
      roles: ["On-site contact"],
      notes: "On job-site calls.",
    });

    let contacts = await db
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.customerId, customerId));
    expect(contacts).toHaveLength(3);
    const primary = contacts.find((contact) => contact.name === `Spencer Primary ${run}`);
    const billing = contacts.find((contact) => contact.name === `Morgan Billing ${run}`);
    const field = contacts.find((contact) => contact.name === `Casey Field ${run}`);
    expect(primary?.isPrimary).toBe(true);
    expect(primary?.receivesShipping).toBe(true);
    expect(billing?.receivesInvoices).toBe(true);
    expect(field?.isOnSite).toBe(true);

    const editResponse = await testFetch(`/api/customers/${customerId}/contacts/${primary?.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: `Spencer Primary ${run}`,
        title: "Project lead",
        email: `spencer-primary-${run}@example.com`,
        phone: "555-7111",
        addressEntryId: null,
        roles: ["primary", "shipping"],
        notes: "Updated after kickoff call.",
      }),
    });
    expect(editResponse.status).toBe(200);

    contacts = await db
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.customerId, customerId));
    expect(contacts.find((contact) => contact.id === primary?.id)?.phone).toBe("555-7111");

    const activityResponse = await testFetch(`/api/customers/${customerId}/correspondence`, {
      method: "POST",
      body: JSON.stringify({
        type: "meeting",
        occurredAt: null,
        title: "Kickoff call with shipping and billing",
        body: "Reviewed soil test, blueprint revisions, delivery window, and invoice routing.",
        attendeeContactIds: [primary?.id, billing?.id, field?.id].filter(Boolean),
      }),
    });
    expect(activityResponse.status).toBe(201);

    const [activity] = await db
      .select()
      .from(customerCorrespondence)
      .where(eq(customerCorrespondence.customerId, customerId));
    expect(activity.type).toBe("meeting");
    expect(activity.title).toBe("Kickoff call with shipping and billing");
    expect(activity.body).toBe(
      "Reviewed soil test, blueprint revisions, delivery window, and invoice routing."
    );

    const attendees = await db
      .select()
      .from(customerCorrespondenceAttendees)
      .where(eq(customerCorrespondenceAttendees.correspondenceId, activity.id));
    expect(attendees).toHaveLength(3);
    expect(attendees.map((attendee) => attendee.contactName).sort()).toEqual(
      [`Casey Field ${run}`, `Morgan Billing ${run}`, `Spencer Primary ${run}`].sort()
    );

    await createProject(customerId, {
      name: projectName,
      status: "Active",
      summary: "Store soil tests, blueprints, specs, and kickoff notes for this job.",
    });

    const [project] = await db
      .select()
      .from(customerProjects)
      .where(eq(customerProjects.customerId, customerId));
    expect(project.name).toBe(projectName);
    expect(project.status).toBe("active");
    expect(project.summary).toBe(
      "Store soil tests, blueprints, specs, and kickoff notes for this job."
    );
    projectId = project.id;
  });

  test("persists CRM data across reloads", async ({ page }) => {
    await page.goto(`/sales/customers/${customerId}`);
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible();

    await expect(page.getByText(`Spencer Primary ${run}`)).toBeVisible();
    await expect(page.getByText(`Morgan Billing ${run}`)).toBeVisible();
    await expect(page.getByText(`Casey Field ${run}`)).toBeVisible();
    await expect(page.getByText("555-7111")).toBeVisible();

    await expect(page.locator("main")).toContainText(projectName);
    await expect(page.locator("main")).toContainText("In Progress");
  });

  test("uploads, downloads, deletes, and project-cleans private files", async ({
    page,
    db,
  }) => {
    test.slow();
    test.skip(!hasBlobToken, "Live Vercel Blob credentials are required.");

    await page.goto(`/sales/customers/${customerId}`);
    await page.getByRole("button", { name: new RegExp(projectName) }).click();

    const files = [
      {
        name: `soil-test-${run}.txt`,
        content: `Soil test pH 6.8 for ${customerName}`,
        mimeType: "text/plain",
      },
      {
        name: `blueprint-${run}.txt`,
        content: `Blueprint revision B for ${projectName}`,
        mimeType: "text/plain",
      },
      {
        name: `specs-${run}.txt`,
        content: `Spec packet for shipping and invoice routing ${run}`,
        mimeType: "text/plain",
      },
    ];

    for (const file of files) {
      await uploadFile(page, customerId, projectId, file);
    }

    const projectFiles = await db
      .select()
      .from(customerProjectFiles)
      .where(
        and(eq(customerProjectFiles.projectId, projectId), isNull(customerProjectFiles.deletedAt))
      );
    expect(projectFiles).toHaveLength(3);
    uploadedFileIds = projectFiles.map((file) => file.id);
    uploadedStorageKeys = projectFiles.map((file) => file.storageKey);

    for (const expected of files) {
      const row = projectFiles.find((file) => file.filename === expected.name);
      expect(row).toBeTruthy();
      expect(row?.contentType).toBe("text/plain");
      expect(Number(row?.sizeBytes)).toBe(expected.content.length);

      const download = await page.request.get(
        `/api/customers/${customerId}/projects/${projectId}/files/${row?.id}`
      );
      expect(download.status()).toBe(200);
      expect(await download.text()).toBe(expected.content);

      const blobListing = await list({ prefix: row!.storageKey });
      expect(blobListing.blobs.map((blob) => blob.pathname)).toContain(row!.storageKey);
    }

    const fileToDelete = projectFiles.find((file) => file.filename === files[0].name)!;
    const [deleteFileResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "DELETE" &&
          res
            .url()
            .endsWith(`/api/customers/${customerId}/projects/${projectId}/files/${fileToDelete.id}`)
      ),
      page
        .getByText(fileToDelete.filename)
        .locator("..")
        .getByRole("button", { name: "Delete" })
        .evaluate((button: HTMLElement) => button.click()),
    ]);
    expect(deleteFileResponse.status()).toBe(200);
    await expect(page.getByText(fileToDelete.filename)).toBeHidden();

    const [deletedFile] = await db
      .select()
      .from(customerProjectFiles)
      .where(eq(customerProjectFiles.id, fileToDelete.id));
    expect(deletedFile.deletedAt).not.toBeNull();
    expect((await list({ prefix: fileToDelete.storageKey })).blobs).toHaveLength(0);

    const deletedDownload = await page.request.get(
      `/api/customers/${customerId}/projects/${projectId}/files/${fileToDelete.id}`
    );
    expect(deletedDownload.status()).toBe(404);
  });

  test("deleting a project removes remaining file access", async ({ page, db }) => {
    test.skip(!hasBlobToken, "Live Vercel Blob credentials are required.");

    await page.goto(`/sales/customers/${customerId}`);
    await page.getByRole("button", { name: new RegExp(projectName) }).click();
    await page.getByRole("button", { name: "Delete project" }).click();

    const [deleteProjectResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "DELETE" &&
          res.url().endsWith(`/api/customers/${customerId}/projects/${projectId}`)
      ),
      page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click(),
    ]);
    expect(deleteProjectResponse.status()).toBe(200);
    await expect(page.getByRole("button", { name: new RegExp(projectName) })).toBeHidden();

    const [project] = await db
      .select()
      .from(customerProjects)
      .where(eq(customerProjects.id, projectId));
    expect(project.deletedAt).not.toBeNull();

    const fileRows = await db
      .select()
      .from(customerProjectFiles)
      .where(inArray(customerProjectFiles.id, uploadedFileIds));
    expect(fileRows.every((file) => file.deletedAt != null)).toBe(true);

    for (const file of fileRows) {
      const response = await page.request.get(
        `/api/customers/${customerId}/projects/${projectId}/files/${file.id}`
      );
      expect(response.status()).toBe(404);
    }

    for (const storageKey of uploadedStorageKeys) {
      expect((await list({ prefix: storageKey })).blobs).toHaveLength(0);
    }
  });

  test("deleting a customer cleans up remaining project files", async ({ page, db }) => {
    test.skip(!hasBlobToken, "Live Vercel Blob credentials are required.");

    const cleanupProjectName = `Customer delete cleanup ${run}`;
    await createProject(customerId, {
      name: cleanupProjectName,
      status: "Active",
      summary: "Temporary project for customer delete cleanup.",
    });

    const [cleanupProject] = await db
      .select()
      .from(customerProjects)
      .where(
        and(
          eq(customerProjects.customerId, customerId),
          eq(customerProjects.name, cleanupProjectName)
        )
    );
    expect(cleanupProject.deletedAt).toBeNull();

    await page.goto(`/sales/customers/${customerId}`);
    await page.getByRole("button", { name: new RegExp(cleanupProjectName) }).click();
    await uploadFile(page, customerId, cleanupProject.id, {
      name: `customer-delete-cleanup-${run}.txt`,
      content: `Delete the customer and clean this private file ${run}`,
      mimeType: "text/plain",
    });

    const [cleanupFile] = await db
      .select()
      .from(customerProjectFiles)
      .where(eq(customerProjectFiles.projectId, cleanupProject.id));
    expect((await list({ prefix: cleanupFile.storageKey })).blobs).toHaveLength(1);

    const deleteCustomerResponse = await page.request.delete(`/api/customers/${customerId}`);
    expect(deleteCustomerResponse.status()).toBe(200);

    const [deletedCustomer] = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.id, customerId));
    expect(deletedCustomer.deletedAt).not.toBeNull();

    const deletedContacts = await db
      .select({ id: customerContacts.id, deletedAt: customerContacts.deletedAt })
      .from(customerContacts)
      .where(eq(customerContacts.customerId, customerId));
    expect(deletedContacts.length).toBeGreaterThan(0);
    expect(deletedContacts.every((contact) => contact.deletedAt != null)).toBe(true);

    const deletedCorrespondence = await db
      .select({
        id: customerCorrespondence.id,
        deletedAt: customerCorrespondence.deletedAt,
      })
      .from(customerCorrespondence)
      .where(eq(customerCorrespondence.customerId, customerId));
    expect(deletedCorrespondence.length).toBeGreaterThan(0);
    expect(deletedCorrespondence.every((entry) => entry.deletedAt != null)).toBe(true);

    const [deletedProject] = await db
      .select()
      .from(customerProjects)
      .where(eq(customerProjects.id, cleanupProject.id));
    expect(deletedProject.deletedAt).not.toBeNull();

    const [deletedFile] = await db
      .select()
      .from(customerProjectFiles)
      .where(eq(customerProjectFiles.id, cleanupFile.id));
    expect(deletedFile.deletedAt).not.toBeNull();
    expect((await list({ prefix: cleanupFile.storageKey })).blobs).toHaveLength(0);

    const downloadAfterCustomerDelete = await page.request.get(
      `/api/customers/${customerId}/projects/${cleanupProject.id}/files/${cleanupFile.id}`
    );
    expect(downloadAfterCustomerDelete.status()).toBe(404);
  });
});
