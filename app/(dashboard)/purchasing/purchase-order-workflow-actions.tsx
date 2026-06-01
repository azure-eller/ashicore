"use client";

import {
  FileDollarIcon,
  FileViewIcon,
  Mail01Icon,
} from "@hugeicons/core-free-icons";
import type { StatusBlockTone } from "@/components/ui/status-block";
import {
  StatusActionMenu,
  StatusActionMenuItem,
} from "@/components/card-page/status-action-menu";

type PurchaseOrderEmailStatus = "sent" | "failed" | "skipped" | "pending" | null;
type PurchaseBillStatus = "pending" | "pushed" | "failed" | null;

const TONE_SWATCH: Record<StatusBlockTone, string> = {
  success: "bg-[var(--color-success-solid)]",
  warning: "bg-[var(--color-warning-solid)]",
  danger: "bg-[var(--color-danger-solid)]",
  muted: "bg-[var(--color-muted-solid)]",
};

function xeroBillHref(externalId?: string | null) {
  return externalId
    ? `https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=${encodeURIComponent(externalId)}`
    : "https://go.xero.com/AccountsPayable/";
}

function emailDisplay(status: PurchaseOrderEmailStatus): {
  label: string;
  tone: StatusBlockTone;
} {
  if (status === "sent") return { label: "Sent", tone: "success" };
  if (status === "failed") return { label: "Failed", tone: "danger" };
  if (status === "pending") return { label: "Sending", tone: "warning" };
  return { label: "Not sent", tone: "muted" };
}

function billDisplay(status: PurchaseBillStatus): {
  label: string;
  tone: StatusBlockTone;
} {
  if (status === "pushed") return { label: "Bill created", tone: "success" };
  if (status === "failed") return { label: "Bill failed", tone: "danger" };
  if (status === "pending") return { label: "Creating bill", tone: "warning" };
  return { label: "Not billed", tone: "muted" };
}

export function PurchaseOrderEmailActionControl({
  orderId,
  status,
  supplierEmail,
  error,
  disabled = false,
  onSend,
}: {
  orderId?: string | null;
  status: PurchaseOrderEmailStatus;
  supplierEmail?: string | null;
  error?: string | null;
  disabled?: boolean;
  onSend: () => void;
}) {
  const display = emailDisplay(status);
  const sendDisabled =
    disabled || !orderId || status === "pending" || !supplierEmail;
  const title =
    error ??
    (!supplierEmail
      ? "Supplier has no email on file."
      : supplierEmail ?? undefined);

  return (
    <StatusActionMenu
      label={display.label}
      tone={display.tone}
      ariaLabel="Supplier email actions"
      title={title}
      disabled={disabled || !orderId}
    >
      <StatusActionMenuItem
        active
        swatchClassName={TONE_SWATCH[display.tone]}
      >
        {display.label}
      </StatusActionMenuItem>
      <StatusActionMenuItem
        icon={Mail01Icon}
        disabled={sendDisabled}
        onSelect={onSend}
      >
        {status === "sent" ? "Resend PO" : "Send PO"}
      </StatusActionMenuItem>
      {orderId ? (
        <StatusActionMenuItem
          icon={FileViewIcon}
          href={`/api/purchase-orders/${orderId}/pdf`}
          target="_blank"
          rel="noreferrer"
        >
          View PDF
        </StatusActionMenuItem>
      ) : null}
    </StatusActionMenu>
  );
}

export function PurchaseBillActionControl({
  status,
  externalId,
  externalNumber,
  disabled = false,
  disabledReason,
  onCreate,
}: {
  status: PurchaseBillStatus;
  externalId?: string | null;
  externalNumber?: string | null;
  disabled?: boolean;
  disabledReason?: string | null;
  onCreate: () => void;
}) {
  const display = billDisplay(status);
  const createDisabled = disabled || status === "pending" || status === "pushed";

  return (
    <StatusActionMenu
      label={display.label}
      tone={display.tone}
      ariaLabel="Bill actions"
      title={disabledReason ?? externalNumber ?? undefined}
    >
      <StatusActionMenuItem
        active
        swatchClassName={TONE_SWATCH[display.tone]}
      >
        {display.label}
      </StatusActionMenuItem>
      {status === "pushed" ? (
        <StatusActionMenuItem
          icon={FileDollarIcon}
          href={xeroBillHref(externalId)}
          target="_blank"
          rel="noreferrer"
        >
          {externalNumber ?? "Open in Xero"}
        </StatusActionMenuItem>
      ) : (
        <StatusActionMenuItem
          icon={FileDollarIcon}
          disabled={createDisabled}
          onSelect={onCreate}
        >
          {status === "failed" ? "Retry bill" : "Create bill"}
        </StatusActionMenuItem>
      )}
    </StatusActionMenu>
  );
}
