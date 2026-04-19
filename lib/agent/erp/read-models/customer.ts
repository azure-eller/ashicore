import type { CustomerCategoryRow, CustomerRow } from "@/app/(dashboard)/sales/types";
import {
  createCustomer,
  createCustomerCategory,
  getCustomer,
  getCustomerCategories,
  getCustomerCategory,
  getCustomers,
  updateCustomer,
  updateCustomerCategory,
} from "@/app/(dashboard)/sales/queries";
import type { InsertCustomerCategory, UpdateCustomerCategory } from "@/lib/schemas/customer-categories";
import type { InsertCustomer, UpdateCustomer } from "@/lib/schemas/customers";
import type { ErpGetOutput, ErpListItem, ErpListOutput, ErpRecord } from "@/lib/agent/erp/read-models/types";

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function paginate<T>(items: T[], limit: number, offset: number) {
  const paged = items.slice(offset, offset + limit);
  const nextOffset = offset + paged.length;

  return {
    items: paged,
    truncated: nextOffset < items.length,
    nextOffset: nextOffset < items.length ? nextOffset : undefined,
  };
}

function toCustomerRecord(row: CustomerRow): ErpRecord {
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    title: row.name,
    subtitle: row.customerCategoryName ?? row.email ?? null,
    status: row.deletedAt ? "deleted" : null,
    badges: row.customerCategoryName ? [row.customerCategoryName] : [],
    fields: {
      name: row.name,
      customerCategoryId: row.customerCategoryId,
      customerCategoryName: row.customerCategoryName,
      email: row.email,
      phone: row.phone,
      billingLine1: row.billingLine1,
      billingLine2: row.billingLine2,
      billingCity: row.billingCity,
      billingRegion: row.billingRegion,
      billingPostcode: row.billingPostcode,
      billingCountry: row.billingCountry,
      shipLine1: row.shipLine1,
      shipLine2: row.shipLine2,
      shipCity: row.shipCity,
      shipRegion: row.shipRegion,
      shipPostcode: row.shipPostcode,
      shipCountry: row.shipCountry,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      deletedAt: toIso(row.deletedAt),
    },
  };
}

function toCustomerCategoryRecord(
  row:
    | CustomerCategoryRow
    | {
        id: string;
        name: string;
        description: string | null;
        updatedAt: Date;
      }
): ErpRecord {
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    title: row.name,
    subtitle: row.description,
    status: null,
    badges: [],
    fields: {
      name: row.name,
      description: row.description,
      customerCount: "customerCount" in row ? row.customerCount : null,
      scheduleCount: "scheduleCount" in row ? row.scheduleCount : null,
      createdAt: "createdAt" in row ? row.createdAt.toISOString() : null,
    },
  };
}

function toListItem(record: ErpRecord): ErpListItem {
  return {
    id: record.id,
    title: record.title,
    subtitle: record.subtitle,
    status: record.status ?? null,
    badges: record.badges,
    updatedAt: record.updatedAt,
    fields: record.fields,
  };
}

export async function listCustomersForAgent(args: {
  limit: number;
  offset: number;
  search?: string;
  activeOnly?: boolean;
}): Promise<ErpListOutput> {
  const customers = await getCustomers();
  const search = args.search?.trim().toLowerCase();

  const filtered = customers
    .filter((customer) => (args.activeOnly ?? true ? customer.deletedAt == null : true))
    .filter((customer) => {
      if (!search) {
        return true;
      }

      return [
        customer.name,
        customer.email,
        customer.phone,
        customer.customerCategoryName,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(search));
    })
    .map((customer) => toListItem(toCustomerRecord(customer)));

  const paged = paginate(filtered, args.limit, args.offset);

  return {
    entityType: "customer",
    ...paged,
  };
}

export async function getCustomerForAgent(id: string): Promise<ErpGetOutput | null> {
  const customer = await getCustomer(id);
  if (!customer) {
    return null;
  }

  return {
    entityType: "customer",
    record: toCustomerRecord(customer),
  };
}

export async function createCustomerForAgent(values: InsertCustomer): Promise<ErpGetOutput> {
  const created = await createCustomer(values);
  const customer = await getCustomerForAgent(created.id);
  if (!customer) {
    throw new Error("Created customer could not be reloaded.");
  }
  return customer;
}

export async function updateCustomerForAgent(
  id: string,
  values: UpdateCustomer
): Promise<ErpGetOutput | null> {
  const updated = await updateCustomer(id, values);
  if (!updated) {
    return null;
  }

  return getCustomerForAgent(updated.id);
}

export async function listCustomerCategoriesForAgent(args: {
  limit: number;
  offset: number;
  search?: string;
}): Promise<ErpListOutput> {
  const categories = await getCustomerCategories();
  const search = args.search?.trim().toLowerCase();

  const filtered = categories
    .filter((category) => {
      if (!search) {
        return true;
      }

      return [category.name, category.description]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(search));
    })
    .map((category) => toListItem(toCustomerCategoryRecord(category)));

  const paged = paginate(filtered, args.limit, args.offset);

  return {
    entityType: "customer_category",
    ...paged,
  };
}

export async function getCustomerCategoryForAgent(id: string): Promise<ErpGetOutput | null> {
  const category = await getCustomerCategory(id);
  if (!category) {
    return null;
  }

  return {
    entityType: "customer_category",
    record: toCustomerCategoryRecord(category),
  };
}

export async function createCustomerCategoryForAgent(
  values: InsertCustomerCategory
): Promise<ErpGetOutput> {
  const created = await createCustomerCategory(values);
  const category = await getCustomerCategoryForAgent(created.id);
  if (!category) {
    throw new Error("Created customer category could not be reloaded.");
  }
  return category;
}

export async function updateCustomerCategoryForAgent(
  id: string,
  values: UpdateCustomerCategory
): Promise<ErpGetOutput | null> {
  const updated = await updateCustomerCategory(id, values);
  if (!updated) {
    return null;
  }

  return getCustomerCategoryForAgent(updated.id);
}
