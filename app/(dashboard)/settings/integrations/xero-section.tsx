"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
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
import { formatDateTime } from "@/lib/format";
import type { XeroConnectionSummary } from "@/lib/dal/xero";
import { XeroImportSection } from "./xero-import-section";

const ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: "Security check failed. Please try connecting Xero again.",
  callback_failed:
    "Xero rejected the connection. Double-check your client credentials and retry.",
  access_denied: "You declined the Xero authorization request.",
};

export function XeroSection({
  connection,
  error,
}: {
  connection: XeroConnectionSummary | null;
  error?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [accountCode, setAccountCode] = useState(
    connection?.defaultAccountCode ?? ""
  );
  const [taxType, setTaxType] = useState(connection?.defaultTaxType ?? "");
  const [invoiceStatus, setInvoiceStatus] = useState<"DRAFT" | "AUTHORISED">(
    (connection?.invoiceStatusPreference as "DRAFT" | "AUTHORISED") ??
      "AUTHORISED"
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Xero</CardTitle>
          <p className="text-sm text-muted-foreground">
            Push customers and invoices to Xero when orders ship, and import
            existing contacts to seed your ERP.
          </p>
        </div>
        {connection ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
          >
            {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
          </Button>
        ) : (
          <Button asChild size="sm">
            <a href="/api/xero/connect">Connect Xero</a>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <FieldError>
            {ERROR_MESSAGES[error] ?? `Xero connection failed (${error}).`}
          </FieldError>
        )}
        {formError && <FieldError>{formError}</FieldError>}

        {connection ? (
          <>
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{connection.tenantName}</p>
                  <p className="text-muted-foreground">
                    Last updated {formatDateTime(connection.updatedAt)}
                  </p>
                </div>
              </div>
            </div>

            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="xero-account-code">
                    Default account code
                  </FieldLabel>
                  <FieldDescription>
                    GL account code applied to every invoice line (e.g. 200).
                  </FieldDescription>
                  <Input
                    id="xero-account-code"
                    value={accountCode}
                    onChange={(event) => setAccountCode(event.target.value)}
                    placeholder="200"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="xero-tax-type">
                    Default tax type
                  </FieldLabel>
                  <FieldDescription>
                    Xero TaxType string (e.g. NONE, OUTPUT).
                  </FieldDescription>
                  <Input
                    id="xero-tax-type"
                    value={taxType}
                    onChange={(event) => setTaxType(event.target.value)}
                    placeholder="NONE"
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel>Invoice status</FieldLabel>
                <FieldDescription>
                  DRAFT lets you review in Xero before sending. AUTHORISED is
                  final.
                </FieldDescription>
                <Select
                  value={invoiceStatus}
                  onValueChange={(value) =>
                    setInvoiceStatus(value as "DRAFT" | "AUTHORISED")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUTHORISED">AUTHORISED</SelectItem>
                    <SelectItem value="DRAFT">DRAFT</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <div>
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? "Saving..." : "Save settings"}
                </Button>
              </div>
            </FieldGroup>

            <XeroImportSection />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Connect a Xero organization to start pushing invoices and importing
            contacts.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
