"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

function useImportMutation(endpoint: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(endpoint, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? "Import failed.");
      }
      return body as ImportResult;
    },
  });
}

export function XeroImportSection({
  canImportCustomers,
  canImportSuppliers,
}: {
  canImportCustomers: boolean;
  canImportSuppliers: boolean;
}) {
  const customersMutation = useImportMutation("/api/xero/import/customers");
  const suppliersMutation = useImportMutation("/api/xero/import/suppliers");
  const [customerSummary, setCustomerSummary] = useState<ImportResult | null>(
    null
  );
  const [supplierSummary, setSupplierSummary] = useState<ImportResult | null>(
    null
  );

  if (!canImportCustomers && !canImportSuppliers) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {canImportCustomers && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              customersMutation.mutate(undefined, {
                onSuccess: (data) => setCustomerSummary(data),
              })
            }
            disabled={customersMutation.isPending}
          >
            {customersMutation.isPending ? "Importing…" : "Import customers"}
          </Button>
        )}
        {canImportSuppliers && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              suppliersMutation.mutate(undefined, {
                onSuccess: (data) => setSupplierSummary(data),
              })
            }
            disabled={suppliersMutation.isPending}
          >
            {suppliersMutation.isPending ? "Importing…" : "Import suppliers"}
          </Button>
        )}
      </div>

      {canImportCustomers && customerSummary && (
        <ImportSummary label="Customers" summary={customerSummary} />
      )}
      {canImportSuppliers && supplierSummary && (
        <ImportSummary label="Suppliers" summary={supplierSummary} />
      )}
      {canImportCustomers && customersMutation.error && (
        <p className="text-sm text-destructive">
          Customers: {(customersMutation.error as Error).message}
        </p>
      )}
      {canImportSuppliers && suppliersMutation.error && (
        <p className="text-sm text-destructive">
          Suppliers: {(suppliersMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}

function ImportSummary({
  label,
  summary,
}: {
  label: string;
  summary: ImportResult;
}) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <p className="font-medium">
        {label}: {summary.created} created, {summary.updated} updated,{" "}
        {summary.skipped} skipped
      </p>
      {summary.errors.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-destructive">
          {summary.errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
