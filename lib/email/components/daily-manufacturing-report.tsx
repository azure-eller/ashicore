import {
  Body,
  Head,
  Html,
  Img,
  Preview,
} from "@react-email/components";
import type { CSSProperties } from "react";
import type { DailyManufacturingReportPayload } from "@/lib/reports/daily-manufacturing-schema";
import { buildSparklineUrl, sparklineImageSize } from "@/lib/reports/sparkline";
import { formatQuantity } from "@/lib/format";

type TrendPoint = {
  date: string;
  quantity: string;
};

type NumericPoint = {
  date: string;
  value: number;
};

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
                    <ProductTypeSection rows={payload.outputByProductType} baseUrl={payload.erpUrl} />
                    <OutputSection rows={payload.outputByProduct} baseUrl={payload.erpUrl} />
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

function ProductTypeSection({
  rows,
  baseUrl,
}: {
  rows: DailyManufacturingReportPayload["outputByProductType"];
  baseUrl: string;
}) {
  return (
    <tr>
      <td className="section-pad" style={sectionCell}>
        <SectionHeader title="Output by product type" meta="90-day trend" />
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.category}>
                <td style={index === rows.length - 1 ? chartCardCellLast : chartCardCell}>
                  <ChartCard row={row} baseUrl={baseUrl} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

function ChartCard({
  row,
  baseUrl,
}: {
  row: DailyManufacturingReportPayload["outputByProductType"][number];
  baseUrl: string;
}) {
  const series = toNumericPoints(row.ninetyDayTrend);
  const last30 = sumPoints(series.slice(-30));
  const prior30 = sumPoints(series.slice(-60, -30));
  const delta = prior30 > 0 ? (last30 - prior30) / prior30 : 0;
  const today = series[series.length - 1]?.value ?? 0;

  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={chartCard}>
      <tbody>
        <tr>
          <td style={chartCardInner}>
            <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
              <tbody>
                <tr>
                  <td valign="top">
                    <div style={chartTitle}>{row.label}</div>
                    <div style={chartSub}>{row.unit}</div>
                  </td>
                  <td align="right" valign="top">
                    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} className="chart-stats">
                      <tbody>
                        <tr>
                          <StatCell label="Today" value={formatNumber(today)} />
                          <StatCell label="Last 30 days" value={formatNumber(last30)} />
                          <StatCell
                            label="Vs prior 30"
                            value={`${delta > 0 ? "↗" : delta < 0 ? "↘" : "→"} ${formatPercent(delta)}`}
                            valueStyle={deltaText(delta)}
                          />
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td colSpan={2} style={chartArea}>
                    <SparklineImage
                      baseUrl={baseUrl}
                      data={series}
                      color={row.color}
                      width={520}
                      height={124}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function StatCell({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string;
  valueStyle?: CSSProperties;
}) {
  return (
    <td align="right" valign="top" className="stat-cell" style={statCell}>
      <div style={statLabel}>{label}</div>
      <div style={{ ...statValue, ...valueStyle }}>{value}</div>
    </td>
  );
}

function OutputSection({
  rows,
  baseUrl,
}: {
  rows: DailyManufacturingReportPayload["outputByProduct"];
  baseUrl: string;
}) {
  const productMeta = `${rows.length} ${rows.length === 1 ? "product" : "products"} · 30-day trend`;

  return (
    <tr>
      <td className="section-pad" style={sectionCell}>
        <SectionHeader title="Output by product" meta={productMeta} />
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={productTable}>
          <tbody>
            <tr style={productHeadRow}>
              <th align="left" style={productHeadCellFirst}>Product</th>
              <th align="right" style={productHeadCell}>Today</th>
              <th align="right" className="hide-sm" style={productHeadCellLast}>30-day</th>
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
                  <td align="right" className="hide-sm" style={sparkCell(index === rows.length - 1)}>
                    <ProductSparkline row={row} baseUrl={baseUrl} />
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
  );
}

function ProductSparkline({
  row,
  baseUrl,
}: {
  row: DailyManufacturingReportPayload["outputByProduct"][number];
  baseUrl: string;
}) {
  const series = toNumericPoints(row.thirtyDayTrend);
  const delta = splitWindowDelta(series);

  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} align="right">
      <tbody>
        <tr>
          <td style={sparklineSvgCell}>
            <SparklineImage
              baseUrl={baseUrl}
              data={series}
              color={row.color}
              width={sparklineImageSize.width}
              height={sparklineImageSize.height}
            />
          </td>
          <td align="right" style={{ ...sparkDelta, ...deltaText(delta, true) }}>
            {formatPercent(delta)}
          </td>
        </tr>
      </tbody>
    </table>
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

function SparklineImage({
  baseUrl,
  data,
  color,
  width,
  height,
}: {
  baseUrl: string;
  data: NumericPoint[];
  color: string;
  width: number;
  height: number;
}) {
  const values = data.map((point) => point.value);
  const src = buildSparklineUrl({ baseUrl, values, color });
  return (
    <Img
      src={src}
      width={width}
      height={height}
      alt=""
      style={{
        display: "block",
        height,
        maxWidth: "100%",
        width,
      }}
    />
  );
}

function toNumericPoints(points: TrendPoint[]): NumericPoint[] {
  return points.map((point) => {
    const value = Number(point.quantity);
    return {
      date: point.date,
      value: Number.isFinite(value) ? value : 0,
    };
  });
}

function sumPoints(points: NumericPoint[]) {
  return points.reduce((sum, point) => sum + point.value, 0);
}

function splitWindowDelta(points: NumericPoint[]) {
  const half = Math.floor(points.length / 2);
  const first = sumPoints(points.slice(0, half));
  const second = sumPoints(points.slice(half));
  return first > 0 ? (second - first) / first : 0;
}

function deltaText(delta: number, neutralMuted = false): CSSProperties {
  if (delta > 0.02) return { color: "#2F7A3D" };
  if (delta < -0.02) return { color: "#B03A2E" };
  return { color: neutralMuted ? "#94A3B8" : "#0F172A" };
}

function formatPercent(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return "0%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(0)}%`;
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
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
  .chart-stats { width: 100% !important; margin-top: 12px !important; }
  .stat-cell { padding-left: 0 !important; padding-right: 14px !important; }
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

const chartCardCell: CSSProperties = {
  paddingBottom: 16,
};

const chartCardCellLast: CSSProperties = {
  paddingBottom: 0,
};

const chartCard: CSSProperties = {
  border: "1px solid #E6E8EC",
  borderRadius: 12,
  width: "100%",
};

const chartCardInner: CSSProperties = {
  padding: "16px 18px 12px",
};

const chartTitle: CSSProperties = {
  color: "#0F172A",
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: "-0.005em",
  lineHeight: "22px",
};

const chartSub: CSSProperties = {
  color: "#64748B",
  fontSize: 12,
  lineHeight: "18px",
};

const statCell: CSSProperties = {
  paddingLeft: 24,
};

const statLabel: CSSProperties = {
  color: "#64748B",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.08em",
  lineHeight: "14px",
  textTransform: "uppercase",
};

const statValue: CSSProperties = {
  color: "#0F172A",
  fontSize: 18,
  fontVariantNumeric: "tabular-nums",
  fontWeight: 600,
  letterSpacing: "-0.01em",
  lineHeight: "24px",
};

const chartArea: CSSProperties = {
  padding: "14px 6px 0",
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

function sparkCell(isLast: boolean): CSSProperties {
  return {
    borderBottom: isLast ? "0" : "1px solid #F1F3F7",
    padding: "13px 14px",
    paddingRight: 14,
    textAlign: "right",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
    width: "1%",
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

const sparklineSvgCell: CSSProperties = {
  paddingRight: 10,
};

const sparkDelta: CSSProperties = {
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
  fontWeight: 500,
  lineHeight: "16px",
  minWidth: 44,
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
