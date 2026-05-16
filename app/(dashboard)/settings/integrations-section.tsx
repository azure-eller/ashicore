"use client";

import { useState } from "react";
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
import { cn } from "@/lib/utils";
import { ACCOUNTING_PROVIDER_QUICKBOOKS } from "@/lib/accounting/constants";
import type { AccountingConnectionSummary } from "@/lib/dal/accounting";
import type {
  XeroConnectionSummary,
  XeroExportHistoryRow,
  XeroImportRunSummary,
} from "@/lib/dal/xero";
import {
  AccountingPurchaseOrderImportButton,
  XeroImportSection,
} from "./integrations/xero-import-section";
import { SettingsPanel, SettingsPanelHeader } from "./settings-panel";

const ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: "Security check failed. Please try connecting Xero again.",
  callback_failed:
    "Xero rejected the connection. Double-check your client credentials and retry.",
  access_denied: "You declined the Xero authorization request.",
};
const XERO_PO_ACCOUNT_FALLBACK_VALUE = "__fallback__";

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

const TAX_DESCRIPTIONS: Record<string, string> = {
  OUTPUT: "Standard tax treatment for sales invoices.",
  OUTPUT2: "Reduced-rate tax treatment for sales invoices.",
  ZERORATEDOUTPUT: "0% tax treatment for eligible sales.",
  EXEMPTOUTPUT: "No tax is applied to the invoice.",
  INPUT: "Standard tax treatment for purchases.",
  INPUT2: "Reduced-rate tax treatment for purchases.",
  ZERORATEDINPUT: "0% tax treatment for eligible purchases.",
  EXEMPTINPUT: "No tax is applied to the purchase order.",
  NONE: "Use when this Xero organisation should not apply tax.",
};

const SALES_TAX_OPTIONS = [
  "OUTPUT",
  "OUTPUT2",
  "ZERORATEDOUTPUT",
  "EXEMPTOUTPUT",
  "NONE",
] as const;

const PURCHASE_TAX_OPTIONS = [
  "INPUT",
  "INPUT2",
  "ZERORATEDINPUT",
  "EXEMPTINPUT",
  "NONE",
] as const;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Awaiting approval",
  AUTHORISED: "Approved",
};

const STATUS_DESCRIPTIONS: Record<string, string> = {
  DRAFT: "Saved in Xero for review before approval.",
  SUBMITTED: "Submitted in Xero and waiting for approval.",
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
    | "autoPushPurchaseOrders"
    | "autoSyncPurchaseOrdersFromAccounting";
  value: boolean;
} | null;

function FriendlyTax({ value }: { value: string | null }) {
  if (!value) return <span>Not set</span>;
  return <span>{TAX_LABELS[value] ?? value}</span>;
}

function FriendlyStatus({ value }: { value: string }) {
  return <span>{STATUS_LABELS[value] ?? value}</span>;
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

function DotBadge({
  variant,
  children,
}: {
  variant: "success" | "secondary" | "warning";
  children: React.ReactNode;
}) {
  return (
    <Badge variant={variant}>
      <span className="size-(--space-3) bg-current" />
      {children}
    </Badge>
  );
}

function XeroLogo() {
  return (
    <div
      aria-hidden
      className="flex size-(--space-20) shrink-0 items-center justify-center bg-primary text-primary-foreground shadow-none"
    >
      <span className="relative flex size-(--space-10) items-center justify-center border border-primary-foreground/40">
        <span className="absolute h-(--space-1) w-(--space-8) rotate-45 bg-primary-foreground" />
        <span className="absolute h-(--space-1) w-(--space-8) -rotate-45 bg-primary-foreground" />
      </span>
    </div>
  );
}

function DefaultChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-h-(--height-input-sm) items-center gap-(--space-2) border bg-background px-(--space-4) py-(--space-1) text-[length:var(--text-xs)] font-medium text-foreground">
      {children}
    </span>
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
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
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
    <div className="grid gap-3 border-t py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <label className="flex min-w-0 items-start gap-3">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          aria-label={ariaLabel}
          className="mt-0.5"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">{meta}</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">{children}</div>
    </div>
  );
}

function PostingDefaultsSummary({
  connection,
  onEdit,
  onHistory,
  onToggleAutoPush,
  canManageConnection,
}: {
  connection: XeroConnectionSummary;
  onEdit: () => void;
  onHistory: () => void;
  onToggleAutoPush: (
    key:
      | "autoPushSalesInvoices"
      | "autoPushPurchaseOrders"
      | "autoSyncPurchaseOrdersFromAccounting",
    value: boolean
  ) => void;
  canManageConnection: boolean;
}) {
  const salesAccount = connection.defaultAccountCode;
  const purchaseAccount =
    connection.purchaseOrderDefaultAccountCode ?? connection.defaultAccountCode;
  const salesTax = connection.defaultTaxType;
  const purchaseTax =
    connection.purchaseOrderDefaultTaxType ?? connection.defaultTaxType;

  return (
    <div className="border-t p-5">
      <SectionHeading
        title="Automation"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onHistory}>
              <HugeiconsIcon icon={TimelineListIcon} strokeWidth={2} />
              History
            </Button>
            {canManageConnection ? (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
                Defaults
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mt-2">
        <AutomationRow
          checked={connection.autoPushSalesInvoices}
          disabled={!canManageConnection}
          onCheckedChange={(value) =>
            onToggleAutoPush("autoPushSalesInvoices", value)
          }
          ariaLabel="Auto-export sales invoices"
          title="Sales invoices"
          meta="Export shipped or manually invoiced sales orders."
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

        <AutomationRow
          checked={connection.autoPushPurchaseOrders}
          disabled={!canManageConnection}
          onCheckedChange={(value) =>
            onToggleAutoPush("autoPushPurchaseOrders", value)
          }
          ariaLabel="Auto-export purchase orders"
          title="Purchase orders"
          meta="Export submitted ERP purchase orders."
        >
            <DefaultChip>
              <span className="font-mono">{purchaseAccount ?? "Account"}</span>
            </DefaultChip>
            <DefaultChip>
              <FriendlyTax value={purchaseTax} />
            </DefaultChip>
            <DefaultChip>
              <FriendlyStatus value={connection.purchaseOrderStatusPreference} />
            </DefaultChip>
        </AutomationRow>

        <AutomationRow
          checked={connection.autoSyncPurchaseOrdersFromAccounting}
          disabled={!canManageConnection}
          onCheckedChange={(value) =>
            onToggleAutoPush("autoSyncPurchaseOrdersFromAccounting", value)
          }
          ariaLabel="Auto-sync purchase orders from Xero"
          title="Purchase order import"
          meta="Import open Xero purchase orders for receiving."
        >
            <DefaultChip>Creates missing materials</DefaultChip>
            <DefaultChip>Open POs only</DefaultChip>
        </AutomationRow>
      </div>
    </div>
  );
}

function ImportFromXeroSection({
  canImportCustomers,
  canImportSuppliers,
  canResetCustomerImports,
  canResetSupplierImports,
  importRuns,
}: {
  canImportCustomers: boolean;
  canImportSuppliers: boolean;
  canResetCustomerImports: boolean;
  canResetSupplierImports: boolean;
  importRuns: XeroImportRunSummary[];
}) {
  if (!canImportCustomers && !canImportSuppliers) return null;

  return (
    <div className="border-t p-5">
      <SectionHeading title="Imports" />
      <div className="mt-3">
        <XeroImportSection
          canImportCustomers={canImportCustomers}
          canImportSuppliers={canImportSuppliers}
          canResetCustomerImports={canResetCustomerImports}
          canResetSupplierImports={canResetSupplierImports}
          importRuns={importRuns}
        />
      </div>
    </div>
  );
}

function XeroRow({
  connection,
  error,
  canManageConnection,
  canImportCustomers,
  canImportSuppliers,
  canResetCustomerImports,
  canResetSupplierImports,
  importRuns,
  exportRows,
}: {
  connection: XeroConnectionSummary | null;
  error?: string;
  canManageConnection: boolean;
  canImportCustomers: boolean;
  canImportSuppliers: boolean;
  canResetCustomerImports: boolean;
  canResetSupplierImports: boolean;
  importRuns: XeroImportRunSummary[];
  exportRows: XeroExportHistoryRow[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState<DialogKey>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [autoPushChange, setAutoPushChange] = useState<AutoPushChange>(null);

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/xero/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Failed to disconnect Xero.");
    },
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
      const res = await fetch("/api/xero/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultAccountCode: connection.defaultAccountCode,
          defaultTaxType: connection.defaultTaxType,
          invoiceStatusPreference: connection.invoiceStatusPreference,
          autoPushSalesInvoices:
            change.key === "autoPushSalesInvoices"
              ? change.value
              : connection.autoPushSalesInvoices,
          autoPushPurchaseOrders:
            change.key === "autoPushPurchaseOrders"
              ? change.value
              : connection.autoPushPurchaseOrders,
          autoSyncPurchaseOrdersFromAccounting:
            change.key === "autoSyncPurchaseOrdersFromAccounting"
              ? change.value
              : connection.autoSyncPurchaseOrdersFromAccounting,
          autoEmailSalesInvoices: connection.autoEmailSalesInvoices,
          autoEmailPurchaseOrders: connection.autoEmailPurchaseOrders,
          purchaseOrderDefaultAccountCode: connection.purchaseOrderDefaultAccountCode,
          purchaseOrderDefaultTaxType: connection.purchaseOrderDefaultTaxType,
          purchaseOrderStatusPreference: connection.purchaseOrderStatusPreference,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to save Xero settings.");
      }
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
    <div className="overflow-hidden border bg-card shadow-none">
      <div className="flex flex-col gap-(--space-8) p-(--space-10) sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-(--space-6)">
          <XeroLogo />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-(--space-4)">
              <h3 className="text-[length:var(--text-base)] leading-[var(--leading-base)] font-semibold text-foreground">Xero</h3>
              {isConnected ? (
                <DotBadge variant="success">Connected</DotBadge>
              ) : (
                <Badge variant="secondary">Not connected</Badge>
              )}
            </div>
            <p className="mt-(--space-2) truncate text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-muted-foreground">
              {isConnected
                ? `${connection.tenantName} · Accounting exports enabled`
                : "Push invoices and POs to Xero automatically. Import contacts when needed."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-(--space-4)">
          {isConnected ? (
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
                    Export history
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
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="border-t px-(--space-10) py-(--space-6)">
          <FieldError>
            {ERROR_MESSAGES[error] ?? `Xero connection failed (${error}).`}
          </FieldError>
        </div>
      ) : null}

      {isConnected ? (
        <>
          <PostingDefaultsSummary
            connection={connection}
            canManageConnection={canManageConnection}
            onEdit={() => setOpenDialog("defaults")}
            onHistory={() => setOpenDialog("history")}
            onToggleAutoPush={(key, value) => {
              if (connection[key] === value) return;
              setFormError(null);
              setAutoPushChange({ key, value });
            }}
          />
          <ImportFromXeroSection
            canImportCustomers={canImportCustomers}
            canImportSuppliers={canImportSuppliers}
            canResetCustomerImports={canResetCustomerImports}
            canResetSupplierImports={canResetSupplierImports}
            importRuns={importRuns}
          />
        </>
      ) : null}

      {connection ? (
        <>
          {openDialog === "defaults" ? (
            <PostingDefaultsDialog
              open
              connection={connection}
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
        rows={exportRows}
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
    </div>
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
  const [summary, setSummary] = useState<{
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  const autoSyncMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!connection) throw new Error("QuickBooks is not connected.");
      const res = await fetch(
        `/api/accounting/connections/${ACCOUNTING_PROVIDER_QUICKBOOKS}/settings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            autoSyncPurchaseOrdersFromAccounting: enabled,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to save QuickBooks settings.");
      }
    },
    onSuccess: () => {
      router.refresh();
      queryClient.invalidateQueries();
    },
    onError: (err) => setError((err as Error).message),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/quickbooks/disconnect", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to disconnect QuickBooks.");
      }
    },
    onSuccess: () => {
      router.refresh();
      queryClient.invalidateQueries();
    },
    onError: (err) => setError((err as Error).message),
  });

  const isConnected = connection != null;

  return (
    <div className="overflow-hidden border bg-card shadow-none">
      <div className="flex flex-col gap-(--space-8) p-(--space-10) sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-(--space-6)">
          <div className="flex size-(--space-20) items-center justify-center border bg-muted text-[length:var(--text-sm)] font-semibold">
            QB
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-(--space-4)">
              <h3 className="text-[length:var(--text-base)] leading-[var(--leading-base)] font-semibold text-foreground">
                QuickBooks
              </h3>
              {isConnected ? (
                <DotBadge variant="success">Connected</DotBadge>
              ) : (
                <Badge variant="secondary">Not connected</Badge>
              )}
            </div>
            <p className="mt-(--space-2) truncate text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-muted-foreground">
              {isConnected
                ? `${connection.tenantName} · Accounting provider`
                : "Connect QuickBooks as an accounting provider."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isConnected && canImportSuppliers ? (
            <AccountingPurchaseOrderImportButton
              provider={ACCOUNTING_PROVIDER_QUICKBOOKS}
              onComplete={setSummary}
            />
          ) : null}
          {isConnected && canManageConnection ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              Disconnect
            </Button>
          ) : !isConnected && canManageConnection ? (
            <Button size="sm" asChild>
              <a href="/api/quickbooks/connect">Connect</a>
            </Button>
          ) : null}
        </div>
      </div>
      {isConnected ? (
        <div className="grid gap-3 border-t p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <label className="flex min-w-0 gap-3">
            <Checkbox
              checked={connection.autoSyncPurchaseOrdersFromAccounting}
              disabled={!canManageConnection || autoSyncMutation.isPending}
              onCheckedChange={(value) => {
                setError(null);
                autoSyncMutation.mutate(value === true);
              }}
              aria-label="Auto-sync purchase orders from QuickBooks"
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                Purchase order import
              </span>
              <span className="text-xs text-muted-foreground">
                Check to automatically import open QuickBooks purchase orders.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:justify-end">
            <DefaultChip>Creates missing materials</DefaultChip>
            <DefaultChip>Open POs only</DefaultChip>
          </div>
        </div>
      ) : null}
      {summary ? (
        <div className="border-t px-5 py-3 text-sm text-muted-foreground">
          {summary.created} created, {summary.updated} updated, {summary.skipped} skipped
          {summary.errors.length > 0 ? `, ${summary.errors.length} errors` : null}
        </div>
      ) : null}
      {error ? (
        <div className="border-t px-5 py-3">
          <FieldError>{error}</FieldError>
        </div>
      ) : null}
    </div>
  );
}

function PostingDefaultsDialog({
  open,
  connection,
  onOpenChange,
}: {
  open: boolean;
  connection: XeroConnectionSummary;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"sales" | "purchases">("sales");
  const [accountCode, setAccountCode] = useState(
    connection.defaultAccountCode ?? ""
  );
  const [taxType, setTaxType] = useState(connection.defaultTaxType ?? "");
  const [invoiceStatus, setInvoiceStatus] = useState<"DRAFT" | "AUTHORISED">(
    (connection.invoiceStatusPreference as "DRAFT" | "AUTHORISED") ??
      "DRAFT"
  );
  const [poAccountCode, setPoAccountCode] = useState(
    connection.purchaseOrderDefaultAccountCode ?? ""
  );
  const [poTaxType, setPoTaxType] = useState(
    connection.purchaseOrderDefaultTaxType ?? ""
  );
  const [poStatus, setPoStatus] = useState<"DRAFT" | "SUBMITTED" | "AUTHORISED">(
    (connection.purchaseOrderStatusPreference as
      | "DRAFT"
      | "SUBMITTED"
      | "AUTHORISED") ?? "DRAFT"
  );
  const [formError, setFormError] = useState<string | null>(null);
  const accountsQuery = useQuery({
    queryKey: ["xero-accounts", connection.tenantId],
    queryFn: async () => {
      const res = await fetch("/api/xero/accounts");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? "Failed to load Xero accounts.");
      }
      return body as {
        accounts: Array<{
          code: string;
          name: string;
          type: string | null;
          taxType: string | null;
          class: string | null;
        }>;
      };
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/xero/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultAccountCode: accountCode.trim() || null,
          defaultTaxType: taxType.trim() || null,
          invoiceStatusPreference: invoiceStatus,
          autoPushSalesInvoices: connection.autoPushSalesInvoices,
          autoPushPurchaseOrders: connection.autoPushPurchaseOrders,
          autoSyncPurchaseOrdersFromAccounting:
            connection.autoSyncPurchaseOrdersFromAccounting,
          autoEmailSalesInvoices: connection.autoEmailSalesInvoices,
          autoEmailPurchaseOrders: connection.autoEmailPurchaseOrders,
          purchaseOrderDefaultAccountCode: poAccountCode.trim() || null,
          purchaseOrderDefaultTaxType: poTaxType.trim() || null,
          purchaseOrderStatusPreference: poStatus,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to save Xero settings.");
      }
    },
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
    onError: (err) => setFormError((err as Error).message),
  });

  const activeTax = tab === "sales" ? taxType : poTaxType || taxType;
  const activeStatus = tab === "sales" ? invoiceStatus : poStatus;
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
          <DialogTitle>Posting defaults</DialogTitle>
          <DialogDescription>
            Defaults applied when records export to Xero.
          </DialogDescription>
        </DialogHeader>

        <div className="flex bg-muted p-(--space-1)">
          <button
            type="button"
            className={cn(
              "flex-1 px-(--space-6) py-(--space-3) text-[length:var(--text-sm)] font-medium transition",
              tab === "sales"
                ? "bg-background text-foreground shadow-none"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("sales")}
          >
            Sales invoices
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 px-(--space-6) py-(--space-3) text-[length:var(--text-sm)] font-medium transition",
              tab === "purchases"
                ? "bg-background text-foreground shadow-none"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("purchases")}
          >
            Purchase orders
          </button>
        </div>

        {formError ? <FieldError>{formError}</FieldError> : null}

        <FieldGroup>
          {tab === "sales" ? (
            <>
              <Field>
                <FieldLabel htmlFor="xero-account-code">Account code</FieldLabel>
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
                    placeholder={
                      accountsQuery.isLoading ? "Loading accounts..." : "200"
                    }
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
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
                  <FieldLabel htmlFor="xero-invoice-status">Push as</FieldLabel>
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
            </>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="xero-po-account-code">Account code</FieldLabel>
                {accounts.length > 0 ? (
                  <Select
                    value={poAccountCode || XERO_PO_ACCOUNT_FALLBACK_VALUE}
                    onValueChange={(value) =>
                      setPoAccountCode(
                        value === XERO_PO_ACCOUNT_FALLBACK_VALUE ? "" : value
                      )
                    }
                  >
                    <SelectTrigger id="xero-po-account-code" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={XERO_PO_ACCOUNT_FALLBACK_VALUE}>
                        Use invoice account fallback
                      </SelectItem>
                      {accounts.map((account) => (
                        <SelectItem key={account.code} value={account.code}>
                          {accountLabel(account.code)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="xero-po-account-code"
                    value={poAccountCode}
                    onChange={(event) => setPoAccountCode(event.target.value)}
                    placeholder={
                      accountsQuery.isLoading
                        ? "Loading accounts..."
                        : "Falls back to invoice code"
                    }
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="xero-po-tax-type">Tax treatment</FieldLabel>
                  <TaxSelect
                    id="xero-po-tax-type"
                    value={poTaxType}
                    options={PURCHASE_TAX_OPTIONS}
                    onValueChange={setPoTaxType}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="xero-po-status">Push as</FieldLabel>
                  <Select
                    value={poStatus}
                    onValueChange={(value) =>
                      setPoStatus(value as "DRAFT" | "SUBMITTED" | "AUTHORISED")
                    }
                  >
                    <SelectTrigger id="xero-po-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DRAFT">Draft</SelectItem>
                      <SelectItem value="SUBMITTED">Awaiting approval</SelectItem>
                      <SelectItem value="AUTHORISED">Approved</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </>
          )}
        </FieldGroup>

        <div className="border bg-muted p-(--space-6) text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-muted-foreground">
          <p>{TAX_DESCRIPTIONS[activeTax] ?? "Xero tax code saved as entered."}</p>
          <p className="mt-1">
            {STATUS_DESCRIPTIONS[activeStatus] ??
              "Xero export status saved as selected."}
          </p>
        </div>

        <DialogFooter className="items-center justify-between sm:justify-between">
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

        <div className="border border-warning bg-[var(--color-warning-soft)] p-(--space-8) text-[length:var(--text-sm)] text-warning">
          <div className="flex gap-(--space-6)">
            <HugeiconsIcon icon={Alert02Icon} className="mt-(--space-1) size-(--space-8)" strokeWidth={2} />
            <div>
              <p className="font-medium">After disconnecting</p>
              <ul className="mt-(--space-4) list-disc space-y-(--space-2) pl-(--space-8)">
                <li>New invoices and POs will stop exporting to Xero.</li>
                <li>Customer and supplier imports will be unavailable.</li>
                <li>Already-exported records remain in both systems.</li>
              </ul>
            </div>
          </div>
        </div>

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
      : "purchase orders";
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
                ? `New ${documentLabel} will be created in Xero automatically when the ERP workflow reaches export.`
                : `New ${documentLabel} will stay in ERP until someone creates the Xero record manually.`}
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
    mutationFn: async (tenantId: string) => {
      const res = await fetch("/api/xero/switch-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to switch tenant.");
      }
    },
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
              <button
                key={tenant.tenantId}
                type="button"
                onClick={() => setPendingTenantId(tenant.tenantId)}
                className={cn(
                  "flex w-full items-center gap-(--space-6) border p-(--space-6) text-left transition",
                  selected
                    ? "border-foreground shadow-[var(--focus-ring)]"
                    : "hover:bg-muted/50"
                )}
              >
                <span
                  className={cn(
                    "flex size-(--space-8) items-center justify-center rounded-full border",
                    selected && "border-foreground"
                  )}
                >
                  {selected ? <span className="size-(--space-4) rounded-full bg-foreground" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      {tenant.tenantName}
                    </span>
                    {current ? <Badge variant="secondary">Current</Badge> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {tenant.tenantId}
                  </span>
                </span>
              </button>
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
            ["Auto-export sales invoices", "Shipped sales orders can create Xero invoices."],
            ["Auto-export purchase orders", "Submitted POs can create Xero purchase orders."],
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

        <DialogFooter className="items-center justify-between sm:justify-between">
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
  rows,
  onOpenChange,
}: {
  open: boolean;
  rows: XeroExportHistoryRow[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>Export history</DialogTitle>
          <DialogDescription>
            Recent sales invoice and purchase order exports to Xero.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="border bg-muted p-(--space-16) text-center">
            <div className="mx-auto flex size-(--space-20) items-center justify-center border bg-background text-muted-foreground">
              <HugeiconsIcon icon={FileExportIcon} strokeWidth={2} />
            </div>
            <p className="mt-(--space-6) text-[length:var(--text-sm)] font-medium text-foreground">
              No export history yet.
            </p>
            <p className="mx-auto mt-(--space-2) max-w-md text-[length:var(--text-sm)] text-muted-foreground">
              Exported invoices and purchase orders will appear here.
            </p>
          </div>
        ) : (
          <div className="max-h-[420px] overflow-auto border">
            {rows.map((row) => (
              <div
                key={`${row.sourceType}-${row.id}`}
                className="grid gap-(--space-4) border-t p-(--space-6) first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {row.sourceNumber}
                    </p>
                    <Badge
                      variant={
                        row.xeroPushStatus === "pushed"
                          ? "success"
                          : row.xeroPushStatus === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {row.xeroPushStatus ?? "pending"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.sourceType === "purchase_order"
                      ? "Purchase order"
                      : "Sales invoice"}{" "}
                    · {row.partyName}
                    {row.xeroDocumentNumber ? ` · Xero ${row.xeroDocumentNumber}` : ""}
                  </p>
                  {row.xeroPushError ? (
                    <p className="mt-1 text-xs text-destructive">{row.xeroPushError}</p>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(row.xeroPushedAt ?? row.updatedAt).toLocaleString()}
                </p>
              </div>
            ))}
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
  canImportCustomers,
  canImportSuppliers,
  canResetCustomerImports,
  canResetSupplierImports,
  importRuns,
  exportRows,
}: {
  connection: XeroConnectionSummary | null;
  quickBooksConnection: AccountingConnectionSummary | null;
  error?: string;
  canManageConnection: boolean;
  canImportCustomers: boolean;
  canImportSuppliers: boolean;
  canResetCustomerImports: boolean;
  canResetSupplierImports: boolean;
  importRuns: XeroImportRunSummary[];
  exportRows: XeroExportHistoryRow[];
}) {
  return (
    <SettingsPanel id="integrations">
      <SettingsPanelHeader title="Integrations" />
      <div className="flex flex-col gap-(--space-8) p-(--space-8)">
        <XeroRow
          connection={connection}
          error={error}
          canManageConnection={canManageConnection}
          canImportCustomers={canImportCustomers}
          canImportSuppliers={canImportSuppliers}
          canResetCustomerImports={canResetCustomerImports}
          canResetSupplierImports={canResetSupplierImports}
          importRuns={importRuns}
          exportRows={exportRows}
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
