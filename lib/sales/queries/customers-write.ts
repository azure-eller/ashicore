import "server-only";

import { sql } from "drizzle-orm";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { customerActivities, customerContacts, customerProjects, customers } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import type { InsertCustomer, PatchCustomer, UpdateCustomer } from "@/lib/schemas/customers";
import { ensureCustomerCategoryExistsInTx } from "./customer-categories";
import { reconcileCustomerContactsInTx } from "./crm";

export type CustomerWriteResult =
  | { kind: "updated"; id: string }
  | { kind: "conflict"; id: string }
  | { kind: "not-found" };

export async function createCustomer(data: InsertCustomer) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const { contacts, ...fields } = data;
    await ensureCustomerCategoryExistsInTx(tx, fields.customerCategoryId);

    // Idempotent under client-generated ids: a retried create with the same
    // id no-ops the insert.
    const inserted = await tx
      .insert(customers)
      .values({ organizationId: orgId, ...fields })
      .onConflictDoNothing({ target: customers.id })
      .returning({ id: customers.id });

    const id = inserted[0]?.id ?? data.id;
    if (!id) return null;

    if (contacts) {
      await reconcileCustomerContactsInTx(tx, orgId, id, contacts);
    }

    return { id };
  });
}

export async function createCustomerInTx(tx: Tx, orgId: string, data: InsertCustomer) {
  const { contacts: _contacts, ...fields } = data;
  await ensureCustomerCategoryExistsInTx(tx, fields.customerCategoryId);

  const [customer] = await tx
    .insert(customers)
    .values({
      organizationId: orgId,
      ...fields,
    })
    .returning({ id: customers.id });

  return customer;
}

export async function updateCustomer(
  id: string,
  data: UpdateCustomer,
): Promise<CustomerWriteResult> {
  return withAuthedOrgContext(async (tx, orgId) => {
    const { expectedVersion, contacts, ...fields } = data;
    await ensureCustomerCategoryExistsInTx(tx, fields.customerCategoryId);

    const [customer] = await tx
      .update(customers)
      .set({
        ...fields,
        version: sql`${customers.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customers.id, id),
          isNull(customers.deletedAt),
          ...(expectedVersion != null
            ? [eq(customers.version, expectedVersion)]
            : []),
        ),
      )
      .returning({ id: customers.id });

    if (!customer) {
      const [current] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, id), isNull(customers.deletedAt)));
      return current
        ? ({ kind: "conflict", id } satisfies CustomerWriteResult)
        : ({ kind: "not-found" } satisfies CustomerWriteResult);
    }

    if (contacts) {
      await reconcileCustomerContactsInTx(tx, orgId, id, contacts);
    }

    return { kind: "updated", id } satisfies CustomerWriteResult;
  });
}

export async function patchCustomerInTx(tx: Tx, id: string, data: PatchCustomer) {
  if (data.customerCategoryId !== undefined) {
    await ensureCustomerCategoryExistsInTx(tx, data.customerCategoryId);
  }

  const [customer] = await tx
    .update(customers)
    .set({
      ...data,
      version: sql`${customers.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
    .returning({ id: customers.id });

  return customer ?? null;
}

export async function patchCustomer(id: string, data: PatchCustomer) {
  return withAuthedOrgContext(async (tx) => {
    return patchCustomerInTx(tx, id, data);
  });
}

async function ensureCustomersDeletableInTx(customerIds: string[]) {
  const uniqueCustomerIds = [...new Set(customerIds)];
  return uniqueCustomerIds;
}

async function softDeleteCustomersInTx(tx: Tx, customerIds: string[]) {
  if (customerIds.length === 0) {
    return [];
  }

  return tx
    .update(customers)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(customers.id, customerIds),
        isNull(customers.deletedAt)
      )
    )
    .returning({ id: customers.id });
}

async function softDeleteCustomerCrmArtifactsInTx(tx: Tx, customerIds: string[]) {
  if (customerIds.length === 0) {
    return [];
  }

  const now = new Date();
  await tx
    .update(customerContacts)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        inArray(customerContacts.customerId, customerIds),
        isNull(customerContacts.deletedAt)
      )
    );

  await tx
    .update(customerActivities)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        inArray(customerActivities.customerId, customerIds),
        isNull(customerActivities.deletedAt)
      )
    );

  await tx
    .update(customerProjects)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        inArray(customerProjects.customerId, customerIds),
        isNull(customerProjects.deletedAt)
      )
    );

  return [];
}

export async function deleteCustomer(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const customerIds = await ensureCustomersDeletableInTx([id]);
    const [customer] = await softDeleteCustomersInTx(tx, customerIds);
    const blobUrls =
      customer != null ? await softDeleteCustomerCrmArtifactsInTx(tx, [customer.id]) : [];

    return { deleted: customer != null, blobUrls };
  });
}

export async function deleteCustomers(ids: string[]) {
  return withAuthedOrgContext(async (tx) => {
    const customerIds = await ensureCustomersDeletableInTx(ids);
    const deletedCustomers = await softDeleteCustomersInTx(tx, customerIds);
    const deletedCustomerIds = deletedCustomers.map((customer) => customer.id);
    const blobUrls = await softDeleteCustomerCrmArtifactsInTx(tx, deletedCustomerIds);

    return { deletedCount: deletedCustomers.length, blobUrls };
  });
}
