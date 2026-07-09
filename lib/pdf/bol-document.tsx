import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { formatAddressLines } from "@/lib/addresses";
import { dateInTimeZone, formatDate } from "@/lib/format";

const borderColor = "#333333";
const mutedColor = "#555555";

const styles = StyleSheet.create({
  page: {
    padding: 24,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#111111",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 8,
    gap: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  subtitle: {
    marginTop: 2,
    fontSize: 8,
    color: mutedColor,
  },
  metaGrid: {
    width: 190,
    borderWidth: 1,
    borderColor,
    borderStyle: "solid",
  },
  row: {
    flexDirection: "row",
  },
  cell: {
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor,
    borderStyle: "solid",
    padding: 4,
    minHeight: 28,
  },
  lastCell: {
    borderRightWidth: 0,
  },
  label: {
    fontSize: 6,
    color: mutedColor,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  value: {
    fontSize: 8,
    lineHeight: 1.25,
  },
  strong: {
    fontWeight: 700,
  },
  box: {
    borderWidth: 1,
    borderColor,
    borderStyle: "solid",
    marginBottom: 7,
  },
  sectionHeader: {
    paddingHorizontal: 4,
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderColor,
    borderStyle: "solid",
    fontSize: 7,
    fontWeight: 700,
    textTransform: "uppercase",
    backgroundColor: "#eeeeee",
  },
  addressCell: {
    flex: 1,
    padding: 5,
    minHeight: 74,
    borderRightWidth: 1,
    borderColor,
    borderStyle: "solid",
  },
  noRightBorder: {
    borderRightWidth: 0,
  },
  chargeTerms: {
    flexDirection: "row",
    gap: 12,
    padding: 5,
    borderTopWidth: 1,
    borderColor,
    borderStyle: "solid",
  },
  checkbox: {
    fontSize: 8,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor,
    borderStyle: "solid",
    backgroundColor: "#eeeeee",
  },
  tableRow: {
    flexDirection: "row",
    minHeight: 29,
    borderBottomWidth: 1,
    borderColor,
    borderStyle: "solid",
  },
  tableCell: {
    padding: 4,
    borderRightWidth: 1,
    borderColor,
    borderStyle: "solid",
  },
  packages: { width: 52 },
  type: { width: 44 },
  description: { flex: 1 },
  weight: { width: 54 },
  hm: { width: 28, textAlign: "center" },
  nmfc: { width: 48 },
  classCol: { width: 40 },
  legalRow: {
    flexDirection: "row",
    gap: 7,
    marginBottom: 7,
  },
  legalBox: {
    flex: 1,
    borderWidth: 1,
    borderColor,
    borderStyle: "solid",
    padding: 5,
    minHeight: 78,
  },
  legalText: {
    fontSize: 6.25,
    lineHeight: 1.18,
  },
  noteText: {
    fontSize: 6.5,
    color: mutedColor,
    lineHeight: 1.2,
  },
  signatureCell: {
    flex: 1,
    padding: 5,
    minHeight: 42,
    borderRightWidth: 1,
    borderColor,
    borderStyle: "solid",
  },
  signatureLine: {
    marginTop: 15,
    borderTopWidth: 1,
    borderColor,
    borderStyle: "solid",
    paddingTop: 3,
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
  xeroInvoiceNumber: string | null;
  customerName: string;
  contactName: string | null;
  contactTitle: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  requestedDate: string | null;
  timeZone: string;
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

function bolDate(order: BolOrder) {
  if (order.shippedAt) {
    return formatDate(dateInTimeZone(new Date(order.shippedAt), order.timeZone));
  }
  if (order.scheduledDate) return formatDate(order.scheduledDate);
  if (order.requestedDate) return formatDate(order.requestedDate);
  return formatDate(dateInTimeZone(new Date(), order.timeZone));
}

function filledLines(lines: BolLine[]) {
  return Array.from({ length: Math.max(6, lines.length) }, (_, index) => lines[index] ?? null);
}

function orderReference(order: BolOrder) {
  return [
    order.orderNumber,
    order.xeroInvoiceNumber ? `Invoice ${order.xeroInvoiceNumber}` : null,
  ].filter(Boolean).join(" / ");
}

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
  const contactLines = [
    order.contactName
      ? order.contactTitle
        ? `${order.contactName}, ${order.contactTitle}`
        : order.contactName
      : null,
    order.contactPhone ? `Phone: ${order.contactPhone}` : null,
    order.contactEmail ? `Email: ${order.contactEmail}` : null,
  ].filter((line): line is string => line != null);
  const dateDisplay = bolDate(order);
  const rows = filledLines(lines);

  return (
    <Document
      title={`BOL ${order.orderNumber}`}
      author={organizationName}
      subject={`Straight bill of lading for ${order.orderNumber}`}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.title}>Straight Bill of Lading - Short Form</Text>
            <Text style={styles.subtitle}>Original - Not Negotiable | Non-Hazardous Material Only</Text>
          </View>
          <View style={styles.metaGrid}>
            <View style={styles.row}>
              <View style={[styles.cell, { flex: 1 }]}>
                <Text style={styles.label}>Date</Text>
                <Text style={styles.value}>{dateDisplay}</Text>
              </View>
              <View style={[styles.cell, styles.lastCell, { flex: 1 }]}>
                <Text style={styles.label}>BOL / Shipper No.</Text>
                <Text style={styles.value}>{order.orderNumber}</Text>
              </View>
            </View>
            <View style={styles.row}>
              <View style={[styles.cell, { flex: 1 }]}>
                <Text style={styles.label}>Carrier Name</Text>
              </View>
              <View style={[styles.cell, styles.lastCell, { flex: 1 }]}>
                <Text style={styles.label}>Carrier No. / PRO</Text>
              </View>
            </View>
            <View style={styles.row}>
              <View style={[styles.cell, { flex: 1, borderBottomWidth: 0 }]}>
                <Text style={styles.label}>Trailer No.</Text>
              </View>
              <View style={[styles.cell, styles.lastCell, { flex: 1, borderBottomWidth: 0 }]}>
                <Text style={styles.label}>Seal No. / SCAC</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.box}>
          <View style={styles.row}>
            <View style={styles.addressCell}>
              <Text style={styles.label}>Ship From</Text>
              <Text style={[styles.value, styles.strong]}>{organizationName}</Text>
            </View>
            <View style={[styles.addressCell, styles.noRightBorder]}>
              <Text style={styles.label}>Ship To / Consignee</Text>
              <Text style={[styles.value, styles.strong]}>{order.customerName}</Text>
              {shipLines.map((line, index) => (
                <Text key={index} style={styles.value}>{line}</Text>
              ))}
              {contactLines.map((line, index) => (
                <Text key={index} style={styles.value}>{line}</Text>
              ))}
            </View>
          </View>
          <View style={styles.chargeTerms}>
            <Text style={styles.checkbox}>Freight charge terms: [x] Prepaid [ ] Collect [ ] 3rd Party</Text>
            <Text style={styles.checkbox}>Master BOL: [ ] Yes [x] No</Text>
            <Text style={styles.checkbox}>FOB: [ ]</Text>
          </View>
        </View>

        <View style={styles.box}>
          <Text style={styles.sectionHeader}>Customer Order Information</Text>
          <View style={styles.row}>
            <View style={[styles.cell, { flex: 1, borderBottomWidth: 0 }]}>
              <Text style={styles.label}>Customer Order No.</Text>
              <Text style={styles.value}>{orderReference(order)}</Text>
            </View>
            <View style={[styles.cell, { width: 64, borderBottomWidth: 0 }]}>
              <Text style={styles.label}># Pkgs.</Text>
            </View>
            <View style={[styles.cell, { width: 70, borderBottomWidth: 0 }]}>
              <Text style={styles.label}>Weight</Text>
            </View>
            <View style={[styles.cell, styles.lastCell, { flex: 1, borderBottomWidth: 0 }]}>
              <Text style={styles.label}>Special Instructions</Text>
              <Text style={styles.value}>{order.notes ?? ""}</Text>
            </View>
          </View>
        </View>

        <View style={styles.box}>
          <Text style={styles.sectionHeader}>Carrier Information</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.packages, styles.label]}>Pkg Qty</Text>
            <Text style={[styles.tableCell, styles.type, styles.label]}>Type</Text>
            <Text style={[styles.tableCell, styles.description, styles.label]}>Commodity Description / Special Marks</Text>
            <Text style={[styles.tableCell, styles.weight, styles.label]}>Weight</Text>
            <Text style={[styles.tableCell, styles.hm, styles.label]}>H.M.</Text>
            <Text style={[styles.tableCell, styles.nmfc, styles.label]}>NMFC</Text>
            <Text style={[styles.tableCell, styles.classCol, styles.lastCell, styles.label]}>Class</Text>
          </View>
          {rows.map((line, index) => (
            <View key={index} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.packages]}>{line?.quantity ?? ""}</Text>
              <Text style={[styles.tableCell, styles.type]}>{line?.unitName ?? ""}</Text>
              <View style={[styles.tableCell, styles.description]}>
                <Text style={styles.value}>{line?.itemName ?? ""}</Text>
                {line?.itemSku ? <Text style={styles.noteText}>{line.itemSku}</Text> : null}
              </View>
              <Text style={[styles.tableCell, styles.weight]} />
              <Text style={[styles.tableCell, styles.hm]} />
              <Text style={[styles.tableCell, styles.nmfc]} />
              <Text style={[styles.tableCell, styles.classCol, styles.lastCell]} />
            </View>
          ))}
          <View style={[styles.row, { minHeight: 28 }]}>
            <View style={[styles.tableCell, { flex: 1 }]}>
              <Text style={styles.noteText}>
                Commodities requiring special or additional care in handling or stowing must be marked and packaged to ensure safe transportation with ordinary care. Where the rate depends on value, the shipper must state the agreed or declared value in writing.
              </Text>
            </View>
            <View style={[styles.tableCell, styles.lastCell, { width: 120 }]}>
              <Text style={styles.label}>COD Amt. / Fee Terms</Text>
            </View>
          </View>
        </View>

        <View style={styles.legalRow}>
          <View style={styles.legalBox}>
            <Text style={[styles.label, styles.strong]}>Bill of Lading Terms</Text>
            <Text style={styles.legalText}>
              RECEIVED, subject to individually determined rates or contracts agreed upon in writing between the carrier and shipper, if applicable, otherwise to the rates, classifications, rules, and applicable state and federal regulations, the property described above in apparent good order, except as noted, contents and condition of packages unknown. Carrier agrees to carry to destination or deliver to another carrier on the route. Every service performed under this bill of lading is subject to the terms and conditions of the Uniform Domestic Straight Bill of Lading and applicable carrier tariff or classification.
            </Text>
          </View>
          <View style={styles.legalBox}>
            <Text style={[styles.label, styles.strong]}>Certifications / Liability</Text>
            <Text style={styles.legalText}>
              This is to certify that the above named materials are properly classified, described, packaged, marked, and labeled, and are in proper condition for transportation according to applicable DOT regulations. Subject to Section 7, if this shipment is delivered without recourse to the consignor, the carrier shall not make delivery without payment of freight and all other lawful charges. Liability limitation for loss or damage may apply. See 49 U.S.C. 14706(c)(1)(A) and (B).
            </Text>
          </View>
        </View>

        <View style={styles.box}>
          <View style={styles.row}>
            <View style={styles.signatureCell}>
              <Text style={styles.label}>Shipper Signature</Text>
              <Text style={styles.signatureLine}>Date</Text>
            </View>
            <View style={styles.signatureCell}>
              <Text style={styles.label}>Carrier Signature / Pickup Date</Text>
              <Text style={styles.signatureLine}>Carrier acknowledges receipt of packages in apparent good order, except as noted.</Text>
            </View>
            <View style={[styles.signatureCell, styles.noRightBorder]}>
              <Text style={styles.label}>Trailer Loaded / Freight Counted</Text>
              <Text style={styles.value}>[ ] By shipper   [ ] By driver</Text>
              <Text style={styles.value}>[ ] Driver/pallets said to contain</Text>
              <Text style={styles.value}>[ ] Driver/pieces</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
