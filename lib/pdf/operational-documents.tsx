import type { ReactNode } from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatAddressLines } from "@/lib/addresses";
import { formatDate, formatPrice } from "@/lib/format";
import type { SalesOrderDetail } from "@/lib/sales/types";
import type { ManufacturingOrderDetail } from "@/lib/manufacturing/types";
import type { StocktakeDetail } from "@/lib/dal/stocktake-types";

const styles = StyleSheet.create({
  page: {
    paddingTop: 92,
    paddingHorizontal: 36,
    paddingBottom: 54,
    color: "#111111",
    fontFamily: "Helvetica",
    fontSize: 9,
  },
  header: {
    position: "absolute",
    top: 28,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: "#cccccc",
    paddingBottom: 10,
  },
  title: { fontSize: 17, fontWeight: 700 },
  headerMeta: { textAlign: "right", color: "#555555", lineHeight: 1.4 },
  footer: {
    position: "absolute",
    left: 36,
    right: 36,
    bottom: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    color: "#666666",
    fontSize: 8,
  },
  twoColumn: { flexDirection: "row", gap: 24, marginBottom: 18 },
  column: { flex: 1 },
  label: {
    color: "#666666",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.7,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  addressLine: { marginBottom: 2 },
  section: { marginTop: 14 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#eeeeee",
    borderBottomWidth: 1,
    borderBottomColor: "#cccccc",
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontWeight: 700,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#dddddd",
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  item: { flex: 1, paddingRight: 8 },
  qty: {
    width: 74,
    maxWidth: 74,
    flexShrink: 0,
    paddingLeft: 4,
    textAlign: "right",
  },
  money: { width: 76, textAlign: "right" },
  status: { width: 82, textAlign: "right" },
  sku: { color: "#666666", fontSize: 8, marginTop: 2 },
  totals: { marginTop: 12, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", width: 210, justifyContent: "space-between", marginBottom: 3 },
  strong: { fontWeight: 700 },
  notes: { marginTop: 14, lineHeight: 1.4 },
  writeLine: { borderBottomWidth: 0.5, borderBottomColor: "#aaaaaa", height: 28 },
});

function DocumentPage({
  title,
  organizationName,
  meta,
  children,
}: {
  title: string;
  organizationName: string;
  meta?: string;
  children: ReactNode;
}) {
  const printedOn = new Date().toISOString().slice(0, 10);
  return (
    <Page size="LETTER" style={styles.page}>
      <View style={styles.header} fixed>
        <View>
          <Text style={styles.title}>{title}</Text>
          <Text>{organizationName}</Text>
        </View>
        {meta ? <Text style={styles.headerMeta}>{meta}</Text> : null}
      </View>
      {children}
      <View style={styles.footer} fixed>
        <Text>Printed on {printedOn}</Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
      </View>
    </Page>
  );
}

function AddressBlock({ label, lines }: { label: string; lines: Array<string | null> }) {
  return (
    <View style={styles.column}>
      <Text style={styles.label}>{label}</Text>
      {lines.filter(Boolean).map((line, index) => (
        <Text key={`${line}-${index}`} style={styles.addressLine}>{line}</Text>
      ))}
    </View>
  );
}

export type SalesOrderDocumentTemplate =
  | "sales-order"
  | "sales-order-with-statuses"
  | "sales-order-without-discounts"
  | "packing-list"
  | "packing-list-with-tracing";

function packingQuantity(
  order: SalesOrderDetail,
  line: SalesOrderDetail["lines"][number]
) {
  return order.status === "done" ? line.shippedQuantity : line.remainingQuantity;
}

function lotPlanLabel(
  lot: NonNullable<ManufacturingOrderDetail["ingredients"][number]["lotPickPlan"]>[number]
) {
  return lot.status === "short"
    ? `Unassigned (${lot.quantity} short)`
    : `${lot.lotNumber ?? lot.sourceLabel ?? "Unassigned"} (${lot.quantity})`;
}

function formatQuantityUnit(quantity: string, unit: string) {
  return [quantity, unit].filter(Boolean).join("\n");
}

export function SalesOrderDocument({
  order,
  organizationName,
  template,
}: {
  order: SalesOrderDetail;
  organizationName: string;
  template: SalesOrderDocumentTemplate;
}) {
  const packing = template === "packing-list" || template === "packing-list-with-tracing";
  const showStatuses = template === "sales-order-with-statuses";
  const showDiscounts = template !== "sales-order-without-discounts";
  const title = packing ? `Packing list: ${order.orderNumber}` : `Sales order: ${order.orderNumber}`;
  const shipLines = formatAddressLines({
    line1: order.shipLine1, line2: order.shipLine2, city: order.shipCity,
    region: order.shipRegion, postcode: order.shipPostcode, country: order.shipCountry,
  });
  const billLines = formatAddressLines({
    line1: order.billingLine1, line2: order.billingLine2, city: order.billingCity,
    region: order.billingRegion, postcode: order.billingPostcode, country: order.billingCountry,
  });
  const lines = packing
    ? order.lines.filter((line) => Number(packingQuantity(order, line)) > 0)
    : order.lines;
  return (
    <Document title={title} author={organizationName}>
      <DocumentPage
        title={title}
        organizationName={organizationName}
        meta={`Order date: ${formatDate(order.orderDate)}\nRequested: ${formatDate(order.requestedDate)}\nStatus: ${order.status}`}
      >
        <View style={styles.twoColumn}>
          <AddressBlock label="Customer" lines={[order.customerName, order.contactName, order.contactEmail, order.contactPhone]} />
          <AddressBlock label="Ship to" lines={[order.customerName, ...shipLines]} />
          {!packing ? <AddressBlock label="Bill to" lines={[order.customerName, ...billLines]} /> : null}
        </View>
        <View style={styles.tableHeader} fixed>
          <Text style={styles.item}>Item</Text>
          <Text style={styles.qty}>{packing ? "Quantity" : "Ordered"}</Text>
          {showStatuses ? <Text style={styles.status}>Status</Text> : null}
          {!packing && showDiscounts ? <Text style={styles.qty}>Discount</Text> : null}
          {!packing ? <Text style={styles.money}>Unit price</Text> : null}
          {!packing ? <Text style={styles.money}>Total</Text> : null}
        </View>
        {lines.map((line) => (
          <View key={line.id} style={styles.row} wrap={false}>
            <View style={styles.item}>
              <Text>{line.itemName}</Text>
              {line.itemSku ? <Text style={styles.sku}>{line.itemSku}</Text> : null}
              {template === "packing-list-with-tracing" && line.lotPickPlan?.length ? (
                <Text style={styles.sku}>
                  Lots: {line.lotPickPlan.map((lot) => `${lot.lotNumber ?? "Untracked"} (${lot.quantity})`).join(", ")}
                </Text>
              ) : null}
            </View>
            <Text style={styles.qty}>
              {formatQuantityUnit(packing ? packingQuantity(order, line) : line.quantity, line.unitName)}
            </Text>
            {showStatuses ? <Text style={styles.status}>{line.allocationStatus}</Text> : null}
            {!packing && showDiscounts ? <Text style={styles.qty}>{line.discountPercent}%</Text> : null}
            {!packing ? <Text style={styles.money}>{formatPrice(showDiscounts ? line.listUnitPrice ?? line.unitPrice : line.unitPrice) ?? line.unitPrice}</Text> : null}
            {!packing ? <Text style={styles.money}>{formatPrice(line.lineSubtotal) ?? line.lineSubtotal}</Text> : null}
          </View>
        ))}
        {!packing ? (
          <View style={styles.totals} wrap={false}>
            <View style={styles.totalRow}><Text>Subtotal</Text><Text>{formatPrice(order.subtotalAmount)}</Text></View>
            <View style={styles.totalRow}><Text>Shipping</Text><Text>{formatPrice(order.shippingFeeAmount)}</Text></View>
            <View style={styles.totalRow}><Text>Tax</Text><Text>{formatPrice(order.taxAmount)}</Text></View>
            <View style={styles.totalRow}><Text style={styles.strong}>Total</Text><Text style={styles.strong}>{formatPrice(order.totalAmount)}</Text></View>
          </View>
        ) : null}
        {order.notes ? <View style={styles.notes}><Text style={styles.label}>Notes</Text><Text>{order.notes}</Text></View> : null}
      </DocumentPage>
    </Document>
  );
}

export type ManufacturingOrderDocumentTemplate =
  | "manufacturing-order"
  | "manufacturing-order-without-costs"
  | "manufacturing-order-notes"
  | "manufacturing-order-partial"
  | "manufacturing-order-partial-without-costs"
  | "pick-list";

export function ManufacturingOrderDocument({
  order,
  organizationName,
  template,
}: {
  order: ManufacturingOrderDetail;
  organizationName: string;
  template: ManufacturingOrderDocumentTemplate;
}) {
  const pickList = template === "pick-list";
  const showCosts = template === "manufacturing-order" || template === "manufacturing-order-partial";
  const partial = template.includes("partial");
  const notesSheet = template === "manufacturing-order-notes";
  const title = pickList ? `Pick list: ${order.orderNumber}` : `Manufacturing order: ${order.orderNumber}`;
  const ingredients = pickList
    ? order.ingredients.filter((line) => Number(line.remainingQuantity) > 0)
    : order.ingredients;
  return (
    <Document title={title} author={organizationName}>
      <DocumentPage
        title={title}
        organizationName={organizationName}
        meta={`Product: ${order.productName}\nPlanned: ${order.plannedQuantity} ${order.unitName}\nStatus: ${order.status}`}
      >
        <View style={styles.twoColumn}>
          <AddressBlock label="Product" lines={[order.productName, order.productSku, order.salesOrderNumber, order.salesCustomerName]} />
          <AddressBlock label="Schedule" lines={[`Planned date: ${formatDate(order.plannedDate)}`, `Mode: ${order.manufacturingMode}`, `Pick status: ${order.pickProgressStatus}`]} />
        </View>
        <Text style={styles.label}>Ingredients</Text>
        <View style={styles.tableHeader} fixed>
          <Text style={styles.item}>Ingredient</Text>
          <Text style={styles.qty}>{pickList ? "Remaining" : "Planned"}</Text>
          {partial ? <Text style={styles.qty}>Picked</Text> : null}
          {partial ? <Text style={styles.qty}>Remaining</Text> : null}
          {showCosts ? <Text style={styles.money}>Actual cost</Text> : null}
        </View>
        {ingredients.map((line) => (
          <View key={line.id} style={styles.row} wrap={false}>
            <View style={styles.item}>
              <Text>{line.itemName}</Text>
              {line.itemSku ? <Text style={styles.sku}>{line.itemSku}</Text> : null}
              {pickList && line.lotPickPlan?.length ? (
                <Text style={styles.sku}>
                  Lots: {line.lotPickPlan.map(lotPlanLabel).join(", ")}
                </Text>
              ) : null}
            </View>
            <Text style={styles.qty}>
              {formatQuantityUnit(pickList ? line.remainingQuantity : line.plannedQuantity, line.unitName)}
            </Text>
            {partial ? <Text style={styles.qty}>{line.pickedQuantity}</Text> : null}
            {partial ? <Text style={styles.qty}>{line.remainingQuantity}</Text> : null}
            {showCosts ? <Text style={styles.money}>{line.actualCostTotal ? formatPrice(line.actualCostTotal) : "—"}</Text> : null}
          </View>
        ))}
        {!pickList && order.operationCosts.length ? (
          <View style={styles.section}>
            <Text style={styles.label}>Operations</Text>
            {order.operationCosts.map((operation) => (
              <View key={operation.id} style={styles.row} wrap={false}>
                <Text style={styles.item}>{operation.operationName} · {operation.resourceName}</Text>
                <Text style={styles.qty}>{operation.crewSize} crew</Text>
                <Text style={styles.qty}>{operation.plannedMinutes} min</Text>
                {showCosts ? <Text style={styles.money}>{formatPrice(operation.plannedCostTotal)}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
        {order.notes ? <View style={styles.notes}><Text style={styles.label}>Instructions</Text><Text>{order.notes}</Text></View> : null}
        {notesSheet ? <View style={styles.section}><Text style={styles.label}>Operator notes</Text>{Array.from({ length: 8 }, (_, index) => <View key={index} style={styles.writeLine} />)}</View> : null}
      </DocumentPage>
    </Document>
  );
}

export type StocktakeDocumentTemplate = "count-sheet" | "reconciliation-report";

export function StocktakeDocument({
  stocktake,
  organizationName,
  template,
}: {
  stocktake: StocktakeDetail;
  organizationName: string;
  template: StocktakeDocumentTemplate;
}) {
  const countSheet = template === "count-sheet";
  const title = countSheet ? `Stocktake count sheet: ${stocktake.name}` : `Stocktake reconciliation: ${stocktake.name}`;
  return (
    <Document title={title} author={organizationName}>
      <DocumentPage title={title} organizationName={organizationName} meta={`Status: ${stocktake.status}\nCreated: ${stocktake.createdAt.toISOString().slice(0, 10)}`}>
        <View style={styles.tableHeader} fixed>
          <Text style={styles.item}>Item / lot</Text>
          <Text style={styles.qty}>{countSheet ? "Count" : "Expected"}</Text>
          {!countSheet ? <Text style={styles.qty}>Counted</Text> : null}
          {!countSheet ? <Text style={styles.qty}>Variance</Text> : null}
          <Text style={styles.status}>Notes</Text>
        </View>
        {stocktake.lines.flatMap((line) => {
          const rows = line.lots.length ? line.lots.map((lot) => ({
            key: lot.id, name: `${line.itemName} · Lot ${lot.lotNumber}`, sku: line.itemSku,
            expected: lot.expectedQty, counted: lot.countedQty, variance: lot.varianceQty, notes: lot.notes,
          })) : [{ key: line.id, name: line.itemName, sku: line.itemSku, expected: line.expectedQty, counted: line.countedQty, variance: line.varianceQty, notes: line.notes }];
          return rows.map((row) => (
            <View key={row.key} style={styles.row} wrap={false}>
              <View style={styles.item}><Text>{row.name}</Text>{row.sku ? <Text style={styles.sku}>{row.sku}</Text> : null}</View>
              <Text style={styles.qty}>{countSheet ? "____________" : row.expected}</Text>
              {!countSheet ? <Text style={styles.qty}>{row.counted ?? "—"}</Text> : null}
              {!countSheet ? <Text style={styles.qty}>{row.variance ?? "—"}</Text> : null}
              <Text style={styles.status}>{row.notes ?? ""}</Text>
            </View>
          ));
        })}
        {stocktake.reason || stocktake.notes ? <View style={styles.notes}><Text style={styles.label}>Context</Text><Text>{[stocktake.reason, stocktake.notes].filter(Boolean).join("\n")}</Text></View> : null}
      </DocumentPage>
    </Document>
  );
}
