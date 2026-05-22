import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { formatAddressLines } from "@/lib/format";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111111",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
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
    borderBottomWidth: 1,
    borderBottomColor: "#999999",
    borderBottomStyle: "solid",
    marginVertical: 10,
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
  contactBlock: {
    marginTop: 6,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#333333",
    borderBottomStyle: "solid",
    paddingBottom: 4,
    marginBottom: 4,
    fontWeight: 700,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#dddddd",
    borderBottomStyle: "solid",
  },
  colDesc: { flex: 1 },
  colQty: { width: 52, paddingRight: 8, textAlign: "right" },
  colUnit: { width: 120, paddingLeft: 8 },
  footer: {
    marginTop: 30,
    fontSize: 9,
    color: "#666666",
  },
  signatureRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 40,
    fontSize: 9,
  },
  signatureBox: {
    borderTopWidth: 1,
    borderTopColor: "#333333",
    borderTopStyle: "solid",
    width: "45%",
    paddingTop: 4,
  },
});

export type BolLine = {
  itemName: string;
  itemSku: string | null;
  quantity: string;
  unitName: string;
};

export type BolOrder = {
  orderNumber: string;
  shipmentNumber?: string | null;
  customerName: string;
  contactName: string | null;
  contactTitle: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  requestedDate: string | null;
  scheduledDate?: string | null;
  shippedAt: Date | null;
  notes: string | null;
  status?: string | null;
  fulfillmentType?: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
};

export function BillOfLadingDocument({
  order,
  lines,
  organizationName,
}: {
  order: BolOrder;
  lines: BolLine[];
  organizationName: string;
}) {
  const shipLines = formatAddressLines({
    line1: order.shipLine1,
    line2: order.shipLine2,
    city: order.shipCity,
    region: order.shipRegion,
    postcode: order.shipPostcode,
    country: order.shipCountry,
  });

  const shippedDisplay = order.shippedAt
    ? new Date(order.shippedAt).toLocaleDateString("en-US")
    : "\u2014";
  const title = "Bill of Lading";
  const contactLines = [
    order.contactName
      ? `${order.contactTitle ? `${order.contactName}, ${order.contactTitle}` : order.contactName}`
      : null,
    order.contactPhone ? `Phone: ${order.contactPhone}` : null,
    order.contactEmail ? `Email: ${order.contactEmail}` : null,
  ].filter((line): line is string => line != null);

  return (
    <Document
      title={`BOL ${order.shipmentNumber ?? order.orderNumber}`}
      author={organizationName}
      subject={`${title} for ${order.shipmentNumber ?? order.orderNumber}`}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{title}</Text>
            <Text>{organizationName}</Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaLine}>Order: {order.orderNumber}</Text>
            {order.shipmentNumber && (
              <Text style={styles.metaLine}>Shipment: {order.shipmentNumber}</Text>
            )}
            {order.fulfillmentType && (
              <Text style={styles.metaLine}>
                Type: {order.fulfillmentType === "pickup" ? "Pickup" : "Delivery"}
              </Text>
            )}
            <Text style={styles.metaLine}>Shipped: {shippedDisplay}</Text>
            {order.scheduledDate && (
              <Text style={styles.metaLine}>
                Ship date: {new Date(`${order.scheduledDate}T00:00:00`).toLocaleDateString("en-US")}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.twoCol}>
          <View style={styles.col}>
            <Text style={styles.colLabel}>Sold To</Text>
            <Text style={styles.addressLine}>{order.customerName}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.colLabel}>Ship To</Text>
            {shipLines.length > 0 ? (
              shipLines.map((line, index) => (
                <Text key={index} style={styles.addressLine}>
                  {line}
                </Text>
              ))
            ) : (
              <Text style={styles.addressLine}>{order.customerName}</Text>
            )}
            {contactLines.length > 0 && (
              <View style={styles.contactBlock}>
                <Text style={styles.colLabel}>Contact</Text>
                {contactLines.map((line, index) => (
                  <Text key={index} style={styles.addressLine}>
                    {line}
                  </Text>
                ))}
              </View>
            )}
          </View>
        </View>

        <View style={styles.tableHeader}>
          <Text style={styles.colDesc}>Item</Text>
          <Text style={styles.colQty}>Qty</Text>
          <Text style={styles.colUnit}>Unit</Text>
        </View>

        {lines.map((line, index) => (
          <View key={index} style={styles.tableRow}>
            <View style={styles.colDesc}>
              <Text>{line.itemName}</Text>
              {line.itemSku && (
                <Text style={{ fontSize: 8, color: "#666666" }}>{line.itemSku}</Text>
              )}
            </View>
            <Text style={styles.colQty}>{line.quantity}</Text>
            <Text style={styles.colUnit}>{line.unitName}</Text>
          </View>
        ))}

        {order.notes && (
          <View style={styles.footer}>
            <Text style={styles.colLabel}>Notes</Text>
            <Text>{order.notes}</Text>
          </View>
        )}

        <View style={styles.signatureRow}>
          <View style={styles.signatureBox}>
            <Text>Driver signature</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text>Received by</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
