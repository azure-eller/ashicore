import {
  Body,
  Head,
  Html,
  Preview,
} from "@react-email/components";
import type { DailyManufacturingReportPayload } from "@/lib/reports/daily-manufacturing-schema";
import { formatQuantity } from "@/lib/format";
import {
  buildSparklineUrl,
  getSparklineTrendColor,
  sparklineImageSize,
} from "@/lib/reports/sparkline";

export function DailyManufacturingReportEmail({
  payload,
}: {
  payload: DailyManufacturingReportPayload;
}) {
  const date = formatLongDate(payload.reportDate);
  const generatedAt = formatGeneratedAt(payload.generatedAt, payload.timeZone);
  const outputRows = payload.outputByProduct.slice(0, 5);
  const materialRows = payload.materialsConsumed.slice(0, 5);
  const preheader = `${payload.summary.productsWithRecordedOutput} products with recorded output · ${payload.summary.shipmentsShipped} shipments · ${date}`;

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
                  width="660"
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  className="container"
                  style={container}
                >
                  <tbody>
                    <HeroSection payload={payload} date={date} />
                    <OutputSection
                      rows={outputRows}
                      totalRows={payload.outputByProduct.length}
                      dashboardUrl={payload.erpUrl}
                    />
                    <MaterialsSection rows={materialRows} />
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

function HeroSection({
  payload,
  date,
}: {
  payload: DailyManufacturingReportPayload;
  date: string;
}) {
  const batchOutputRollup = formatQuantityRollup(
    payload.completedBatches.map((row) => ({ quantity: row.totalOutput, unit: row.unit }))
  );
  const materialRollup = formatQuantityRollup(
    payload.materialsConsumed.map((row) => ({ quantity: row.quantity, unit: row.unit }))
  );
  const outputUnitCount = countUnits(
    payload.outputByProduct.map((row) => row.unit)
  );
  const outputFoot =
    outputUnitCount > 0
      ? `${outputUnitCount} output ${outputUnitCount === 1 ? "unit type" : "unit types"}`
      : "No output recorded";

  return (
    <tr>
      <td className="hero-pad" style={heroCell}>
        <div style={heroEyebrow}>Daily Manufacturing · {payload.organizationName}</div>
        <div style={heroDate}>{date}</div>
        <div style={heroSub}>
          24-hour close · {payload.summary.productsWithRecordedOutput} products with recorded output
        </div>

        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={tileWrap}>
          <tbody>
            <tr>
              <KpiTile
                label="Output"
                value={payload.summary.productsWithRecordedOutput}
                foot={outputFoot}
                outerStyle={firstTile}
              />
              <KpiTile
                label="Batches"
                value={payload.summary.completedBatches}
                foot={batchOutputRollup.footer}
                outerStyle={middleTile}
              />
              <KpiTile
                label="Shipments"
                value={payload.summary.shipmentsShipped}
                foot={`${formatMoney(payload.summary.shippedLineValue)} line value`}
                outerStyle={middleTile}
              />
              <KpiTile
                label="Materials"
                value={payload.summary.materialsConsumedFromRecordedOutputs}
                foot={materialRollup.footer}
                outerStyle={lastTile}
              />
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  );
}

function KpiTile({
  label,
  value,
  foot,
  outerStyle,
}: {
  label: string;
  value: number | string;
  foot: string;
  outerStyle: React.CSSProperties;
}) {
  return (
    <td valign="top" width="25%" className="tile" style={outerStyle}>
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={tileTable}>
        <tbody>
          <tr>
            <td style={tileCell}>
              <div style={tileLabel}>{label}</div>
              <div style={tileValue}>
                {typeof value === "number" ? formatInteger(value) : value}
              </div>
              <div style={tileFoot}>{foot}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </td>
  );
}

function OutputSection({
  rows,
  totalRows,
  dashboardUrl,
}: {
  rows: DailyManufacturingReportPayload["outputByProduct"];
  totalRows: number;
  dashboardUrl: string;
}) {
  const dashboardOrigin = getOrigin(dashboardUrl);
  const productMeta =
    totalRows > rows.length
      ? `${rows.length} of ${totalRows} products`
      : `${totalRows} ${totalRows === 1 ? "product" : "products"}`;

  return (
    <>
      <SectionHeader
        title="Output by product"
        meta={`${productMeta} · 7-day trend`}
        topPadding={28}
      />
      <tr>
        <td className="body-pad" style={cardCell}>
          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={cardTable}>
            <tbody>
              <tr style={tableHeadRow}>
                <th align="left" style={headCell}>Product</th>
                <th align="right" style={headCellRight}>Output</th>
                <th align="right" className="hide-sm" style={headCellRight}>7-day</th>
              </tr>
              {rows.length > 0 ? (
                rows.map((row, index) => (
                  <tr key={`${row.productName}-${row.unit}`}>
                    <td style={bodyCell(index === rows.length - 1)}>
                      <div style={nameText}>{row.productName}</div>
                      <div style={skuText}>{row.productSku ?? "No SKU"}</div>
                    </td>
                    <td align="right" style={numberCell(index === rows.length - 1, true)}>
                      {formatQuantity(row.quantity)} {row.unit}
                    </td>
                    <td align="right" className="hide-sm" style={trendCell(index === rows.length - 1)}>
                      <SparklineImage row={row} baseUrl={dashboardOrigin} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} style={emptyCell}>No output recorded.</td>
                </tr>
              )}
            </tbody>
          </table>
        </td>
      </tr>
    </>
  );
}

function SparklineImage({
  row,
  baseUrl,
}: {
  row: DailyManufacturingReportPayload["outputByProduct"][number];
  baseUrl: string;
}) {
  const values = row.sevenDayTrend.map((point) => point.quantity);
  const numericValues = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const color = getSparklineTrendColor(numericValues);
  const src = buildSparklineUrl({ baseUrl, values, color });

  return (
    // eslint-disable-next-line @next/next/no-img-element -- Email clients need a plain img tag.
    <img
      src={src}
      width={sparklineImageSize.width}
      height={sparklineImageSize.height}
      alt={`7-day trend for ${row.productSku ?? row.productName}, ending at ${formatQuantity(row.quantity)} ${row.unit}`}
      style={sparklineImage}
    />
  );
}

function MaterialsSection({
  rows,
}: {
  rows: DailyManufacturingReportPayload["materialsConsumed"];
}) {
  return (
    <>
      <SectionHeader
        title="Materials consumed"
        meta="From recorded outputs"
        topPadding={28}
      />
      <tr>
        <td className="body-pad" style={cardCell}>
          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={cardTable}>
            <tbody>
              {rows.length > 0 ? (
                rows.map((row, index) => (
                  <tr key={`${row.materialName}-${row.unit}`}>
                    <td style={bodyCell(index === rows.length - 1)}>
                      <div style={nameText}>{row.materialName}</div>
                      <div style={skuText}>{row.materialSku ?? "No SKU"}</div>
                    </td>
                    <td align="right" style={numberCell(index === rows.length - 1, true)}>
                      {formatQuantity(row.quantity)} {row.unit}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td style={emptyCell}>No materials consumed from recorded outputs.</td>
                </tr>
              )}
            </tbody>
          </table>
        </td>
      </tr>
    </>
  );
}

function SectionHeader({
  title,
  meta,
  topPadding,
}: {
  title: string;
  meta: string;
  topPadding: number;
}) {
  return (
    <tr>
      <td className="body-pad" style={{ padding: `${topPadding}px 32px 0` }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
          <tbody>
            <tr>
              <td style={sectionTitle}>{title}</td>
              <td align="right" style={sectionMeta}>{meta}</td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
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
      <td className="body-pad" style={footerCell}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={footerTable}>
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

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatMoney(value: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function formatQuantityRollup(rows: Array<{ quantity: string; unit: string }>) {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity)) continue;
    totals.set(row.unit, (totals.get(row.unit) ?? 0) + quantity);
  }

  const entries = Array.from(totals.entries());
  if (entries.length === 0) {
    return { primary: "0", footer: "No quantity recorded" };
  }

  const [unit, quantity] = entries[0];
  const formatted = `${formatQuantity(String(quantity))} ${unit}`;

  if (entries.length === 1) {
    return { primary: formatQuantity(String(quantity)), footer: formatted };
  }

  return {
    primary: formatted,
    footer: `+ ${entries.length - 1} more ${entries.length === 2 ? "unit type" : "unit types"}`,
  };
}

function countUnits(units: string[]) {
  return new Set(units.filter(Boolean)).size;
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

function getOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "http://localhost:3000";
  }
}

const emailCss = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
body, table, td, th, div, a { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
table { border-collapse: collapse !important; }
img { -ms-interpolation-mode: bicubic; border: 0; line-height: 100%; outline: none; text-decoration: none; display: block; }
@media screen and (max-width: 680px) {
  .container { width: 100% !important; border-radius: 0 !important; border-left: 0 !important; border-right: 0 !important; }
  .hero-pad, .body-pad { padding-left: 20px !important; padding-right: 20px !important; }
  .tile { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; padding-bottom: 8px !important; }
  .hide-sm { display: none !important; }
}
`;

const body: React.CSSProperties = {
  backgroundColor: "#EEF1F5",
  margin: 0,
  padding: 0,
};

const preheaderStyle: React.CSSProperties = {
  color: "#EEF1F5",
  display: "none",
  fontSize: 1,
  lineHeight: "1px",
  maxHeight: 0,
  overflow: "hidden",
};

const outerTable: React.CSSProperties = {
  backgroundColor: "#EEF1F5",
};

const outerCell: React.CSSProperties = {
  padding: "24px 12px",
};

const container: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #E2E8F0",
  borderRadius: 12,
  boxShadow: "0 16px 40px -24px rgba(15,23,42,.18)",
  overflow: "hidden",
  width: 660,
};

const heroCell: React.CSSProperties = {
  backgroundColor: "#0F2A54",
  backgroundImage: "linear-gradient(180deg,#0F2A54 0%,#133769 100%)",
  color: "#FFFFFF",
  padding: "24px 32px 28px",
};

const heroEyebrow: React.CSSProperties = {
  color: "#9FB3D9",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "1.1px",
  lineHeight: "16px",
  textTransform: "uppercase",
};

const heroDate: React.CSSProperties = {
  color: "#FFFFFF",
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: "-0.4px",
  lineHeight: "26px",
  marginTop: 4,
};

const heroSub: React.CSSProperties = {
  color: "#9FB3D9",
  fontSize: 12,
  lineHeight: "18px",
  marginTop: 4,
};

const tileWrap: React.CSSProperties = {
  marginTop: 20,
};

const firstTile: React.CSSProperties = {
  paddingRight: 5,
};

const middleTile: React.CSSProperties = {
  paddingLeft: 5,
  paddingRight: 5,
};

const lastTile: React.CSSProperties = {
  paddingLeft: 5,
};

const tileTable: React.CSSProperties = {
  backgroundColor: "#1A3D6E",
  border: "1px solid #264C7C",
  borderRadius: 8,
};

const tileCell: React.CSSProperties = {
  padding: "12px 14px",
};

const tileLabel: React.CSSProperties = {
  color: "#9FB3D9",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.8px",
  lineHeight: "14px",
  textTransform: "uppercase",
};

const tileValue: React.CSSProperties = {
  color: "#FFFFFF",
  fontSize: 22,
  fontVariantNumeric: "tabular-nums",
  fontWeight: 700,
  letterSpacing: "-0.4px",
  lineHeight: "28px",
  marginTop: 4,
};

const tileFoot: React.CSSProperties = {
  color: "#C7D5EE",
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
  lineHeight: "16px",
  marginTop: 2,
};

const sectionTitle: React.CSSProperties = {
  color: "#0F172A",
  fontSize: 13,
  fontWeight: 600,
  lineHeight: "18px",
};

const sectionMeta: React.CSSProperties = {
  color: "#64748B",
  fontSize: 12,
  lineHeight: "18px",
};

const cardCell: React.CSSProperties = {
  padding: "10px 32px 0",
};

const cardTable: React.CSSProperties = {
  border: "1px solid #E2E8F0",
  borderRadius: 10,
  overflow: "hidden",
  width: "100%",
};

const tableHeadRow: React.CSSProperties = {
  backgroundColor: "#F8FAFC",
};

const headCell: React.CSSProperties = {
  borderBottom: "1px solid #E2E8F0",
  color: "#64748B",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.6px",
  lineHeight: "14px",
  padding: "8px 12px",
  textTransform: "uppercase",
};

const headCellRight: React.CSSProperties = {
  ...headCell,
  textAlign: "right",
};

function bodyCell(isLast: boolean): React.CSSProperties {
  return {
    borderBottom: isLast ? "0" : "1px solid #EEF2F7",
    padding: 12,
    verticalAlign: "middle",
  };
}

function numberCell(isLast: boolean, primary: boolean): React.CSSProperties {
  return {
    borderBottom: isLast ? "0" : "1px solid #EEF2F7",
    color: primary ? "#0F172A" : "#64748B",
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
    fontWeight: primary ? 600 : 400,
    lineHeight: "18px",
    padding: 12,
    textAlign: "right",
    verticalAlign: "middle",
  };
}

function trendCell(isLast: boolean): React.CSSProperties {
  return {
    borderBottom: isLast ? "0" : "1px solid #EEF2F7",
    padding: 12,
    textAlign: "right",
    verticalAlign: "middle",
  };
}

const sparklineImage: React.CSSProperties = {
  background: "transparent",
  border: 0,
  display: "inline-block",
  height: 22,
  lineHeight: "100%",
  outline: "none",
  textDecoration: "none",
  width: 92,
};

const nameText: React.CSSProperties = {
  color: "#0F172A",
  fontSize: 13,
  fontWeight: 600,
  lineHeight: "18px",
};

const skuText: React.CSSProperties = {
  color: "#64748B",
  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 11,
  lineHeight: "16px",
  marginTop: 2,
};

const emptyCell: React.CSSProperties = {
  color: "#64748B",
  fontSize: 13,
  lineHeight: "18px",
  padding: 16,
  textAlign: "center",
};

const footerCell: React.CSSProperties = {
  padding: "24px 32px 28px",
};

const footerTable: React.CSSProperties = {
  borderTop: "1px solid #E2E8F0",
};

const footerText: React.CSSProperties = {
  color: "#64748B",
  fontSize: 11,
  lineHeight: "16px",
  paddingTop: 18,
};

const footerLink: React.CSSProperties = {
  color: "#2563EB",
  fontWeight: 600,
  textDecoration: "none",
};
