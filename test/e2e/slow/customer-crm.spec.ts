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

const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

async function addContact(
  page: Page,
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
  await page.getByRole("button", { name: /^Contacts/ }).click();
  await page.getByRole("button", { name: "Add contact" }).click();

  const dialog = page.getByRole("dialog", { name: "Add contact" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Full name").fill(contact.name);
  await dialog.getByLabel("Title").fill(contact.title);
  await dialog.getByLabel("Email").fill(contact.email);
  await dialog.getByLabel("Phone").fill(contact.phone);
  for (const role of contact.roles) {
    await dialog.getByText(role, { exact: true }).click();
  }
  await dialog.getByLabel("Notes").fill(contact.notes);

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        res.url().endsWith(`/api/customers/${customerId}/contacts`)
    ),
    dialog.getByRole("button", { name: "Save contact" }).click(),
  ]);
  expect(response.status()).toBe(201);
  await expect(dialog).toBeHidden();
  await expect(page.getByText(contact.name)).toBeVisible();
}

async function createProject(
  page: Page,
  customerId: string,
  project: {
    name: string;
    summary: string;
    status?: string;
  }
) {
  await page.getByRole("button", { name: /^Projects/ }).click();
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Project name").fill(project.name);
  if (project.status) {
    await dialog.getByLabel("Status").click();
    await page.getByRole("option", { name: project.status }).click();
  }
  await dialog.getByLabel("Summary").fill(project.summary);

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        res.url().endsWith(`/api/customers/${customerId}/projects`)
    ),
    dialog.getByRole("button", { name: "Save project" }).click(),
  ]);
  expect(response.status()).toBe(201);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: new RegExp(project.name) })).toBeVisible();
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

    await page.goto("/sales/customers/new");
    await expect(page.getByText("Add Customer")).toBeVisible();
    await page.getByLabel("Name").fill(customerName);
    await page.getByLabel("Email").fill(`seven-castles-${run}@example.com`);
    await page.getByLabel("Phone").fill("555-7000");
    await page.locator("#customer-billing-line1").fill("700 Castle Road");
    await page.locator("#customer-billing-city").fill("Paonia");
    await page.locator("#customer-billing-region").fill("CO");
    await page.locator("#customer-billing-postcode").fill("81428");
    await page.getByLabel("Notes").fill("CRM slow story account.");

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === "POST" && res.url().endsWith("/api/customers")
      ),
      page.getByRole("button", { name: "Create Customer" }).click(),
    ]);
    expect(createResponse.status()).toBe(201);
    await page.waitForURL(/\/sales\/customers\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: customerName })).toBeVisible();
    await expect(page.getByText(`seven-castles-${run}@example.com`)).toBeVisible();
    await expect(page.locator("main")).toContainText("700 Castle Road");

    const [customer] = await db
      .select()
      .from(salesCustomers)
      .where(eq(salesCustomers.name, customerName));
    expect(customer.email).toBe(`seven-castles-${run}@example.com`);
    expect(customer.billingRegion).toBe("CO");
    expect(customer.notes).toBe("CRM slow story account.");
    customerId = customer.id;

    await addContact(page, customerId, {
      name: `Spencer Primary ${run}`,
      title: "Project lead",
      email: `spencer-primary-${run}@example.com`,
      phone: "555-7100",
      roles: ["Primary", "Shipping recipient"],
      notes: "Needs delivery and field updates.",
    });
    await addContact(page, customerId, {
      name: `Morgan Billing ${run}`,
      title: "Controller",
      email: `morgan-billing-${run}@example.com`,
      phone: "555-7200",
      roles: ["Invoicing recipient", "Billing CC"],
      notes: "Receives invoices only.",
    });
    await addContact(page, customerId, {
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

    const primaryRow = page.getByRole("row", { name: new RegExp(`Spencer Primary ${run}`) });
    await primaryRow.getByLabel("Contact actions").click();
    await page.getByRole("menuitem", { name: "Edit contact" }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit contact" });
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByLabel("Full name")).toHaveValue(`Spencer Primary ${run}`);
    await editDialog.getByLabel("Phone").fill("555-7111");
    await editDialog.getByLabel("Notes").fill("Updated after kickoff call.");

    const [editResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "PUT" &&
          res.url().endsWith(`/api/customers/${customerId}/contacts/${primary?.id}`)
      ),
      editDialog.getByRole("button", { name: "Save contact" }).click(),
    ]);
    expect(editResponse.status()).toBe(200);
    await expect(page.getByText("555-7111")).toBeVisible();

    contacts = await db
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.customerId, customerId));
    expect(contacts.find((contact) => contact.id === primary?.id)?.phone).toBe("555-7111");

    await page.getByRole("button", { name: /^Activity/ }).click();
    await page.getByRole("button", { name: "Meeting" }).first().click();
    await page.getByPlaceholder("Optional title").fill("Kickoff call with shipping and billing");
    await page
      .getByPlaceholder("Jot it down.")
      .fill("Reviewed soil test, blueprint revisions, delivery window, and invoice routing.");
    await page.getByRole("button", { name: /Spencer/ }).click();
    await page.getByRole("button", { name: /Morgan/ }).click();
    await page.getByRole("button", { name: /Casey/ }).click();

    const [activityResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" &&
          res.url().endsWith(`/api/customers/${customerId}/correspondence`)
      ),
      page.getByRole("button", { name: "Log meeting" }).click(),
    ]);
    expect(activityResponse.status()).toBe(201);
    await expect(page.getByText("Kickoff call with shipping and billing")).toBeVisible();
    await expect(page.locator("main")).toContainText(`Spencer Primary ${run}`);
    await expect(page.locator("main")).toContainText(`Morgan Billing ${run}`);
    await expect(page.locator("main")).toContainText(`Casey Field ${run}`);

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

    await createProject(page, customerId, {
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

    await page.getByRole("button", { name: /^Contacts/ }).click();
    await expect(page.getByText(`Spencer Primary ${run}`)).toBeVisible();
    await expect(page.getByText(`Morgan Billing ${run}`)).toBeVisible();
    await expect(page.getByText(`Casey Field ${run}`)).toBeVisible();
    await expect(page.getByText("555-7111")).toBeVisible();
    await expect(page.getByText("Updated after kickoff call.")).toBeVisible();

    await page.getByRole("button", { name: /^Activity/ }).click();
    await expect(page.getByText("Kickoff call with shipping and billing")).toBeVisible();
    await expect(page.getByText("Reviewed soil test")).toBeVisible();

    await page.getByRole("button", { name: /^Projects/ }).click();
    await expect(page.getByRole("button", { name: new RegExp(projectName) })).toBeVisible();
    await page.getByRole("button", { name: new RegExp(projectName) }).click();
    await expect(page.locator("main")).toContainText("Active");
    await expect(page.locator("main")).toContainText("Store soil tests, blueprints");
  });

  test("uploads, downloads, deletes, and project-cleans private files", async ({
    page,
    db,
  }) => {
    test.slow();
    test.skip(!hasBlobToken, "Live Vercel Blob credentials are required.");

    await page.goto(`/sales/customers/${customerId}`);
    await page.getByRole("button", { name: /^Projects/ }).click();
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
        .getByRole("button", { name: `Delete ${fileToDelete.filename}` })
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
    await page.getByRole("button", { name: /^Projects/ }).click();
    await page.getByRole("button", { name: new RegExp(projectName) }).click();

    const [deleteProjectResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "DELETE" &&
          res.url().endsWith(`/api/customers/${customerId}/projects/${projectId}`)
      ),
      page.getByRole("button", { name: "Delete", exact: true }).click(),
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
    await page.goto(`/sales/customers/${customerId}`);
    await createProject(page, customerId, {
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
