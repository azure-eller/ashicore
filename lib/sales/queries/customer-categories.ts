import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { customerCategories, customers, pricingSchedules } from "@/lib/db/schema";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import type { InsertCustomerCategory, UpdateCustomerCategory } from "@/lib/schemas/customer-categories";
import type { CustomerCategoryOption, CustomerCategoryRow } from "../types";
import { SalesError } from "./errors";

export async function ensureCustomerCategoryExistsInTx(
  tx: Tx,
  customerCategoryId: string | null
) {
  if (customerCategoryId == null) {
    return;
  }

  const [existingCategory] = await tx
    .select({ id: customerCategories.id })
    .from(customerCategories)
    .where(
      and(
        eq(customerCategories.id, customerCategoryId),
        isNull(customerCategories.deletedAt)
      )
    );

  if (!existingCategory) {
    throw new SalesError("Customer category not found.", 404);
  }
}

async function ensureCustomerCategoryNameAvailableInTx(
  tx: Tx,
  name: string,
  options?: { excludeId?: string }
) {
  const conditions = [
    eq(customerCategories.name, name),
    isNull(customerCategories.deletedAt),
  ];

  if (options?.excludeId) {
    conditions.push(sql`${customerCategories.id} <> ${options.excludeId}`);
  }

  const [existingCategory] = await tx
    .select({ id: customerCategories.id })
    .from(customerCategories)
    .where(and(...conditions))
    .limit(1);

  if (existingCategory) {
    throw new SalesError("A customer category with this name already exists.", 400, {
      errors: {
        name: ["A customer category with this name already exists."],
      },
    });
  }
}

export async function getCustomerCategoryOptions(): Promise<CustomerCategoryOption[]> {
  return withAuthedOrgContext(async (tx) => {
    return tx
      .select({
        id: customerCategories.id,
        name: customerCategories.name,
      })
      .from(customerCategories)
      .where(isNull(customerCategories.deletedAt))
      .orderBy(asc(customerCategories.sortOrder), asc(customerCategories.name));
  });
}

export async function getCustomerCategories(): Promise<CustomerCategoryRow[]> {
  return withAuthedOrgContext(async (tx) => {
    const rows = await tx
      .select({
        id: customerCategories.id,
        name: customerCategories.name,
        description: customerCategories.description,
        createdAt: customerCategories.createdAt,
        updatedAt: customerCategories.updatedAt,
      })
      .from(customerCategories)
      .where(isNull(customerCategories.deletedAt))
      .orderBy(asc(customerCategories.sortOrder), asc(customerCategories.name));

    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((row) => row.id);
    const [customerCounts, scheduleCounts] = await Promise.all([
      tx
        .select({
          customerCategoryId: customers.customerCategoryId,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(customers)
        .where(
          and(
            inArray(customers.customerCategoryId, ids),
            isNull(customers.deletedAt)
          )
        )
        .groupBy(customers.customerCategoryId),
      tx
        .select({
          customerCategoryId: pricingSchedules.customerCategoryId,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(pricingSchedules)
        .where(
          and(
            inArray(pricingSchedules.customerCategoryId, ids),
            isNull(pricingSchedules.deletedAt)
          )
        )
        .groupBy(pricingSchedules.customerCategoryId),
    ]);

    const customerCountsByCategoryId = new Map(
      customerCounts
        .filter(
          (
            row
          ): row is {
            customerCategoryId: string;
            count: number;
          } => row.customerCategoryId != null
        )
        .map((row) => [row.customerCategoryId, row.count])
    );
    const scheduleCountsByCategoryId = new Map(
      scheduleCounts
        .filter(
          (
            row
          ): row is {
            customerCategoryId: string;
            count: number;
          } => row.customerCategoryId != null
        )
        .map((row) => [row.customerCategoryId, row.count])
    );

    return rows.map((row) => ({
      ...row,
      customerCount: customerCountsByCategoryId.get(row.id) ?? 0,
      scheduleCount: scheduleCountsByCategoryId.get(row.id) ?? 0,
    }));
  });
}

export async function getCustomerCategory(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const [category] = await tx
      .select({
        id: customerCategories.id,
        name: customerCategories.name,
        description: customerCategories.description,
        updatedAt: customerCategories.updatedAt,
      })
      .from(customerCategories)
      .where(
        and(
          eq(customerCategories.id, id),
          isNull(customerCategories.deletedAt)
        )
      );

    return category ?? null;
  });
}

export async function createCustomerCategory(data: InsertCustomerCategory) {
  return withAuthedOrgContext(async (tx, orgId) => {
    await ensureCustomerCategoryNameAvailableInTx(tx, data.name);

    const [maxSortOrderRow] = await tx
      .select({
        value: sql<number>`COALESCE(MAX(${customerCategories.sortOrder}), -1)`,
      })
      .from(customerCategories)
      .where(isNull(customerCategories.deletedAt));

    const [category] = await tx
      .insert(customerCategories)
      .values({
        organizationId: orgId,
        name: data.name,
        description: data.description,
        sortOrder: Number(maxSortOrderRow?.value ?? -1) + 1,
      })
      .returning({ id: customerCategories.id, name: customerCategories.name });

    return category;
  });
}

export async function updateCustomerCategory(id: string, data: UpdateCustomerCategory) {
  return withAuthedOrgContext(async (tx) => {
    await ensureCustomerCategoryNameAvailableInTx(tx, data.name, {
      excludeId: id,
    });

    const [category] = await tx
      .update(customerCategories)
      .set({
        name: data.name,
        description: data.description,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerCategories.id, id),
          isNull(customerCategories.deletedAt)
        )
      )
      .returning({ id: customerCategories.id });

    return category ?? null;
  });
}

async function ensureCustomerCategoriesDeletableInTx(
  tx: Tx,
  categoryIds: string[]
) {
  const uniqueCategoryIds = [...new Set(categoryIds)];
  const now = new Date();

  await Promise.all([
    tx
      .update(customers)
      .set({ customerCategoryId: null, updatedAt: now })
      .where(
        and(
          inArray(customers.customerCategoryId, uniqueCategoryIds),
          isNull(customers.deletedAt)
        )
      )
      .returning({ id: customers.id }),
    tx
      .update(pricingSchedules)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          inArray(pricingSchedules.customerCategoryId, uniqueCategoryIds),
          isNull(pricingSchedules.deletedAt)
        )
      )
      .returning({ id: pricingSchedules.id }),
  ]);

  return uniqueCategoryIds;
}

async function softDeleteCustomerCategoriesInTx(tx: Tx, categoryIds: string[]) {
  if (categoryIds.length === 0) {
    return [];
  }

  return tx
    .update(customerCategories)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(customerCategories.id, categoryIds),
        isNull(customerCategories.deletedAt)
      )
    )
    .returning({ id: customerCategories.id });
}

export async function deleteCustomerCategory(id: string) {
  const deleted = await withAuthedOrgContext(async (tx) => {
    const categoryIds = await ensureCustomerCategoriesDeletableInTx(tx, [id]);
    const [category] = await softDeleteCustomerCategoriesInTx(tx, categoryIds);
    return category != null;
  });

  return { deleted };
}

export async function deleteCustomerCategories(ids: string[]) {
  const deletedCount = await withAuthedOrgContext(async (tx) => {
    const categoryIds = await ensureCustomerCategoriesDeletableInTx(tx, ids);
    const deletedCategories = await softDeleteCustomerCategoriesInTx(tx, categoryIds);
    return deletedCategories.length;
  });

  return { deletedCount };
}
