import "server-only";

import { escapeHtml, formatCurrency, formatQuantity as formatDisplayQuantity } from "@/lib/format";

export type AccountingDocumentEmailLine = {
  description: string;
  quantity: string | null;
  unitLabel?: string | null;
  amount: string;
};

export type AccountingDocumentEmailInput = {
  documentType: "invoice" | "purchase-order";
  documentNumber: string;
  issuerName: string;
  recipientName: string;
  totalAmount: string;
  dueDate?: string | null;
  actionUrl?: string | null;
  lines: AccountingDocumentEmailLine[];
};

const EMAIL_BG = "#f3f3f1";
const EMAIL_SURFACE = "#ffffff";
const EMAIL_SURFACE_ALT = "#fafaf8";
const EMAIL_INK = "#13161b";
const EMAIL_INK_2 = "#3a3f48";
const EMAIL_MUTED = "#6a707a";
const EMAIL_LINE = "#dcdcd6";
const EMAIL_LINE_2 = "#e8e8e3";
const EMAIL_ACCENT = "#1c3d6b";
const EMAIL_ACCENT_TEXT = "#ffffff";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatMoney(value: string): string {
  return formatCurrency(value, "USD") ?? value;
}

function formatDateLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormat.format(date);
}

function formatQuantity(value: string | null): string {
  if (!value) return "";
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? formatDisplayQuantity(value) : value;
}

function buildInvoiceSchema(params: AccountingDocumentEmailInput) {
  if (params.documentType !== "invoice" || !params.actionUrl) return "";

  const schema = {
    "@context": "http://schema.org",
    "@type": "EmailMessage",
    "publisher": {
      "@type": "Organization",
      "name": params.issuerName,
    },
    "about": {
      "@type": "Invoice",
      "accountId": params.documentNumber,
      "minimumPaymentDue": {
        "@type": "PriceSpecification",
        "price": parseFloat(params.totalAmount),
        "priceCurrency": "USD",
      },
      "totalPaymentDue": {
        "@type": "PriceSpecification",
        "price": parseFloat(params.totalAmount),
        "priceCurrency": "USD",
      },
      "paymentDueDate": params.dueDate ?? undefined,
      "provider": {
        "@type": "Organization",
        "name": params.issuerName,
      },
    },
    "potentialAction": {
      "@type": "ViewAction",
      "name": "View invoice",
      "target": params.actionUrl,
    },
  };

  return `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>`;
}

export function buildAccountingDocumentEmail(params: AccountingDocumentEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const noun = params.documentType === "invoice" ? "invoice" : "purchase order";
  const title = params.documentType === "invoice" ? "Invoice" : "Purchase Order";
  const actionLabel = params.documentType === "invoice" ? "View invoice" : "PDF attached";
  const totalLabel = params.documentType === "invoice" ? "Amount Due" : "Order Total";
  const dueLabel = formatDateLabel(params.dueDate);
  const total = formatMoney(params.totalAmount);
  const escapedTitle = escapeHtml(title);
  const escapedIssuer = escapeHtml(params.issuerName);
  const escapedRecipient = escapeHtml(params.recipientName);
  const escapedNumber = escapeHtml(params.documentNumber);
  const escapedTotal = escapeHtml(total);
  const escapedDue = dueLabel ? escapeHtml(dueLabel) : null;
  const escapedActionUrl = params.actionUrl ? escapeHtml(params.actionUrl) : null;
  const subject =
    params.documentType === "invoice"
      ? `Invoice ${params.documentNumber} from ${params.issuerName} for ${params.recipientName}`
      : `Purchase order ${params.documentNumber} from ${params.issuerName}`;

  const rows = params.lines
    .map((line) => {
      const quantity = formatQuantity(line.quantity);
      const unit = line.unitLabel ? ` ${line.unitLabel}` : "";
      const quantityLabel = quantity ? `${escapeHtml(quantity)}${escapeHtml(unit)}` : "";
      return [
        "<tr>",
        `<td style="padding:14px 0;border-top:1px solid ${EMAIL_LINE_2};color:${EMAIL_INK};font-size:14px;line-height:20px;">${escapeHtml(line.description)}${quantityLabel ? `<div style="color:${EMAIL_MUTED};font-size:12px;line-height:18px;">${quantityLabel}</div>` : ""}</td>`,
        `<td style="padding:14px 0;border-top:1px solid ${EMAIL_LINE_2};color:${EMAIL_INK};font-size:14px;line-height:20px;text-align:right;white-space:nowrap;">${escapeHtml(formatMoney(line.amount))}</td>`,
        "</tr>",
      ].join("");
    })
    .join("");

  const cta = params.actionUrl
    ? `<a href="${escapedActionUrl}" style="display:block;background:${EMAIL_ACCENT};color:${EMAIL_ACCENT_TEXT};font-size:15px;font-weight:700;line-height:20px;padding:14px 18px;text-align:center;text-decoration:none;">${escapeHtml(actionLabel)}</a>`
    : `<div style="background:${EMAIL_INK};color:${EMAIL_ACCENT_TEXT};font-size:15px;font-weight:700;line-height:20px;padding:14px 18px;text-align:center;">${escapeHtml(actionLabel)}</div>`;

  const bodyCopy =
    params.documentType === "invoice"
      ? `Your ${noun} ${params.documentNumber} is ready.`
      : `Please review purchase order ${params.documentNumber}. The PDF is attached.`;

  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />',
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
    buildInvoiceSchema(params),
    "</head>",
    `<body style="margin:0;background:${EMAIL_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${EMAIL_INK};">`,
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">',
    `${escapedTitle} ${escapedNumber} for ${escapedTotal}`,
    "</div>",
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${EMAIL_BG};width:100%;">`,
    '<tr><td align="center" style="padding:40px 16px;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;width:100%;margin-bottom:16px;"><tr><td>',
    `<span style="display:inline-block;width:24px;background:${EMAIL_ACCENT};color:${EMAIL_ACCENT_TEXT};font-size:13px;font-weight:700;line-height:24px;text-align:center;margin-right:10px;">a</span>`,
    `<span style="color:${EMAIL_INK};font-size:17px;font-weight:700;line-height:24px;">ashicore</span>`,
    "</td></tr></table>",
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${EMAIL_SURFACE};border:1px solid ${EMAIL_LINE};max-width:580px;width:100%;">`,
    `<tr><td style="background:${EMAIL_SURFACE_ALT};border-bottom:1px solid ${EMAIL_LINE};padding:30px;text-align:left;">`,
    `<div style="color:${EMAIL_MUTED};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapedIssuer}</div>`,
    `<h1 style="color:${EMAIL_INK};font-size:24px;line-height:30px;margin:16px 0 10px;">${escapedTitle}</h1>`,
    `<div style="color:${EMAIL_INK};font-size:34px;font-weight:700;line-height:40px;margin:0;">${escapedTotal} <span style="font-size:14px;font-weight:700;">USD</span></div>`,
    escapedDue
      ? `<div style="color:${EMAIL_INK};font-size:14px;font-weight:700;line-height:20px;margin-top:12px;">Due ${escapedDue}</div>`
      : "",
    `<div style="color:${EMAIL_MUTED};font-size:13px;line-height:20px;margin-top:2px;">${escapedTitle} #: ${escapedNumber}</div>`,
    "</td></tr>",
    `<tr><td style="padding:0 30px 24px;">${cta}</td></tr>`,
    '<tr><td style="padding:0 30px 8px;">',
    `<p style="color:${EMAIL_INK_2};font-size:15px;line-height:23px;margin:0 0 18px;">Hi ${escapedRecipient},</p>`,
    `<p style="color:${EMAIL_INK_2};font-size:15px;line-height:23px;margin:0 0 18px;">${escapeHtml(bodyCopy)}</p>`,
    params.actionUrl
      ? `<p style="color:${EMAIL_INK_2};font-size:14px;line-height:22px;margin:0 0 24px;">View online: <a href="${escapedActionUrl}" style="color:${EMAIL_ACCENT};text-decoration:underline;">${escapedActionUrl}</a></p>`
      : `<p style="color:${EMAIL_INK_2};font-size:14px;line-height:22px;margin:0 0 24px;">A PDF copy is attached to this email.</p>`,
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">',
    `<tr><th align="left" style="color:${EMAIL_INK};font-size:13px;line-height:18px;padding:0 0 12px;text-align:left;">Description</th><th align="right" style="color:${EMAIL_INK};font-size:13px;line-height:18px;padding:0 0 12px;text-align:right;">Amount</th></tr>`,
    rows,
    '<tr>',
    `<td style="padding:16px 0;border-top:1px solid ${EMAIL_LINE};color:${EMAIL_INK};font-size:16px;font-weight:700;">${escapeHtml(totalLabel)}</td>`,
    `<td style="padding:16px 0;border-top:1px solid ${EMAIL_LINE};color:${EMAIL_INK};font-size:20px;font-weight:700;text-align:right;white-space:nowrap;">USD ${escapedTotal}</td>`,
    "</tr>",
    "</table>",
    "</td></tr>",
    params.actionUrl
      ? `<tr><td style="padding:22px 30px 34px;">${cta}</td></tr>`
      : '<tr><td style="padding:0 30px 34px;"></td></tr>',
    "</table>",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("");

  const textLines = [
    `${title} ${params.documentNumber}`,
    `${params.issuerName}`,
    "",
    `Hi ${params.recipientName},`,
    "",
    bodyCopy,
    "",
    `${totalLabel}: ${total} USD`,
    dueLabel ? `Due: ${dueLabel}` : null,
    params.actionUrl ? `View online: ${params.actionUrl}` : "PDF attached.",
    "",
    "Lines:",
    ...params.lines.map((line) => {
      const quantity = formatQuantity(line.quantity);
      const unit = line.unitLabel ? ` ${line.unitLabel}` : "";
      const quantityLabel = quantity ? ` (${quantity}${unit})` : "";
      return `- ${line.description}${quantityLabel}: ${formatMoney(line.amount)}`;
    }),
  ].filter((line): line is string => line != null);

  return {
    subject,
    html,
    text: textLines.join("\n"),
  };
}
