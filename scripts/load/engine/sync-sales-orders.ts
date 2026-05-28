import { eq, isNull, sql } from "drizzle-orm";
import {
  items,
  salesShipmentLines,
  salesShipments,
  salesOrderLines,
  salesOrders,
  unitDefinitions,
} from "@/lib/db/schema";
import { normalizeMoney, normalizeNumeric } from "@/lib/format";
import type { Tx } from "@/lib/db/with-org-context";
import {
  releaseReservationForSalesLineInTx,
  reserveForSalesInTx,
} from "@/lib/inventory/kernel/operations/sales";
import { buildExistingItemsByName, findExistingItem } from "./seeds";
import {
  assertNoDuplicateCustomerNames,
  buildExistingCustomersByKey,
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
  ReadySalesImportOrder,
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

  const requestedWindow = order.requestedWindow?.trim();
  if (requestedWindow) {
    parts.push(`Requested window: ${requestedWindow}`);
  }

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
  allocated?: boolean;
}) {
  return `${line.itemSku ?? ""}:${line.quantity}:${line.unitPrice}:${
    line.allocated ? "1" : "0"
  }`;
}

function buildOrderSignature(input: {
  customerName: string;
  orderDate: string;
  shipDate: string | null;
  requestedDate: string | null;
  lines: Array<{
    itemSku: string | null;
    quantity: string;
    unitPrice: string;
    allocated?: boolean;
  }>;
}) {
  const lineSignature = [...input.lines]
    .map((line) => buildLineSignature(line))
    .sort()
    .join("|");

  return [
    normalizeCustomerKey(input.customerName),
    input.orderDate,
    input.shipDate ?? "",
    input.requestedDate ?? "",
    lineSignature,
  ].join("||");
}

function buildCustomerAliasByKey(config: SalesImportConfig) {
  const aliases = new Map<string, string>();
  for (const [sourceName, targetName] of Object.entries(config.customerAliases ?? {})) {
    aliases.set(normalizeCustomerKey(sourceName), targetName);
  }
  return aliases;
}

function buildCustomerAliasBySourceRow(config: SalesImportConfig) {
  return new Map(
    Object.entries(config.customerAliasesBySourceRow ?? {}).map(
      ([sourceRow, targetName]) => [Number(sourceRow), targetName]
    )
  );
}

function resolveOrderCustomerAliasName(
  order: SalesImportConfig["orderSeeds"][number],
  customerAliasByKey: Map<string, string>,
  customerAliasBySourceRow: Map<number, string>
) {
  for (const sourceRow of order.sourceRows) {
    const targetName = customerAliasBySourceRow.get(sourceRow);
    if (targetName) return targetName;
  }

  return customerAliasByKey.get(normalizeCustomerKey(order.customerName)) ?? null;
}

function resolveOrderCustomerKey(
  order: SalesImportConfig["orderSeeds"][number],
  customerAliasByKey: Map<string, string>,
  customerAliasBySourceRow: Map<number, string>
) {
  const sourceKey = normalizeCustomerKey(order.customerName);
  const targetName = resolveOrderCustomerAliasName(
    order,
    customerAliasByKey,
    customerAliasBySourceRow
  );
  return targetName ? normalizeCustomerKey(targetName) : sourceKey;
}

function addPreparedLine(
  preparedLines: PreparedSalesImportLine[],
  nextLine: Omit<PreparedSalesImportLine, "sortOrder">
) {
  const existingLine = preparedLines.find(
    (line) =>
      line.itemId === nextLine.itemId &&
      line.unitPrice === nextLine.unitPrice &&
      line.allocated === nextLine.allocated
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
  orderSeeds: SalesImportConfig["orderSeeds"],
  customerAliasByKey: Map<string, string>,
  customerAliasBySourceRow: Map<number, string>
): Map<string, CustomerSeed> {
  const customerByKey = new Map<string, CustomerSeed>();

  for (const order of orderSeeds) {
    const sourceKey = normalizeCustomerKey(order.customerName);
    const aliasName = resolveOrderCustomerAliasName(
      order,
      customerAliasByKey,
      customerAliasBySourceRow
    );
    const key = aliasName ? normalizeCustomerKey(aliasName) : sourceKey;
    const name = aliasName ?? order.customerName;
    const existing = customerByKey.get(key);

    if (!existing) {
      customerByKey.set(key, {
        name,
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

function toSalesOrderLineInsert(
  salesOrderId: string,
  line: PreparedSalesImportLine
) {
  return {
    salesOrderId,
    itemId: line.itemId,
    itemName: line.itemName,
    itemSku: line.itemSku,
    unitName: line.unitName,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxRateId: null,
    taxRateName: null,
    taxRatePercent: "0",
    lineSubtotal: line.lineTotal,
    lineTaxAmount: "0",
    lineTotal: line.lineTotal,
    sortOrder: line.sortOrder,
  };
}

async function reserveConfirmedImportLinesInTx(
  tx: Tx,
  orgId: string,
  order: ReadySalesImportOrder,
  salesOrderId: string,
  lineRows: Array<{
    salesOrderLineId: string;
    itemId: string;
    quantity: string;
  }>
) {
  const linesToReserve = lineRows
    .map((line) => ({
      salesOrderLineId: line.salesOrderLineId,
      itemId: line.itemId,
      quantity: parseFloat(line.quantity),
    }))
    .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);

  if (linesToReserve.length === 0) return;

  await reserveForSalesInTx(tx, {
    organizationId: orgId,
    salesOrderId,
    actorUserId: null,
    lines: linesToReserve,
  });
}

function buildProvisionalCustomerSeedsByKey(config: SalesImportConfig) {
  return new Map(
    (config.provisionalCustomers ?? []).map((customer) => [
      normalizeCustomerKey(customer.name),
      customer,
    ])
  );
}

export async function evaluateSalesImportInTx(
  tx: Tx,
  config: SalesImportConfig,
  seedByKey: Map<string, ItemSeed>,
  managedItemSkus: Set<string>
): Promise<SalesImportEvaluation> {
  const existingCustomers = await loadExistingCustomersInTx(tx);
  assertNoDuplicateCustomerNames(existingCustomers);
  const customerMode = config.customerMode ?? "sync";
  const customerAliasByKey = buildCustomerAliasByKey(config);
  const customerAliasBySourceRow = buildCustomerAliasBySourceRow(config);
  const provisionalCustomerSeedsByKey = buildProvisionalCustomerSeedsByKey(config);

  const existingOrderRows = await tx
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      status: salesOrders.status,
      customerName: salesOrders.customerName,
      orderDate: salesOrders.orderDate,
      shipDate: salesOrders.shipDate,
      requestedDate: salesOrders.requestedDate,
      notes: salesOrders.notes,
      lineId: salesOrderLines.id,
      itemSku: items.sku,
      quantity: salesOrderLines.quantity,
      unitPrice: salesOrderLines.unitPrice,
      allocated: sql<boolean>`EXISTS (
        SELECT 1
        FROM sales.sales_shipment_lines ssl
        JOIN sales.sales_shipments ss ON ss.id = ssl.sales_shipment_id
        WHERE ssl.sales_order_line_id = ${salesOrderLines.id}
          AND ss.status <> 'cancelled'
      )`,
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
        allocated?: boolean;
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
        orderDate: row.orderDate,
        shipDate: row.shipDate,
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
        allocated: row.allocated === true,
      });
    }

    existingOrdersById.set(row.id, existing);
  }

  const existingOrders = [...existingOrdersById.values()].map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customerName: order.customerName,
    orderDate: order.orderDate,
    shipDate: order.shipDate,
    requestedDate: order.requestedDate,
    notes: order.notes,
    lineSignature: buildOrderSignature({
      customerName: order.customerName,
      orderDate: order.orderDate,
      shipDate: order.shipDate,
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

  const existingCustomersByKey = buildExistingCustomersByKey(existingCustomers, {
    includeDeletedFallback: customerMode === "sync",
  });
  const existingCustomerIdByKey = new Map(
    [...existingCustomersByKey].map(([key, row]) => [key, row.id])
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
  const existingItemsByName = buildExistingItemsByName(existingItems);
  const unitNameById = new Map(existingUnits.map((row) => [row.id, row.name]));

  const customerSeedsByKey = buildCustomerSeedsFromOrders(
    config.orderSeeds,
    customerAliasByKey,
    customerAliasBySourceRow
  );
  const provisionalCustomerPlans = buildCustomerPlans(
    provisionalCustomerSeedsByKey,
    existingCustomersByKey,
    config.customerNotesDefault
  );
  const customerPlans =
    customerMode === "sync"
      ? buildCustomerPlans(
          customerSeedsByKey,
          existingCustomersByKey,
          config.customerNotesDefault
        )
      : provisionalCustomerPlans;

  const orders: EvaluatedSalesImportOrder[] = [];

  for (const order of config.orderSeeds) {
    const marker = buildOrderMarker(config.orderMarkerPrefix, order.sourceRows);
    const label = buildOrderLabel(order);
    const requestedDate =
      order.requestedDate ?? config.requestedDateBySourceRow?.[order.sourceRows[0]] ?? null;
    const orderDate = order.orderDate ?? requestedDate ?? new Date().toISOString().slice(0, 10);
    const shipDate = order.shipDate ?? requestedDate;
    const status = "open";
    const customerKey = resolveOrderCustomerKey(
      order,
      customerAliasByKey,
      customerAliasBySourceRow
    );
    const existingCustomer = existingCustomersByKey.get(customerKey) ?? null;
    const provisionalCustomerSeed = provisionalCustomerSeedsByKey.get(customerKey) ?? null;

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

      const existingItem = findExistingItem(seed, existingItemsBySku, existingItemsByName, {
        nameMatchPredicate: (item) => item.familyId != null,
      });
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
        allocated: line.allocated === true,
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

    if (
      customerMode === "existing-only" &&
      !existingCustomer &&
      !provisionalCustomerSeed
    ) {
      issues.push(
        `Customer "${order.customerName}" is not an active existing customer.`
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
    const resolvedCustomerName =
      existingCustomer?.name ?? provisionalCustomerSeed?.name ?? order.customerName;
    const signature = buildOrderSignature({
      customerName: resolvedCustomerName,
      orderDate,
      shipDate,
      requestedDate,
      lines: preparedLines,
    });
    const existingOrder =
      existingOrdersByMarker.get(marker) ?? existingOrdersBySignature.get(signature) ?? null;

    if (existingOrder && existingOrder.status !== "open") {
      if (existingOrder.status === status && existingOrder.lineSignature === signature) {
        orders.push({
          kind: "ready",
          label: readyLabel,
          sourceRows: order.sourceRows,
          existingId: existingOrder.id,
          existingOrderNumber: existingOrder.orderNumber,
          orderNumber: order.orderNumber ?? null,
          status,
          customerKey,
          customerName: resolvedCustomerName,
          notes: buildOrderNotes(config.orderMarkerPrefix, order.sourceRows, order),
          totalAmount,
          lines: preparedLines,
          orderDate,
          shipDate,
          requestedDate,
        });
        continue;
      }

      orders.push({
        kind: "skipped",
        label,
        sourceRows: order.sourceRows,
        issues: [
          `Existing order ${existingOrder.orderNumber} is ${existingOrder.status}; import leaves non-open orders untouched.`,
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
      orderNumber: order.orderNumber ?? null,
      unchanged:
        existingOrder != null &&
        existingOrder.status === status &&
        existingOrder.lineSignature === signature,
      status,
      customerKey,
      customerName: resolvedCustomerName,
      notes: buildOrderNotes(config.orderMarkerPrefix, order.sourceRows, order),
      totalAmount,
      lines: preparedLines,
      orderDate,
      shipDate,
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
        if (order.unchanged) {
          report.existingOrders.push(
            `${order.existingOrderNumber ?? order.existingId} - ${order.label}`
          );
          continue;
        }

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

        if (!lockedOrder || lockedOrder.status !== "open") {
          if (lockedOrder?.status === order.status) {
            report.existingOrders.push(
              `${order.existingOrderNumber ?? order.existingId} - ${order.label}`
            );
            continue;
          }

          report.skippedOrders.push({
            label: order.label,
            sourceRows: order.sourceRows,
            issues: [
              lockedOrder
                ? `Existing order ${lockedOrder.orderNumber} is ${lockedOrder.status}; import leaves non-open orders untouched.`
                : "Existing order could not be locked; it may have been deleted.",
            ],
          });
          continue;
        }

        const existingShipmentRefs = await tx
          .select({ id: salesShipmentLines.id })
          .from(salesShipmentLines)
          .innerJoin(salesShipments, eq(salesShipments.id, salesShipmentLines.salesShipmentId))
          .where(eq(salesShipments.salesOrderId, order.existingId))
          .limit(1);
        if (existingShipmentRefs.length > 0) {
          report.skippedOrders.push({
            label: order.label,
            sourceRows: order.sourceRows,
            issues: [
              `Existing order ${lockedOrder.orderNumber} has historical shipment lines; import leaves it untouched.`,
            ],
          });
          continue;
        }

        await tx
          .update(salesOrders)
          .set({
            customerId: customerId!,
            customerName: order.customerName,
            orderDate: order.orderDate,
            shipDate: order.shipDate,
            requestedDate: order.requestedDate,
            notes: order.notes,
            subtotalAmount: order.totalAmount,
            taxAmount: "0",
            totalAmount: order.totalAmount,
            status: order.status,
            updatedAt: new Date(),
          })
          .where(eq(salesOrders.id, order.existingId));

        const existingLineIds = await tx
          .select({ id: salesOrderLines.id })
          .from(salesOrderLines)
          .where(eq(salesOrderLines.salesOrderId, order.existingId));
        if (existingLineIds.length > 0) {
          await releaseReservationForSalesLineInTx(tx, {
            organizationId: orgId,
            salesOrderId: order.existingId,
            actorUserId: null,
            reason: "edited",
            salesOrderLineIds: existingLineIds.map((line) => line.id),
          });
        }

        await tx
          .delete(salesOrderLines)
          .where(eq(salesOrderLines.salesOrderId, order.existingId));

        const createdLines = await tx
          .insert(salesOrderLines)
          .values(order.lines.map((line) => toSalesOrderLineInsert(order.existingId!, line)))
          .returning({
            salesOrderLineId: salesOrderLines.id,
            itemId: salesOrderLines.itemId,
            quantity: salesOrderLines.quantity,
          });

        await reserveConfirmedImportLinesInTx(
          tx,
          orgId,
          order,
          order.existingId,
          createdLines
        );

        report.existingOrders.push(
          `${order.existingOrderNumber ?? order.existingId} - ${order.label}`
        );
      } else {
        const orderNumber = order.orderNumber ?? (await generateSalesOrderNumber(tx));
        const [createdOrder] = await tx
          .insert(salesOrders)
          .values({
            organizationId: orgId,
            orderNumber,
            customerId: customerId!,
            customerName: order.customerName,
            status: order.status,
            orderDate: order.orderDate,
            shipDate: order.shipDate,
            requestedDate: order.requestedDate,
            notes: order.notes,
            subtotalAmount: order.totalAmount,
            taxAmount: "0",
            totalAmount: order.totalAmount,
          })
          .returning({ id: salesOrders.id });

        if (order.lines.length > 0) {
          const createdLines = await tx
            .insert(salesOrderLines)
            .values(order.lines.map((line) => toSalesOrderLineInsert(createdOrder.id, line)))
            .returning({
              salesOrderLineId: salesOrderLines.id,
              itemId: salesOrderLines.itemId,
              quantity: salesOrderLines.quantity,
            });

          await reserveConfirmedImportLinesInTx(
            tx,
            orgId,
            {
              ...order,
              existingOrderNumber: orderNumber,
            },
            createdOrder.id,
            createdLines
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
