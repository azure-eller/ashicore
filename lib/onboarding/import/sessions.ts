import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  customers,
  importCommitRecords,
  importFiles,
  importSessions,
  items,
  suppliers,
  unitDefinitions,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { withAuthedOrgContext } from "@/lib/dal/auth";
import { DomainError } from "@/lib/errors/domain-error";
import {
  createItemCardInTx,
  updateItemCardInTx,
  updateItemCardVariantInTx,
} from "@/lib/inventory/item-cards";
import { seedOpeningBalanceInTx } from "@/lib/inventory/kernel/operations/inventory";
import { createBomRevisionInTx } from "@/app/(dashboard)/inventory/queries/internal";
import {
  createSupplierInTx,
  patchSupplierInTx,
} from "@/app/(dashboard)/purchasing/queries";
import {
  createCustomerInTx,
  patchCustomerInTx,
} from "@/app/(dashboard)/sales/queries";
import { supplierDefaultValues } from "@/lib/schemas/suppliers";
import { customerDefaultValues } from "@/lib/schemas/customers";
import type { PrivateFileUpload } from "@/lib/blob-storage";
import { businessDateToUtcDate, hashImportPackage } from "./hash";
import { getSkuImportLimitInTx } from "./entitlements";
import {
  importPackageSchema,
  type ImportPackage,
  type PreviewIssue,
  type PreviewReport,
} from "./types";

const SESSION_TTL_DAYS = 14;

export const patchImportSessionSchema = z.object({
  openingStockAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includeBoms: z.boolean().optional(),
  package: importPackageSchema,
});

export const approveImportSessionSchema = z.object({
  previewHash: z.string().min(1),
});

type SessionRow = typeof importSessions.$inferSelect;

function expiresAt() {
  const date = new Date();
  date.setDate(date.getDate() + SESSION_TTL_DAYS);
  return date;
}

function buildPreview(pkg: ImportPackage, issues: PreviewIssue[]): PreviewReport {
  const hash = hashImportPackage(pkg);
  const blockingIssueCount = issues.filter((issue) => issue.severity === "blocking").length;
  return {
    hash,
    status: blockingIssueCount === 0 ? "validated" : "needs_review",
    blockingIssueCount,
    warningIssueCount: issues.length - blockingIssueCount,
    issues,
    summary: {
      units: pkg.units.length,
      suppliers: pkg.suppliers.length,
      customers: pkg.customers.length,
      items: pkg.items.length,
      openingStock: pkg.openingStock.length,
      boms: pkg.boms.length,
    },
  };
}

function key(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function isReviewSelected(record: { review?: { selected?: boolean } }) {
  return record.review?.selected !== false;
}

function isReviewActive(record: {
  review?: { selected?: boolean };
  match?: { suggestion?: "create" | "update" | "skip"; existingId?: string };
}) {
  return isReviewSelected(record) && record.match?.suggestion !== "skip";
}

function isPositiveNumericString(value: string | null | undefined): value is string {
  if (value == null) return false;
  return /^\d+(\.\d+)?$/.test(String(value).trim());
}

function diffFields(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
) {
  const diff: Record<string, { current: unknown; incoming: unknown }> = {};
  for (const [field, incomingValue] of Object.entries(incoming)) {
    const currentValue = current[field] ?? null;
    if ((incomingValue ?? null) !== currentValue) {
      diff[field] = { current: currentValue, incoming: incomingValue ?? null };
    }
  }
  return Object.keys(diff).length > 0 ? diff : undefined;
}

export async function normalizeImportPackageInTx(
  tx: Tx,
  pkg: ImportPackage,
): Promise<ImportPackage> {
  const supplierRows = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
      code: suppliers.code,
      contactName: suppliers.contactName,
      email: suppliers.email,
      phone: suppliers.phone,
    })
    .from(suppliers)
    .where(isNull(suppliers.deletedAt));
  const supplierByCode = new Map(
    supplierRows.flatMap((row) => (key(row.code) ? [[key(row.code)!, row]] : [])),
  );
  const supplierByName = new Map(supplierRows.map((row) => [key(row.name)!, row]));

  const customerRows = await tx
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
    })
    .from(customers)
    .where(isNull(customers.deletedAt));
  const customerByName = new Map(customerRows.map((row) => [key(row.name)!, row]));

  const itemRows = await tx
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      itemType: items.itemType,
      defaultSellingPrice: items.defaultSellingPrice,
      defaultPurchasePrice: items.defaultPurchasePrice,
      sellable: items.sellable,
    })
    .from(items)
    .where(isNull(items.deletedAt));
  const itemBySku = new Map(
    itemRows.flatMap((row) => (key(row.sku) ? [[key(row.sku)!, row]] : [])),
  );
  const itemByName = new Map(itemRows.map((row) => [key(row.name)!, row]));

  return importPackageSchema.parse({
    ...pkg,
    suppliers: pkg.suppliers.map((supplier) => {
      const matched =
        (supplier.code ? supplierByCode.get(key(supplier.code)!) : undefined) ??
        supplierByName.get(key(supplier.name)!);
      if (!matched) {
        return {
          ...supplier,
          match: { suggestion: supplier.match.suggestion === "skip" ? "skip" : "create" },
        };
      }
      return {
        ...supplier,
        match: {
          suggestion: supplier.match.suggestion === "skip" ? "skip" : "update",
          existingId: matched.id,
          matchedBy: supplier.code && key(supplier.code) === key(matched.code) ? "code" : "name",
          fieldDiff: diffFields(
            {
              name: matched.name,
              code: matched.code,
              contactName: matched.contactName,
              email: matched.email,
              phone: matched.phone,
            },
            {
              name: supplier.name,
              code: nullable(supplier.code),
              contactName: nullable(supplier.contactName),
              email: nullable(supplier.email),
              phone: nullable(supplier.phone),
            },
          ),
        },
      };
    }),
    customers: pkg.customers.map((customer) => {
      const matched = customerByName.get(key(customer.name)!);
      if (!matched) {
        return {
          ...customer,
          match: { suggestion: customer.match.suggestion === "skip" ? "skip" : "create" },
        };
      }
      return {
        ...customer,
        match: {
          suggestion: customer.match.suggestion === "skip" ? "skip" : "update",
          existingId: matched.id,
          matchedBy: "name",
          fieldDiff: diffFields(
            {
              name: matched.name,
              email: matched.email,
              phone: matched.phone,
            },
            {
              name: customer.name,
              email: nullable(customer.email),
              phone: nullable(customer.phone),
            },
          ),
        },
      };
    }),
    items: pkg.items.map((item) => {
      const matched =
        (item.sku ? itemBySku.get(key(item.sku)!) : undefined) ??
        itemByName.get(key(item.name)!);
      if (!matched) {
        return {
          ...item,
          match: { suggestion: item.match.suggestion === "skip" ? "skip" : "create" },
        };
      }
      return {
        ...item,
        match: {
          suggestion: item.match.suggestion === "skip" ? "skip" : "update",
          existingId: matched.id,
          matchedBy: item.sku && key(item.sku) === key(matched.sku) ? "sku" : "name",
          fieldDiff: diffFields(
            {
              name: matched.name,
              sku: matched.sku,
              itemType: matched.itemType,
              defaultSellingPrice: matched.defaultSellingPrice,
              defaultPurchasePrice: matched.defaultPurchasePrice,
              sellable: matched.sellable,
            },
            {
              name: item.name,
              sku: nullable(item.sku),
              itemType: item.itemType,
              defaultSellingPrice: item.defaultSellingPrice,
              defaultPurchasePrice: item.defaultPurchasePrice,
              sellable: item.itemType === "product" ? item.sellable ?? false : false,
            },
          ),
        },
      };
    }),
  });
}

async function validateImportPackageInTx(
  tx: Tx,
  orgId: string,
  pkg: ImportPackage,
): Promise<PreviewReport> {
  const issues: PreviewIssue[] = [];
  const unitRefs = new Set(
    pkg.units.filter((unit) => isReviewSelected(unit)).map((unit) => unit.tempId),
  );
  const activeItemRefs = new Set(
    pkg.items
      .filter((item) => isReviewActive(item) || item.match.existingId)
      .map((item) => item.tempId),
  );
  const activeSupplierRefs = new Set(
    pkg.suppliers
      .filter((supplier) => isReviewActive(supplier) || supplier.match.existingId)
      .map((supplier) => supplier.tempId),
  );

  if (new Set(pkg.units.map((unit) => unit.tempId)).size !== pkg.units.length) {
    issues.push({ severity: "blocking", message: "Unit references must be unique." });
  }

  if (new Set(pkg.items.map((item) => item.tempId)).size !== pkg.items.length) {
    issues.push({ severity: "blocking", message: "Item references must be unique." });
  }

  const skus = pkg.items.map((item) => key(item.sku)).filter((sku): sku is string => sku != null);
  if (new Set(skus).size !== skus.length) {
    issues.push({ severity: "blocking", message: "Item SKUs must be unique within the import." });
  }

  for (const question of pkg.unresolvedQuestions) {
    if (question.severity !== "blocking") continue;
    issues.push({
      severity: "blocking",
      message: question.question,
      path: question.entityRef ? `questions.${question.entityRef}` : "questions",
    });
  }

  for (const item of pkg.items) {
    if (!isReviewActive(item) && !item.match.existingId) continue;
    if (!unitRefs.has(item.unitRef)) {
      issues.push({
        severity: "blocking",
        message: `Unit reference ${item.unitRef} does not exist.`,
        path: `items.${item.tempId}.unitRef`,
      });
    }
    if (item.purchaseUnitRef && !unitRefs.has(item.purchaseUnitRef)) {
      issues.push({
        severity: "blocking",
        message: `Purchase unit reference ${item.purchaseUnitRef} does not exist.`,
        path: `items.${item.tempId}.purchaseUnitRef`,
      });
    }
    if (item.defaultSupplierRef && !activeSupplierRefs.has(item.defaultSupplierRef)) {
      issues.push({
        severity: "blocking",
        message: `Supplier reference ${item.defaultSupplierRef} does not exist or is skipped.`,
        path: `items.${item.tempId}.defaultSupplierRef`,
      });
    }
  }

  for (const stock of pkg.openingStock) {
    if (!isReviewSelected(stock)) continue;
    const item = pkg.items.find((candidate) => candidate.tempId === stock.itemRef);
    if (!activeItemRefs.has(stock.itemRef)) {
      issues.push({
        severity: "blocking",
        message: `Opening stock item reference ${stock.itemRef} does not exist or is skipped.`,
        path: `openingStock.${stock.itemRef}`,
      });
    }
    if (item?.match.existingId) {
      issues.push({
        severity: "warning",
        message: `Opening stock for existing item ${item.name} will be skipped to avoid double-counting stock.`,
        path: `openingStock.${stock.itemRef}`,
      });
    }
    if (!isPositiveNumericString(stock.unitCost)) {
      issues.push({
        severity: "blocking",
        message: `Opening stock for ${stock.itemRef} needs a numeric unit cost before approval.`,
        path: `openingStock.${stock.itemRef}.unitCost`,
      });
    }
  }

  for (const bom of pkg.boms) {
    if (!isReviewSelected(bom)) continue;
    const product = pkg.items.find((item) => item.tempId === bom.productRef);
    if (!product || product.itemType !== "product" || !activeItemRefs.has(bom.productRef)) {
      issues.push({
        severity: "blocking",
        message: `BOM product reference ${bom.productRef} must reference an active product.`,
        path: `boms.${bom.productRef}`,
      });
    }
    if (!unitRefs.has(bom.outputUnitRef)) {
      issues.push({
        severity: "blocking",
        message: `BOM output unit reference ${bom.outputUnitRef} does not exist.`,
        path: `boms.${bom.productRef}.outputUnitRef`,
      });
    }
    if (product && bom.outputUnitRef !== product.unitRef) {
      issues.push({
        severity: "blocking",
        message: `BOM output unit for ${bom.productRef} must match the product stock unit.`,
        path: `boms.${bom.productRef}.outputUnitRef`,
      });
    }
    if (new Set(bom.components.map((component) => component.basis)).size > 1) {
      issues.push({
        severity: "blocking",
        message: `BOM ${bom.productRef} mixes per-unit and per-batch component basis values.`,
        path: `boms.${bom.productRef}.components`,
      });
    }
    for (const component of bom.components) {
      const componentItem = pkg.items.find((item) => item.tempId === component.itemRef);
      if (!activeItemRefs.has(component.itemRef)) {
        issues.push({
          severity: "blocking",
          message: `BOM component reference ${component.itemRef} does not exist or is skipped.`,
          path: `boms.${bom.productRef}.components`,
        });
      }
      if (component.unitRef && componentItem && component.unitRef !== componentItem.unitRef) {
        issues.push({
          severity: "blocking",
          message: `BOM component ${component.itemRef} quantity must be reviewed in the component stock unit.`,
          path: `boms.${bom.productRef}.components.${component.itemRef}.unitRef`,
        });
      }
    }
  }

  const limit = await getSkuImportLimitInTx(tx, orgId);
  if (limit != null) {
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(items)
      .where(isNull(items.deletedAt));
    const createCount = pkg.items.filter(
      (item) => isReviewActive(item) && item.match.suggestion === "create",
    ).length;
    if (count + createCount > limit) {
      issues.push({
        severity: "blocking",
        message: `This import would exceed the ${limit} SKU limit for this plan.`,
      });
    }
  }

  return buildPreview(pkg, issues);
}

export async function createImportSession() {
  return withAuthedOrgContext(async (tx, orgId, userId) => {
    const [session] = await tx
      .insert(importSessions)
      .values({
        organizationId: orgId,
        createdByUserId: userId,
        status: "uploaded",
        expiresAt: expiresAt(),
      })
      .returning();
    return session;
  });
}

export async function addImportFiles(sessionId: string, uploads: PrivateFileUpload[]) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [session] = await tx
      .select({ id: importSessions.id })
      .from(importSessions)
      .where(and(eq(importSessions.id, sessionId), isNull(importSessions.deletedAt)));
    if (!session) throw new DomainError("Import session not found.", 404);

    if (uploads.length === 0) return [];

    return tx
      .insert(importFiles)
      .values(
        uploads.map((upload) => ({
          sessionId,
          organizationId: orgId,
          filename: upload.filename,
          contentType: upload.contentType,
          sizeBytes: upload.sizeBytes,
          storageKey: upload.storageKey,
          expiresAt: expiresAt(),
        })),
      )
      .returning({
        id: importFiles.id,
        filename: importFiles.filename,
        extractionStatus: importFiles.extractionStatus,
      });
  });
}

export async function getImportSession(sessionId: string) {
  return withAuthedOrgContext(async (tx, orgId) => {
    const [session] = await tx
      .select()
      .from(importSessions)
      .where(and(eq(importSessions.id, sessionId), isNull(importSessions.deletedAt)));
    if (!session) throw new DomainError("Import session not found.", 404);

    const files = await tx
      .select({
        id: importFiles.id,
        filename: importFiles.filename,
        contentType: importFiles.contentType,
        sizeBytes: importFiles.sizeBytes,
        extractionStatus: importFiles.extractionStatus,
        extractionError: importFiles.extractionError,
      })
      .from(importFiles)
      .where(and(eq(importFiles.sessionId, sessionId), isNull(importFiles.deletedAt)));

    const normalizedPackage = session.normalizedPackage
      ? await normalizeImportPackageInTx(tx, importPackageSchema.parse(session.normalizedPackage))
      : null;
    const preview = normalizedPackage
      ? await validateImportPackageInTx(tx, orgId, normalizedPackage)
      : null;

    return { session, files, preview, reviewPackage: normalizedPackage };
  });
}

export async function updateImportSessionPackage(
  sessionId: string,
  input: z.infer<typeof patchImportSessionSchema>,
) {
  const submittedPackage = importPackageSchema.parse({
    ...input.package,
    openingStockAsOf: input.openingStockAsOf ?? input.package.openingStockAsOf,
  });

  return withAuthedOrgContext(async (tx, orgId) => {
    const [session] = await tx
      .select({ id: importSessions.id, status: importSessions.status })
      .from(importSessions)
      .where(and(eq(importSessions.id, sessionId), isNull(importSessions.deletedAt)))
      .for("update");
    if (!session) throw new DomainError("Import session not found.", 404);
    if (session.status === "committed") {
      throw new DomainError("Committed imports cannot be edited.", 409);
    }

    const parsedPackage = await normalizeImportPackageInTx(tx, submittedPackage);
    const preview = await validateImportPackageInTx(tx, orgId, parsedPackage);
    const status = preview.status;

    const [updated] = await tx
      .update(importSessions)
      .set({
        status,
        normalizedPackage: parsedPackage,
        openingStockAsOf: parsedPackage.openingStockAsOf,
        includeBoms: input.includeBoms ?? true,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(importSessions.id, sessionId))
      .returning();

    return { session: updated, preview, reviewPackage: parsedPackage };
  });
}

async function resolveUnitInTx(
  tx: Tx,
  orgId: string,
  unit: ImportPackage["units"][number],
) {
  const [existing] = await tx
    .select({ id: unitDefinitions.id })
    .from(unitDefinitions)
    .where(
      and(
        eq(unitDefinitions.name, unit.name),
        eq(unitDefinitions.uom, unit.uom),
        eq(unitDefinitions.size, unit.size),
        isNull(unitDefinitions.deletedAt),
      ),
    );
  if (existing) return existing.id;

  const [created] = await tx
    .insert(unitDefinitions)
    .values({
      organizationId: orgId,
      name: unit.name,
      size: unit.size,
      uom: unit.uom,
    })
    .returning({ id: unitDefinitions.id });
  return created.id;
}

function nullable(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function nullableForCreate(value: string | null | undefined) {
  return nullable(value) ?? null;
}

async function writeFailure(sessionId: string, message: string) {
  await withAuthedOrgContext(async (tx) => {
    await tx
      .update(importSessions)
      .set({
        status: "failed",
        error: message,
        updatedAt: new Date(),
      })
      .where(eq(importSessions.id, sessionId));
  });
}

export async function approveImportSession(
  sessionId: string,
  // `previewHash` is the optimistic-concurrency guard for the interactive review
  // approve (free path). The post-payment finalize commit (paid path) omits it —
  // the stored package is the source of truth and is re-validated server-side.
  input: { previewHash?: string },
) {
  try {
    return await withAuthedOrgContext(async (tx, orgId, userId) => {
      const [session] = await tx
        .select()
        .from(importSessions)
        .where(and(eq(importSessions.id, sessionId), isNull(importSessions.deletedAt)))
        .for("update");
      if (!session) throw new DomainError("Import session not found.", 404);
      if (session.status !== "validated") {
        throw new DomainError("Import must be validated before approval.", 409);
      }
      if (session.committedAt) {
        throw new DomainError("Import has already been committed.", 409);
      }

      const approvedPackage = await normalizeImportPackageInTx(
        tx,
        importPackageSchema.parse(session.normalizedPackage),
      );
      const preview = await validateImportPackageInTx(tx, orgId, approvedPackage);
      if (preview.blockingIssueCount > 0) {
        throw new DomainError("Import has blocking validation errors.", 409, {
          extra: { preview },
        });
      }
      if (input.previewHash && input.previewHash !== preview.hash) {
        throw new DomainError("Import data changed. Review it again before approving.", 409);
      }

      const sourceFiles = await tx
        .select({ storageKey: importFiles.storageKey })
        .from(importFiles)
        .where(and(eq(importFiles.sessionId, sessionId), isNull(importFiles.deletedAt)));

      const unitIdByRef = new Map<string, string>();
      for (const unit of approvedPackage.units) {
        if (!isReviewSelected(unit)) continue;
        unitIdByRef.set(unit.tempId, await resolveUnitInTx(tx, orgId, unit));
      }

      const supplierIdByRef = new Map<string, string>();
      for (const supplier of approvedPackage.suppliers) {
        if (!isReviewActive(supplier)) {
          if (supplier.match.existingId) supplierIdByRef.set(supplier.tempId, supplier.match.existingId);
          continue;
        }
        if (supplier.match.suggestion === "update" && supplier.match.existingId) {
          await patchSupplierInTx(tx, supplier.match.existingId, {
            name: supplier.name,
            code: nullable(supplier.code),
            contactName: nullable(supplier.contactName),
            email: nullable(supplier.email),
            phone: nullable(supplier.phone),
          });
          supplierIdByRef.set(supplier.tempId, supplier.match.existingId);
          continue;
        }
        const created = await createSupplierInTx(tx, orgId, {
          ...supplierDefaultValues,
          name: supplier.name,
          code: nullableForCreate(supplier.code),
          contactName: nullableForCreate(supplier.contactName),
          email: nullableForCreate(supplier.email),
          phone: nullableForCreate(supplier.phone),
        });
        supplierIdByRef.set(supplier.tempId, created.id);
      }

      const customerIdByRef = new Map<string, string>();
      for (const customer of approvedPackage.customers) {
        if (!isReviewActive(customer)) {
          if (customer.match.existingId) customerIdByRef.set(customer.tempId, customer.match.existingId);
          continue;
        }
        if (customer.match.suggestion === "update" && customer.match.existingId) {
          await patchCustomerInTx(tx, customer.match.existingId, {
            name: customer.name,
            email: nullable(customer.email),
            phone: nullable(customer.phone),
          });
          customerIdByRef.set(customer.tempId, customer.match.existingId);
          continue;
        }
        const created = await createCustomerInTx(tx, orgId, {
          ...customerDefaultValues,
          name: customer.name,
          email: nullableForCreate(customer.email),
          phone: nullableForCreate(customer.phone),
          customerCategoryId: null,
          accountState: "active",
          accountPriority: "standard",
        });
        customerIdByRef.set(customer.tempId, created.id);
      }

      const itemIdByRef = new Map<string, string>();
      for (const item of approvedPackage.items) {
        if (!isReviewActive(item)) {
          if (item.match.existingId) itemIdByRef.set(item.tempId, item.match.existingId);
          continue;
        }
        const unitDefinitionId = unitIdByRef.get(item.unitRef);
        if (!unitDefinitionId) throw new DomainError(`Unit ${item.unitRef} was not resolved.`);
        const purchaseUnitDefinitionId = item.purchaseUnitRef
          ? unitIdByRef.get(item.purchaseUnitRef)
          : item.purchaseUnitRef === null
            ? null
            : undefined;
        const defaultSupplierId = item.defaultSupplierRef
          ? supplierIdByRef.get(item.defaultSupplierRef) ?? null
          : item.defaultSupplierRef === null
            ? null
            : undefined;
        if (item.match.suggestion === "update" && item.match.existingId) {
          await updateItemCardInTx(
            tx,
            orgId,
            userId,
            item.match.existingId,
            {
              name: item.name,
              category: undefined,
              description: undefined,
              unitDefinitionId,
              defaultSupplierId:
                item.itemType === "material" ? defaultSupplierId : undefined,
              purchaseUnitDefinitionId:
                item.itemType === "material" ? purchaseUnitDefinitionId : undefined,
              purchaseToStockFactor:
                item.itemType === "material" ? item.purchaseToStockFactor : undefined,
              lotTrackingMode: item.lotTrackingMode,
            },
            { idempotencyKey: `import:${sessionId}:item-card:${item.tempId}` },
          );
          await updateItemCardVariantInTx(
            tx,
            orgId,
            item.match.existingId,
            {
              sku: nullable(item.sku),
              registeredBarcode: undefined,
              internalBarcode: undefined,
              supplierItemCode: undefined,
              defaultLeadTimeDays: undefined,
              minimumOrderQuantity: undefined,
              defaultSellingPrice: item.defaultSellingPrice,
              defaultPurchasePrice: item.defaultPurchasePrice,
              currentStockUnitCost: undefined,
              safetyStock: undefined,
              sellable: item.itemType === "product" ? item.sellable : undefined,
            },
            { idempotencyKey: `import:${sessionId}:item-variant:${item.tempId}` },
          );
          itemIdByRef.set(item.tempId, item.match.existingId);
          continue;
        }
        const created = await createItemCardInTx(
          tx,
          orgId,
          {
            itemType: item.itemType,
            name: item.name,
            category: null,
            description: null,
            unitDefinitionId,
            defaultSupplierId,
            purchaseUnitDefinitionId,
            purchaseToStockFactor: item.purchaseToStockFactor ?? null,
            sku: nullableForCreate(item.sku),
            sellable: item.itemType === "product" ? item.sellable ?? false : false,
            defaultSellingPrice: item.defaultSellingPrice ?? null,
            defaultPurchasePrice: item.defaultPurchasePrice ?? null,
            currentStockUnitCost: null,
            registeredBarcode: null,
            internalBarcode: null,
            supplierItemCode: null,
            defaultLeadTimeDays: null,
            minimumOrderQuantity: null,
            lotTrackingMode: item.lotTrackingMode,
          },
          { idempotencyKey: `import:${sessionId}:item:${item.tempId}` },
        );
        itemIdByRef.set(item.tempId, created.itemId);
      }

      const stockResults: Array<{ itemId: string; lotId: string; eventId: string }> = [];
      for (const [index, stock] of approvedPackage.openingStock.entries()) {
        if (!isReviewSelected(stock)) continue;
        const stockItem = approvedPackage.items.find((item) => item.tempId === stock.itemRef);
        if (stockItem?.match.existingId) {
          continue;
        }
        const itemId = itemIdByRef.get(stock.itemRef);
        if (!itemId) throw new DomainError(`Item ${stock.itemRef} was not resolved.`);
        if (!isPositiveNumericString(stock.unitCost)) {
          throw new DomainError(`Opening stock for ${stock.itemRef} needs a numeric unit cost.`);
        }
        const unitCost = stock.unitCost;
        const result = await seedOpeningBalanceInTx(tx, {
          organizationId: orgId,
          itemId,
          quantity: Number(stock.quantity),
          unitCost,
          lotNumber: nullable(stock.lotNumber),
          actorUserId: userId,
          idempotencyKey: [
            "import",
            sessionId,
            "opening-stock",
            index,
            stock.itemRef,
            stock.lotNumber ?? "auto-lot",
            stock.receivedAt ?? approvedPackage.openingStockAsOf,
          ].join(":"),
          receivedAt: businessDateToUtcDate(stock.receivedAt ?? approvedPackage.openingStockAsOf),
        });
        stockResults.push({ itemId, ...result });
      }

      const bomResults: Array<{ productId: string; revisionId: string; revisionNumber: number }> = [];
      if (session.includeBoms) {
        for (const bom of approvedPackage.boms) {
          if (!isReviewSelected(bom)) continue;
          const productId = itemIdByRef.get(bom.productRef);
          if (!productId) throw new DomainError(`Product ${bom.productRef} was not resolved.`);
          const result = await createBomRevisionInTx(tx, {
            orgId,
            userId,
            productId,
            note: `Created by onboarding import ${sessionId}`,
            outputQuantity: bom.outputQuantity,
            recipeBasis: bom.components[0]?.basis === "per_batch" ? "batch" : "unit",
            bom: bom.components.map((component) => {
              const componentId = itemIdByRef.get(component.itemRef);
              if (!componentId) throw new DomainError(`Component ${component.itemRef} was not resolved.`);
              return { componentId, quantity: component.quantity };
            }),
          });
          bomResults.push({ productId, revisionId: result.id, revisionNumber: result.revisionNumber });
        }
      }

      const commitSummary = {
        units: unitIdByRef.size,
        suppliers: supplierIdByRef.size,
        customers: customerIdByRef.size,
        items: itemIdByRef.size,
        openingStock: stockResults.length,
        boms: bomResults.length,
      };

      const records = [
        ...[...itemIdByRef.values()].map((id) => ({ recordType: "item", localRecordId: id })),
        ...[...supplierIdByRef.values()].map((id) => ({ recordType: "supplier", localRecordId: id })),
        ...[...customerIdByRef.values()].map((id) => ({ recordType: "customer", localRecordId: id })),
        ...stockResults.map((result) => ({ recordType: "inventory_event", localRecordId: result.eventId })),
        ...bomResults.map((result) => ({ recordType: "bom_revision", localRecordId: result.revisionId })),
      ];

      if (records.length > 0) {
        await tx.insert(importCommitRecords).values(
          records.map((record) => ({
            sessionId,
            organizationId: orgId,
            action: "commit",
            ...record,
          })),
        );
      }

      const [updated] = await tx
        .update(importSessions)
        .set({
          status: "committed",
          approvedPackage,
          approvedPackageHash: preview.hash,
          approvedByUserId: userId,
          approvedAt: new Date(),
          committedAt: new Date(),
          commitSummary,
          draftPackage: null,
          normalizedPackage: null,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(importSessions.id, sessionId))
        .returning();

      await tx
        .update(importFiles)
        .set({ extractedPackage: null, deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(importFiles.sessionId, sessionId));

      return {
        session: updated,
        preview,
        commitSummary,
        storageKeysToDelete: sourceFiles.map((file) => file.storageKey),
      };
    });
  } catch (error) {
    if (error instanceof DomainError) throw error;
    await writeFailure(sessionId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function cancelImportSession(sessionId: string) {
  return withAuthedOrgContext(async (tx) => {
    const files = await tx
      .select({ storageKey: importFiles.storageKey })
      .from(importFiles)
      .where(and(eq(importFiles.sessionId, sessionId), isNull(importFiles.deletedAt)));

    const [session] = await tx
      .update(importSessions)
      .set({
        status: "canceled",
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(importSessions.id, sessionId),
          isNull(importSessions.committedAt),
          isNull(importSessions.deletedAt),
        ),
      )
      .returning({ id: importSessions.id, status: importSessions.status });
    if (!session) return null;

    await tx
      .update(importFiles)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(importFiles.sessionId, sessionId), isNull(importFiles.deletedAt)));

    return { session, storageKeys: files.map((file) => file.storageKey) };
  });
}

export function serializeImportSession(row: SessionRow) {
  return {
    id: row.id,
    status: row.status,
    openingStockAsOf: row.openingStockAsOf,
    includeBoms: row.includeBoms,
    approvedPackageHash: row.approvedPackageHash,
    committedAt: row.committedAt?.toISOString() ?? null,
    commitSummary: row.commitSummary,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
