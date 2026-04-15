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

export function XeroImportSection() {
  const customersMutation = useImportMutation("/api/xero/import/customers");
  const suppliersMutation = useImportMutation("/api/xero/import/suppliers");
  const [customerSummary, setCustomerSummary] = useState<ImportResult | null>(
    null
  );
  const [supplierSummary, setSupplierSummary] = useState<ImportResult | null>(
    null
  );

  return (
    <div className="space-y-4 border-t pt-6">
      <div>
        <h3 className="text-base font-medium">Import from Xero</h3>
        <p className="text-sm text-muted-foreground">
          Pull existing contacts so you don&apos;t have to re-key customers and
          suppliers. Matches by Xero contact ID, then email, then name.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() =>
            customersMutation.mutate(undefined, {
              onSuccess: (data) => setCustomerSummary(data),
            })
          }
          disabled={customersMutation.isPending}
        >
          {customersMutation.isPending
            ? "Importing customers..."
            : "Import customers"}
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            suppliersMutation.mutate(undefined, {
              onSuccess: (data) => setSupplierSummary(data),
            })
          }
          disabled={suppliersMutation.isPending}
        >
          {suppliersMutation.isPending
            ? "Importing suppliers..."
            : "Import suppliers"}
        </Button>
      </div>

      {customerSummary && (
        <ImportSummary label="Customers" summary={customerSummary} />
      )}
      {supplierSummary && (
        <ImportSummary label="Suppliers" summary={supplierSummary} />
      )}
      {customersMutation.error && (
        <p className="text-sm text-destructive">
          Customers: {(customersMutation.error as Error).message}
        </p>
      )}
      {suppliersMutation.error && (
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
