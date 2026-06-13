import "server-only";

import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import {
  integrationExternalRecords,
  purchaseOrderAdditionalCosts,
  purchaseOrders,
  suppliers,
} from "@/lib/db/schema";
import { ACCOUNTING_PROVIDER_XERO } from "@/lib/accounting/sync-state";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { measureObservedOperation } from "@/lib/observability/request-log";
import type { InsertSupplier, PatchSupplier, UpdateSupplier } from "@/lib/schemas/suppliers";
import type { SupplierRow } from "../types";
import { PurchasingError } from "./errors";

async function ensureSuppliersDeletableInTx(tx: Tx, supplierIds: string[]) {
  const uniqueSupplierIds = [...new Set(supplierIds)];

  const [blockingOrder] = await tx
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        inArray(purchaseOrders.supplierId, uniqueSupplierIds),
        isNull(purchaseOrders.deletedAt),
        inArray(purchaseOrders.status, ["draft", "ordered", "partial"]),
      ),
    )
    .limit(1);

  if (blockingOrder) {
    throw new PurchasingError(
      "Cannot delete supplier with active draft, ordered, or partially received purchase orders.",
      400,
    );
  }

  const [blockingCost] = await tx
    .select({ id: purchaseOrderAdditionalCosts.id })
    .from(purchaseOrderAdditionalCosts)
    .innerJoin(
      purchaseOrders,
      eq(purchaseOrders.id, purchaseOrderAdditionalCosts.purchaseOrderId),
    )
    .where(
      and(
        inArray(
          purchaseOrderAdditionalCosts.supplierId,
          uniqueSupplierIds,
        ),
        isNull(purchaseOrders.deletedAt),
        inArray(purchaseOrders.status, ["draft", "ordered", "partial"]),
      ),
    )
    .limit(1);

  if (blockingCost) {
    throw new PurchasingError(
      "Cannot delete supplier used as a supplier on active draft, ordered, or partially received purchase orders.",
      400,
    );
  }

  return uniqueSupplierIds;
}

async function softDeleteSuppliersInTx(tx: Tx, supplierIds: string[]) {
  if (supplierIds.length === 0) {
    return [];
  }

  return tx
    .update(suppliers)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(inArray(suppliers.id, supplierIds), isNull(suppliers.deletedAt)))
    .returning({ id: suppliers.id });
}

const supplierRowSelect = {
  id: suppliers.id,
  name: suppliers.name,
  code: suppliers.code,
  contactName: suppliers.contactName,
  email: suppliers.email,
  phone: suppliers.phone,
  billingLine1: suppliers.billingLine1,
  billingLine2: suppliers.billingLine2,
  billingCity: suppliers.billingCity,
  billingRegion: suppliers.billingRegion,
  billingPostcode: suppliers.billingPostcode,
  billingCountry: suppliers.billingCountry,
  xeroContactId: sql<string | null>`(
    SELECT ${integrationExternalRecords.externalId}
    FROM ${integrationExternalRecords}
    WHERE ${integrationExternalRecords.provider} = ${ACCOUNTING_PROVIDER_XERO}
      AND ${integrationExternalRecords.entityType} = 'supplier'
      AND ${integrationExternalRecords.localRecordId} = ${suppliers.id}
    LIMIT 1
  )`,
  paymentTerms: suppliers.paymentTerms,
  notes: suppliers.notes,
  version: suppliers.version,
  deletedAt: suppliers.deletedAt,
  createdAt: suppliers.createdAt,
  updatedAt: suppliers.updatedAt,
} as const;

export type SupplierWriteResult =
  | { kind: "updated"; supplier: SupplierRow }
  | { kind: "conflict"; current: SupplierRow }
  | { kind: "not-found" };

export async function getSuppliers(): Promise<SupplierRow[]> {
  return measureObservedOperation(
    "purchasing.get_suppliers",
    async () => {
      return withAuthedOrgContext(async (tx) => {
        return tx
          .select(supplierRowSelect)
          .from(suppliers)
          .where(isNull(suppliers.deletedAt))
          .orderBy(asc(suppliers.name));
      });
    },
    {
      successData: (rows) => ({
        rowCount: rows.length,
      }),
    }
  );
}

export async function getSupplier(
  id: string,
  options?: { includeDeleted?: boolean },
): Promise<SupplierRow | null> {
  return withAuthedOrgContext(async (tx) => {
    const conditions = [eq(suppliers.id, id)];

    if (!options?.includeDeleted) {
      conditions.push(isNull(suppliers.deletedAt));
    }

    const [supplier] = await tx
      .select(supplierRowSelect)
      .from(suppliers)
      .where(and(...conditions));

    return supplier ?? null;
  });
}

export async function createSupplier(data: InsertSupplier): Promise<SupplierRow> {
  return withAuthedOrgContext(async (tx, orgId) => {
    // Idempotent under client-generated ids: a retried create with the same
    // id no-ops the insert and returns the existing row.
    const inserted = await tx
      .insert(suppliers)
      .values({ organizationId: orgId, ...data })
      .onConflictDoNothing({ target: suppliers.id })
      .returning({ id: suppliers.id });

    const id = inserted[0]?.id ?? data.id;
    if (!id) {
      throw new PurchasingError("Failed to create supplier.", 500);
    }

    const [supplier] = await tx
      .select(supplierRowSelect)
      .from(suppliers)
      .where(eq(suppliers.id, id));

    if (!supplier) {
      throw new PurchasingError("Supplier id is already in use.", 409);
    }

    return supplier;
  });
}

export async function createSupplierInTx(tx: Tx, orgId: string, data: InsertSupplier) {
  const [supplier] = await tx
    .insert(suppliers)
    .values({
      organizationId: orgId,
      ...data,
    })
    .returning({ id: suppliers.id, name: suppliers.name });

  return supplier;
}

export async function updateSupplier(
  id: string,
  data: UpdateSupplier,
): Promise<SupplierWriteResult> {
  return withAuthedOrgContext(async (tx) => {
    const { expectedVersion, ...fields } = data;
    const updated = await writeSupplierInTx(tx, id, fields, expectedVersion);
    if (updated) {
      const [supplier] = await tx
        .select(supplierRowSelect)
        .from(suppliers)
        .where(eq(suppliers.id, id));
      return { kind: "updated", supplier } satisfies SupplierWriteResult;
    }

    const [current] = await tx
      .select(supplierRowSelect)
      .from(suppliers)
      .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)));
    return current
      ? ({ kind: "conflict", current } satisfies SupplierWriteResult)
      : ({ kind: "not-found" } satisfies SupplierWriteResult);
  });
}

export async function patchSupplier(
  id: string,
  data: PatchSupplier,
): Promise<SupplierRow | null> {
  return withAuthedOrgContext(async (tx) => {
    const updated = await patchSupplierInTx(tx, id, data);
    if (!updated) return null;
    const [supplier] = await tx
      .select(supplierRowSelect)
      .from(suppliers)
      .where(eq(suppliers.id, id));
    return supplier ?? null;
  });
}

async function writeSupplierInTx(
  tx: Tx,
  id: string,
  data: Omit<UpdateSupplier, "expectedVersion"> | PatchSupplier,
  expectedVersion?: number,
) {
  const [supplier] = await tx
    .update(suppliers)
    .set({
      ...data,
      version: sql`${suppliers.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(suppliers.id, id),
        isNull(suppliers.deletedAt),
        ...(expectedVersion != null
          ? [eq(suppliers.version, expectedVersion)]
          : []),
      ),
    )
    .returning({ id: suppliers.id });

  return supplier ?? null;
}

export async function patchSupplierInTx(tx: Tx, id: string, data: PatchSupplier) {
  return writeSupplierInTx(tx, id, data);
}

export async function deleteSupplier(id: string) {
  return withAuthedOrgContext(async (tx) => {
    const supplierIds = await ensureSuppliersDeletableInTx(tx, [id]);
    const [supplier] = await softDeleteSuppliersInTx(tx, supplierIds);
    return { deleted: supplier != null };
  });
}

export async function deleteSuppliers(ids: string[]) {
  return withAuthedOrgContext(async (tx) => {
    const supplierIds = await ensureSuppliersDeletableInTx(tx, ids);
    const deletedSuppliers = await softDeleteSuppliersInTx(tx, supplierIds);
    return { deletedCount: deletedSuppliers.length };
  });
}
