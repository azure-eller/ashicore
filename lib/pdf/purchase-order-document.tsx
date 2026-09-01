import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { formatAddressLines } from "@/lib/addresses";
import { formatDate, formatPrice, formatUnitPrice } from "@/lib/format";

const styles = StyleSheet.create({
  page: {
    paddingTop: 94,
    paddingHorizontal: 36,
    paddingBottom: 54,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111111",
  },
  header: {
    position: "absolute",
    top: 30,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
  },
  meta: {
    fontSize: 10,
    textAlign: "right",
  },
  metaLine: {
    marginBottom: 2,
  },
  divider: {
    position: "absolute",
    top: 76,
    left: 36,
    right: 36,
    borderBottomWidth: 1,
    borderBottomColor: "#cccccc",
    borderBottomStyle: "solid",
  },
  twoCol: {
    flexDirection: "row",
    gap: 20,
    marginBottom: 16,
  },
  col: {
    flex: 1,
  },
  colLabel: {
    fontSize: 9,
    textTransform: "uppercase",
    color: "#666666",
    marginBottom: 4,
  },
  addressLine: {
    marginBottom: 2,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#eeeeee",
    borderWidth: 0.5,
    borderColor: "#cccccc",
    borderBottomStyle: "solid",
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontWeight: 700,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#dddddd",
    borderBottomStyle: "solid",
  },
  colItem: { flex: 1 },
  lineCode: {
    fontSize: 9,
    color: "#444444",
    marginTop: 1,
  },
  colQty: {
    width: 82,
    maxWidth: 82,
    flexShrink: 0,
    paddingLeft: 4,
    paddingRight: 8,
    textAlign: "right",
  },
  colPrice: { width: 72, paddingRight: 8, textAlign: "right" },
  colTax: { width: 48, paddingRight: 8, textAlign: "right" },
  colTotal: { width: 82, textAlign: "right" },
  colExpected: { width: 72, textAlign: "right" },
  section: {
    marginTop: 14,
  },
  totals: {
    marginTop: 12,
    alignItems: "flex-end",
  },
  totalRow: {
    flexDirection: "row",
    width: 180,
    justifyContent: "space-between",
    marginBottom: 3,
  },
  totalLabel: {
    color: "#666666",
  },
  totalValue: {
    fontWeight: 700,
  },
  footer: {
    position: "absolute",
    left: 36,
    right: 36,
    bottom: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#666666",
  },
});

export type PurchaseOrderPdfLine = {
  itemName: string;
  itemSku: string | null;
  supplierItemCode: string | null;
  purchaseUnitName: string;
  quantityOrdered: string;
  quantityReceived?: string;
  unitCost: string;
  taxRatePercent: string;
  lineTotal: string;
};

export type PurchaseOrderDocumentTemplate =
  | "purchase-order"
  | "request-for-quote"
  | "put-away-list"
  | "costs";

export type PurchaseOrderPdfAdditionalCost = {
  costType: string;
  reference: string | null;
  amount: string;
};

export type PurchaseOrderPdf = {
  orderNumber: string;
  supplierName: string;
  supplierContactName: string | null;
  supplierEmail: string | null;
  supplierPhone: string | null;
  supplierBillingLine1: string | null;
  supplierBillingLine2: string | null;
  supplierBillingCity: string | null;
  supplierBillingRegion: string | null;
  supplierBillingPostcode: string | null;
  supplierBillingCountry: string | null;
  expectedDate: string | null;
  orderedAt: Date | null;
  deliveryInstructions: string | null;
  shipContactName: string | null;
  shipContactPhone: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  subtotalAmount: string;
  taxAmount: string;
  totalAmount: string;
};

function formatQuantity(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed.toString() : value;
}

function formatPercent(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? `${parsed.toString()}%` : value;
}

function formatCostType(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatQuantityUnit(quantity: string, unit: string) {
  return [formatQuantity(quantity), unit].filter(Boolean).join("\n");
}

export function PurchaseOrderDocument({
  order,
  lines,
  additionalCosts = [],
  organizationName,
  template = "purchase-order",
}: {
  order: PurchaseOrderPdf;
  lines: PurchaseOrderPdfLine[];
  additionalCosts?: PurchaseOrderPdfAdditionalCost[];
  organizationName: string;
  template?: PurchaseOrderDocumentTemplate;
}) {
  const supplierLines = [
    order.supplierName,
    order.supplierContactName,
    order.supplierEmail,
    ...formatAddressLines({
      line1: order.supplierBillingLine1,
      line2: order.supplierBillingLine2,
      city: order.supplierBillingCity,
      region: order.supplierBillingRegion,
      postcode: order.supplierBillingPostcode,
      country: order.supplierBillingCountry,
    }),
  ].filter((line): line is string => Boolean(line));
  const shipLines = formatAddressLines({
    line1: order.shipLine1,
    line2: order.shipLine2,
    city: order.shipCity,
    region: order.shipRegion,
    postcode: order.shipPostcode,
    country: order.shipCountry,
  });
  const orderedDisplay = order.orderedAt
    ? order.orderedAt.toLocaleDateString("en-US")
    : "\u2014";
  const printedDisplay = new Date().toISOString().slice(0, 10);
  const title =
    template === "request-for-quote"
      ? `Request for quote: ${order.orderNumber}`
      : template === "put-away-list"
        ? `Received inventory summary: ${order.orderNumber}`
        : `Purchase order: ${order.orderNumber}`;
  const showPrices = template === "purchase-order" || template === "costs";
  const showStandardLines = template !== "costs";

  return (
    <Document
      title={`Purchase Order ${order.orderNumber}`}
      author={organizationName}
      subject={`Purchase order ${order.orderNumber}`}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.title}>
              {title}
            </Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaLine}>PO date: {orderedDisplay}</Text>
            <Text style={styles.metaLine}>Expected arrival: {formatDate(order.expectedDate)}</Text>
          </View>
        </View>

        <View style={styles.divider} fixed />

        <View style={styles.header} fixed>
          <View>
            <Text
              style={styles.title}
              render={({ pageNumber, totalPages }) =>
                pageNumber === totalPages ? title : ""
              }
            />
          </View>
          <View style={styles.meta}>
            <Text
              style={styles.metaLine}
              render={({ pageNumber, totalPages }) =>
                pageNumber === totalPages ? `PO date: ${orderedDisplay}` : ""
              }
            />
            <Text
              style={styles.metaLine}
              render={({ pageNumber, totalPages }) =>
                pageNumber === totalPages
                  ? `Expected arrival: ${formatDate(order.expectedDate)}`
                  : ""
              }
            />
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={styles.col}>
            <Text style={styles.colLabel}>Supplier</Text>
            {supplierLines.map((line, index) => (
              <Text key={index} style={styles.addressLine}>
                {line}
              </Text>
            ))}
            {order.supplierPhone ? (
              <Text style={[styles.addressLine, { marginTop: 10 }]}>
                Phone: {order.supplierPhone}
              </Text>
            ) : null}
            <Text style={[styles.colLabel, { marginTop: 14 }]}>Bill to</Text>
            <Text style={styles.addressLine}>{organizationName}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.colLabel}>Ship to</Text>
            <Text style={styles.addressLine}>{organizationName}</Text>
            {order.shipContactName ? (
              <Text style={styles.addressLine}>{order.shipContactName}</Text>
            ) : null}
            {order.shipContactPhone ? (
              <Text style={styles.addressLine}>{order.shipContactPhone}</Text>
            ) : null}
            {shipLines.length > 0 ? (
              shipLines.map((line, index) => (
                <Text key={index} style={styles.addressLine}>
                  {line}
                </Text>
              ))
            ) : null}
          </View>
        </View>

        {showStandardLines ? (
          <>
            <View style={styles.tableHeader} fixed>
              <Text style={styles.colItem}>Item</Text>
              <Text style={styles.colQty}>Quantity</Text>
              {template === "put-away-list" ? (
                <Text style={styles.colQty}>Received</Text>
              ) : null}
              {showPrices ? <Text style={styles.colPrice}>Unit price</Text> : null}
              {showPrices ? <Text style={styles.colTotal}>Total</Text> : null}
              {showPrices ? <Text style={styles.colTax}>Tax</Text> : null}
              <Text style={styles.colExpected}>Exp. arrival</Text>
            </View>

            {lines.map((line, index) => (
              <View key={index} style={styles.tableRow} wrap={false}>
                <View style={styles.colItem}>
                  <Text>{line.itemName}</Text>
                  {/* Supplier's own code first — it is the one they recognise. */}
                  {line.supplierItemCode ? (
                    <Text style={styles.lineCode}>
                      Supplier code: {line.supplierItemCode}
                    </Text>
                  ) : null}
                  {line.itemSku ? (
                    <Text style={styles.lineCode}>SKU: {line.itemSku}</Text>
                  ) : null}
                </View>
                <Text style={styles.colQty}>
                  {formatQuantityUnit(line.quantityOrdered, line.purchaseUnitName)}
                </Text>
                {template === "put-away-list" ? (
                  <Text style={styles.colQty}>
                    {formatQuantityUnit(line.quantityReceived ?? "0", line.purchaseUnitName)}
                  </Text>
                ) : null}
                {showPrices ? (
                  <Text style={styles.colPrice}>
                    {formatUnitPrice(line.unitCost) ?? line.unitCost}
                  </Text>
                ) : null}
                {showPrices ? (
                  <Text style={styles.colTotal}>
                    {formatPrice(line.lineTotal) ?? line.lineTotal}
                  </Text>
                ) : null}
                {showPrices ? (
                  <Text style={styles.colTax}>{formatPercent(line.taxRatePercent)}</Text>
                ) : null}
                <Text style={styles.colExpected}>
                  {formatDate(order.expectedDate)}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {showPrices && additionalCosts.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.colLabel}>
              {template === "purchase-order" ? "Other items" : "Items"}
            </Text>
            {additionalCosts.map((cost, index) => (
              <View key={index} style={styles.tableRow} wrap={false}>
                <Text style={styles.colItem}>
                  {cost.reference
                    ? `${formatCostType(cost.costType)} - ${cost.reference}`
                    : formatCostType(cost.costType)}
                </Text>
                <Text style={styles.colTotal}>
                  {formatPrice(cost.amount) ?? cost.amount}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {showPrices ? <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text>{formatPrice(order.subtotalAmount) ?? order.subtotalAmount}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax</Text>
            <Text>{formatPrice(order.taxAmount) ?? order.taxAmount}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>
              {formatPrice(order.totalAmount) ?? order.totalAmount}
            </Text>
          </View>
        </View> : null}

        {order.deliveryInstructions ? (
          <View style={styles.section}>
            <Text style={styles.colLabel}>Additional info</Text>
            <Text>{order.deliveryInstructions}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>Printed on {printedDisplay}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber}/${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
