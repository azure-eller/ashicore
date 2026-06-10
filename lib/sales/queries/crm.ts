import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { customerContacts, customerCorrespondence, customerCorrespondenceAttendees, customerProjectFiles, customerProjectNotes, customerProjects, customers } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import type { CustomerContactInput, CustomerCorrespondenceInput, CustomerProjectFileRenameInput, CustomerProjectInput, CustomerProjectNoteInput } from "@/lib/schemas/customer-crm";
import type { CustomerContactRole, CustomerContactRow, CustomerCorrespondenceRow, CustomerProjectFileRow, CustomerProjectNoteRow, CustomerProjectRow } from "../types";
import { getAddressEntryInTx } from "@/lib/dal/addresses";
import { SalesError } from "./errors";

function buildCustomerContactRoles(row: {
  isPrimary: boolean;
  receivesShipping: boolean;
  receivesInvoices: boolean;
  receivesBillingCc: boolean;
  isOnSite: boolean;
}): CustomerContactRole[] {
  return [
    ...(row.isPrimary ? (["primary"] as const) : []),
    ...(row.receivesShipping ? (["shipping"] as const) : []),
    ...(row.receivesInvoices ? (["invoicing"] as const) : []),
    ...(row.receivesBillingCc ? (["billing"] as const) : []),
    ...(row.isOnSite ? (["field"] as const) : []),
  ];
}

function buildCustomerContactRoleColumns(roles: CustomerContactInput["roles"]) {
  const roleSet = new Set(roles);
  return {
    isPrimary: roleSet.has("primary"),
    receivesShipping: roleSet.has("shipping"),
    receivesInvoices: roleSet.has("invoicing"),
    receivesBillingCc: roleSet.has("billing"),
    isOnSite: roleSet.has("field"),
  };
}

const customerContactSelect = {
  id: customerContacts.id,
  name: customerContacts.name,
  title: customerContacts.title,
  email: customerContacts.email,
  phone: customerContacts.phone,
  addressEntryId: customerContacts.addressEntryId,
  isPrimary: customerContacts.isPrimary,
  receivesShipping: customerContacts.receivesShipping,
  receivesInvoices: customerContacts.receivesInvoices,
  receivesBillingCc: customerContacts.receivesBillingCc,
  isOnSite: customerContacts.isOnSite,
  notes: customerContacts.notes,
  createdAt: customerContacts.createdAt,
  updatedAt: customerContacts.updatedAt,
} as const;

function mapCustomerContactRow(
  row: {
    id: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    addressEntryId: string | null;
    isPrimary: boolean;
    receivesShipping: boolean;
    receivesInvoices: boolean;
    receivesBillingCc: boolean;
    isOnSite: boolean;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  }
): CustomerContactRow {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    email: row.email,
    phone: row.phone,
    addressEntryId: row.addressEntryId,
    roles: buildCustomerContactRoles(row),
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ensureActiveCustomerInTx(tx: Tx, customerId: string) {
  const [customer] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)));

  return customer ?? null;
}

async function ensureAddressEntryForContactInTx(
  tx: Tx,
  organizationId: string,
  addressEntryId: string | null | undefined
) {
  if (!addressEntryId) return;
  const address = await getAddressEntryInTx(tx, organizationId, addressEntryId);
  if (!address) {
    throw new SalesError("Address not found.", 404);
  }
}

export async function getCustomerContactsInTx(
  tx: Tx,
  customerId: string
): Promise<CustomerContactRow[]> {
  const rows = await tx
    .select(customerContactSelect)
    .from(customerContacts)
    .where(
      and(
        eq(customerContacts.customerId, customerId),
        isNull(customerContacts.deletedAt)
      )
    )
    .orderBy(desc(customerContacts.isPrimary), asc(customerContacts.name));

  return rows.map(mapCustomerContactRow);
}

export async function getCustomerCorrespondenceInTx(
  tx: Tx,
  customerId: string
): Promise<CustomerCorrespondenceRow[]> {
  const rows = await tx
    .select({
      id: customerCorrespondence.id,
      type: customerCorrespondence.type,
      occurredAt: customerCorrespondence.occurredAt,
      title: customerCorrespondence.title,
      body: customerCorrespondence.body,
      createdByUserId: customerCorrespondence.createdByUserId,
      createdByName: customerCorrespondence.createdByName,
      createdAt: customerCorrespondence.createdAt,
      updatedAt: customerCorrespondence.updatedAt,
    })
    .from(customerCorrespondence)
    .where(
      and(
        eq(customerCorrespondence.customerId, customerId),
        isNull(customerCorrespondence.deletedAt)
      )
    )
    .orderBy(desc(customerCorrespondence.occurredAt), desc(customerCorrespondence.createdAt));

  const ids = rows.map((row) => row.id);
  const attendeeRows =
    ids.length === 0
      ? []
      : await tx
          .select({
            id: customerCorrespondenceAttendees.id,
            correspondenceId: customerCorrespondenceAttendees.correspondenceId,
            contactId: customerCorrespondenceAttendees.contactId,
            contactName: customerCorrespondenceAttendees.contactName,
          })
          .from(customerCorrespondenceAttendees)
          .where(
            inArray(customerCorrespondenceAttendees.correspondenceId, ids)
          )
          .orderBy(asc(customerCorrespondenceAttendees.contactName));

  const attendeesByCorrespondence = new Map<
    string,
    CustomerCorrespondenceRow["attendees"]
  >();
  for (const attendee of attendeeRows) {
    const list = attendeesByCorrespondence.get(attendee.correspondenceId) ?? [];
    list.push({
      id: attendee.id,
      contactId: attendee.contactId,
      contactName: attendee.contactName,
    });
    attendeesByCorrespondence.set(attendee.correspondenceId, list);
  }

  return rows.map((row) => ({
    ...row,
    type: row.type as CustomerCorrespondenceRow["type"],
    attendees: attendeesByCorrespondence.get(row.id) ?? [],
  }));
}

function mapCustomerProjectFileRow(row: {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  uploadedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CustomerProjectFileRow {
  return row;
}

export async function getCustomerProjectsInTx(
  tx: Tx,
  customerId: string
): Promise<CustomerProjectRow[]> {
  const rows = await tx
    .select({
      id: customerProjects.id,
      name: customerProjects.name,
      status: customerProjects.status,
      startDate: customerProjects.startDate,
      targetEndDate: customerProjects.targetEndDate,
      summary: customerProjects.summary,
      createdAt: customerProjects.createdAt,
      updatedAt: customerProjects.updatedAt,
    })
    .from(customerProjects)
    .where(
      and(eq(customerProjects.customerId, customerId), isNull(customerProjects.deletedAt))
    )
    .orderBy(desc(customerProjects.createdAt));

  const projectIds = rows.map((row) => row.id);
  const fileRows =
    projectIds.length === 0
      ? []
      : await tx
          .select({
            id: customerProjectFiles.id,
            projectId: customerProjectFiles.projectId,
            filename: customerProjectFiles.filename,
            contentType: customerProjectFiles.contentType,
            sizeBytes: customerProjectFiles.sizeBytes,
            uploadedByUserId: customerProjectFiles.uploadedByUserId,
            uploadedByName: customerProjectFiles.uploadedByName,
            createdAt: customerProjectFiles.createdAt,
            updatedAt: customerProjectFiles.updatedAt,
          })
          .from(customerProjectFiles)
          .where(
            and(
              inArray(customerProjectFiles.projectId, projectIds),
              isNull(customerProjectFiles.deletedAt)
            )
          )
          .orderBy(desc(customerProjectFiles.createdAt));
  const noteRows =
    projectIds.length === 0
      ? []
      : await tx
          .select({
            id: customerProjectNotes.id,
            projectId: customerProjectNotes.projectId,
            body: customerProjectNotes.body,
            createdByUserId: customerProjectNotes.createdByUserId,
            createdByName: customerProjectNotes.createdByName,
            createdAt: customerProjectNotes.createdAt,
            updatedAt: customerProjectNotes.updatedAt,
          })
          .from(customerProjectNotes)
          .where(
            and(
              inArray(customerProjectNotes.projectId, projectIds),
              isNull(customerProjectNotes.deletedAt)
            )
          )
          .orderBy(desc(customerProjectNotes.createdAt));

  const filesByProject = new Map<string, CustomerProjectFileRow[]>();
  for (const file of fileRows) {
    const files = filesByProject.get(file.projectId) ?? [];
    files.push(mapCustomerProjectFileRow(file));
    filesByProject.set(file.projectId, files);
  }
  const notesByProject = new Map<string, CustomerProjectNoteRow[]>();
  for (const note of noteRows) {
    const notes = notesByProject.get(note.projectId) ?? [];
    notes.push({
      id: note.id,
      body: note.body,
      createdByUserId: note.createdByUserId,
      createdByName: note.createdByName,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });
    notesByProject.set(note.projectId, notes);
  }

  return rows.map((row) => ({
    ...row,
    status: row.status as CustomerProjectRow["status"],
    notes: notesByProject.get(row.id) ?? [],
    files: filesByProject.get(row.id) ?? [],
    salesOrders: [],
    orderCount: 0,
    orderValue: "0",
  }));
}

export async function createCustomerContact(
  customerId: string,
  data: CustomerContactInput
): Promise<CustomerContactRow | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return null;
    await ensureAddressEntryForContactInTx(tx, orgId, data.addressEntryId);

    const [contact] = await tx
      .insert(customerContacts)
      .values({
        organizationId: orgId,
        customerId,
        name: data.name,
        title: data.title,
        email: data.email,
        phone: data.phone,
        addressEntryId: data.addressEntryId,
        ...buildCustomerContactRoleColumns(data.roles),
        notes: data.notes,
      })
      .returning(customerContactSelect);

    return contact ? mapCustomerContactRow(contact) : null;
  });
}

export async function updateCustomerContact(
  customerId: string,
  contactId: string,
  data: CustomerContactInput
): Promise<CustomerContactRow | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return null;
    await ensureAddressEntryForContactInTx(tx, orgId, data.addressEntryId);

    const [contact] = await tx
      .update(customerContacts)
      .set({
        name: data.name,
        title: data.title,
        email: data.email,
        phone: data.phone,
        addressEntryId: data.addressEntryId,
        ...buildCustomerContactRoleColumns(data.roles),
        notes: data.notes,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerContacts.id, contactId),
          eq(customerContacts.customerId, customerId),
          isNull(customerContacts.deletedAt)
        )
      )
      .returning(customerContactSelect);

    return contact ? mapCustomerContactRow(contact) : null;
  });
}

export async function deleteCustomerContact(customerId: string, contactId: string) {
  return withAuthedOrgContext(async (tx) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return { deleted: false };

    const [contact] = await tx
      .update(customerContacts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(customerContacts.id, contactId),
          eq(customerContacts.customerId, customerId),
          isNull(customerContacts.deletedAt)
        )
      )
      .returning({ id: customerContacts.id });

    return { deleted: contact != null };
  });
}

export async function createCustomerCorrespondence(
  customerId: string,
  data: CustomerCorrespondenceInput,
  actor: { userId: string; name: string }
): Promise<CustomerCorrespondenceRow | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return null;

    const uniqueAttendeeIds = [...new Set(data.attendeeContactIds)];
    const attendeeContacts =
      uniqueAttendeeIds.length === 0
        ? []
        : await tx
            .select({ id: customerContacts.id, name: customerContacts.name })
            .from(customerContacts)
            .where(
              and(
                inArray(customerContacts.id, uniqueAttendeeIds),
                eq(customerContacts.customerId, customerId),
                isNull(customerContacts.deletedAt)
              )
            );

    if (attendeeContacts.length !== uniqueAttendeeIds.length) {
      throw new SalesError("One or more tagged contacts were not found.", 400);
    }

    const now = new Date();
    const [entry] = await tx
      .insert(customerCorrespondence)
      .values({
        organizationId: orgId,
        customerId,
        type: data.type,
        occurredAt: data.occurredAt ?? now,
        title: data.title,
        body: data.body,
        createdByUserId: actor.userId,
        createdByName: actor.name || null,
      })
      .returning({
        id: customerCorrespondence.id,
        type: customerCorrespondence.type,
        occurredAt: customerCorrespondence.occurredAt,
        title: customerCorrespondence.title,
        body: customerCorrespondence.body,
        createdByUserId: customerCorrespondence.createdByUserId,
        createdByName: customerCorrespondence.createdByName,
        createdAt: customerCorrespondence.createdAt,
        updatedAt: customerCorrespondence.updatedAt,
      });

    if (!entry) return null;

    const attendees =
      attendeeContacts.length === 0
        ? []
        : await tx
            .insert(customerCorrespondenceAttendees)
            .values(
              attendeeContacts.map((contact) => ({
                organizationId: orgId,
                customerId,
                correspondenceId: entry.id,
                contactId: contact.id,
                contactName: contact.name,
              }))
            )
            .returning({
              id: customerCorrespondenceAttendees.id,
              contactId: customerCorrespondenceAttendees.contactId,
              contactName: customerCorrespondenceAttendees.contactName,
            });

    return {
      ...entry,
      type: entry.type as CustomerCorrespondenceRow["type"],
      attendees,
    };
  });
}

export async function createCustomerProject(
  customerId: string,
  data: CustomerProjectInput
): Promise<CustomerProjectRow | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return null;

    const [project] = await tx
      .insert(customerProjects)
      .values({
        organizationId: orgId,
        customerId,
        name: data.name,
        status: data.status,
        startDate: data.startDate,
        targetEndDate: data.targetEndDate,
        summary: data.summary,
      })
      .returning({
        id: customerProjects.id,
        name: customerProjects.name,
        status: customerProjects.status,
        startDate: customerProjects.startDate,
        targetEndDate: customerProjects.targetEndDate,
        summary: customerProjects.summary,
        createdAt: customerProjects.createdAt,
        updatedAt: customerProjects.updatedAt,
      });

    return project
      ? {
          ...project,
          status: project.status as CustomerProjectRow["status"],
          notes: [],
          files: [],
          salesOrders: [],
          orderCount: 0,
          orderValue: "0",
        }
      : null;
  });
}

export async function updateCustomerProject(
  customerId: string,
  projectId: string,
  data: CustomerProjectInput
): Promise<CustomerProjectRow | null> {
  return withAuthedOrgContext(async (tx) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return null;

    const [project] = await tx
      .update(customerProjects)
      .set({
        name: data.name,
        status: data.status,
        startDate: data.startDate,
        targetEndDate: data.targetEndDate,
        summary: data.summary,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerProjects.id, projectId),
          eq(customerProjects.customerId, customerId),
          isNull(customerProjects.deletedAt)
        )
      )
      .returning({
        id: customerProjects.id,
        name: customerProjects.name,
        status: customerProjects.status,
        startDate: customerProjects.startDate,
        targetEndDate: customerProjects.targetEndDate,
        summary: customerProjects.summary,
        createdAt: customerProjects.createdAt,
        updatedAt: customerProjects.updatedAt,
      });

    if (!project) return null;

    const projects = await getCustomerProjectsInTx(tx, customerId);
    const fullProject = projects.find((row) => row.id === project.id);
    return fullProject ?? {
      ...project,
      status: project.status as CustomerProjectRow["status"],
      notes: [],
      files: [],
      salesOrders: [],
      orderCount: 0,
      orderValue: "0",
    };
  });
}

export async function deleteCustomerProject(customerId: string, projectId: string) {
  return withAuthedOrgContext(async (tx) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return { deleted: false, blobUrls: [] };

    const now = new Date();
    const [project] = await tx
      .update(customerProjects)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(customerProjects.id, projectId),
          eq(customerProjects.customerId, customerId),
          isNull(customerProjects.deletedAt)
        )
      )
      .returning({ id: customerProjects.id });

    if (!project) return { deleted: false, blobUrls: [] };

    const files = await tx
      .select({
        id: customerProjectFiles.id,
        blobUrl: customerProjectFiles.blobUrl,
      })
      .from(customerProjectFiles)
      .where(
        and(
          eq(customerProjectFiles.customerId, customerId),
          eq(customerProjectFiles.projectId, projectId),
          isNull(customerProjectFiles.deletedAt)
        )
      );

    if (files.length > 0) {
      await tx
        .update(customerProjectFiles)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          inArray(
            customerProjectFiles.id,
            files.map((file) => file.id)
          )
        );
    }

    await tx
      .update(customerProjectNotes)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(customerProjectNotes.customerId, customerId),
          eq(customerProjectNotes.projectId, projectId),
          isNull(customerProjectNotes.deletedAt)
        )
      );

    return {
      deleted: true,
      blobUrls: files.map((file) => file.blobUrl),
    };
  });
}

export async function createCustomerProjectNote(
  customerId: string,
  projectId: string,
  data: CustomerProjectNoteInput,
  actor: { userId: string; name: string }
): Promise<CustomerProjectNoteRow | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return null;

    const [project] = await tx
      .select({ id: customerProjects.id })
      .from(customerProjects)
      .where(
        and(
          eq(customerProjects.id, projectId),
          eq(customerProjects.customerId, customerId),
          isNull(customerProjects.deletedAt)
        )
      );

    if (!project) return null;

    const [note] = await tx
      .insert(customerProjectNotes)
      .values({
        organizationId: orgId,
        customerId,
        projectId,
        body: data.body,
        createdByUserId: actor.userId,
        createdByName: actor.name || null,
      })
      .returning({
        id: customerProjectNotes.id,
        body: customerProjectNotes.body,
        createdByUserId: customerProjectNotes.createdByUserId,
        createdByName: customerProjectNotes.createdByName,
        createdAt: customerProjectNotes.createdAt,
        updatedAt: customerProjectNotes.updatedAt,
      });

    return note ?? null;
  });
}

export async function deleteCustomerProjectNote(
  customerId: string,
  projectId: string,
  noteId: string
) {
  return withAuthedOrgContext(async (tx) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return { deleted: false };

    const [note] = await tx
      .update(customerProjectNotes)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(customerProjectNotes.id, noteId),
          eq(customerProjectNotes.customerId, customerId),
          eq(customerProjectNotes.projectId, projectId),
          isNull(customerProjectNotes.deletedAt)
        )
      )
      .returning({ id: customerProjectNotes.id });

    return { deleted: note != null };
  });
}

export async function getCustomerProjectFileUploadTarget(
  customerId: string,
  projectId: string
) {
  return withAuthedOrgContext(async (tx) => {
    const [project] = await tx
      .select({ id: customerProjects.id })
      .from(customerProjects)
      .where(
        and(
          eq(customerProjects.id, projectId),
          eq(customerProjects.customerId, customerId),
          isNull(customerProjects.deletedAt)
        )
      );

    return project ?? null;
  });
}

export async function createCustomerProjectFile(params: {
  customerId: string;
  projectId: string;
  storageKey: string;
  blobUrl: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: { userId: string; name: string };
}): Promise<CustomerProjectFileRow | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [project] = await tx
      .select({ id: customerProjects.id })
      .from(customerProjects)
      .where(
        and(
          eq(customerProjects.id, params.projectId),
          eq(customerProjects.customerId, params.customerId),
          isNull(customerProjects.deletedAt)
        )
      );

    if (!project) return null;

    const [file] = await tx
      .insert(customerProjectFiles)
      .values({
        organizationId: orgId,
        customerId: params.customerId,
        projectId: params.projectId,
        storageKey: params.storageKey,
        blobUrl: params.blobUrl,
        filename: params.filename,
        contentType: params.contentType,
        sizeBytes: params.sizeBytes,
        uploadedByUserId: params.uploadedBy.userId,
        uploadedByName: params.uploadedBy.name || null,
      })
      .returning({
        id: customerProjectFiles.id,
        filename: customerProjectFiles.filename,
        contentType: customerProjectFiles.contentType,
        sizeBytes: customerProjectFiles.sizeBytes,
        uploadedByUserId: customerProjectFiles.uploadedByUserId,
        uploadedByName: customerProjectFiles.uploadedByName,
        createdAt: customerProjectFiles.createdAt,
        updatedAt: customerProjectFiles.updatedAt,
      });

    return file ? mapCustomerProjectFileRow(file) : null;
  });
}

export async function getCustomerProjectFileForDownload(
  customerId: string,
  projectId: string,
  fileId: string
) {
  return withAuthedOrgContext(async (tx) => {
    const [file] = await tx
      .select({
        id: customerProjectFiles.id,
        storageKey: customerProjectFiles.storageKey,
        blobUrl: customerProjectFiles.blobUrl,
        filename: customerProjectFiles.filename,
        contentType: customerProjectFiles.contentType,
        sizeBytes: customerProjectFiles.sizeBytes,
      })
      .from(customerProjectFiles)
      .innerJoin(
        customerProjects,
        eq(customerProjectFiles.projectId, customerProjects.id)
      )
      .innerJoin(customers, eq(customerProjectFiles.customerId, customers.id))
      .where(
        and(
          eq(customerProjectFiles.id, fileId),
          eq(customerProjectFiles.projectId, projectId),
          eq(customerProjectFiles.customerId, customerId),
          isNull(customerProjectFiles.deletedAt),
          isNull(customerProjects.deletedAt),
          isNull(customers.deletedAt)
        )
      );

    return file ?? null;
  });
}

export async function renameCustomerProjectFile(
  customerId: string,
  projectId: string,
  fileId: string,
  data: CustomerProjectFileRenameInput
): Promise<CustomerProjectFileRow | null> {
  return withAuthedOrgContext(async (tx) => {
    const [project] = await tx
      .select({ id: customerProjects.id })
      .from(customerProjects)
      .innerJoin(customers, eq(customerProjects.customerId, customers.id))
      .where(
        and(
          eq(customerProjects.id, projectId),
          eq(customerProjects.customerId, customerId),
          isNull(customerProjects.deletedAt),
          isNull(customers.deletedAt)
        )
      )
      .limit(1);

    if (!project) return null;

    const [file] = await tx
      .update(customerProjectFiles)
      .set({ filename: data.filename, updatedAt: new Date() })
      .where(
        and(
          eq(customerProjectFiles.id, fileId),
          eq(customerProjectFiles.projectId, projectId),
          eq(customerProjectFiles.customerId, customerId),
          isNull(customerProjectFiles.deletedAt)
        )
      )
      .returning({
        id: customerProjectFiles.id,
        filename: customerProjectFiles.filename,
        contentType: customerProjectFiles.contentType,
        sizeBytes: customerProjectFiles.sizeBytes,
        uploadedByUserId: customerProjectFiles.uploadedByUserId,
        uploadedByName: customerProjectFiles.uploadedByName,
        createdAt: customerProjectFiles.createdAt,
        updatedAt: customerProjectFiles.updatedAt,
      });

    return file ? mapCustomerProjectFileRow(file) : null;
  });
}

export async function deleteCustomerProjectFile(
  customerId: string,
  projectId: string,
  fileId: string
) {
  return withAuthedOrgContext(async (tx) => {
    const [project] = await tx
      .select({ id: customerProjects.id })
      .from(customerProjects)
      .innerJoin(customers, eq(customerProjects.customerId, customers.id))
      .where(
        and(
          eq(customerProjects.id, projectId),
          eq(customerProjects.customerId, customerId),
          isNull(customerProjects.deletedAt),
          isNull(customers.deletedAt)
        )
      )
      .limit(1);

    if (!project) return null;

    const [file] = await tx
      .update(customerProjectFiles)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(customerProjectFiles.id, fileId),
          eq(customerProjectFiles.projectId, projectId),
          eq(customerProjectFiles.customerId, customerId),
          isNull(customerProjectFiles.deletedAt)
        )
      )
      .returning({
        id: customerProjectFiles.id,
        blobUrl: customerProjectFiles.blobUrl,
      });

    return file ?? null;
  });
}
