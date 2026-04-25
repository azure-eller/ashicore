import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { customerCategories, customers } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { createCustomerCategory, updateCustomerCategory } from "@/app/(dashboard)/sales/queries";
import type { InsertCustomer } from "@/lib/schemas/customers";

export type AgentCustomerLookupRow = {
  id: string;
  name: string;
  customerCategoryId: string | null;
  customerCategoryName: string | null;
  email: string | null;
  phone: string | null;
  billingLine1: string | null;
  notes: string | null;
};

export type AgentCustomerCategoryLookupRow = {
  id: string;
  name: string;
  description: string | null;
};

export type PreparedCustomerImportRow = {
  existingCustomerId: string | null;
  values: InsertCustomer;
};

export async function getActiveCustomersForAgentImport(): Promise<AgentCustomerLookupRow[]> {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: customers.id,
        name: customers.name,
        customerCategoryId: customers.customerCategoryId,
        customerCategoryName: customerCategories.name,
        email: customers.email,
        phone: customers.phone,
        billingLine1: customers.billingLine1,
        notes: customers.notes,
      })
      .from(customers)
      .leftJoin(customerCategories, eq(customers.customerCategoryId, customerCategories.id))
      .where(isNull(customers.deletedAt))
      .orderBy(asc(customers.name));
  });
}

export async function lookupCustomersForAgent(args: { query: string; limit?: number }) {
  const query = args.query.trim().toLowerCase();
  const limit = args.limit ?? 20;
  const rows = await getActiveCustomersForAgentImport();

  if (query.length === 0) {
    return rows.slice(0, limit);
  }

  return rows
    .filter((row) =>
      [row.name, row.email, row.phone, row.customerCategoryName]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query))
    )
    .slice(0, limit);
}

export async function lookupCustomerCategoriesForAgent(): Promise<
  AgentCustomerCategoryLookupRow[]
> {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: customerCategories.id,
        name: customerCategories.name,
        description: customerCategories.description,
      })
      .from(customerCategories)
      .where(isNull(customerCategories.deletedAt))
      .orderBy(asc(customerCategories.sortOrder), asc(customerCategories.name));
  });
}

export async function upsertCustomerCategoryForAgent(args: {
  id?: string | null;
  name: string;
  description: string | null;
}) {
  const categories = await lookupCustomerCategoriesForAgent();
  const existing = args.id
    ? categories.find((category) => category.id === args.id) ?? null
    : categories.find((category) => category.name.toLowerCase() === args.name.toLowerCase()) ?? null;

  if (existing) {
    const updated = await updateCustomerCategory(existing.id, {
      name: args.name,
      description: args.description,
    });

    return {
      action: "updated" as const,
      id: updated?.id ?? existing.id,
      name: args.name,
    };
  }

  const created = await createCustomerCategory({
    name: args.name,
    description: args.description,
  });

  if (!created) {
    throw new Error("Failed to create customer category.");
  }

  return {
    action: "created" as const,
    id: created.id,
    name: created.name,
  };
}

export async function commitCustomerImportForAgent(rows: PreparedCustomerImportRow[]) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const categoryIds = [...new Set(rows.map((row) => row.values.customerCategoryId).filter(Boolean))];
    if (categoryIds.length > 0) {
      const activeCategories = await tx
        .select({ id: customerCategories.id })
        .from(customerCategories)
        .where(and(isNull(customerCategories.deletedAt)));
      const activeCategoryIds = new Set(activeCategories.map((category) => category.id));

      for (const categoryId of categoryIds) {
        if (!activeCategoryIds.has(categoryId!)) {
          throw new Error(`Customer category '${categoryId}' is no longer active.`);
        }
      }
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const row of rows) {
      if (row.existingCustomerId) {
        const [updated] = await tx
          .update(customers)
          .set({
            ...row.values,
            updatedAt: new Date(),
          })
          .where(and(eq(customers.id, row.existingCustomerId), isNull(customers.deletedAt)))
          .returning({ id: customers.id });

        if (updated) {
          updatedCount += 1;
        }
        continue;
      }

      const [created] = await tx
        .insert(customers)
        .values({
          organizationId: orgId,
          ...row.values,
        })
        .returning({ id: customers.id });

      if (created) {
        createdCount += 1;
      }
    }

    return {
      createdCount,
      updatedCount,
      totalCount: createdCount + updatedCount,
    };
  });
}
