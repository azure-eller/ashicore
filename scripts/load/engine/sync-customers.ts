import { eq } from "drizzle-orm";
import { customers } from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import type {
  CustomerPlan,
  CustomerSeed,
  ExistingCustomer,
  SalesImportReport,
} from "./types";

export function normalizeCustomerKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function assertNoDuplicateCustomerNames(rows: ExistingCustomer[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.deletedAt) continue;
    const key = normalizeCustomerKey(row.name);
    if (seen.has(key)) {
      throw new Error(`Duplicate customer name found: ${row.name}`);
    }
    seen.add(key);
  }
}

export async function loadExistingCustomersInTx(
  tx: Tx
): Promise<ExistingCustomer[]> {
  return tx
    .select({
      id: customers.id,
      name: customers.name,
      address: customers.billingLine1,
      phone: customers.phone,
      notes: customers.notes,
      deletedAt: customers.deletedAt,
    })
    .from(customers);
}

export function buildExistingCustomersByKey(
  rows: ExistingCustomer[],
  options: { includeDeletedFallback: boolean }
) {
  const activeByKey = new Map<string, ExistingCustomer>();
  const deletedByKey = new Map<string, ExistingCustomer>();

  for (const row of rows) {
    const key = normalizeCustomerKey(row.name);
    if (row.deletedAt) {
      if (!deletedByKey.has(key)) {
        deletedByKey.set(key, row);
      }
      continue;
    }
    activeByKey.set(key, row);
  }

  if (!options.includeDeletedFallback) {
    return activeByKey;
  }

  const result = new Map(deletedByKey);
  for (const [key, row] of activeByKey) {
    result.set(key, row);
  }
  return result;
}

export function buildCustomerPlans(
  customerSeedsByKey: Map<string, CustomerSeed>,
  existingCustomersByKey: Map<string, ExistingCustomer>,
  defaultNotes: string
): CustomerPlan[] {
  const plans: CustomerPlan[] = [];
  for (const [key, seed] of customerSeedsByKey) {
    const existing = existingCustomersByKey.get(key) ?? null;
    const nextAddress = existing?.address ?? seed.address ?? null;
    const nextPhone = existing?.phone ?? seed.phone ?? null;
    const nextNotes = existing?.notes ?? seed.notes ?? defaultNotes;
    let action: CustomerPlan["action"] = "create";

    if (existing) {
      const hasFieldChanges =
        nextAddress !== existing.address ||
        nextPhone !== existing.phone ||
        nextNotes !== existing.notes;

      if (existing.deletedAt) {
        action = "reactivate";
      } else if (hasFieldChanges) {
        action = "update";
      } else {
        action = "unchanged";
      }
    }

    plans.push({
      key,
      seed,
      existingId: existing?.id ?? null,
      action,
      nextAddress,
      nextPhone,
      nextNotes,
    });
  }
  return plans;
}

export async function applyCustomerPlansInTx(
  tx: Tx,
  orgId: string,
  plans: CustomerPlan[],
  customerIdByKey: Map<string, string>,
  apply: boolean,
  report: SalesImportReport
) {
  for (const plan of plans) {
    if (plan.action === "create") {
      if (apply) {
        const [created] = await tx
          .insert(customers)
          .values({
            organizationId: orgId,
            name: plan.seed.name,
            billingLine1: plan.nextAddress,
            phone: plan.nextPhone,
            notes: plan.nextNotes,
          })
          .returning({ id: customers.id });
        customerIdByKey.set(plan.key, created.id);
      }

      report.createdCustomers.push(plan.seed.name);
      continue;
    }

    if (plan.existingId == null) {
      throw new Error(`Customer plan for "${plan.seed.name}" is missing an existing id.`);
    }

    customerIdByKey.set(plan.key, plan.existingId);

    if (plan.action === "reactivate" || plan.action === "update") {
      if (apply) {
        await tx
          .update(customers)
          .set({
            billingLine1: plan.nextAddress,
            phone: plan.nextPhone,
            notes: plan.nextNotes,
            deletedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, plan.existingId));
      }

      if (plan.action === "reactivate") {
        report.reactivatedCustomers.push(plan.seed.name);
      } else {
        report.updatedCustomers.push(plan.seed.name);
      }
      continue;
    }

    report.unchangedCustomers.push(plan.seed.name);
  }
}
