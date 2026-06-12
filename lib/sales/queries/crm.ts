import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  customerActivities,
  customerActivityAttendees,
  customerContacts,
  customerProjects,
  customers,
} from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { assertFeatureAccessInTx } from "@/lib/billing/entitlements";
import type { Tx } from "@/lib/db/with-org-context";
import type {
  CustomerActivityInput,
  CustomerActivityPatch,
  CustomerContactInput,
  CustomerProjectInput,
} from "@/lib/schemas/customer-crm";
import type {
  CustomerActivityRow,
  CustomerContactRole,
  CustomerContactRow,
  CustomerProjectRow,
} from "../types";
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function ensureActiveCustomerInTx(tx: Tx, customerId: string) {
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

export async function getCustomerActivitiesInTx(
  tx: Tx,
  customerId: string
): Promise<CustomerActivityRow[]> {
  const rows = await tx
    .select({
      id: customerActivities.id,
      type: customerActivities.type,
      occurredAt: customerActivities.occurredAt,
      title: customerActivities.title,
      body: customerActivities.body,
      dueDate: customerActivities.dueDate,
      status: customerActivities.status,
      completedAt: customerActivities.completedAt,
      customerProjectId: customerActivities.customerProjectId,
      projectName: customerProjects.name,
      createdByUserId: customerActivities.createdByUserId,
      createdByName: customerActivities.createdByName,
      createdAt: customerActivities.createdAt,
      updatedAt: customerActivities.updatedAt,
    })
    .from(customerActivities)
    .leftJoin(
      customerProjects,
      eq(customerActivities.customerProjectId, customerProjects.id)
    )
    .where(
      and(
        eq(customerActivities.customerId, customerId),
        isNull(customerActivities.deletedAt)
      )
    )
    .orderBy(desc(customerActivities.occurredAt), desc(customerActivities.createdAt));

  const ids = rows.map((row) => row.id);
  const attendeeRows =
    ids.length === 0
      ? []
      : await tx
          .select({
            id: customerActivityAttendees.id,
            activityId: customerActivityAttendees.activityId,
            contactId: customerActivityAttendees.contactId,
            contactName: customerActivityAttendees.contactName,
          })
          .from(customerActivityAttendees)
          .where(inArray(customerActivityAttendees.activityId, ids))
          .orderBy(asc(customerActivityAttendees.contactName));

  const attendeesByActivity = new Map<string, CustomerActivityRow["attendees"]>();
  for (const attendee of attendeeRows) {
    const list = attendeesByActivity.get(attendee.activityId) ?? [];
    list.push({
      id: attendee.id,
      contactId: attendee.contactId,
      contactName: attendee.contactName,
    });
    attendeesByActivity.set(attendee.activityId, list);
  }

  return rows.map((row) => ({
    ...row,
    type: row.type as CustomerActivityRow["type"],
    status: row.status as CustomerActivityRow["status"],
    attendees: attendeesByActivity.get(row.id) ?? [],
  }));
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

  return rows.map((row) => ({
    ...row,
    status: row.status as CustomerProjectRow["status"],
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
    // Recording new CRM data is the crm workflow; editing/deleting existing
    // records stays free (same boundary as lot tracking's existing-data rule).
    await assertFeatureAccessInTx(tx, orgId, "crm", {
      route: "POST /api/customers/[id]/contacts",
    });
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

export async function createCustomerActivity(
  customerId: string,
  data: CustomerActivityInput,
  actor: { userId: string; name: string }
): Promise<CustomerActivityRow | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    await assertFeatureAccessInTx(tx, orgId, "crm", {
      route: "POST /api/customers/[id]/activities",
    });
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return null;

    if (data.customerProjectId) {
      const [project] = await tx
        .select({ id: customerProjects.id })
        .from(customerProjects)
        .where(
          and(
            eq(customerProjects.id, data.customerProjectId),
            eq(customerProjects.customerId, customerId),
            isNull(customerProjects.deletedAt)
          )
        );
      if (!project) {
        throw new SalesError("Project not found for this customer.", 400);
      }
    }

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

    const isTask = data.type === "task";
    const now = new Date();
    const [entry] = await tx
      .insert(customerActivities)
      .values({
        organizationId: orgId,
        customerId,
        customerProjectId: data.customerProjectId ?? null,
        type: data.type,
        occurredAt: data.occurredAt ?? now,
        title: data.title,
        body: data.body,
        dueDate: isTask ? data.dueDate : null,
        status: isTask ? "open" : null,
        createdByUserId: actor.userId,
        createdByName: actor.name || null,
      })
      .returning({ id: customerActivities.id });

    if (!entry) return null;

    if (attendeeContacts.length > 0) {
      await tx.insert(customerActivityAttendees).values(
        attendeeContacts.map((contact) => ({
          organizationId: orgId,
          customerId,
          activityId: entry.id,
          contactId: contact.id,
          contactName: contact.name,
        }))
      );
    }

    const [activity] = await getCustomerActivityByIdInTx(tx, customerId, entry.id);
    return activity ?? null;
  });
}

async function getCustomerActivityByIdInTx(
  tx: Tx,
  customerId: string,
  activityId: string
): Promise<CustomerActivityRow[]> {
  const all = await getCustomerActivitiesInTx(tx, customerId);
  return all.filter((row) => row.id === activityId);
}

export async function patchCustomerActivity(
  customerId: string,
  activityId: string,
  data: CustomerActivityPatch
): Promise<CustomerActivityRow | null> {
  return withAuthedOrgContext(async (tx) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return null;

    const [existing] = await tx
      .select({ id: customerActivities.id, type: customerActivities.type })
      .from(customerActivities)
      .where(
        and(
          eq(customerActivities.id, activityId),
          eq(customerActivities.customerId, customerId),
          isNull(customerActivities.deletedAt)
        )
      );
    if (!existing) return null;

    if (
      existing.type !== "task" &&
      (data.status !== undefined || data.dueDate !== undefined)
    ) {
      throw new SalesError("Only tasks have a status or due date.", 400);
    }

    const [updated] = await tx
      .update(customerActivities)
      .set({
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.body !== undefined ? { body: data.body } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
        ...(data.status !== undefined
          ? {
              status: data.status,
              completedAt: data.status === "done" ? new Date() : null,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(customerActivities.id, existing.id))
      .returning({ id: customerActivities.id });

    if (!updated) return null;
    const [activity] = await getCustomerActivityByIdInTx(tx, customerId, updated.id);
    return activity ?? null;
  });
}

export async function deleteCustomerActivity(
  customerId: string,
  activityId: string
): Promise<boolean> {
  return withAuthedOrgContext(async (tx) => {
    const customer = await ensureActiveCustomerInTx(tx, customerId);
    if (!customer) return false;

    const deleted = await tx
      .update(customerActivities)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(customerActivities.id, activityId),
          eq(customerActivities.customerId, customerId),
          isNull(customerActivities.deletedAt)
        )
      )
      .returning({ id: customerActivities.id });

    return deleted.length > 0;
  });
}

export async function createCustomerProject(
  customerId: string,
  data: CustomerProjectInput
): Promise<CustomerProjectRow | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    await assertFeatureAccessInTx(tx, orgId, "crm", {
      route: "POST /api/customers/[id]/projects",
    });
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

    return { deleted: true, blobUrls: [] };
  });
}
