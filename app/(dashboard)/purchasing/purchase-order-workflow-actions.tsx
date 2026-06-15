"use client";

import {
  FileDollarIcon,
  FileViewIcon,
  Mail01Icon,
} from "@hugeicons/core-free-icons";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import type { StatusBlockTone } from "@/components/ui/status-block";
import {
  StatusActionMenu,
  StatusActionMenuItem,
} from "@/components/card-page/status-action-menu";

type PurchaseOrderEmailStatus = "sent" | "failed" | "skipped" | "pending" | null;
type PurchaseBillStatus = "pending" | "pushed" | "failed" | null;
type ManualBillStatus = "not_billed" | "partly_billed" | "billed" | null;
type BillRollupStatus = "not_billed" | "partly_billed" | "billed" | "failed";
type BillGroupState = {
  pushStatus: PurchaseBillStatus;
};

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

function billDisplay(status: BillRollupStatus): {
  label: string;
  tone: StatusBlockTone;
} {
  if (status === "failed") return { label: "Bill failed", tone: "danger" };
  if (status === "billed") return { label: "Billed", tone: "success" };
  if (status === "partly_billed") return { label: "Partly billed", tone: "warning" };
  return { label: "Not billed", tone: "muted" };
}

function rollupBillStatus(params: {
  status: PurchaseBillStatus;
  manualStatus?: ManualBillStatus;
  groupStates?: BillGroupState[];
  billableGroupCount?: number;
  busy?: boolean;
}): BillRollupStatus {
  if (params.manualStatus) return params.manualStatus;

  const realStates = params.groupStates?.map((group) => group.pushStatus) ?? [];
  const failed = realStates.includes("failed") || params.status === "failed";
  if (failed) return "failed";

  const billableGroupCount = Math.max(params.billableGroupCount ?? 1, 1);
  const pushedCount =
    realStates.length > 0
      ? realStates.filter((status) => status === "pushed").length
      : params.status === "pushed"
        ? billableGroupCount
        : 0;

  if (pushedCount >= billableGroupCount) return "billed";
  if (pushedCount > 0) return "partly_billed";
  if (params.status === "pending" || (params.busy && pushedCount > 0)) {
    return "partly_billed";
  }
  return "not_billed";
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
  manualStatus = null,
  groupStates,
  billableGroupCount = 1,
  externalId,
  externalNumber,
  busy = false,
  disabled = false,
  disabledReason,
  onSetManualStatus,
  onCreate,
}: {
  status: PurchaseBillStatus;
  manualStatus?: ManualBillStatus;
  groupStates?: BillGroupState[];
  billableGroupCount?: number;
  externalId?: string | null;
  externalNumber?: string | null;
  busy?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  onSetManualStatus?: (status: NonNullable<ManualBillStatus>) => void;
  onCreate: () => void;
}) {
  const rollup = rollupBillStatus({
    status,
    manualStatus,
    groupStates,
    billableGroupCount,
    busy,
  });
  const display = busy ? { label: "Creating bill", tone: "warning" as const } : billDisplay(rollup);
  const manageDisabled = disabled || busy;
  const settableStatuses: Array<{
    value: NonNullable<ManualBillStatus>;
    label: string;
    tone: StatusBlockTone;
  }> = [
    { value: "not_billed", label: "Not billed", tone: "muted" },
    { value: "partly_billed", label: "Partly billed", tone: "warning" },
    { value: "billed", label: "Billed", tone: "success" },
  ];

  return (
    <StatusActionMenu
      label={display.label}
      tone={display.tone}
      ariaLabel="Bill actions"
      title={disabledReason ?? externalNumber ?? undefined}
    >
      {settableStatuses.map((option) => (
        <StatusActionMenuItem
          key={option.value}
          active={rollup === option.value}
          swatchClassName={TONE_SWATCH[option.tone]}
          disabled={busy || !onSetManualStatus}
          onSelect={() => onSetManualStatus?.(option.value)}
        >
          {option.label}
        </StatusActionMenuItem>
      ))}
      <DropdownMenuSeparator />
      <StatusActionMenuItem
        icon={FileDollarIcon}
        disabled={manageDisabled}
        onSelect={onCreate}
      >
        Manage bills...
      </StatusActionMenuItem>
      {externalId ? (
        <StatusActionMenuItem
          icon={FileDollarIcon}
          href={xeroBillHref(externalId)}
          target="_blank"
          rel="noreferrer"
        >
          {externalNumber ?? "Open in Xero"}
        </StatusActionMenuItem>
      ) : null}
    </StatusActionMenu>
  );
}
