import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { customerContacts, customerCorrespondence, customerProjectFiles, customerProjects, customers } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import type { InsertCustomer, PatchCustomer, UpdateCustomer } from "@/lib/schemas/customers";
import { ensureCustomerCategoryExistsInTx } from "./customer-categories";

export async function createCustomer(data: InsertCustomer) {
  return withAuthedOrgContext(async (tx, orgId) => {
    return createCustomerInTx(tx, orgId, data);
  });
}

export async function createCustomerInTx(tx: Tx, orgId: string, data: InsertCustomer) {
  await ensureCustomerCategoryExistsInTx(tx, data.customerCategoryId);

  const [customer] = await tx
    .insert(customers)
    .values({
      organizationId: orgId,
      ...data,
    })
    .returning({ id: customers.id });

  return customer;
}

export async function updateCustomer(id: string, data: UpdateCustomer) {
  return withAuthedOrgContext(async (tx) => {
    return updateCustomerInTx(tx, id, data);
  });
}

export async function updateCustomerInTx(tx: Tx, id: string, data: UpdateCustomer) {
  await ensureCustomerCategoryExistsInTx(tx, data.customerCategoryId);

  const [customer] = await tx
    .update(customers)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
    .returning({ id: customers.id });

  return customer ?? null;
}

export async function patchCustomerInTx(tx: Tx, id: string, data: PatchCustomer) {
  if (data.customerCategoryId !== undefined) {
    await ensureCustomerCategoryExistsInTx(tx, data.customerCategoryId);
  }

  const [customer] = await tx
    .update(customers)
    .set({
      ...data,
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
    .update(customerCorrespondence)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        inArray(customerCorrespondence.customerId, customerIds),
        isNull(customerCorrespondence.deletedAt)
      )
    );

  const files = await tx
    .select({
      id: customerProjectFiles.id,
      blobUrl: customerProjectFiles.blobUrl,
    })
    .from(customerProjectFiles)
    .where(
      and(
        inArray(customerProjectFiles.customerId, customerIds),
        isNull(customerProjectFiles.deletedAt)
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

  return files.map((file) => file.blobUrl);
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
