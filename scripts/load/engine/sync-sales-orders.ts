import { eq, isNull, sql } from "drizzle-orm";
import {
  items,
  salesOrderLines,
  salesOrders,
  unitDefinitions,
} from "@/lib/db/schema";
import { normalizeMoney, normalizeNumeric } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import { findExistingItem } from "./seeds";
import {
  assertNoDuplicateCustomerNames,
  buildCustomerPlans,
  loadExistingCustomersInTx,
  normalizeCustomerKey,
} from "./sync-customers";
import { assertNoDuplicateSkus, loadExistingItemsInTx } from "./sync-items";
import type {
  CustomerSeed,
  EvaluatedSalesImportOrder,
  ExistingItem,
  ExistingSalesOrder,
  ItemSeed,
  PreparedSalesImportLine,
  SalesImportConfig,
  SalesImportEvaluation,
  SalesImportReport,
} from "./types";

function buildOrderMarker(prefix: string, sourceRows: number[]) {
  return `${prefix}${sourceRows.join(",")}]`;
}

function extractOrderMarker(prefix: string, notes: string | null) {
  if (!notes) return null;
  const [firstLine] = notes.split(/\r?\n/);
  return firstLine?.startsWith(prefix) ? firstLine : null;
}

function buildOrderLabel(order: SalesImportConfig["orderSeeds"][number]) {
  return order.reference
    ? `${order.customerName} (${order.reference})`
    : `${order.customerName} (rows ${order.sourceRows.join(",")})`;
}

function buildOrderNotes(
  prefix: string,
  sourceRows: number[],
  order: SalesImportConfig["orderSeeds"][number]
) {
  // Marker must be the first line so extractOrderMarker can find it on re-import.
  const parts: string[] = [buildOrderMarker(prefix, sourceRows)];

  const specialInstructions = order.specialInstructions?.trim();
  if (specialInstructions) {
    parts.push(specialInstructions);
  }

  const unresolvedLines: string[] = [];
  for (const line of order.lines) {
    if (line.kind === "unmapped") {
      const raw = line.raw.trim();
      if (raw) unresolvedLines.push(raw);
    }
  }

  if (unresolvedLines.length > 0) {
    parts.push(`Needs manual entry: ${unresolvedLines.join(" | ")}`);
  }

  return parts.join("\n");
}

function buildLineSignature(line: {
  itemSku: string | null;
  quantity: string;
  unitPrice: string;
}) {
  return `${line.itemSku ?? ""}:${line.quantity}:${line.unitPrice}`;
}

function buildOrderSignature(input: {
  customerName: string;
  requestedDate: string | null;
  lines: Array<{
    itemSku: string | null;
    quantity: string;
    unitPrice: string;
  }>;
}) {
  const lineSignature = [...input.lines]
    .map((line) => buildLineSignature(line))
    .sort()
    .join("|");

  return [
    normalizeCustomerKey(input.customerName),
    input.requestedDate ?? "",
    lineSignature,
  ].join("||");
}

function addPreparedLine(
  preparedLines: PreparedSalesImportLine[],
  nextLine: Omit<PreparedSalesImportLine, "sortOrder">
) {
  const existingLine = preparedLines.find(
    (line) => line.itemId === nextLine.itemId && line.unitPrice === nextLine.unitPrice
  );

  if (!existingLine) {
    preparedLines.push({
      ...nextLine,
      sortOrder: preparedLines.length,
    });
    return;
  }

  existingLine.quantity = normalizeNumeric(
    parseFloat(existingLine.quantity) + parseFloat(nextLine.quantity)
  );
  existingLine.lineTotal = normalizeMoney(
    parseFloat(existingLine.lineTotal) + parseFloat(nextLine.lineTotal)
  );
}

async function generateSalesOrderNumber(tx: Tx) {
  const result = await tx.execute(
    sql`SELECT nextval('sales.order_number_seq') AS val`
  );
  const raw = (result.rows[0] as { val: string | number }).val;
  const sequenceValue = Number(raw);
  const year = new Date().getFullYear();
  return `SO-${year}-${String(sequenceValue).padStart(4, "0")}`;
}

function buildCustomerSeedsFromOrders(
  orderSeeds: SalesImportConfig["orderSeeds"]
): Map<string, CustomerSeed> {
  const customerByKey = new Map<string, CustomerSeed>();

  for (const order of orderSeeds) {
    const key = normalizeCustomerKey(order.customerName);
    const existing = customerByKey.get(key);

    if (!existing) {
      customerByKey.set(key, {
        name: order.customerName,
        address: order.address,
        phone: order.contact,
      });
      continue;
    }

    if (existing.address == null && order.address != null) {
      existing.address = order.address;
    }
    if (existing.phone == null && order.contact != null) {
      existing.phone = order.contact;
    }
  }

  return customerByKey;
}

export async function evaluateSalesImportInTx(
  tx: Tx,
  config: SalesImportConfig,
  seedByKey: Map<string, ItemSeed>,
  managedItemSkus: Set<string>
): Promise<SalesImportEvaluation> {
  const existingCustomers = await loadExistingCustomersInTx(tx);
  assertNoDuplicateCustomerNames(existingCustomers);

  const existingOrderRows = await tx
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      status: salesOrders.status,
      customerName: salesOrders.customerName,
      requestedDate: salesOrders.requestedDate,
      notes: salesOrders.notes,
      lineId: salesOrderLines.id,
      itemSku: items.sku,
      quantity: salesOrderLines.quantity,
      unitPrice: salesOrderLines.unitPrice,
    })
    .from(salesOrders)
    .leftJoin(salesOrderLines, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .leftJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(isNull(salesOrders.deletedAt));

  const existingOrdersById = new Map<
    string,
    ExistingSalesOrder & {
      lines: Array<{
        itemSku: string | null;
        quantity: string;
        unitPrice: string;
      }>;
    }
  >();

  for (const row of existingOrderRows) {
    const existing =
      existingOrdersById.get(row.id) ??
      {
        id: row.id,
        orderNumber: row.orderNumber,
        status: row.status,
        customerName: row.customerName,
        requestedDate: row.requestedDate,
        notes: row.notes,
        lineSignature: "",
        lines: [],
      };

    if (row.lineId != null) {
      existing.lines.push({
        itemSku: row.itemSku,
        quantity: normalizeNumeric(Number(row.quantity)),
        unitPrice: normalizeMoney(Number(row.unitPrice)),
      });
    }

    existingOrdersById.set(row.id, existing);
  }

  const existingOrders = [...existingOrdersById.values()].map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customerName: order.customerName,
    requestedDate: order.requestedDate,
    notes: order.notes,
    lineSignature: buildOrderSignature({
      customerName: order.customerName,
      requestedDate: order.requestedDate,
      lines: order.lines,
    }),
  }));

  const existingUnits = await tx
    .select({
      id: unitDefinitions.id,
      name: unitDefinitions.name,
    })
    .from(unitDefinitions);

  const existingItems = await loadExistingItemsInTx(tx);
  assertNoDuplicateSkus(existingItems, managedItemSkus);

  const existingCustomersByKey = new Map(
    existingCustomers.map((row) => [normalizeCustomerKey(row.name), row])
  );
  const existingCustomerIdByKey = new Map(
    existingCustomers.map((row) => [normalizeCustomerKey(row.name), row.id])
  );
  const existingOrdersByMarker = new Map<string, ExistingSalesOrder>();
  const existingOrdersBySignature = new Map<string, ExistingSalesOrder>();
  for (const order of existingOrders) {
    const marker = extractOrderMarker(config.orderMarkerPrefix, order.notes);
    if (marker) {
      existingOrdersByMarker.set(marker, order);
    }
    existingOrdersBySignature.set(order.lineSignature, order);
  }

  const existingItemsBySku = new Map(
    existingItems
      .filter((row): row is ExistingItem & { sku: string } => row.sku != null)
      .map((row) => [row.sku, row])
  );
  const existingItemsByName = new Map(existingItems.map((row) => [row.name, row]));
  const unitNameById = new Map(existingUnits.map((row) => [row.id, row.name]));

  const customerSeedsByKey = buildCustomerSeedsFromOrders(config.orderSeeds);
  const customerPlans = buildCustomerPlans(
    customerSeedsByKey,
    existingCustomersByKey,
    config.customerNotesDefault
  );

  const orders: EvaluatedSalesImportOrder[] = [];

  for (const order of config.orderSeeds) {
    const marker = buildOrderMarker(config.orderMarkerPrefix, order.sourceRows);
    const label = buildOrderLabel(order);
    const requestedDate = config.requestedDateBySourceRow[order.sourceRows[0]] ?? null;

    const issues: string[] = [];
    const preparedLines: PreparedSalesImportLine[] = [];
    const hasUnmappedLines = order.lines.some((l) => l.kind === "unmapped");

    for (const line of order.lines) {
      if (line.kind === "unmapped") {
        continue;
      }

      const seedKey = config.productAliasToSeedKey[line.product];
      const seed = seedByKey.get(seedKey);
      if (!seed) {
        issues.push(`${line.raw} -> Catalog seed "${seedKey}" was not found.`);
        continue;
      }

      const existingItem = findExistingItem(seed, existingItemsBySku, existingItemsByName);
      if (!existingItem || existingItem.deletedAt) {
        issues.push(`${line.raw} -> Item "${seed.name}" is missing from active catalog.`);
        continue;
      }

      const unitName = existingItem.unitDefinitionId
        ? unitNameById.get(existingItem.unitDefinitionId)
        : undefined;
      if (!unitName) {
        issues.push(`${line.raw} -> Unit definition is missing for "${seed.name}".`);
        continue;
      }

      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        issues.push(`${line.raw} -> Quantity "${line.quantity}" is invalid.`);
        continue;
      }

      const unitPriceNumber =
        line.priceOverride != null
          ? Number(line.priceOverride)
          : existingItem.defaultSellingPrice == null
            ? Number.NaN
            : Number(existingItem.defaultSellingPrice);
      if (!Number.isFinite(unitPriceNumber) || unitPriceNumber <= 0) {
        issues.push(`${line.raw} -> "${seed.name}" has no selling price (and no line override).`);
        continue;
      }

      addPreparedLine(preparedLines, {
        itemId: existingItem.id,
        itemName: existingItem.name,
        itemSku: existingItem.sku,
        unitName,
        quantity: normalizeNumeric(quantity),
        unitPrice: normalizeMoney(unitPriceNumber),
        lineTotal: normalizeMoney(quantity * unitPriceNumber),
      });
    }

    if (issues.length > 0) {
      orders.push({
        kind: "skipped",
        label,
        sourceRows: order.sourceRows,
        issues,
      });
      continue;
    }

    if (preparedLines.length === 0) {
      issues.push(
        hasUnmappedLines
          ? "No mapped line items; unresolved lines require manual entry."
          : "No importable line items are currently mapped for this order."
      );
      orders.push({
        kind: "skipped",
        label,
        sourceRows: order.sourceRows,
        issues,
      });
      continue;
    }

    const totalAmount = normalizeMoney(
      preparedLines.reduce((sum, line) => sum + parseFloat(line.lineTotal), 0)
    );
    const readyLabel = hasUnmappedLines ? `${label} [UNFINISHED]` : label;
    const signature = buildOrderSignature({
      customerName: order.customerName,
      requestedDate,
      lines: preparedLines,
    });
    const existingOrder =
      existingOrdersByMarker.get(marker) ?? existingOrdersBySignature.get(signature) ?? null;

    if (existingOrder && existingOrder.status !== "draft") {
      orders.push({
        kind: "skipped",
        label,
        sourceRows: order.sourceRows,
        issues: [
          `Existing order ${existingOrder.orderNumber} is ${existingOrder.status}; import leaves non-draft orders untouched.`,
        ],
      });
      continue;
    }

    orders.push({
      kind: "ready",
      label: readyLabel,
      sourceRows: order.sourceRows,
      existingId: existingOrder?.id ?? null,
      existingOrderNumber: existingOrder?.orderNumber ?? null,
      customerKey: normalizeCustomerKey(order.customerName),
      customerName: order.customerName,
      notes: buildOrderNotes(config.orderMarkerPrefix, order.sourceRows, order),
      totalAmount,
      lines: preparedLines,
      requestedDate,
    });
  }

  return {
    customerPlans,
    existingCustomerIdByKey,
    orders,
  };
}

export async function applySalesImportOrdersInTx(
  tx: Tx,
  orgId: string,
  evaluation: SalesImportEvaluation,
  customerIdByKey: Map<string, string>,
  apply: boolean,
  report: SalesImportReport
) {
  for (const order of evaluation.orders) {
    if (order.kind === "skipped") {
      report.skippedOrders.push({
        label: order.label,
        sourceRows: order.sourceRows,
        issues: order.issues,
      });
      continue;
    }

    const customerId = customerIdByKey.get(order.customerKey);
    if (apply && !customerId) {
      report.skippedOrders.push({
        label: order.label,
        sourceRows: order.sourceRows,
        issues: ["Customer could not be resolved during import."],
      });
      continue;
    }

    if (apply) {
      if (order.existingId) {
        // Skip the rewrite entirely if there are no mapped lines to insert —
        // otherwise the unconditional delete would silently strip the order's existing lines.
        if (order.lines.length === 0) {
          report.skippedOrders.push({
            label: order.label,
            sourceRows: order.sourceRows,
            issues: ["No mapped lines to write; existing order left untouched."],
          });
          continue;
        }

        const [lockedOrder] = await tx
          .select({
            orderNumber: salesOrders.orderNumber,
            status: salesOrders.status,
          })
          .from(salesOrders)
          .where(eq(salesOrders.id, order.existingId))
          .for("update");

        if (!lockedOrder || lockedOrder.status !== "draft") {
          report.skippedOrders.push({
            label: order.label,
            sourceRows: order.sourceRows,
            issues: [
              lockedOrder
                ? `Existing order ${lockedOrder.orderNumber} is ${lockedOrder.status}; import leaves non-draft orders untouched.`
                : "Existing order could not be locked; it may have been deleted.",
            ],
          });
          continue;
        }

        await tx
          .update(salesOrders)
          .set({
            customerId: customerId!,
            customerName: order.customerName,
            requestedDate: order.requestedDate,
            notes: order.notes,
            totalAmount: order.totalAmount,
            updatedAt: new Date(),
          })
          .where(eq(salesOrders.id, order.existingId));

        await tx
          .delete(salesOrderLines)
          .where(eq(salesOrderLines.salesOrderId, order.existingId));

        await tx.insert(salesOrderLines).values(
          order.lines.map((line) => ({
            salesOrderId: order.existingId!,
            ...line,
          }))
        );

        report.existingOrders.push(
          `${order.existingOrderNumber ?? order.existingId} - ${order.label}`
        );
      } else {
        const orderNumber = await generateSalesOrderNumber(tx);
        const [createdOrder] = await tx
          .insert(salesOrders)
          .values({
            organizationId: orgId,
            orderNumber,
            customerId: customerId!,
            customerName: order.customerName,
            status: "draft",
            requestedDate: order.requestedDate,
            notes: order.notes,
            totalAmount: order.totalAmount,
          })
          .returning({ id: salesOrders.id });

        if (order.lines.length > 0) {
          await tx.insert(salesOrderLines).values(
            order.lines.map((line) => ({
              salesOrderId: createdOrder.id,
              ...line,
            }))
          );
        }

        report.createdOrders.push(`${orderNumber} - ${order.label}`);
      }
      continue;
    }

    if (order.existingId) {
      report.existingOrders.push(
        `${order.existingOrderNumber ?? order.existingId} - ${order.label}`
      );
    } else {
      report.createdOrders.push(order.label);
    }
  }

}
