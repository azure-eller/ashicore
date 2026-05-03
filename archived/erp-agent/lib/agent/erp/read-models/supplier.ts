import type { SupplierRow } from "@/app/(dashboard)/purchasing/types";
import {
  createSupplier,
  getSupplier,
  getSuppliers,
  updateSupplier,
} from "@/app/(dashboard)/purchasing/queries";
import type { InsertSupplier, UpdateSupplier } from "@/lib/schemas/suppliers";
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

function toSupplierRecord(row: SupplierRow): ErpRecord {
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    title: row.name,
    subtitle: row.code ?? row.contactName ?? row.email ?? null,
    status: row.deletedAt ? "deleted" : null,
    badges: row.code ? [row.code] : [],
    fields: {
      name: row.name,
      code: row.code,
      contactName: row.contactName,
      email: row.email,
      phone: row.phone,
      billingLine1: row.billingLine1,
      billingLine2: row.billingLine2,
      billingCity: row.billingCity,
      billingRegion: row.billingRegion,
      billingPostcode: row.billingPostcode,
      billingCountry: row.billingCountry,
      paymentTerms: row.paymentTerms,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      deletedAt: toIso(row.deletedAt),
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

export async function listSuppliersForAgent(args: {
  limit: number;
  offset: number;
  search?: string;
  activeOnly?: boolean;
}): Promise<ErpListOutput> {
  const suppliers = await getSuppliers();
  const search = args.search?.trim().toLowerCase();

  const filtered = suppliers
    .filter((supplier) => (args.activeOnly ?? true ? supplier.deletedAt == null : true))
    .filter((supplier) => {
      if (!search) {
        return true;
      }

      return [supplier.name, supplier.code, supplier.contactName, supplier.email, supplier.phone]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(search));
    })
    .map((supplier) => toListItem(toSupplierRecord(supplier)));

  const paged = paginate(filtered, args.limit, args.offset);

  return {
    entityType: "supplier",
    ...paged,
  };
}

export async function getSupplierForAgent(id: string): Promise<ErpGetOutput | null> {
  const supplier = await getSupplier(id);
  if (!supplier) {
    return null;
  }

  return {
    entityType: "supplier",
    record: toSupplierRecord(supplier),
  };
}

export async function createSupplierForAgent(values: InsertSupplier): Promise<ErpGetOutput> {
  const created = await createSupplier(values);
  const supplier = await getSupplierForAgent(created.id);
  if (!supplier) {
    throw new Error("Created supplier could not be reloaded.");
  }
  return supplier;
}

export async function updateSupplierForAgent(
  id: string,
  values: UpdateSupplier
): Promise<ErpGetOutput | null> {
  const updated = await updateSupplier(id, values);
  if (!updated) {
    return null;
  }

  return getSupplierForAgent(updated.id);
}

