"use client";

import { useMemo } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Mail01Icon,
  MoreVerticalIcon,
  PrinterIcon,
} from "@hugeicons/core-free-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusLabel, type StatusTone } from "@/components/ui/status-label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { formatDate } from "@/lib/format";
import type { SalesOrderDetail } from "@/app/(dashboard)/sales/types";
import {
  deriveOrderDisplayStatus,
  type OrderDisplayStatusTone,
} from "@/lib/sales/order-display-status";
import { useSalesOrderSaveStatus } from "./use-sales-order-save-status";
import cardStyles from "@/components/card-page/card-page.module.css";

export type OrderCardHeaderMode = "draft" | "edit";

export type OrderCardHeaderProps = {
  order: SalesOrderDetail | null;
  mode: OrderCardHeaderMode;
  draftCustomerName?: string | null;
  draftIsDirty?: boolean;
  /** Disable the saved-pill (e.g. while a create POST is pending). */
  draftSaving?: boolean;
  draftHasError?: boolean;
  /** CTA handlers — only the one matching the current status is rendered. */
  onCreate?: () => void;
  onCreateDisabled?: boolean;
  onPlanShipment?: () => void;
  onPlanShipmentDisabled?: boolean;
  onReturn?: () => void;
  /** ⋯ menu callbacks. Items hide when the callback is missing. */
  onDuplicate?: () => void;
  onPushXero?: () => void;
  onPushXeroDisabled?: boolean;
  onPushXeroLabel?: string;
  onEmailPo?: () => void;
  onEmailPoDisabled?: boolean;
  onCreateMo?: () => void;
  onCreateMoDisabled?: boolean;
  onCreateMoDisabledReason?: string;
  onDelete?: () => void;
};

const toneMap: Record<OrderDisplayStatusTone, StatusTone> = {
  neutral: "neutral",
  accent: "info",
  warning: "warning",
  success: "success",
};

export function OrderCardHeader({
  order,
  mode,
  draftCustomerName,
  draftIsDirty,
  draftSaving,
  draftHasError,
  onCreate,
  onCreateDisabled,
  onPlanShipment,
  onPlanShipmentDisabled,
  onReturn,
  onDuplicate,
  onPushXero,
  onPushXeroDisabled,
  onPushXeroLabel,
  onEmailPo,
  onEmailPoDisabled,
  onCreateMo,
  onCreateMoDisabled,
  onCreateMoDisabledReason,
  onDelete,
}: OrderCardHeaderProps) {
  const handleClose = useSmartBack("/sales/orders");
  const liveSaveStatus = useSalesOrderSaveStatus(order?.id ?? "");

  const status = useMemo(
    () => (order ? deriveOrderDisplayStatus(order) : null),
    [order],
  );

  const customerName = order?.customerName ?? draftCustomerName ?? null;
  const eyebrow =
    customerName && customerName.trim().length > 0
      ? `Sales order · ${customerName}`
      : "Sales order · New";

  const title = order
    ? order.orderNumber
    : "New sales order";

  const description = order ? buildDescriptionLine(order) : null;

  // Save-indicator state. Edit mode reads from the live mutation aggregator.
  // Draft mode is driven by the parent (Create order POST).
  const saveLabel = (() => {
    if (mode === "draft") {
      if (draftSaving) return { kind: "saving" as const, label: "Saving…" };
      if (draftHasError) return { kind: "error" as const, label: "Save failed" };
      if (draftIsDirty) return { kind: "draft" as const, label: "Not saved" };
      return null;
    }
    if (liveSaveStatus.status === "saving") {
      return { kind: "saving" as const, label: "Saving…" };
    }
    if (liveSaveStatus.status === "error") {
      return { kind: "error" as const, label: "Save failed" };
    }
    return { kind: "saved" as const, label: "All changes saved" };
  })();

  return (
    <header className={cardStyles.header}>
      <div className={cardStyles.headerIdentity}>
        <div className={cardStyles.eyebrow}>{eyebrow}</div>
        <div className="flex flex-wrap items-baseline gap-[10px]">
          <h1 className={`${cardStyles.title} ${cardStyles.mono}`}>{title}</h1>
          {customerName && customerName.trim().length > 0 ? (
            <span className="text-[14px] font-semibold text-[var(--color-ink)]">
              {customerName}
            </span>
          ) : null}
          {status ? (
            <StatusLabel tone={toneMap[status.tone]}>{status.label}</StatusLabel>
          ) : null}
        </div>
        {description ? (
          <div className={cardStyles.meta} style={{ maxWidth: 780 }}>
            {description}
          </div>
        ) : null}
      </div>

      <div className={cardStyles.headerRight}>
        {saveLabel ? <SaveStatusPill kind={saveLabel.kind} label={saveLabel.label} /> : null}

        {status?.label === "DRAFT" || mode === "draft" ? (
          <button
            type="button"
            onClick={onCreate}
            disabled={onCreateDisabled}
            className="h-[28px] px-[12px] bg-[var(--color-accent)] text-white text-[12px] font-semibold uppercase tracking-[0.04em] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--color-accent-hover)]"
          >
            Create order
          </button>
        ) : null}

        {mode === "edit" && status && (status.label === "OPEN" || status.label === "ALLOCATED" || status.label === "PARTIALLY SHIPPED") ? (
          <button
            type="button"
            onClick={onPlanShipment}
            disabled={onPlanShipmentDisabled}
            className="h-[28px] px-[12px] bg-[var(--color-accent)] text-white text-[12px] font-semibold uppercase tracking-[0.04em] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--color-accent-hover)]"
          >
            Plan shipment
          </button>
        ) : null}

        {mode === "edit" && status && (status.label === "SHIPPED" || status.label === "CLOSED") ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onReturn}
                disabled
                className="h-[28px] px-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] text-[12px] font-semibold uppercase tracking-[0.04em] cursor-not-allowed"
              >
                Return
              </button>
            </TooltipTrigger>
            <TooltipContent>Returns coming soon.</TooltipContent>
          </Tooltip>
        ) : null}

        <button
          type="button"
          className={cardStyles.iconBtn}
          aria-label="Print"
          title="Print"
          onClick={() => window.print()}
        >
          <HugeiconsIcon icon={PrinterIcon} size={14} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cardStyles.iconBtn}
              aria-label="More actions"
            >
              <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onDuplicate ? (
              <DropdownMenuItem onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
            ) : null}
            {onPushXero ? (
              <DropdownMenuItem
                onSelect={() => {
                  if (onPushXeroDisabled) return;
                  onPushXero();
                }}
                disabled={onPushXeroDisabled}
              >
                {onPushXeroLabel ?? "Push to Xero"}
              </DropdownMenuItem>
            ) : null}
            {onEmailPo ? (
              <DropdownMenuItem
                onSelect={() => {
                  if (onEmailPoDisabled) return;
                  onEmailPo();
                }}
                disabled={onEmailPoDisabled}
              >
                <HugeiconsIcon icon={Mail01Icon} size={14} className="mr-2" />
                Email PO
              </DropdownMenuItem>
            ) : null}
            {order ? (
              <DropdownMenuItem asChild>
                <Link
                  href={`/inventory/ledger?salesOrderId=${order.id}`}
                  prefetch={false}
                >
                  View inventory ledger
                </Link>
              </DropdownMenuItem>
            ) : null}
            {onCreateMo ? (
              <DropdownMenuItem
                onSelect={() => {
                  if (onCreateMoDisabled) return;
                  onCreateMo();
                }}
                disabled={onCreateMoDisabled}
                title={onCreateMoDisabledReason}
              >
                Create manufacturing order(s)
              </DropdownMenuItem>
            ) : null}
            {onDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onDelete} variant="destructive">
                  Delete order
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          className={cardStyles.iconBtn}
          aria-label="Close"
          onClick={handleClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </button>
      </div>
    </header>
  );
}

function buildDescriptionLine(order: SalesOrderDetail): string | null {
  const parts: string[] = [];
  if (order.customerProjectName) {
    parts.push(order.customerProjectName);
  }
  const nextPlanned = order.shipments.find((shipment) => shipment.status !== "shipped");
  if (nextPlanned) {
    const type = nextPlanned.fulfillmentType === "pickup" ? "Pickup" : "Delivery";
    const date = nextPlanned.scheduledDate ? ` ${formatDate(nextPlanned.scheduledDate)}` : "";
    parts.push(`next ${type.toLowerCase()}${date}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function SaveStatusPill({
  kind,
  label,
}: {
  kind: "saving" | "error" | "draft" | "saved";
  label: string;
}) {
  const className = (() => {
    switch (kind) {
      case "saving":
        return cardStyles.savingPill;
      case "error":
      case "draft":
        return cardStyles.failedPill;
      case "saved":
      default:
        return cardStyles.savedPill;
    }
  })();
  return (
    <span className={className}>
      <span className={cardStyles.pillSquare} />
      {label}
    </span>
  );
}

