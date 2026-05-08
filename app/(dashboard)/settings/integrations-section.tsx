"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import type {
  XeroConnectionSummary,
  XeroImportRunSummary,
} from "@/lib/dal/xero";
import { XeroImportSection } from "./integrations/xero-import-section";

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

function FriendlyTax({ value }: { value: string | null }) {
  if (!value) return <span>Not set</span>;
  return <span>{TAX_LABELS[value] ?? value}</span>;
}

function FriendlyStatus({ value }: { value: string }) {
  return <span>{STATUS_LABELS[value] ?? value}</span>;
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
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </Badge>
  );
}

function XeroLogo() {
  return (
    <div
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-sm"
    >
      <span className="relative flex size-5 items-center justify-center rounded-full border border-white/40">
        <span className="absolute h-0.5 w-4 rotate-45 rounded-full bg-white" />
        <span className="absolute h-0.5 w-4 -rotate-45 rounded-full bg-white" />
      </span>
    </div>
  );
}

function DefaultChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-h-6 items-center gap-1 rounded-md border bg-muted/50 px-2 py-0.5 text-xs font-medium text-foreground">
      {children}
    </span>
  );
}

function ExportVisibilityRow({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-t py-3 first:border-t-0">
      <span className="mt-1 size-2 rounded-full bg-muted-foreground/50 shadow-[0_0_0_3px_hsl(var(--muted-foreground)/0.12)]" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function PostingDefaultsSummary({
  connection,
  onEdit,
  canManageConnection,
}: {
  connection: XeroConnectionSummary;
  onEdit: () => void;
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Posting defaults
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Used when records auto-export. Override per record at any time.
          </p>
        </div>
        {canManageConnection ? (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
            Edit defaults
          </Button>
        ) : null}
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <p className="text-xs font-semibold text-foreground">Sales invoices</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <DefaultChip>
              <span className="font-mono">{salesAccount ?? "Account"}</span>
            </DefaultChip>
            <span>·</span>
            <DefaultChip>
              <FriendlyTax value={salesTax} />
            </DefaultChip>
            <span>·</span>
            <span>push as</span>
            <DefaultChip>
              <FriendlyStatus value={connection.invoiceStatusPreference} />
            </DefaultChip>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-foreground">Purchase orders</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <DefaultChip>
              <span className="font-mono">{purchaseAccount ?? "Account"}</span>
            </DefaultChip>
            <span>·</span>
            <DefaultChip>
              <FriendlyTax value={purchaseTax} />
            </DefaultChip>
            <span>·</span>
            <span>push as</span>
            <DefaultChip>
              <FriendlyStatus value={connection.purchaseOrderStatusPreference} />
            </DefaultChip>
          </div>
        </div>
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
      <div>
        <h3 className="text-sm font-semibold text-foreground">Import from Xero</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          One-time pull to bring existing contacts into the ERP.
        </p>
      </div>

      <div className="mt-4">
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

function ExportActivitySection({ onHistory }: { onHistory: () => void }) {
  return (
    <div className="border-t p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Accounting exports
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Invoices and purchase orders export when ERP workflows reach Xero.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onHistory}>
          <HugeiconsIcon icon={TimelineListIcon} strokeWidth={2} />
          Export history
        </Button>
      </div>

      <div className="mt-3 rounded-lg border bg-muted/20 px-3">
        <ExportVisibilityRow
          label="Sales invoices"
          description="Created in Xero when sales orders are shipped and invoiced."
        />
        <ExportVisibilityRow
          label="Purchase orders"
          description="Created in Xero when purchase orders are submitted."
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
}: {
  connection: XeroConnectionSummary | null;
  error?: string;
  canManageConnection: boolean;
  canImportCustomers: boolean;
  canImportSuppliers: boolean;
  canResetCustomerImports: boolean;
  canResetSupplierImports: boolean;
  importRuns: XeroImportRunSummary[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState<DialogKey>(null);
  const [formError, setFormError] = useState<string | null>(null);

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

  const isConnected = connection != null;

  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <XeroLogo />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">Xero</h3>
              {isConnected ? (
                <DotBadge variant="success">Connected</DotBadge>
              ) : (
                <Badge variant="secondary">Not connected</Badge>
              )}
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {isConnected
                ? `${connection.tenantName} · Accounting exports enabled`
                : "Push invoices and POs to Xero automatically. Import contacts when needed."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isConnected ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpenDialog("history")}
              >
                <HugeiconsIcon icon={TimelineListIcon} strokeWidth={2} />
                Export history
              </Button>
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
        <div className="border-t px-5 py-3">
          <FieldError>
            {ERROR_MESSAGES[error] ?? `Xero connection failed (${error}).`}
          </FieldError>
        </div>
      ) : null}

      {isConnected ? (
        <>
          <ExportActivitySection onHistory={() => setOpenDialog("history")} />
          <PostingDefaultsSummary
            connection={connection}
            canManageConnection={canManageConnection}
            onEdit={() => setOpenDialog("defaults")}
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
        onOpenChange={(open) => setOpenDialog(open ? "history" : null)}
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
      "AUTHORISED"
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/xero/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultAccountCode: accountCode.trim() || null,
          defaultTaxType: taxType.trim() || null,
          invoiceStatusPreference: invoiceStatus,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>Posting defaults</DialogTitle>
          <DialogDescription>
            Defaults applied when records export to Xero.
          </DialogDescription>
        </DialogHeader>

        <div className="flex rounded-lg bg-muted p-1">
          <button
            type="button"
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition",
              tab === "sales"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("sales")}
          >
            Sales invoices
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition",
              tab === "purchases"
                ? "bg-background text-foreground shadow-sm"
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
                <Input
                  id="xero-account-code"
                  value={accountCode}
                  onChange={(event) => setAccountCode(event.target.value)}
                  placeholder="200"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="xero-tax-type">Tax treatment</FieldLabel>
                  <Input
                    id="xero-tax-type"
                    value={taxType}
                    onChange={(event) => setTaxType(event.target.value)}
                    placeholder="NONE"
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
                      <SelectItem value="AUTHORISED">Approved</SelectItem>
                      <SelectItem value="DRAFT">Draft</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="xero-po-account-code">Account code</FieldLabel>
                <Input
                  id="xero-po-account-code"
                  value={poAccountCode}
                  onChange={(event) => setPoAccountCode(event.target.value)}
                  placeholder="Falls back to invoice code"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="xero-po-tax-type">Tax treatment</FieldLabel>
                  <Input
                    id="xero-po-tax-type"
                    value={poTaxType}
                    onChange={(event) => setPoTaxType(event.target.value)}
                    placeholder="Falls back to invoice tax"
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

        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p>{TAX_DESCRIPTIONS[activeTax] ?? "Xero tax code saved as entered."}</p>
          <p className="mt-1">
            {STATUS_DESCRIPTIONS[activeStatus] ??
              "Xero export status saved as selected."}
          </p>
        </div>

        <DialogFooter className="items-center justify-between sm:justify-between">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
            Changes apply to new exports.
          </p>
          <div className="flex gap-2">
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

        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <div className="flex gap-3">
            <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 size-4" strokeWidth={2} />
            <div>
              <p className="font-medium">After disconnecting</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
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

        <div className="space-y-2">
          {tenants.map((tenant) => {
            const selected = pendingTenantId === tenant.tenantId;
            const current = connection.tenantId === tenant.tenantId;

            return (
              <button
                key={tenant.tenantId}
                type="button"
                onClick={() => setPendingTenantId(tenant.tenantId)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition",
                  selected
                    ? "border-foreground ring-2 ring-foreground/10"
                    : "hover:bg-muted/50"
                )}
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-full border",
                    selected && "border-foreground"
                  )}
                >
                  {selected ? <span className="size-2 rounded-full bg-foreground" /> : null}
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

        <div className="space-y-3">
          {[
            ["Auto-export sales invoices", "Shipped sales orders can create Xero invoices."],
            ["Auto-export purchase orders", "Submitted POs can create Xero purchase orders."],
            ["Import contacts", "Pull existing customers and suppliers into ERP."],
            ["Avoid duplicates", "Existing records are matched before import."],
          ].map(([title, description]) => (
            <div key={title} className="flex gap-3">
              <span className="mt-0.5 flex size-6 items-center justify-center rounded-full bg-success/10 text-success">
                <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="items-center justify-between sm:justify-between">
          <Button variant="ghost" size="sm" disabled>
            <HugeiconsIcon icon={HelpCircleIcon} strokeWidth={2} />
            Setup guide
          </Button>
          <div className="flex gap-2">
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
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rows = useMemo(() => [], []);

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
          <div className="rounded-lg border bg-muted/30 p-8 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-background text-muted-foreground">
              <HugeiconsIcon icon={FileExportIcon} strokeWidth={2} />
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">
              No export history yet.
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Exported invoices and purchase orders will appear here.
            </p>
          </div>
        ) : null}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

export function IntegrationsSection({
  connection,
  error,
  canManageConnection,
  canImportCustomers,
  canImportSuppliers,
  canResetCustomerImports,
  canResetSupplierImports,
  importRuns,
}: {
  connection: XeroConnectionSummary | null;
  error?: string;
  canManageConnection: boolean;
  canImportCustomers: boolean;
  canImportSuppliers: boolean;
  canResetCustomerImports: boolean;
  canResetSupplierImports: boolean;
  importRuns: XeroImportRunSummary[];
}) {
  return (
    <section id="integrations" className="scroll-mt-24">
      <div className="mb-3">
        <h2 className="text-base font-semibold tracking-tight">Integrations</h2>
      </div>
      <XeroRow
        connection={connection}
        error={error}
        canManageConnection={canManageConnection}
        canImportCustomers={canImportCustomers}
        canImportSuppliers={canImportSuppliers}
        canResetCustomerImports={canResetCustomerImports}
        canResetSupplierImports={canResetSupplierImports}
        importRuns={importRuns}
      />
    </section>
  );
}
