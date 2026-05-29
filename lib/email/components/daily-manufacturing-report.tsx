import {
  Body,
  Head,
  Html,
  Preview,
} from "@react-email/components";
import type { CSSProperties } from "react";
import type { DailyManufacturingReportPayload } from "@/lib/reports/daily-manufacturing-schema";
import { formatQuantity } from "@/lib/format";

export function DailyManufacturingReportEmail({
  payload,
}: {
  payload: DailyManufacturingReportPayload;
}) {
  const date = formatLongDate(payload.reportDate);
  const generatedAt = formatGeneratedAt(payload.generatedAt, payload.timeZone);
  const productCount = payload.outputByProduct.length;
  const preheader = `${productCount} ${productCount === 1 ? "product" : "products"} with recorded output · ${date}`;

  return (
    <Html lang="en">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="x-apple-disable-message-reformatting" />
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <style>{emailCss}</style>
      </Head>
      <Preview>{preheader}</Preview>
      <Body style={body}>
        <div style={preheaderStyle}>{preheader}</div>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={outerTable}>
          <tbody>
            <tr>
              <td align="center" style={outerCell}>
                <table
                  role="presentation"
                  width="680"
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  className="container"
                  style={container}
                >
                  <tbody>
                    <Header payload={payload} date={date} />
                    <OutputSection rows={payload.outputByProduct} />
                    <Footer generatedAt={generatedAt} dashboardUrl={payload.erpUrl} />
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}

function Header({
  payload,
  date,
}: {
  payload: DailyManufacturingReportPayload;
  date: string;
}) {
  const productCount = payload.outputByProduct.length;

  return (
    <tr>
      <td className="section-pad" style={headerCell}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
          <tbody>
            <tr>
              <td valign="bottom" style={headerMain}>
                <div style={headerEyebrow}>Daily Manufacturing · {payload.organizationName}</div>
                <div style={headerTitle}>{date}</div>
              </td>
              <td valign="bottom" align="right" className="header-meta" style={headerMeta}>
                24-hour close · {productCount} {productCount === 1 ? "product" : "products"}
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  );
}

function OutputSection({
  rows,
}: {
  rows: DailyManufacturingReportPayload["outputByProduct"];
}) {
  const productMeta = `${rows.length} ${rows.length === 1 ? "sellable product" : "sellable products"}`;

  return (
    <tr>
      <td className="section-pad" style={sectionCell}>
        <SectionHeader title="Sellable output" meta={productMeta} />
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={productTable}>
          <tbody>
            <tr style={productHeadRow}>
              <th align="left" style={productHeadCellFirst}>Product</th>
              <th align="right" style={productHeadCellLast}>Output</th>
            </tr>
            {rows.length > 0 ? (
              rows.map((row, index) => (
                <tr key={`${row.productName}-${row.productSku ?? ""}-${row.unit}`}>
                  <td style={productCell(index === rows.length - 1)}>
                    <div style={productName}>{row.productName}</div>
                    <div style={productSku}>{row.productSku ?? "No SKU"}</div>
                  </td>
                  <td align="right" style={todayCell(index === rows.length - 1)}>
                    <div style={todayValue}>{formatQuantity(row.quantity)}</div>
                    <div style={todayUnit}>{row.unit}</div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={2} style={emptyCell}>No sellable output recorded.</td>
              </tr>
            )}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

function SectionHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={sectionHeaderTable}>
      <tbody>
        <tr>
          <td style={sectionTitle}>{title}</td>
          <td align="right" style={sectionMeta}>{meta}</td>
        </tr>
      </tbody>
    </table>
  );
}

function Footer({
  generatedAt,
  dashboardUrl,
}: {
  generatedAt: string;
  dashboardUrl: string;
}) {
  return (
    <tr>
      <td className="section-pad" style={footerCell}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
          <tbody>
            <tr>
              <td style={footerText}>Generated {generatedAt} · ashicore ERP</td>
              <td align="right" style={footerText}>
                <a href={dashboardUrl} style={footerLink}>
                  Open dashboard →
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  );
}


function formatLongDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatGeneratedAt(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

const sansStack = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const monoStack = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const emailCss = `
body, table, td, th, div, a { font-family: ${sansStack}; }
table { border-collapse: collapse !important; }
@media screen and (max-width: 700px) {
  .container { width: 100% !important; border-radius: 0 !important; }
  .section-pad { padding-left: 20px !important; padding-right: 20px !important; }
  .header-meta { display: block !important; width: 100% !important; text-align: left !important; padding-top: 8px !important; }
  .hide-sm { display: none !important; }
}
`;

const body: CSSProperties = {
  backgroundColor: "#EEF0F3",
  margin: 0,
  padding: 0,
};

const preheaderStyle: CSSProperties = {
  color: "#EEF0F3",
  display: "none",
  fontSize: 1,
  lineHeight: "1px",
  maxHeight: 0,
  overflow: "hidden",
};

const outerTable: CSSProperties = {
  backgroundColor: "#EEF0F3",
};

const outerCell: CSSProperties = {
  padding: "24px 12px",
};

const container: CSSProperties = {
  backgroundColor: "#FFFFFF",
  borderRadius: 14,
  boxShadow: "0 1px 0 rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.04)",
  overflow: "hidden",
  width: 680,
};

const headerCell: CSSProperties = {
  borderBottom: "1px solid #F1F3F7",
  padding: "24px 28px 18px",
};

const headerMain: CSSProperties = {
  paddingRight: 24,
};

const headerEyebrow: CSSProperties = {
  color: "#64748B",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.12em",
  lineHeight: "15px",
  textTransform: "uppercase",
};

const headerTitle: CSSProperties = {
  color: "#0F172A",
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  lineHeight: "28px",
  marginTop: 6,
};

const headerMeta: CSSProperties = {
  color: "#64748B",
  fontSize: 12,
  lineHeight: "18px",
  paddingBottom: 4,
  whiteSpace: "nowrap",
};

const sectionCell: CSSProperties = {
  borderBottom: "1px solid #F1F3F7",
  padding: "22px 28px",
};

const sectionHeaderTable: CSSProperties = {
  marginBottom: 14,
};

const sectionTitle: CSSProperties = {
  color: "#0F172A",
  fontSize: 15,
  fontWeight: 600,
  letterSpacing: "-0.005em",
  lineHeight: "20px",
};

const sectionMeta: CSSProperties = {
  color: "#64748B",
  fontSize: 12,
  lineHeight: "18px",
};

const productTable: CSSProperties = {
  width: "100%",
};

const productHeadRow: CSSProperties = {
  backgroundColor: "#F7F8FB",
};

const productHeadCellFirst: CSSProperties = {
  borderBottom: "1px solid #F1F3F7",
  borderTop: "1px solid #F1F3F7",
  color: "#64748B",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.08em",
  lineHeight: "14px",
  padding: "8px 14px",
  textTransform: "uppercase",
};

const productHeadCell: CSSProperties = {
  ...productHeadCellFirst,
  textAlign: "right",
};

const productHeadCellLast: CSSProperties = {
  ...productHeadCell,
  paddingRight: 14,
};

function productCell(isLast: boolean): CSSProperties {
  return {
    borderBottom: isLast ? "0" : "1px solid #F1F3F7",
    padding: "13px 14px",
    verticalAlign: "middle",
  };
}

function todayCell(isLast: boolean): CSSProperties {
  return {
    borderBottom: isLast ? "0" : "1px solid #F1F3F7",
    padding: "13px 14px",
    textAlign: "right",
    verticalAlign: "middle",
  };
}

const productName: CSSProperties = {
  color: "#0F172A",
  fontSize: 14,
  fontWeight: 600,
  lineHeight: "19px",
};

const productSku: CSSProperties = {
  color: "#64748B",
  fontFamily: monoStack,
  fontSize: 11,
  lineHeight: "15px",
  marginTop: 2,
};

const todayValue: CSSProperties = {
  color: "#0F172A",
  fontSize: 14,
  fontVariantNumeric: "tabular-nums",
  fontWeight: 600,
  lineHeight: "18px",
};

const todayUnit: CSSProperties = {
  color: "#64748B",
  fontSize: 11,
  fontWeight: 500,
  lineHeight: "15px",
};

const emptyCell: CSSProperties = {
  color: "#64748B",
  fontSize: 13,
  lineHeight: "18px",
  padding: 16,
  textAlign: "center",
};

const footerCell: CSSProperties = {
  padding: "14px 28px 18px",
};

const footerText: CSSProperties = {
  color: "#64748B",
  fontSize: 12,
  lineHeight: "18px",
};

const footerLink: CSSProperties = {
  color: "#1E3A8A",
  fontWeight: 500,
  textDecoration: "none",
};
