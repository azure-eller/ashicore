"use client";

import { useMemo } from "react";
import { StatusLabel, type StatusTone } from "@/components/ui/status-label";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { formatDate } from "@/lib/format";
import { buildInventoryLedgerHref } from "@/lib/inventory/ledger";
import type { SalesOrderDetail } from "@/app/(dashboard)/sales/types";
import {
  deriveOrderDisplayStatus,
  type OrderDisplayStatusTone,
} from "@/lib/sales/order-display-status";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import {
  saveStateFromEntityStatus,
  useEntitySaveStatus,
  type CardSaveState,
} from "@/components/card-page/card-save-status";
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
  onShipOrder?: () => void;
  onShipOrderDisabled?: boolean;
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
  canViewLedger?: boolean;
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
  onShipOrder,
  onShipOrderDisabled,
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
  canViewLedger,
}: OrderCardHeaderProps) {
  const handleClose = useSmartBack("/sales/orders");
  const liveSaveStatus = useEntitySaveStatus("sales-order", order?.id ?? "__draft__");

  const status = useMemo(
    () => (order ? deriveOrderDisplayStatus(order) : null),
    [order],
  );

  const customerName = order?.customerName ?? draftCustomerName ?? null;
  const title = order
    ? order.orderNumber
    : "New sales order";

  const description = order ? buildDescriptionLine(order) : null;

  const saveState: CardSaveState | null = (() => {
    if (mode === "draft") {
      if (draftSaving) return "saving";
      if (draftHasError) return "failed";
      if (draftIsDirty) return "not_saved";
      return "not_saved";
    }
    return saveStateFromEntityStatus(liveSaveStatus.status);
  })();

  const primaryAction = (() => {
    if (mode === "draft") {
      return {
        label: "Create order",
        onClick: onCreate,
        disabled: onCreateDisabled,
      };
    }
    if (
      mode === "edit" &&
      status &&
      (status.label === "OPEN" ||
        status.label === "ALLOCATED" ||
        status.label === "PARTIALLY SHIPPED")
    ) {
      return {
        label: "Mark shipped",
        onClick: onShipOrder,
        disabled: onShipOrderDisabled,
      };
    }
    if (mode === "edit" && status && (status.label === "SHIPPED" || status.label === "CLOSED")) {
      return {
        label: "Return",
        onClick: onReturn,
        disabled: true,
        tooltip: "Returns coming soon.",
      };
    }
    return undefined;
  })();

  return (
    <CardPageHeader
      title={
        <span className={cardStyles.mono}>
          {title}
          {customerName && customerName.trim().length > 0 ? (
            <span className="ml-[10px] font-sans text-[14px] font-semibold text-[var(--color-ink)]">
              {customerName}
            </span>
          ) : null}
        </span>
      }
      status={status ? <StatusLabel tone={toneMap[status.tone]}>{status.label}</StatusLabel> : null}
      meta={description}
      saveState={saveState}
      primaryAction={primaryAction}
      menuActions={[
        ...(onDuplicate ? [{ label: "Duplicate", onClick: onDuplicate }] : []),
        ...(onPushXero
          ? [
              {
                label: onPushXeroLabel ?? "Push to Xero",
                onClick: onPushXero,
                disabled: onPushXeroDisabled,
              },
            ]
          : []),
        ...(onEmailPo
          ? [
              {
                label: "Email PO",
                onClick: onEmailPo,
                disabled: onEmailPoDisabled,
              },
            ]
          : []),
        ...(order && canViewLedger
          ? [
              {
                label: "View inventory activity",
                href: buildInventoryLedgerHref({
                  documentType: "sales_order",
                  documentId: order.id,
                }),
              },
            ]
          : []),
        ...(onCreateMo
          ? [
              {
                label: "Create manufacturing order(s)",
                onClick: onCreateMo,
                disabled: onCreateMoDisabled,
                tooltip: onCreateMoDisabledReason,
              },
            ]
          : []),
        ...(onDelete
          ? [{ label: "Delete order", onClick: onDelete, destructive: true }]
          : []),
      ]}
      onClose={handleClose}
      fallbackHref="/sales/orders"
    />
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
