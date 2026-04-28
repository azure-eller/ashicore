import { and, eq, or } from "drizzle-orm";
import { suppliers } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import type { Report, SupplierSeed } from "./types";

type ExistingSupplier = {
  id: string;
  name: string;
  code: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  paymentTerms: string | null;
  notes: string | null;
  deletedAt: Date | null;
};

function nullable(value: string | null | undefined) {
  return value?.trim() || null;
}

function supplierValues(seed: SupplierSeed) {
  return {
    name: seed.name,
    code: seed.code,
    contactName: nullable(seed.contactName),
    email: nullable(seed.email),
    phone: nullable(seed.phone),
    billingLine1: nullable(seed.billingLine1),
    billingLine2: nullable(seed.billingLine2),
    billingCity: nullable(seed.billingCity),
    billingRegion: nullable(seed.billingRegion),
    billingPostcode: nullable(seed.billingPostcode),
    billingCountry: nullable(seed.billingCountry),
    paymentTerms: nullable(seed.paymentTerms),
    notes: nullable(seed.notes),
  };
}

function needsUpdate(existing: ExistingSupplier, seed: SupplierSeed) {
  const next = supplierValues(seed);
  return (
    existing.name !== next.name ||
    existing.code !== next.code ||
    existing.contactName !== next.contactName ||
    existing.email !== next.email ||
    existing.phone !== next.phone ||
    existing.billingLine1 !== next.billingLine1 ||
    existing.billingLine2 !== next.billingLine2 ||
    existing.billingCity !== next.billingCity ||
    existing.billingRegion !== next.billingRegion ||
    existing.billingPostcode !== next.billingPostcode ||
    existing.billingCountry !== next.billingCountry ||
    existing.paymentTerms !== next.paymentTerms ||
    existing.notes !== next.notes
  );
}

export async function applySuppliersSyncInTx(
  tx: Tx,
  seeds: SupplierSeed[] | undefined,
  orgId: string,
  report: Report
) {
  if (!seeds || seeds.length === 0) return;

  const existingRows = await tx
    .select({
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
      paymentTerms: suppliers.paymentTerms,
      notes: suppliers.notes,
      deletedAt: suppliers.deletedAt,
    })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.organizationId, orgId),
        or(
          ...seeds.flatMap((seed) => [
            eq(suppliers.code, seed.code),
            eq(suppliers.name, seed.name),
          ])
        )
      )
    );

  const byCode = new Map(
    existingRows
      .filter((row): row is ExistingSupplier & { code: string } => row.code != null)
      .map((row) => [row.code, row])
  );
  const byName = new Map(existingRows.map((row) => [row.name, row]));

  for (const seed of seeds) {
    const existing = byCode.get(seed.code) ?? byName.get(seed.name);
    const values = supplierValues(seed);

    if (!existing) {
      await tx.insert(suppliers).values({
        organizationId: orgId,
        ...values,
      });
      report.createdSuppliers.push(seed.name);
      continue;
    }

    if (existing.deletedAt != null) {
      await tx
        .update(suppliers)
        .set({ ...values, deletedAt: null, updatedAt: new Date() })
        .where(eq(suppliers.id, existing.id));
      report.reactivatedSuppliers.push(seed.name);
      continue;
    }

    if (needsUpdate(existing, seed)) {
      await tx
        .update(suppliers)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(suppliers.id, existing.id));
      report.updatedSuppliers.push(seed.name);
      continue;
    }

    report.unchangedSuppliers.push(seed.name);
  }
}
