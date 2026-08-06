import "server-only";

import { and, asc, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import {
  itemFamilies,
  items,
  manufacturingResources,
  pricingScenarioRevisions,
  pricingScenarios,
  unitDefinitions,
} from "@/lib/db/schema";
import {
  formatSalesItemDisplayName,
  getSalesOptionLabelsByItemIdInTx,
} from "@/lib/sales/queries/validation";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import type { Tx } from "@/lib/db/with-org-context";
import { assertFeatureAccessInTx } from "@/lib/billing/entitlements";
import { DomainError } from "@/lib/errors/domain-error";
import {
  getProductUsageTermsByItemIdInTx,
  type ProductUsageTerms,
} from "@/lib/inventory/estimated-cost";
import { resolveStockUnitCostFromDefaultPurchasePrice } from "@/lib/inventory/cost";
import { formatItemSnapshotDisplayName } from "@/lib/inventory/display-name";
import { getItemDisplayMetadataByIdInTx } from "@/lib/inventory/item-display";
import { runIdempotentInventoryOperationInTx } from "@/lib/inventory/kernel";
import {
  calculatePricingScenario,
  type PricingBaseline,
  type PricingUsageTermsDto,
} from "@/lib/pricing-scenarios/calculations";
import {
  pricingScenarioRevisionSnapshotSchema,
  type InsertPricingScenario,
  type CommitPricingScenarioRevision,
  type PricingScenarioDoc,
  type PricingScenarioRevisionSnapshot,
  type UpdatePricingScenario,
} from "@/lib/schemas/pricing-scenarios";
import { sellingUnitPriceToStockUnitPrice } from "@/lib/sales/quantity-basis";

export type PricingScenarioListRow = {
  id: string;
  name: string;
  version: number;
  updatedAt: Date;
  updatedByUserId: string;
  latestRevisionNumber: number | null;
};

export type PricingScenarioRevisionListRow = {
  id: string;
  revisionNumber: number;
  note: string | null;
  createdByUserId: string;
  createdAt: Date;
};

export type PricingScenarioDetail = {
  scenario: {
    id: string;
    name: string;
    doc: PricingScenarioDoc;
    version: number;
    updatedAt: Date;
    updatedByUserId: string;
    createdAt: Date;
  };
  baseline: PricingBaseline;
  usageTerms: PricingUsageTermsDto[];
  revisions: PricingScenarioRevisionListRow[];
};

export type PricingScenarioWriteResult =
  | { kind: "updated"; detail: PricingScenarioDetail }
  | { kind: "conflict"; current: PricingScenarioDetail }
  | { kind: "not-found" };

async function assertPricingScenariosAccessInTx(
  tx: Tx,
  orgId: string,
  route: string
) {
  await assertFeatureAccessInTx(tx, orgId, "pricing_scenarios", { route });
}

const scenarioSelect = {
  id: pricingScenarios.id,
  name: pricingScenarios.name,
  doc: pricingScenarios.doc,
  version: pricingScenarios.version,
  updatedAt: pricingScenarios.updatedAt,
  updatedByUserId: pricingScenarios.updatedByUserId,
  createdAt: pricingScenarios.createdAt,
};

async function getActiveScenarioRowInTx(tx: Tx, id: string) {
  const [row] = await tx
    .select(scenarioSelect)
    .from(pricingScenarios)
    .where(and(eq(pricingScenarios.id, id), isNull(pricingScenarios.deletedAt)));
  return row ?? null;
}

/**
 * One resolver feeds both the detail read and revision commit so the page
 * preview and the frozen snapshot can never disagree.
 */
async function resolveScenarioInputsInTx(tx: Tx, doc: PricingScenarioDoc) {
  const usageByProductId = await getProductUsageTermsByItemIdInTx(
    tx,
    doc.productIds
  );

  const leafItemIds = new Set<string>();
  const resourceIds = new Set<string>();
  for (const usage of usageByProductId.values()) {
    for (const term of usage.materialTerms) leafItemIds.add(term.itemId);
    for (const term of usage.laborTerms) {
      if (term.resourceId) resourceIds.add(term.resourceId);
    }
  }

  const itemIds = [...new Set([...leafItemIds, ...doc.productIds])];
  const itemRows = itemIds.length
    ? await tx
        .select({
          id: items.id,
          name: items.name,
          sku: items.sku,
          currentStockUnitCost: items.currentStockUnitCost,
          defaultPurchasePrice: items.defaultPurchasePrice,
          purchaseToStockFactor: items.purchaseToStockFactor,
          defaultSellingPrice: items.defaultSellingPrice,
          salesToStockFactor: items.salesToStockFactor,
          unitName: unitDefinitions.name,
        })
        .from(items)
        .leftJoin(unitDefinitions, eq(unitDefinitions.id, items.unitDefinitionId))
        .where(inArray(items.id, itemIds))
    : [];
  const displayByItemId = await getItemDisplayMetadataByIdInTx(
    tx,
    itemRows.map((row) => row.id)
  );
  const itemsById = new Map(
    itemRows.map((row) => [
      row.id,
      {
        ...row,
        name: displayByItemId.get(row.id)?.displayName ?? row.name,
      },
    ])
  );

  const resourceRows = resourceIds.size
    ? await tx
        .select({
          id: manufacturingResources.id,
          name: manufacturingResources.name,
          loadedCostPerHour: manufacturingResources.loadedCostPerHour,
        })
        .from(manufacturingResources)
        .where(inArray(manufacturingResources.id, [...resourceIds]))
    : [];

  const baseline: PricingBaseline = {
    leafItems: [...leafItemIds].map((itemId) => {
      const item = itemsById.get(itemId);
      return {
        itemId,
        name: item?.name ?? "Unknown item",
        sku: item?.sku ?? null,
        unitName: item?.unitName ?? null,
        baselinePrice:
          item == null
            ? null
            : (item.currentStockUnitCost ??
              resolveStockUnitCostFromDefaultPurchasePrice({
                defaultPurchasePrice: item.defaultPurchasePrice,
                purchaseToStockFactor: item.purchaseToStockFactor,
              })),
      };
    }),
    resources: resourceRows.map((row) => ({
      resourceId: row.id,
      name: row.name,
      baselineRate: row.loadedCostPerHour,
    })),
    products: doc.productIds.map((itemId) => {
      const item = itemsById.get(itemId);
      return {
        itemId,
        name: item?.name ?? "Unknown product",
        sku: item?.sku ?? null,
        unitName: item?.unitName ?? null,
        baselineCurrentPrice:
          item?.defaultSellingPrice == null
            ? null
            : sellingUnitPriceToStockUnitPrice(
                item.defaultSellingPrice,
                item.salesToStockFactor ?? "1"
              ),
      };
    }),
  };

  const usageTerms: PricingUsageTermsDto[] = doc.productIds.map((productId) => {
    const usage: ProductUsageTerms = usageByProductId.get(productId) ?? {
      materialTerms: [],
      laborTerms: [],
      issues: ["missing_component"],
    };
    return { productId, ...usage };
  });

  return { baseline, usageTerms };
}

async function listRevisionRowsInTx(
  tx: Tx,
  scenarioId: string
): Promise<PricingScenarioRevisionListRow[]> {
  return tx
    .select({
      id: pricingScenarioRevisions.id,
      revisionNumber: pricingScenarioRevisions.revisionNumber,
      note: pricingScenarioRevisions.note,
      createdByUserId: pricingScenarioRevisions.createdByUserId,
      createdAt: pricingScenarioRevisions.createdAt,
    })
    .from(pricingScenarioRevisions)
    .where(eq(pricingScenarioRevisions.scenarioId, scenarioId))
    .orderBy(desc(pricingScenarioRevisions.revisionNumber));
}

async function buildDetailInTx(
  tx: Tx,
  row: NonNullable<Awaited<ReturnType<typeof getActiveScenarioRowInTx>>>
): Promise<PricingScenarioDetail> {
  const { baseline, usageTerms } = await resolveScenarioInputsInTx(tx, row.doc);
  const revisions = await listRevisionRowsInTx(tx, row.id);
  return { scenario: row, baseline, usageTerms, revisions };
}

export type PricingScenarioProductOption = {
  id: string;
  name: string;
  displayName: string;
  sku: string | null;
  unitName: string | null;
};

export async function getPricingScenarioProductOptions(): Promise<
  PricingScenarioProductOption[]
> {
  return withAuthedOrgContext(async (tx, orgId) => {
    await assertPricingScenariosAccessInTx(
      tx,
      orgId,
      "page /sales/pricing-scenarios"
    );
    const rows = await tx
      .select({
        id: items.id,
        name: items.name,
        familyName: itemFamilies.name,
        sku: items.sku,
        unitName: unitDefinitions.name,
      })
      .from(items)
      .leftJoin(unitDefinitions, eq(items.unitDefinitionId, unitDefinitions.id))
      .leftJoin(itemFamilies, eq(items.familyId, itemFamilies.id))
      .where(and(eq(items.itemType, "product"), isNull(items.deletedAt)))
      .orderBy(asc(items.name));

    const optionLabelsByItemId = await getSalesOptionLabelsByItemIdInTx(
      tx,
      rows.map((row) => row.id)
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      displayName: formatSalesItemDisplayName(
        row.name,
        row.familyName,
        optionLabelsByItemId.get(row.id) ?? []
      ),
      sku: row.sku,
      unitName: row.unitName,
    }));
  });
}

export async function listPricingScenarios(): Promise<PricingScenarioListRow[]> {
  return withAuthedOrgContext(async (tx, orgId) => {
    await assertPricingScenariosAccessInTx(tx, orgId, "GET /api/pricing-scenarios");
    const scenarios = await tx
      .select({
        id: pricingScenarios.id,
        name: pricingScenarios.name,
        version: pricingScenarios.version,
        updatedAt: pricingScenarios.updatedAt,
        updatedByUserId: pricingScenarios.updatedByUserId,
      })
      .from(pricingScenarios)
      .where(isNull(pricingScenarios.deletedAt))
      .orderBy(desc(pricingScenarios.updatedAt));

    // A correlated subquery on the revisions table silently returns NULL under
    // RLS; a direct grouped read on that table as the primary relation does
    // not. Fetch the max revision per scenario separately and merge in memory.
    const latestByScenarioId = new Map<string, number>();
    if (scenarios.length > 0) {
      const revisionMaxes = await tx
        .select({
          scenarioId: pricingScenarioRevisions.scenarioId,
          latest: max(pricingScenarioRevisions.revisionNumber),
        })
        .from(pricingScenarioRevisions)
        .where(
          inArray(
            pricingScenarioRevisions.scenarioId,
            scenarios.map((scenario) => scenario.id)
          )
        )
        .groupBy(pricingScenarioRevisions.scenarioId);
      for (const row of revisionMaxes) {
        if (row.latest != null) {
          latestByScenarioId.set(row.scenarioId, row.latest);
        }
      }
    }

    return scenarios.map((scenario) => ({
      ...scenario,
      latestRevisionNumber: latestByScenarioId.get(scenario.id) ?? null,
    }));
  });
}

export async function getPricingScenarioDetail(
  id: string
): Promise<PricingScenarioDetail | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    await assertPricingScenariosAccessInTx(tx, orgId, "GET /api/pricing-scenarios/[id]");
    const row = await getActiveScenarioRowInTx(tx, id);
    if (!row) return null;
    return buildDetailInTx(tx, row);
  });
}

export async function createPricingScenario(
  data: InsertPricingScenario,
  options: { idempotencyKey: string }
): Promise<PricingScenarioDetail> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await assertPricingScenariosAccessInTx(tx, orgId, "POST /api/pricing-scenarios");
    const { result } = await runIdempotentInventoryOperationInTx<{ id: string }>(
      tx,
      {
        organizationId: orgId,
        operationName: "createPricingScenario",
        idempotencyKey: options.idempotencyKey,
        payload: data,
      },
      async () => {
        const inserted = await tx
          .insert(pricingScenarios)
          .values({
            ...(data.id ? { id: data.id } : {}),
            organizationId: orgId,
            name: data.name,
            doc: data.doc,
            createdByUserId: userId,
            updatedByUserId: userId,
          })
          .onConflictDoNothing({ target: pricingScenarios.id })
          .returning({ id: pricingScenarios.id });

        const id = inserted[0]?.id ?? data.id;
        if (!id) {
          throw new DomainError("Failed to create pricing scenario.", 500);
        }
        return { id };
      }
    );

    const row = await getActiveScenarioRowInTx(tx, result.id);
    if (!row) {
      throw new DomainError("Pricing scenario id is already in use.", 409);
    }
    return buildDetailInTx(tx, row);
  });
}

export async function updatePricingScenario(
  id: string,
  data: UpdatePricingScenario
): Promise<PricingScenarioWriteResult> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await assertPricingScenariosAccessInTx(tx, orgId, "PATCH /api/pricing-scenarios/[id]");
    const [updated] = await tx
      .update(pricingScenarios)
      .set({
        name: data.name,
        doc: data.doc,
        version: sql`${pricingScenarios.version} + 1`,
        updatedByUserId: userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pricingScenarios.id, id),
          isNull(pricingScenarios.deletedAt),
          ...(data.expectedVersion != null
            ? [eq(pricingScenarios.version, data.expectedVersion)]
            : [])
        )
      )
      .returning({ id: pricingScenarios.id });

    const row = await getActiveScenarioRowInTx(tx, id);
    if (!row) {
      return { kind: "not-found" };
    }
    if (!updated) {
      return { kind: "conflict", current: await buildDetailInTx(tx, row) };
    }
    return { kind: "updated", detail: await buildDetailInTx(tx, row) };
  });
}

export async function softDeletePricingScenario(id: string): Promise<boolean> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await assertPricingScenariosAccessInTx(tx, orgId, "DELETE /api/pricing-scenarios/[id]");
    const [removed] = await tx
      .update(pricingScenarios)
      .set({ deletedAt: new Date(), deletedByUserId: userId })
      .where(and(eq(pricingScenarios.id, id), isNull(pricingScenarios.deletedAt)))
      .returning({ id: pricingScenarios.id });
    return removed != null;
  });
}

export async function duplicatePricingScenario(
  id: string,
  options: { name?: string; idempotencyKey: string }
): Promise<PricingScenarioDetail | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await assertPricingScenariosAccessInTx(
      tx,
      orgId,
      "POST /api/pricing-scenarios/[id]/duplicate"
    );
    const source = await getActiveScenarioRowInTx(tx, id);
    if (!source) return null;

    const { result } = await runIdempotentInventoryOperationInTx<{ id: string }>(
      tx,
      {
        organizationId: orgId,
        operationName: "duplicatePricingScenario",
        idempotencyKey: options.idempotencyKey,
        payload: { sourceId: id, name: options.name ?? null },
      },
      async () => {
        const [inserted] = await tx
          .insert(pricingScenarios)
          .values({
            organizationId: orgId,
            name: options.name ?? `${source.name} copy`,
            doc: source.doc,
            createdByUserId: userId,
            updatedByUserId: userId,
          })
          .returning({ id: pricingScenarios.id });
        return { id: inserted.id };
      }
    );

    const row = await getActiveScenarioRowInTx(tx, result.id);
    if (!row) {
      throw new DomainError("Failed to duplicate pricing scenario.", 500);
    }
    return buildDetailInTx(tx, row);
  });
}

export type PricingScenarioRevisionDetail = PricingScenarioRevisionListRow & {
  snapshot: PricingScenarioRevisionSnapshot;
};

export async function commitPricingScenarioRevision(
  id: string,
  data: CommitPricingScenarioRevision,
  options: { idempotencyKey: string }
): Promise<PricingScenarioRevisionDetail | null> {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    await assertPricingScenariosAccessInTx(
      tx,
      orgId,
      "POST /api/pricing-scenarios/[id]/revisions"
    );

    // Lock the scenario row to serialize concurrent commits so revision
    // numbers stay dense under the unique (scenario_id, revision_number) key.
    const [locked] = await tx
      .select({ id: pricingScenarios.id })
      .from(pricingScenarios)
      .where(and(eq(pricingScenarios.id, id), isNull(pricingScenarios.deletedAt)))
      .for("update");
    if (!locked) return null;
    const row = await getActiveScenarioRowInTx(tx, id);
    if (!row) return null;

    const { result } = await runIdempotentInventoryOperationInTx<{ revisionId: string }>(
      tx,
      {
        organizationId: orgId,
        operationName: "commitPricingScenarioRevision",
        idempotencyKey: options.idempotencyKey,
        payload: { scenarioId: id, note: data.note ?? null },
      },
      async () => {
        const { baseline, usageTerms } = await resolveScenarioInputsInTx(tx, row.doc);
        const calculation = calculatePricingScenario({
          baseline,
          usageTerms,
          doc: row.doc,
        });
        const snapshot = pricingScenarioRevisionSnapshotSchema.parse({
          calculationVersion: calculation.calculationVersion,
          capturedAt: new Date().toISOString(),
          globals: {
            overheadPercent: row.doc.overheadPercent,
            targetProfitPercent: row.doc.targetProfitPercent,
          },
          products: calculation.products,
        });

        const [{ nextRevisionNumber }] = await tx
          .select({
            nextRevisionNumber: sql<number>`COALESCE(MAX(${pricingScenarioRevisions.revisionNumber}), 0) + 1`,
          })
          .from(pricingScenarioRevisions)
          .where(eq(pricingScenarioRevisions.scenarioId, id));

        const [inserted] = await tx
          .insert(pricingScenarioRevisions)
          .values({
            organizationId: orgId,
            scenarioId: id,
            revisionNumber: nextRevisionNumber,
            note: data.note ?? null,
            snapshot,
            createdByUserId: userId,
          })
          .returning({ id: pricingScenarioRevisions.id });
        return { revisionId: inserted.id };
      }
    );

    return getPricingScenarioRevisionInTx(tx, id, result.revisionId);
  });
}

async function getPricingScenarioRevisionInTx(
  tx: Tx,
  scenarioId: string,
  revisionId: string
): Promise<PricingScenarioRevisionDetail | null> {
  const [revision] = await tx
    .select({
      id: pricingScenarioRevisions.id,
      revisionNumber: pricingScenarioRevisions.revisionNumber,
      note: pricingScenarioRevisions.note,
      createdByUserId: pricingScenarioRevisions.createdByUserId,
      createdAt: pricingScenarioRevisions.createdAt,
      snapshot: pricingScenarioRevisions.snapshot,
    })
    .from(pricingScenarioRevisions)
    .where(
      and(
        eq(pricingScenarioRevisions.scenarioId, scenarioId),
        eq(pricingScenarioRevisions.id, revisionId)
      )
    );
  if (!revision) return null;

  const snapshot = pricingScenarioRevisionSnapshotSchema.parse(revision.snapshot);
  const itemIds = snapshot.products.flatMap((product) => [
    product.itemId,
    ...product.materials.map((material) => material.itemId),
  ]);
  const displayByItemId = await getItemDisplayMetadataByIdInTx(tx, itemIds);
  const repairName = (itemId: string, snapshotName: string) => {
    const display = displayByItemId.get(itemId);
    return display
      ? formatItemSnapshotDisplayName(snapshotName, display.optionLabels, [
          display.masterName,
          display.name,
          display.familyName,
        ])
      : snapshotName;
  };

  return {
    ...revision,
    snapshot: {
      ...snapshot,
      products: snapshot.products.map((product) => ({
        ...product,
        name: repairName(product.itemId, product.name),
        materials: product.materials.map((material) => ({
          ...material,
          name: repairName(material.itemId, material.name),
        })),
      })),
    },
  };
}

export async function getPricingScenarioRevision(
  scenarioId: string,
  revisionId: string
): Promise<PricingScenarioRevisionDetail | null> {
  return withAuthedOrgContext(async (tx, orgId) => {
    await assertPricingScenariosAccessInTx(
      tx,
      orgId,
      "GET /api/pricing-scenarios/[id]/revisions/[revisionId]"
    );
    const scenario = await getActiveScenarioRowInTx(tx, scenarioId);
    if (!scenario) return null;
    return getPricingScenarioRevisionInTx(tx, scenarioId, revisionId);
  });
}
