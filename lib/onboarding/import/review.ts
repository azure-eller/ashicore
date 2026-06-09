import "server-only";

import { isNull, sql } from "drizzle-orm";
import {
  customers,
  items,
  suppliers,
} from "@/lib/db/schema";
import type { Tx } from "@/lib/db/with-org-context";
import { getUomOptions } from "@/lib/units-of-measure";
import { hashImportPackage } from "./hash";
import { getSkuImportLimitInTx } from "./entitlements";
import {
  importPackageSchema,
  type ImportPackage,
  type PreviewIssue,
  type PreviewReport,
} from "./types";

const allowedImportUoms = new Set(
  getUomOptions().flatMap((group) => group.options.map((option) => option.value)),
);

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

function nullable(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) && parsed > 0;
}

function isPhoneLike(value: string | null | undefined) {
  if (!value) return true;
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && /^[+\d\s().\-xext]+$/i.test(trimmed);
}

function unitDefinitionKey(unit: { name: string; size: string; uom: string }) {
  return `${unit.name.trim().toLowerCase()}|${unit.size}|${unit.uom}`;
}

function isGenericPackagingUnitName(name: string) {
  return (
    /^\d+(?:\.\d+)?\s+pallets?$/i.test(name) ||
    /^(?:bags?|totes?|pallets?|yards?|cfb|cyt|cyd|cy)$/i.test(name.trim())
  );
}

function isCountPrefixedDimensionalUnit(unit: { name: string }) {
  return /^\d+(?:\.\d+)?\s*ea\b/i.test(unit.name) && /\b(?:cfb|cf|cyt|cyd|cy)\b/i.test(unit.name);
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

export async function validateImportPackageInTx(
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

  for (const unit of pkg.units) {
    if (!isReviewSelected(unit)) continue;
    if (!allowedImportUoms.has(unit.uom)) {
      issues.push({
        severity: "blocking",
        message: `Unit ${unit.name} uses unsupported UOM "${unit.uom}". Use the package/display name in Name and a supported base UOM such as lb, kg, cu ft, cu yd, gal, or ea.`,
        path: `units.${unit.tempId}.uom`,
      });
    }
    if (isGenericPackagingUnitName(unit.name)) {
      issues.push({
        severity: "blocking",
        message: `Unit ${unit.name} is generic packaging shorthand. Use a dimensional package name such as 2cfb bag or 1 cu yd tote, or leave order-only packaging out.`,
        path: `units.${unit.tempId}.name`,
      });
    }
    if (isCountPrefixedDimensionalUnit(unit)) {
      issues.push({
        severity: "blocking",
        message: `Unit ${unit.name} includes an order quantity/count prefix. Use the underlying dimensional stock unit instead.`,
        path: `units.${unit.tempId}.name`,
      });
    }
  }
  const unitDefinitionKeys = pkg.units
    .filter((unit) => isReviewSelected(unit))
    .map(unitDefinitionKey);
  if (new Set(unitDefinitionKeys).size !== unitDefinitionKeys.length) {
    issues.push({
      severity: "blocking",
      message: "Duplicate unit definitions must be merged before approval.",
      path: "units",
    });
  }

  if (new Set(pkg.items.map((item) => item.tempId)).size !== pkg.items.length) {
    issues.push({ severity: "blocking", message: "Item references must be unique." });
  }

  for (const supplier of pkg.suppliers) {
    if (!isReviewActive(supplier)) continue;
    if (!isPhoneLike(supplier.phone)) {
      issues.push({
        severity: "blocking",
        message: `Supplier ${supplier.name} has a non-phone value in phone. Put addresses, names, and delivery notes somewhere else or leave phone blank.`,
        path: `suppliers.${supplier.tempId}.phone`,
      });
    }
  }

  for (const customer of pkg.customers) {
    if (!isReviewActive(customer)) continue;
    if (!isPhoneLike(customer.phone)) {
      issues.push({
        severity: "blocking",
        message: `Customer ${customer.name} has a non-phone value in phone. Put addresses, names, and delivery notes somewhere else or leave phone blank.`,
        path: `customers.${customer.tempId}.phone`,
      });
    }
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
    if (!isPositiveNumericString(stock.quantity)) {
      issues.push({
        severity: "blocking",
        message: `Opening stock for ${stock.itemRef} needs a positive quantity before approval.`,
        path: `openingStock.${stock.itemRef}.quantity`,
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
    if (bom.components.length === 0) {
      issues.push({
        severity: "blocking",
        message: `BOM ${bom.productRef} needs at least one explicit component before approval.`,
        path: `boms.${bom.productRef}.components`,
      });
    }
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
