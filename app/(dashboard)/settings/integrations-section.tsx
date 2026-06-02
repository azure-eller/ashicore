"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Building02Icon,
  FileExportIcon,
  HelpCircleIcon,
  InformationCircleIcon,
  LinkSquare02Icon,
  MoreHorizontalIcon,
  Settings02Icon,
  Tick02Icon,
  TimelineListIcon,
  Unlink03Icon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ConfiguredBadge,
  type ConfiguredBadgeConfig,
} from "@/components/configured-badge";
import { InsetPanel } from "@/components/inset-panel";
import {
  ListFrame,
  ListFrameItem,
  SelectableListFrameItem,
} from "@/components/list-frame";
import { NoticePanel } from "@/components/notice-panel";
import { ProviderIconFrame } from "@/components/provider-icon-frame";
import { SurfacePanel } from "@/components/surface-panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiJson } from "@/lib/client/api";
import { formatDateTimeLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ACCOUNTING_PROVIDER_QUICKBOOKS } from "@/lib/accounting/constants";
import type { AccountingConnectionSummary } from "@/lib/dal/accounting";
import type {
  XeroConnectionSummary,
  XeroExportHistoryRow,
  XeroImportRunSummary,
  XeroSyncEventSummary,
} from "@/lib/dal/xero";
import {
  AccountingPurchaseOrderImportButton,
  XeroImportSection,
} from "./integrations/xero-import-section";
import { SettingsPanel, SettingsPanelHeader } from "@/components/settings-panel";

const ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: "Security check failed. Please try connecting Xero again.",
  callback_failed:
    "Xero rejected the connection. Double-check your client credentials and retry.",
  access_denied: "You declined the Xero authorization request.",
};
const TAX_LABELS: Record<string, string> = {
  OUTPUT: "Output tax",
  OUTPUT2: "Output tax, reduced",
  ZERORATEDOUTPUT: "Zero rated",
  EXEMPTOUTPUT: "Exempt",
  INPUT: "Input tax",
  INPUT2: "Input tax, reduced",
  ZERORATEDINPUT: "Zero rated",
  EXEMPTINPUT: "Exempt",
  NONE: "No tax",
};

const syncOutcomeBadgeConfig = {
  success: { label: "Success", variant: "success" },
  failure: { label: "Failed", variant: "destructive" },
} satisfies ConfiguredBadgeConfig<XeroSyncEventSummary["outcome"]>;

const importRunBadgeConfig = {
  undone: { label: "Reset", variant: "secondary" },
} satisfies ConfiguredBadgeConfig<"undone">;

const xeroPushStatusBadgeConfig = {
  pending: { label: "pending", variant: "secondary" },
  pushed: { label: "pushed", variant: "success" },
  failed: { label: "failed", variant: "destructive" },
} satisfies ConfiguredBadgeConfig<"pending" | "pushed" | "failed">;

const TAX_DESCRIPTIONS: Record<string, string> = {
  OUTPUT: "Standard tax treatment for sales invoices.",
  OUTPUT2: "Reduced-rate tax treatment for sales invoices.",
  ZERORATEDOUTPUT: "0% tax treatment for eligible sales.",
  EXEMPTOUTPUT: "No tax is applied to the invoice.",
  NONE: "Use when this Xero organisation should not apply tax.",
};

const SALES_TAX_OPTIONS = [
  "OUTPUT",
  "OUTPUT2",
  "ZERORATEDOUTPUT",
  "EXEMPTOUTPUT",
  "NONE",
] as const;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Awaiting approval",
  AUTHORISED: "Approved",
};

const STATUS_DESCRIPTIONS: Record<string, string> = {
  DRAFT: "Saved in Xero for review before approval.",
  AUTHORISED: "Approved in Xero after export.",
};

type DialogKey =
  | "defaults"
  | "disconnect"
  | "switch-org"
  | "connect"
  | "history"
  | null;

type AutoPushChange = {
  key:
    | "autoPushSalesInvoices"
    | "autoSyncPurchaseOrdersFromAccounting";
  value: boolean;
} | null;

type XeroAccountOption = {
  code: string;
  name: string;
  type: string | null;
  taxType: string | null;
  class: string | null;
};

type XeroSettingsPayload = {
  defaultAccountCode: string | null;
  defaultTaxType: string | null;
  invoiceStatusPreference: string;
  autoPushSalesInvoices: boolean;
  autoPushPurchaseOrders: false;
  autoSyncPurchaseOrdersFromAccounting: boolean;
  autoEmailSalesInvoices: boolean;
  autoEmailPurchaseOrders: false;
  purchaseOrderDefaultAccountCode: string | null;
  purchaseOrderDefaultTaxType: string | null;
  purchaseOrderStatusPreference: string;
};

function xeroSettingsPayload(
  connection: XeroConnectionSummary,
  overrides: Partial<XeroSettingsPayload> = {}
): XeroSettingsPayload {
  return {
    defaultAccountCode: connection.defaultAccountCode,
    defaultTaxType: connection.defaultTaxType,
    invoiceStatusPreference: connection.invoiceStatusPreference,
    autoPushSalesInvoices: connection.autoPushSalesInvoices,
    autoPushPurchaseOrders: false,
    autoSyncPurchaseOrdersFromAccounting:
      connection.autoSyncPurchaseOrdersFromAccounting,
    autoEmailSalesInvoices: connection.autoEmailSalesInvoices,
    autoEmailPurchaseOrders: false,
    purchaseOrderDefaultAccountCode: connection.purchaseOrderDefaultAccountCode,
    purchaseOrderDefaultTaxType: connection.purchaseOrderDefaultTaxType,
    purchaseOrderStatusPreference: connection.purchaseOrderStatusPreference,
    ...overrides,
  };
}

function FriendlyTax({ value }: { value: string | null }) {
  if (!value) return <span>Not set</span>;
  return <span>{TAX_LABELS[value] ?? value}</span>;
}

function FriendlyStatus({ value }: { value: string }) {
  return <span>{STATUS_LABELS[value] ?? value}</span>;
}

function importRunTitle(entityType: XeroImportRunSummary["entityType"]) {
  if (entityType === "customers") return "Customers";
  if (entityType === "suppliers") return "Suppliers";
  if (entityType === "purchase_orders") return "Purchase Orders";
  return "Purchasing";
}

function syncEventTitle(eventType: XeroSyncEventSummary["eventType"]) {
  if (eventType === "accounting_auto_sync") return "Purchase order auto-sync";
  if (eventType === "accounting_import" || eventType === "xero_import") {
    return "Import";
  }
  if (
    eventType === "accounting_missing_scope" ||
    eventType === "xero_missing_scope"
  ) {
    return "Missing Xero scope";
  }
  return "Token refresh";
}

function metadataText(metadata: Record<string, unknown> | null) {
  if (!metadata) return null;
  if (typeof metadata.message === "string") return metadata.message;
  if (Array.isArray(metadata.errors) && metadata.errors.length > 0) {
    return metadata.errors
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, 3)
      .join("; ");
  }
  if (Array.isArray(metadata.autoSkipped) && metadata.autoSkipped.length > 0) {
    return metadata.autoSkipped
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const row = entry as {
          externalPurchaseOrderNumber?: unknown;
          reason?: unknown;
        };
        if (
          typeof row.externalPurchaseOrderNumber !== "string" ||
          typeof row.reason !== "string"
        ) {
          return null;
        }
        return `${row.externalPurchaseOrderNumber}: ${row.reason}`;
      })
      .filter((entry): entry is string => entry != null)
      .slice(0, 3)
      .join("; ");
  }
  if (
    Array.isArray(metadata.staleOpenPurchaseOrders) &&
    metadata.staleOpenPurchaseOrders.length > 0
  ) {
    return metadata.staleOpenPurchaseOrders
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const row = entry as {
          purchaseOrderNumber?: unknown;
          status?: unknown;
        };
        if (
          typeof row.purchaseOrderNumber !== "string" ||
          typeof row.status !== "string"
        ) {
          return null;
        }
        return `${row.purchaseOrderNumber}: no longer open in Xero (${row.status})`;
      })
      .filter((entry): entry is string => entry != null)
      .slice(0, 3)
      .join("; ");
  }

  const summary = [
    typeof metadata.fetched === "number" ? `${metadata.fetched} fetched` : null,
    typeof metadata.created === "number" ? `${metadata.created} created` : null,
    typeof metadata.updated === "number" ? `${metadata.updated} updated` : null,
    typeof metadata.skipped === "number" ? `${metadata.skipped} skipped` : null,
    typeof metadata.errorCount === "number" ? `${metadata.errorCount} errors` : null,
    typeof metadata.autoSkippedCount === "number"
      ? `${metadata.autoSkippedCount} need review`
      : null,
    typeof metadata.staleOpenPurchaseOrderCount === "number"
      ? `${metadata.staleOpenPurchaseOrderCount} no longer open`
      : null,
  ].filter(Boolean);

  return summary.length > 0 ? summary.join(", ") : null;
}

function TaxSelect({
  id,
  value,
  options,
  onValueChange,
}: {
  id: string;
  value: string;
  options: readonly string[];
  onValueChange: (value: string) => void;
}) {
  const normalizedValue = value || "NONE";
  const selectOptions = options.includes(normalizedValue)
    ? options
    : [normalizedValue, ...options];

  return (
    <Select value={normalizedValue} onValueChange={onValueChange}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {selectOptions.map((option) => (
          <SelectItem key={option} value={option}>
            {TAX_LABELS[option] ?? option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function XeroLogo() {
  return (
    <ProviderIconFrame tone="primary">
      <span className="relative flex size-(--space-10) items-center justify-center border border-primary-foreground/40">
        <span className="absolute h-(--space-1) w-(--space-8) rotate-45 bg-primary-foreground" />
        <span className="absolute h-(--space-1) w-(--space-8) -rotate-45 bg-primary-foreground" />
      </span>
    </ProviderIconFrame>
  );
}

function DefaultChip({ children }: { children: React.ReactNode }) {
  return (
    <SurfacePanel
      as="span"
      tone="background"
      className="inline-flex min-h-(--height-input-sm) items-center gap-(--space-2) px-(--space-4) py-(--space-1) text-[length:var(--text-xs)] font-medium"
    >
      {children}
    </SurfacePanel>
  );
}

function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-(--space-6)">
      <h3 className="text-[length:var(--text-sm)] font-semibold text-foreground">{title}</h3>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function AutomationRow({
  checked,
  disabled,
  onCheckedChange,
  ariaLabel,
  title,
  meta,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (value: boolean) => void;
  ariaLabel: string;
  title: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <ListFrameItem className="grid gap-(--space-6) py-(--space-6) sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <label className="flex min-w-0 items-start gap-(--space-6)">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          aria-label={ariaLabel}
          className="mt-(--space-1)"
        />
        <span className="min-w-0">
          <span className="block text-[length:var(--text-sm)] font-medium text-foreground">{title}</span>
          <span className="text-[length:var(--text-xs)] text-muted-foreground">{meta}</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-(--space-4) sm:justify-end">{children}</div>
    </ListFrameItem>
  );
}

function PostingDefaultsSummary({
  connection,
  onEdit,
  onHistory,
  onToggleAutoPush,
  canManageSalesXero,
  canManagePurchasingXero,
  purchaseOrderSyncConfigured,
}: {
  connection: XeroConnectionSummary;
  onEdit: () => void;
  onHistory: () => void;
  onToggleAutoPush: (
    key:
      | "autoPushSalesInvoices"
      | "autoSyncPurchaseOrdersFromAccounting",
    value: boolean
  ) => void;
  canManageSalesXero: boolean;
  canManagePurchasingXero: boolean;
  purchaseOrderSyncConfigured: boolean;
}) {
  const salesAccount = connection.defaultAccountCode;
  const salesTax = connection.defaultTaxType;
  const purchaseAccount = connection.purchaseOrderDefaultAccountCode;
  const purchaseTax =
    connection.purchaseOrderDefaultTaxType ?? connection.defaultTaxType;
  const showPoSyncConfigWarning =
    connection.autoSyncPurchaseOrdersFromAccounting &&
    !purchaseOrderSyncConfigured;

  return (
    <ListFrameItem className="p-(--space-10)">
      <SectionHeading
        title="Automation"
        action={
          <div className="flex flex-wrap gap-(--space-4)">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onHistory}
              aria-label="View Xero sync history"
              title="Sync history"
            >
              <HugeiconsIcon icon={TimelineListIcon} strokeWidth={2} />
            </Button>
            {canManageSalesXero || canManagePurchasingXero ? (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
                Defaults
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mt-(--space-4)">
        <AutomationRow
          checked={connection.autoPushSalesInvoices}
          disabled={!canManageSalesXero}
          onCheckedChange={(value) =>
            onToggleAutoPush("autoPushSalesInvoices", value)
          }
          ariaLabel="Auto-export sales invoices"
          title="Sales invoices"
          meta="Send invoices to Xero automatically when sales orders ship."
        >
            <DefaultChip>
              <span className="font-mono">{salesAccount ?? "Account"}</span>
            </DefaultChip>
            <DefaultChip>
              <FriendlyTax value={salesTax} />
            </DefaultChip>
            <DefaultChip>
              <FriendlyStatus value={connection.invoiceStatusPreference} />
            </DefaultChip>
        </AutomationRow>

        <ListFrameItem className="grid gap-(--space-3) py-(--space-3) sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <span className="min-w-0">
            <span className="block text-[length:var(--text-sm)] font-medium text-foreground">
              Purchase bills
            </span>
            <span className="text-[length:var(--text-xs)] text-muted-foreground">
              Default ledger account for Xero bills created from ERP purchase orders.
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-(--space-2) text-[length:var(--text-xs)] text-muted-foreground sm:justify-end">
            <DefaultChip>
              <span className="font-mono">{purchaseAccount ?? "Account"}</span>
            </DefaultChip>
            <DefaultChip>
              <FriendlyTax value={purchaseTax} />
            </DefaultChip>
          </div>
        </ListFrameItem>

        <AutomationRow
          checked={connection.autoSyncPurchaseOrdersFromAccounting}
          disabled={!canManagePurchasingXero}
          onCheckedChange={(value) =>
            onToggleAutoPush("autoSyncPurchaseOrdersFromAccounting", value)
          }
          ariaLabel="Auto-sync purchase orders from Xero"
          title="Purchase order import"
          meta="Import open Xero purchase orders for receiving."
        >
            <DefaultChip>Reviews new materials</DefaultChip>
            <DefaultChip>Open POs only</DefaultChip>
        </AutomationRow>
        {showPoSyncConfigWarning ? (
          <NoticePanel
            tone="destructive"
            padding="md"
            className="mt-(--space-4) flex gap-(--space-4) text-[length:var(--text-xs)] text-destructive"
          >
            <HugeiconsIcon
              icon={Alert02Icon}
              strokeWidth={2}
              className="mt-0.5 size-(--space-5) shrink-0"
            />
            <p>
              Purchase order auto-sync is on, but the cron secret is not configured
              in this deployment.
            </p>
          </NoticePanel>
        ) : null}
      </div>
    </ListFrameItem>
  );
}

function ImportFromXeroSection({
  canImportCustomers,
  canImportSuppliers,
}: {
  canImportCustomers: boolean;
  canImportSuppliers: boolean;
}) {
  if (!canImportCustomers && !canImportSuppliers) return null;

  return (
    <ListFrameItem className="p-5">
      <SectionHeading title="Imports" />
      <div className="mt-3">
        <XeroImportSection
          canImportCustomers={canImportCustomers}
          canImportSuppliers={canImportSuppliers}
        />
      </div>
    </ListFrameItem>
  );
}

function AccountingProviderCard({
  icon,
  title,
  connected,
  summary,
  actions,
  children,
}: {
  icon: ReactNode;
  title: string;
  connected: boolean;
  summary: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <SurfacePanel className="overflow-hidden p-0 shadow-none">
      <div className="flex flex-col gap-(--space-8) p-(--space-10) sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-(--space-6)">
          {icon}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-(--space-4)">
              <h3 className="text-[length:var(--text-base)] leading-[var(--leading-base)] font-semibold text-foreground">
                {title}
              </h3>
              {connected ? (
                <Badge variant="success">
                  <span className="size-(--space-3) bg-current" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="secondary">Not connected</Badge>
              )}
            </div>
            <p className="mt-(--space-2) truncate text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-muted-foreground">
              {summary}
            </p>
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </SurfacePanel>
  );
}

function XeroRow({
  connection,
  error,
  canManageConnection,
  canManageSalesXero,
  canManagePurchasingXero,
  canImportCustomers,
  canImportSuppliers,
  importRuns,
  syncEvents,
  exportRows,
  purchaseOrderSyncConfigured,
  timeZone,
}: {
  connection: XeroConnectionSummary | null;
  error?: string;
  canManageConnection: boolean;
  canManageSalesXero: boolean;
  canManagePurchasingXero: boolean;
  canImportCustomers: boolean;
  canImportSuppliers: boolean;
  importRuns: XeroImportRunSummary[];
  syncEvents: XeroSyncEventSummary[];
  exportRows: XeroExportHistoryRow[];
  purchaseOrderSyncConfigured: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState<DialogKey>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [autoPushChange, setAutoPushChange] = useState<AutoPushChange>(null);

  const disconnectMutation = useMutation({
    mutationFn: () =>
      apiJson<void>("/api/xero/disconnect", {
        method: "POST",
        fallbackError: "Failed to disconnect Xero.",
      }),
    onSuccess: () => {
      setOpenDialog(null);
      router.refresh();
      queryClient.invalidateQueries();
    },
    onError: (err) => setFormError((err as Error).message),
  });

  const autoPushMutation = useMutation({
    mutationFn: async (change: NonNullable<AutoPushChange>) => {
      if (!connection) throw new Error("Xero is not connected.");
      await apiJson<void>("/api/xero/settings", {
        method: "PUT",
        body: xeroSettingsPayload(connection, {
          autoPushSalesInvoices:
            change.key === "autoPushSalesInvoices"
              ? change.value
              : connection.autoPushSalesInvoices,
          autoSyncPurchaseOrdersFromAccounting:
            change.key === "autoSyncPurchaseOrdersFromAccounting"
              ? change.value
              : connection.autoSyncPurchaseOrdersFromAccounting,
        }),
        fallbackError: "Failed to save Xero settings.",
      });
    },
    onSuccess: () => {
      setAutoPushChange(null);
      router.refresh();
      queryClient.invalidateQueries();
    },
    onError: (err) => setFormError((err as Error).message),
  });

  const isConnected = connection != null;

  return (
    <AccountingProviderCard
      icon={<XeroLogo />}
      title="Xero"
      connected={isConnected}
      summary={
        isConnected
          ? `${connection.tenantName} · Xero connected`
          : "Send invoices to Xero and import purchase orders for receiving."
      }
      actions={
        isConnected ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" aria-label="More actions">
                    <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Connection</DropdownMenuLabel>
                  {canManageConnection ? (
                    <DropdownMenuItem onSelect={() => setOpenDialog("switch-org")}>
                      <HugeiconsIcon icon={Building02Icon} strokeWidth={2} />
                      Switch organisation
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem asChild>
                    <a href="https://go.xero.com" target="_blank" rel="noreferrer">
                      <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} />
                      Open in Xero
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setOpenDialog("history")}>
                    <HugeiconsIcon icon={TimelineListIcon} strokeWidth={2} />
                    Sync history
                  </DropdownMenuItem>
                  {canManageConnection ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setOpenDialog("disconnect")}
                      >
                        <HugeiconsIcon icon={Unlink03Icon} strokeWidth={2} />
                        Disconnect
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : canManageConnection ? (
            <Button size="sm" onClick={() => setOpenDialog("connect")}>
              Connect
            </Button>
          ) : null
      }
    >

      {error ? (
        <ListFrameItem className="px-(--space-10) py-(--space-6)">
          <FieldError>
            {ERROR_MESSAGES[error] ?? `Xero connection failed (${error}).`}
          </FieldError>
        </ListFrameItem>
      ) : null}

      {isConnected ? (
        <>
          <PostingDefaultsSummary
            connection={connection}
            canManageSalesXero={canManageSalesXero}
            canManagePurchasingXero={canManagePurchasingXero}
            onEdit={() => setOpenDialog("defaults")}
            onHistory={() => setOpenDialog("history")}
            purchaseOrderSyncConfigured={purchaseOrderSyncConfigured}
            onToggleAutoPush={(key, value) => {
              if (connection[key] === value) return;
              setFormError(null);
              setAutoPushChange({ key, value });
            }}
          />
          <ImportFromXeroSection
            canImportCustomers={canImportCustomers}
            canImportSuppliers={canImportSuppliers}
          />
        </>
      ) : null}

      {connection ? (
        <>
          {openDialog === "defaults" ? (
            <PostingDefaultsDialog
              open
              connection={connection}
              canManageSalesXero={canManageSalesXero}
              canManagePurchasingXero={canManagePurchasingXero}
              onOpenChange={(open) => setOpenDialog(open ? "defaults" : null)}
            />
          ) : null}
          {openDialog === "switch-org" ? (
            <SwitchOrgDialog
              open
              connection={connection}
              onOpenChange={(open) => setOpenDialog(open ? "switch-org" : null)}
            />
          ) : null}
        </>
      ) : null}

      <ExportHistoryDialog
        open={openDialog === "history"}
        importRuns={importRuns}
        syncEvents={syncEvents}
        rows={exportRows}
        timeZone={timeZone}
        onOpenChange={(open) => setOpenDialog(open ? "history" : null)}
      />
      <AutoPushConfirmDialog
        change={autoPushChange}
        pending={autoPushMutation.isPending}
        error={formError}
        onOpenChange={(open) => {
          if (!open) {
            setAutoPushChange(null);
            setFormError(null);
          }
        }}
        onConfirm={() => {
          if (autoPushChange) autoPushMutation.mutate(autoPushChange);
        }}
      />
      {openDialog === "disconnect" ? (
        <DisconnectDialog
          open
          pending={disconnectMutation.isPending}
          error={formError}
          onOpenChange={(open) => {
            setFormError(null);
            setOpenDialog(open ? "disconnect" : null);
          }}
          onDisconnect={() => disconnectMutation.mutate()}
        />
      ) : null}
      <ConnectDialog
        open={openDialog === "connect"}
        onOpenChange={(open) => setOpenDialog(open ? "connect" : null)}
      />
    </AccountingProviderCard>
  );
}

function QuickBooksRow({
  connection,
  canManageConnection,
  canImportSuppliers,
}: {
  connection: AccountingConnectionSummary | null;
  canManageConnection: boolean;
  canImportSuppliers: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [summary, setSummary] = useState<{
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  const autoSyncMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!connection) throw new Error("QuickBooks is not connected.");
      await apiJson<void>(
        `/api/accounting/connections/${ACCOUNTING_PROVIDER_QUICKBOOKS}/settings`,
        {
          method: "PUT",
          body: {
            autoSyncPurchaseOrdersFromAccounting: enabled,
          },
          fallbackError: "Failed to save QuickBooks settings.",
        }
      );
    },
    onSuccess: () => {
      router.refresh();
      queryClient.invalidateQueries();
    },
    onError: (err) => setError((err as Error).message),
  });

  const disconnectMutation = useMutation({
    mutationFn: () =>
      apiJson<void>("/api/quickbooks/disconnect", {
        method: "POST",
        fallbackError: "Failed to disconnect QuickBooks.",
      }),
    onSuccess: () => {
      router.refresh();
      queryClient.invalidateQueries();
    },
    onError: (err) => setError((err as Error).message),
  });

  const isConnected = connection != null;

  return (
    <AccountingProviderCard
      icon={
        <ProviderIconFrame>QB</ProviderIconFrame>
      }
      title="QuickBooks"
      connected={isConnected}
      summary={
        isConnected
          ? `${connection.tenantName} · Accounting provider`
          : "Connect QuickBooks as an accounting provider."
      }
      actions={
        <>
          {isConnected && canImportSuppliers ? (
            <AccountingPurchaseOrderImportButton
              provider={ACCOUNTING_PROVIDER_QUICKBOOKS}
              onComplete={setSummary}
            />
          ) : null}
          {isConnected && canManageConnection ? (
            <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDefaultsOpen(true)}
            >
              <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
              Defaults
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              Disconnect
            </Button>
            </>
          ) : !isConnected && canManageConnection ? (
            <Button size="sm" asChild>
              <a href="/api/quickbooks/connect">Connect</a>
            </Button>
          ) : null}
        </>
      }
    >
      {isConnected ? (
        <AutomationRow
          checked={connection.autoSyncPurchaseOrdersFromAccounting}
          disabled={!canManageConnection || autoSyncMutation.isPending}
          onCheckedChange={(value) => {
            setError(null);
            autoSyncMutation.mutate(value);
          }}
          ariaLabel="Auto-sync purchase orders from QuickBooks"
          title="Purchase order import"
          meta="Check to automatically import open QuickBooks purchase orders."
        >
          <DefaultChip>Creates missing materials</DefaultChip>
          <DefaultChip>Open POs only</DefaultChip>
        </AutomationRow>
      ) : null}
      {summary ? (
        <ListFrameItem className="px-(--space-10) py-(--space-6) text-[length:var(--text-sm)] text-muted-foreground">
          {summary.created} created, {summary.updated} updated, {summary.skipped} skipped
          {summary.errors.length > 0 ? `, ${summary.errors.length} errors` : null}
        </ListFrameItem>
      ) : null}
      {error ? (
        <ListFrameItem className="px-(--space-10) py-(--space-6)">
          <FieldError>{error}</FieldError>
        </ListFrameItem>
      ) : null}
      {isConnected ? (
        <QuickBooksDefaultsDialog
          open={defaultsOpen}
          connection={connection}
          onOpenChange={setDefaultsOpen}
        />
      ) : null}
    </AccountingProviderCard>
  );
}

function QuickBooksDefaultsDialog({
  open,
  connection,
  onOpenChange,
}: {
  open: boolean;
  connection: AccountingConnectionSummary;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [salesAccountCode, setSalesAccountCode] = useState(
    connection.defaultAccountCode ?? ""
  );
  const [purchaseAccountCode, setPurchaseAccountCode] = useState(
    connection.purchaseOrderDefaultAccountCode ?? ""
  );
  const [formError, setFormError] = useState<string | null>(null);
  const accountsQuery = useQuery({
    queryKey: ["quickbooks-accounts", connection.tenantId],
    enabled: open,
    queryFn: () =>
      apiJson<{ accounts: XeroAccountOption[] }>(
        `/api/accounting/connections/${ACCOUNTING_PROVIDER_QUICKBOOKS}/accounts`,
        { fallbackError: "Failed to load QuickBooks accounts." }
      ),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiJson<void>(
        `/api/accounting/connections/${ACCOUNTING_PROVIDER_QUICKBOOKS}/settings`,
        {
          method: "PUT",
          body: {
            defaultAccountCode: salesAccountCode.trim() || null,
            purchaseOrderDefaultAccountCode:
              purchaseAccountCode.trim() || null,
          },
          fallbackError: "Failed to save QuickBooks defaults.",
        }
      ),
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
    onError: (err) => setFormError((err as Error).message),
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const accountLabel = (code: string) => {
    const account = accounts.find((entry) => entry.code === code);
    if (!account) return code;
    const metadata = [account.type, account.class].filter(Boolean).join(" · ");
    return `${account.name}${metadata ? ` (${metadata})` : ""}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>QuickBooks defaults</DialogTitle>
          <DialogDescription>
            Accounts used when sales invoices and purchase bills are sent to QuickBooks.
          </DialogDescription>
        </DialogHeader>
        {formError ? <FieldError>{formError}</FieldError> : null}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="quickbooks-sales-account">
              Sales invoice account
            </FieldLabel>
            <Select value={salesAccountCode} onValueChange={setSalesAccountCode}>
              <SelectTrigger id="quickbooks-sales-account" className="w-full">
                <SelectValue placeholder="Choose account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.code} value={account.code}>
                    {accountLabel(account.code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="quickbooks-purchase-account">
              Purchase bill account
            </FieldLabel>
            <Select
              value={purchaseAccountCode}
              onValueChange={setPurchaseAccountCode}
            >
              <SelectTrigger id="quickbooks-purchase-account" className="w-full">
                <SelectValue placeholder="Choose account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.code} value={account.code}>
                    {accountLabel(account.code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        {accountsQuery.error ? (
          <FieldError>
            {accountsQuery.error instanceof Error
              ? accountsQuery.error.message
              : "Failed to load QuickBooks accounts."}
          </FieldError>
        ) : null}
        <DialogFooter justify="between">
          <p className="flex items-center gap-(--space-2) text-[length:var(--text-xs)] text-muted-foreground">
            <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
            Changes apply to new exports.
          </p>
          <div className="flex gap-(--space-4)">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending ||
                salesAccountCode.trim() === "" ||
                purchaseAccountCode.trim() === ""
              }
            >
              {saveMutation.isPending ? "Saving..." : "Save defaults"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PostingDefaultsDialog({
  open,
  connection,
  canManageSalesXero,
  canManagePurchasingXero,
  onOpenChange,
}: {
  open: boolean;
  connection: XeroConnectionSummary;
  canManageSalesXero: boolean;
  canManagePurchasingXero: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [accountCode, setAccountCode] = useState(
    connection.defaultAccountCode ?? ""
  );
  const [purchaseAccountCode, setPurchaseAccountCode] = useState(
    connection.purchaseOrderDefaultAccountCode ?? ""
  );
  const [taxType, setTaxType] = useState(connection.defaultTaxType ?? "");
  const [invoiceStatus, setInvoiceStatus] = useState<"DRAFT" | "AUTHORISED">(
    (connection.invoiceStatusPreference as "DRAFT" | "AUTHORISED") ??
      "DRAFT"
  );
  const [formError, setFormError] = useState<string | null>(null);
  const accountsQuery = useQuery({
    queryKey: ["xero-accounts", connection.tenantId],
    queryFn: () =>
      apiJson<{ accounts: XeroAccountOption[] }>("/api/xero/accounts", {
        fallbackError: "Failed to load Xero accounts.",
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiJson<void>("/api/xero/settings", {
        method: "PUT",
        body: xeroSettingsPayload(connection, {
          defaultAccountCode: accountCode.trim() || null,
          defaultTaxType: taxType.trim() || null,
          invoiceStatusPreference: invoiceStatus,
          purchaseOrderDefaultAccountCode: purchaseAccountCode.trim() || null,
        }),
        fallbackError: "Failed to save Xero settings.",
      }),
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
    onError: (err) => setFormError((err as Error).message),
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const accountLabel = (code: string) => {
    const account = accounts.find((entry) => entry.code === code);
    if (!account) return code;
    const metadata = [account.type, account.class].filter(Boolean).join(" · ");
    return `${account.code} - ${account.name}${metadata ? ` (${metadata})` : ""}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>Xero defaults</DialogTitle>
          <DialogDescription>
            Defaults applied when invoices and purchase bills are sent to Xero.
          </DialogDescription>
        </DialogHeader>

        {formError ? <FieldError>{formError}</FieldError> : null}

        <FieldGroup>
          {canManageSalesXero ? (
            <Field>
              <FieldLabel htmlFor="xero-account-code">
                Sales invoice account
              </FieldLabel>
              {accounts.length > 0 ? (
                <Select value={accountCode} onValueChange={setAccountCode}>
                  <SelectTrigger id="xero-account-code" className="w-full">
                    <SelectValue placeholder="Choose account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.code} value={account.code}>
                        {accountLabel(account.code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="xero-account-code"
                  value={accountCode}
                  onChange={(event) => setAccountCode(event.target.value)}
                  placeholder={accountsQuery.isLoading ? "Loading accounts..." : "200"}
                />
              )}
            </Field>
          ) : null}
          {canManagePurchasingXero ? (
            <Field>
              <FieldLabel htmlFor="xero-purchase-account-code">
                Purchase bill account
              </FieldLabel>
              {accounts.length > 0 ? (
                <Select
                  value={purchaseAccountCode}
                  onValueChange={setPurchaseAccountCode}
                >
                  <SelectTrigger id="xero-purchase-account-code" className="w-full">
                    <SelectValue placeholder="Choose account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.code} value={account.code}>
                        {accountLabel(account.code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="xero-purchase-account-code"
                  value={purchaseAccountCode}
                  onChange={(event) => setPurchaseAccountCode(event.target.value)}
                  placeholder={accountsQuery.isLoading ? "Loading accounts..." : "500"}
                />
              )}
            </Field>
          ) : null}
          {canManageSalesXero ? (
            <div className="grid gap-(--space-4) sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="xero-tax-type">Tax treatment</FieldLabel>
                <TaxSelect
                  id="xero-tax-type"
                  value={taxType}
                  options={SALES_TAX_OPTIONS}
                  onValueChange={setTaxType}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="xero-invoice-status">Send as</FieldLabel>
                <Select
                  value={invoiceStatus}
                  onValueChange={(value) =>
                    setInvoiceStatus(value as "DRAFT" | "AUTHORISED")
                  }
                >
                  <SelectTrigger id="xero-invoice-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="AUTHORISED">Approved</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          ) : null}
        </FieldGroup>

        {canManageSalesXero ? (
          <InsetPanel
            tone="muted"
            padding="lg"
            className="text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-muted-foreground"
          >
            <p>{TAX_DESCRIPTIONS[taxType] ?? "Xero tax code saved as entered."}</p>
            <p className="mt-1">
              {STATUS_DESCRIPTIONS[invoiceStatus] ??
                "Xero export status saved as selected."}
            </p>
          </InsetPanel>
        ) : null}

        <DialogFooter justify="between">
          <p className="flex items-center gap-(--space-2) text-[length:var(--text-xs)] text-muted-foreground">
            <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
            Changes apply to new exports.
          </p>
          <div className="flex gap-(--space-4)">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving..." : "Save defaults"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisconnectDialog({
  open,
  pending,
  error,
  onOpenChange,
  onDisconnect,
}: {
  open: boolean;
  pending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onDisconnect: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Disconnect Xero?</DialogTitle>
          <DialogDescription>
            Existing data stays put, but new exports and imports pause until
            Xero is reconnected.
          </DialogDescription>
        </DialogHeader>

        <NoticePanel padding="lg" className="text-[length:var(--text-sm)] text-warning">
          <div className="flex gap-(--space-6)">
            <HugeiconsIcon icon={Alert02Icon} className="mt-(--space-1) size-(--space-8)" strokeWidth={2} />
            <div>
              <p className="font-medium">After disconnecting</p>
              <ul className="mt-(--space-4) list-disc space-y-(--space-2) pl-(--space-8)">
                <li>New invoices will stop sending to Xero.</li>
                <li>Xero purchase order imports will pause.</li>
                <li>Customer and supplier imports will be unavailable.</li>
                <li>Already-synced records remain in both systems.</li>
              </ul>
            </div>
          </div>
        </NoticePanel>

        {error ? <FieldError>{error}</FieldError> : null}

        <Field>
          <FieldLabel htmlFor="disconnect-confirm">
            Type DISCONNECT to confirm
          </FieldLabel>
          <Input
            id="disconnect-confirm"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder="DISCONNECT"
          />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || confirmText !== "DISCONNECT"}
            onClick={onDisconnect}
          >
            {pending ? "Disconnecting..." : "Disconnect Xero"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AutoPushConfirmDialog({
  change,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: {
  change: AutoPushChange;
  pending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const isSales = change?.key === "autoPushSalesInvoices";
  const isImport = change?.key === "autoSyncPurchaseOrdersFromAccounting";
  const documentLabel = isSales
    ? "sales invoices"
    : isImport
      ? "Xero purchase orders"
      : "records";
  const actionLabel = change?.value ? "Turn on" : "Turn off";

  return (
    <Dialog open={change != null} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{actionLabel} {isImport ? "auto-sync" : "auto-export"}?</DialogTitle>
          <DialogDescription>
            {isImport
              ? change?.value
                ? `Open ${documentLabel} will be imported into ERP automatically for receiving.`
                : `Open ${documentLabel} will only import when someone runs bulk import.`
              : change?.value
                ? `New ${documentLabel} will be sent to Xero automatically when the ERP workflow reaches invoicing.`
                : `New ${documentLabel} will stay in ERP until someone sends them to Xero manually.`}
          </DialogDescription>
        </DialogHeader>
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? "Saving..." : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SwitchOrgDialog({
  open,
  connection,
  onOpenChange,
}: {
  open: boolean;
  connection: XeroConnectionSummary;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pendingTenantId, setPendingTenantId] = useState(connection.tenantId);
  const [formError, setFormError] = useState<string | null>(null);

  const switchTenantMutation = useMutation({
    mutationFn: (tenantId: string) =>
      apiJson<void>("/api/xero/switch-tenant", {
        method: "POST",
        body: { tenantId },
        fallbackError: "Failed to switch tenant.",
      }),
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
    onError: (err) => setFormError((err as Error).message),
  });

  const tenants = connection.authorizedTenants.length
    ? connection.authorizedTenants
    : [{ tenantId: connection.tenantId, tenantName: connection.tenantName }];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Switch Xero organisation</DialogTitle>
          <DialogDescription>
            Push and import records to a different authorised Xero organisation.
          </DialogDescription>
        </DialogHeader>

        {formError ? <FieldError>{formError}</FieldError> : null}

        <div className="space-y-(--space-4)">
          {tenants.map((tenant) => {
            const selected = pendingTenantId === tenant.tenantId;
            const current = connection.tenantId === tenant.tenantId;

            return (
              <SelectableListFrameItem
                key={tenant.tenantId}
                type="button"
                onClick={() => setPendingTenantId(tenant.tenantId)}
                selected={selected}
                indicator
                className="gap-(--space-6) p-(--space-6)"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-(--space-4)">
                    <span className="font-medium text-foreground">
                      {tenant.tenantName}
                    </span>
                    {current ? <Badge variant="secondary">Current</Badge> : null}
                  </span>
                  <span className="mt-(--space-1) block truncate text-[length:var(--text-xs)] text-muted-foreground">
                    {tenant.tenantId}
                  </span>
                </span>
              </SelectableListFrameItem>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              switchTenantMutation.isPending ||
              pendingTenantId === connection.tenantId
            }
            onClick={() => switchTenantMutation.mutate(pendingTenantId)}
          >
            {switchTenantMutation.isPending ? "Switching..." : "Switch organisation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Connect to Xero</DialogTitle>
          <DialogDescription>
            Authorise the connection in Xero, then return here to finish setup.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-(--space-6)">
          {[
            ["Send sales invoices", "Sales orders can create Xero invoices."],
            ["Import purchase orders", "Open Xero POs can create ERP purchase orders for receiving."],
            ["Import contacts", "Pull existing customers and suppliers into ERP."],
            ["Avoid duplicates", "Existing records are matched before import."],
          ].map(([title, description]) => (
            <div key={title} className="flex gap-(--space-6)">
              <span className="mt-(--space-1) flex size-(--space-10) items-center justify-center border bg-[var(--color-success-soft)] text-success">
                <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
              </span>
              <div>
                <p className="text-[length:var(--text-sm)] font-medium text-foreground">{title}</p>
                <p className="text-[length:var(--text-xs)] text-muted-foreground">{description}</p>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter justify="between">
          <Button variant="ghost" size="sm" disabled>
            <HugeiconsIcon icon={HelpCircleIcon} strokeWidth={2} />
            Setup guide
          </Button>
          <div className="flex gap-(--space-4)">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button asChild>
              <a href="/api/xero/connect">Continue to Xero</a>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExportHistoryDialog({
  open,
  importRuns,
  syncEvents,
  rows,
  timeZone,
  onOpenChange,
}: {
  open: boolean;
  importRuns: XeroImportRunSummary[];
  syncEvents: XeroSyncEventSummary[];
  rows: XeroExportHistoryRow[];
  timeZone: string;
  onOpenChange: (open: boolean) => void;
}) {
  const hasHistory =
    rows.length > 0 || importRuns.length > 0 || syncEvents.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>Sync history</DialogTitle>
          <DialogDescription>
            Recent Xero imports, automation checks, and sales invoice sends.
          </DialogDescription>
        </DialogHeader>

        {!hasHistory ? (
          <InsetPanel tone="muted" padding="xl" className="text-center">
            <SurfacePanel
              tone="background"
              className="mx-auto flex size-(--space-20) items-center justify-center p-0 text-muted-foreground"
            >
              <HugeiconsIcon icon={FileExportIcon} strokeWidth={2} />
            </SurfacePanel>
            <p className="mt-(--space-6) text-[length:var(--text-sm)] font-medium text-foreground">
              No sync history yet.
            </p>
            <p className="mx-auto mt-(--space-2) max-w-md text-[length:var(--text-sm)] text-muted-foreground">
              Xero imports and sent invoices will appear here.
            </p>
          </InsetPanel>
        ) : (
          <div className="max-h-[420px] space-y-(--space-8) overflow-auto">
            {syncEvents.length > 0 ? (
              <div>
                <h3 className="mb-(--space-3) text-[length:var(--text-sm)] font-medium text-foreground">
                  Automation
                </h3>
                <ListFrame>
                  {syncEvents.map((event) => {
                    const detail = metadataText(event.metadata);

                    return (
                      <ListFrameItem
                        key={event.id}
                        className="grid gap-(--space-4) p-(--space-6) sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-(--space-4)">
                            <p className="truncate text-[length:var(--text-sm)] font-medium text-foreground">
                              {syncEventTitle(event.eventType)}
                            </p>
                            <ConfiguredBadge
                              value={event.outcome}
                              config={syncOutcomeBadgeConfig}
                            />
                          </div>
                          <p className="mt-(--space-2) text-[length:var(--text-xs)] text-muted-foreground">
                            {event.tenantName ?? "Xero"} · {event.source}
                          </p>
                          {detail ? (
                            <p
                              className={cn(
                                "mt-(--space-2) text-[length:var(--text-xs)]",
                                event.outcome === "failure"
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                              )}
                            >
                              {detail}
                            </p>
                          ) : null}
                        </div>
                        <p className="text-[length:var(--text-xs)] text-muted-foreground">
                          {formatDateTimeLabel(event.occurredAt, timeZone)}
                        </p>
                      </ListFrameItem>
                    );
                  })}
                </ListFrame>
              </div>
            ) : null}

            {importRuns.length > 0 ? (
              <div>
                <h3 className="mb-(--space-3) text-[length:var(--text-sm)] font-medium text-foreground">
                  Imports
                </h3>
                <ListFrame>
                  {importRuns.map((run) => (
                    <ListFrameItem
                      key={run.id}
                      className="grid gap-(--space-4) p-(--space-6) sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-(--space-4)">
                          <p className="truncate text-[length:var(--text-sm)] font-medium text-foreground">
                            {importRunTitle(run.entityType)}
                          </p>
                          <ConfiguredBadge
                            value={run.status}
                            config={importRunBadgeConfig}
                            fallback={{ label: "Imported", variant: "outline" }}
                          />
                          {run.errorCount > 0 ? (
                            <Badge variant="destructive">{run.errorCount} errors</Badge>
                          ) : null}
                        </div>
                        <p className="mt-(--space-2) text-[length:var(--text-xs)] text-muted-foreground">
                          {run.tenantName} · {run.createdCount} created,{" "}
                          {run.updatedCount} updated, {run.skippedCount} skipped
                        </p>
                      </div>
                      <p className="text-[length:var(--text-xs)] text-muted-foreground">
                        {formatDateTimeLabel(run.createdAt, timeZone)}
                      </p>
                    </ListFrameItem>
                  ))}
                </ListFrame>
              </div>
            ) : null}

            {rows.length > 0 ? (
              <div>
                <h3 className="mb-(--space-3) text-[length:var(--text-sm)] font-medium text-foreground">
                  Invoices
                </h3>
                <ListFrame>
                  {rows.map((row) => (
                    <ListFrameItem
                      key={`${row.sourceType}-${row.id}`}
                      className="grid gap-(--space-4) p-(--space-6) sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-(--space-4)">
                          <p className="truncate text-[length:var(--text-sm)] font-medium text-foreground">
                            {row.sourceNumber}
                          </p>
                          <ConfiguredBadge
                            value={row.xeroPushStatus ?? "pending"}
                            config={xeroPushStatusBadgeConfig}
                            fallback={(value) => ({ label: value, variant: "secondary" })}
                          />
                        </div>
                        <p className="mt-(--space-2) text-[length:var(--text-xs)] text-muted-foreground">
                          {row.sourceType === "sales_order"
                            ? "Sales invoice"
                            : "Purchase order"}{" "}
                          · {row.partyName}
                          {row.xeroDocumentNumber ? ` · Xero ${row.xeroDocumentNumber}` : ""}
                        </p>
                        {row.xeroPushError ? (
                          <p className="mt-(--space-2) text-[length:var(--text-xs)] text-destructive">
                            {row.xeroPushError}
                          </p>
                        ) : null}
                      </div>
                      <p className="text-[length:var(--text-xs)] text-muted-foreground">
                        {formatDateTimeLabel(row.xeroPushedAt ?? row.updatedAt, timeZone)}
                      </p>
                    </ListFrameItem>
                  ))}
                </ListFrame>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

export function IntegrationsSection({
  connection,
  quickBooksConnection,
  error,
  canManageConnection,
  canManageSalesXero,
  canManagePurchasingXero,
  canImportCustomers,
  canImportSuppliers,
  importRuns,
  syncEvents,
  exportRows,
  purchaseOrderSyncConfigured,
  timeZone,
}: {
  connection: XeroConnectionSummary | null;
  quickBooksConnection: AccountingConnectionSummary | null;
  error?: string;
  canManageConnection: boolean;
  canManageSalesXero: boolean;
  canManagePurchasingXero: boolean;
  canImportCustomers: boolean;
  canImportSuppliers: boolean;
  importRuns: XeroImportRunSummary[];
  syncEvents: XeroSyncEventSummary[];
  exportRows: XeroExportHistoryRow[];
  purchaseOrderSyncConfigured: boolean;
  timeZone: string;
}) {
  return (
    <SettingsPanel id="integrations">
      <SettingsPanelHeader title="Integrations" />
      <div className="flex flex-col gap-(--space-8) p-(--space-8)">
        <XeroRow
          connection={connection}
          error={error}
          canManageConnection={canManageConnection}
          canManageSalesXero={canManageSalesXero}
          canManagePurchasingXero={canManagePurchasingXero}
          canImportCustomers={canImportCustomers}
          canImportSuppliers={canImportSuppliers}
          importRuns={importRuns}
          syncEvents={syncEvents}
          exportRows={exportRows}
          purchaseOrderSyncConfigured={purchaseOrderSyncConfigured}
          timeZone={timeZone}
        />
        <QuickBooksRow
          connection={quickBooksConnection}
          canManageConnection={canManageConnection}
          canImportSuppliers={canImportSuppliers}
        />
      </div>
    </SettingsPanel>
  );
}
