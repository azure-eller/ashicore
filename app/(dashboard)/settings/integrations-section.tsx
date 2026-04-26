"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { XeroConnectionSummary } from "@/lib/dal/xero";
import { XeroImportSection } from "./integrations/xero-import-section";

const ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: "Security check failed. Please try connecting Xero again.",
  callback_failed:
    "Xero rejected the connection. Double-check your client credentials and retry.",
  access_denied: "You declined the Xero authorization request.",
};

function XeroLogo() {
  return (
    <div
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#13B5EA] font-bold text-white"
    >
      X
    </div>
  );
}

function XeroRow({
  connection,
  error,
  canManageConnection,
  canImportCustomers,
  canImportSuppliers,
}: {
  connection: XeroConnectionSummary | null;
  error?: string;
  canManageConnection: boolean;
  canImportCustomers: boolean;
  canImportSuppliers: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isConnected = connection != null;
  const [expanded, setExpanded] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [accountCode, setAccountCode] = useState(connection?.defaultAccountCode ?? "");
  const [taxType, setTaxType] = useState(connection?.defaultTaxType ?? "");
  const [invoiceStatus, setInvoiceStatus] = useState<"DRAFT" | "AUTHORISED">(
    (connection?.invoiceStatusPreference as "DRAFT" | "AUTHORISED") ?? "AUTHORISED"
  );
  const [autoEmailInvoices, setAutoEmailInvoices] = useState(
    connection?.autoEmailSalesInvoices ?? false
  );
  const [poAccountCode, setPoAccountCode] = useState(
    connection?.purchaseOrderDefaultAccountCode ?? ""
  );
  const [poTaxType, setPoTaxType] = useState(
    connection?.purchaseOrderDefaultTaxType ?? ""
  );
  const [poStatus, setPoStatus] = useState<"DRAFT" | "SUBMITTED" | "AUTHORISED">(
    (connection?.purchaseOrderStatusPreference as
      | "DRAFT"
      | "SUBMITTED"
      | "AUTHORISED") ?? "DRAFT"
  );

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/xero/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Failed to disconnect Xero.");
    },
    onSuccess: () => {
      router.refresh();
      queryClient.invalidateQueries();
    },
    onError: (err) => setFormError((err as Error).message),
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
          autoEmailSalesInvoices: autoEmailInvoices,
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
      setFormError(null);
      router.refresh();
    },
    onError: (err) => setFormError((err as Error).message),
  });

  const hasConfigurableContent =
    isConnected && (canManageConnection || canImportCustomers || canImportSuppliers);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <XeroLogo />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Xero</span>
              {isConnected ? (
                <span className="rounded-full border border-green-600/40 bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                  Connected
                </span>
              ) : (
                <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  Not connected
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              Accounting{connection?.tenantName ? ` · ${connection.tenantName}` : ""}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {hasConfigurableContent ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((prev) => !prev)}
              aria-expanded={expanded}
            >
              Configure
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className={cn(
                  "ml-1 size-3.5 transition-transform",
                  expanded && "rotate-180"
                )}
              />
            </Button>
          ) : null}

          {isConnected && canManageConnection ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          ) : null}

          {!isConnected && canManageConnection ? (
            <Button asChild size="sm">
              <a href="/api/xero/connect">Connect</a>
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="px-6 pb-3">
          <FieldError>
            {ERROR_MESSAGES[error] ?? `Xero connection failed (${error}).`}
          </FieldError>
        </div>
      ) : null}

      {expanded && hasConfigurableContent ? (
        <div className="space-y-6 border-t bg-muted/30 px-6 py-5">
          {formError ? <FieldError>{formError}</FieldError> : null}

          {canManageConnection ? (
            <FieldGroup className="gap-6">
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">
                  Sales invoice defaults
                </h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="xero-account-code">Account code</FieldLabel>
                    <Input
                      id="xero-account-code"
                      value={accountCode}
                      onChange={(event) => setAccountCode(event.target.value)}
                      placeholder="200"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="xero-tax-type">Tax type</FieldLabel>
                    <Input
                      id="xero-tax-type"
                      value={taxType}
                      onChange={(event) => setTaxType(event.target.value)}
                      placeholder="NONE"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="xero-invoice-status">Invoice status</FieldLabel>
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
                        <SelectItem value="AUTHORISED">AUTHORISED</SelectItem>
                        <SelectItem value="DRAFT">DRAFT</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field orientation="horizontal">
                  <Switch
                    id="xero-auto-email"
                    checked={autoEmailInvoices}
                    onCheckedChange={(checked) =>
                      setAutoEmailInvoices(Boolean(checked))
                    }
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="xero-auto-email">
                      Auto-email sales invoices
                    </FieldLabel>
                    <FieldDescription>
                      Xero emails the customer after invoice creation. Requires
                      AUTHORISED status and an email on the customer record.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">
                  Purchase order defaults
                </h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="xero-po-account-code">
                      Account code
                    </FieldLabel>
                    <Input
                      id="xero-po-account-code"
                      value={poAccountCode}
                      onChange={(event) => setPoAccountCode(event.target.value)}
                      placeholder="Falls back to invoice code"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="xero-po-tax-type">Tax type</FieldLabel>
                    <Input
                      id="xero-po-tax-type"
                      value={poTaxType}
                      onChange={(event) => setPoTaxType(event.target.value)}
                      placeholder="Falls back to invoice tax type"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="xero-po-status">PO status</FieldLabel>
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
                        <SelectItem value="DRAFT">DRAFT</SelectItem>
                        <SelectItem value="SUBMITTED">SUBMITTED</SelectItem>
                        <SelectItem value="AUTHORISED">AUTHORISED</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </FieldGroup>
          ) : null}

          <XeroImportSection
            canImportCustomers={canImportCustomers}
            canImportSuppliers={canImportSuppliers}
          />
        </div>
      ) : null}
    </div>
  );
}

export function IntegrationsSection({
  connection,
  error,
  canManageConnection,
  canImportCustomers,
  canImportSuppliers,
}: {
  connection: XeroConnectionSummary | null;
  error?: string;
  canManageConnection: boolean;
  canImportCustomers: boolean;
  canImportSuppliers: boolean;
}) {
  return (
    <section id="integrations" className="scroll-mt-24 rounded-lg border">
      <div className="px-6 py-4">
        <h2 className="text-base font-semibold tracking-tight">Integrations</h2>
      </div>
      <div className="border-t">
        <XeroRow
          connection={connection}
          error={error}
          canManageConnection={canManageConnection}
          canImportCustomers={canImportCustomers}
          canImportSuppliers={canImportSuppliers}
        />
      </div>
    </section>
  );
}
