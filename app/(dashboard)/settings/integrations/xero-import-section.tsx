"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/format";
import type { XeroImportRunSummary } from "@/lib/dal/xero";

type EntityType = "customers" | "suppliers";

type ImportResult = {
  runId: string;
  tenantName: string;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

type ContactImportPreview = {
  entityType: EntityType;
  tenantName: string;
  isDemoCompany: boolean;
  totalFetched: number;
  toCreate: number;
  toUpdate: number;
  skipped: number;
  errors: string[];
  sampleCreates: string[];
  sampleUpdates: string[];
  sampleSkipped: string[];
};

type UndoPreview = {
  runId: string;
  entityType: EntityType;
  tenantName: string;
  status: string;
  createdRows: number;
  updatedRows: number;
  blockedRows: number;
  canUndo: boolean;
  sampleNames: string[];
  blockedNames: string[];
};

type DialogAction =
  | { mode: "import"; entityType: EntityType }
  | { mode: "reset"; run: XeroImportRunSummary };

function entityLabel(entityType: EntityType) {
  return entityType === "customers" ? "customers" : "suppliers";
}

function entityTitle(entityType: EntityType) {
  return entityType === "customers" ? "Customers" : "Suppliers";
}

async function readJson<T>(res: Response, defaultError: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? defaultError);
  }
  return body as T;
}

async function fetchPreview(action: DialogAction) {
  if (action.mode === "import") {
    const res = await fetch(`/api/xero/import/${action.entityType}/preview`, {
      method: "POST",
    });
    return readJson<ContactImportPreview>(res, "Failed to preview import.");
  }

  const res = await fetch(`/api/xero/import-runs/${action.run.id}/undo/preview`, {
    method: "POST",
  });
  return readJson<UndoPreview>(res, "Failed to preview reset.");
}

export function XeroImportSection({
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
  const router = useRouter();
  const [runs, setRuns] = useState(importRuns);
  const [dialogAction, setDialogAction] = useState<DialogAction | null>(null);
  const [preview, setPreview] = useState<ContactImportPreview | UndoPreview | null>(
    null
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [customerSummary, setCustomerSummary] = useState<ImportResult | null>(
    null
  );
  const [supplierSummary, setSupplierSummary] = useState<ImportResult | null>(
    null
  );

  useEffect(() => {
    setRuns(importRuns);
  }, [importRuns]);

  useEffect(() => {
    if (!dialogAction) return;

    let active = true;
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);

    fetchPreview(dialogAction)
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch((error) => {
        if (active) setPreviewError((error as Error).message);
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });

    return () => {
      active = false;
    };
  }, [dialogAction]);

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!dialogAction || !preview) return null;

      if (dialogAction.mode === "import") {
        const importPreview = preview as ContactImportPreview;
        const res = await fetch(`/api/xero/import/${dialogAction.entityType}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allowDemoCompany: importPreview.isDemoCompany,
          }),
        });
        return {
          mode: "import" as const,
          entityType: dialogAction.entityType,
          data: await readJson<ImportResult>(res, "Import failed."),
        };
      }

      const res = await fetch(
        `/api/xero/import-runs/${dialogAction.run.id}/undo`,
        { method: "POST" }
      );
      return {
        mode: "reset" as const,
        runId: dialogAction.run.id,
        data: await readJson<UndoPreview>(res, "Reset failed."),
      };
    },
    onSuccess: (result) => {
      if (!result) return;

      if (result.mode === "import") {
        const nextRun: XeroImportRunSummary = {
          id: result.data.runId,
          entityType: result.entityType,
          tenantName: result.data.tenantName,
          status: "completed",
          createdCount: result.data.created,
          updatedCount: result.data.updated,
          skippedCount: result.data.skipped,
          errorCount: result.data.errors.length,
          createdAt: new Date(),
          undoneAt: null,
        };
        setRuns((current) => [nextRun, ...current].slice(0, 8));
        if (result.entityType === "customers") {
          setCustomerSummary(result.data);
        } else {
          setSupplierSummary(result.data);
        }
      } else {
        setRuns((current) =>
          current.map((run) =>
            run.id === result.runId
              ? { ...run, status: "undone", undoneAt: new Date() }
              : run
          )
        );
      }

      setDialogAction(null);
      if (result.mode === "reset") {
        router.refresh();
      }
    },
  });

  if (!canImportCustomers && !canImportSuppliers) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {canImportCustomers ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogAction({ mode: "import", entityType: "customers" })}
          >
            Import customers
          </Button>
        ) : null}
        {canImportSuppliers ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogAction({ mode: "import", entityType: "suppliers" })}
          >
            Import suppliers
          </Button>
        ) : null}
      </div>

      {customerSummary ? (
        <ImportSummary label="Customers" summary={customerSummary} />
      ) : null}
      {supplierSummary ? (
        <ImportSummary label="Suppliers" summary={supplierSummary} />
      ) : null}

      {runs.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">Recent imports</h3>
          <div className="divide-y rounded-md border">
            {runs.map((run) => {
              const canReset =
                run.status === "completed" &&
                ((run.entityType === "customers" && canResetCustomerImports) ||
                  (run.entityType === "suppliers" && canResetSupplierImports));

              return (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">
                        {entityTitle(run.entityType)}
                      </span>
                      <Badge variant={run.status === "undone" ? "secondary" : "outline"}>
                        {run.status === "undone" ? "Reset" : "Imported"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {run.tenantName} · {formatDateTime(run.createdAt)} ·{" "}
                      {run.createdCount} loaded, {run.updatedCount} already existed
                    </div>
                  </div>
                  {canReset ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDialogAction({ mode: "reset", run })}
                    >
                      Reset
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <ImportActionDialog
        action={dialogAction}
        preview={preview}
        previewError={previewError}
        previewLoading={previewLoading}
        pending={actionMutation.isPending}
        actionError={(actionMutation.error as Error | null)?.message ?? null}
        onCancel={() => setDialogAction(null)}
        onConfirm={() => actionMutation.mutate()}
      />
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
    <div className="rounded-md border bg-muted/40 p-3 text-sm">
      <p className="font-medium">
        {label}: {summary.created} loaded, {summary.updated} already existed
      </p>
      {(summary.errors?.length ?? 0) > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-xs text-destructive">
          {(summary.errors ?? []).map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ImportActionDialog({
  action,
  preview,
  previewError,
  previewLoading,
  pending,
  actionError,
  onCancel,
  onConfirm,
}: {
  action: DialogAction | null;
  preview: ContactImportPreview | UndoPreview | null;
  previewError: string | null;
  previewLoading: boolean;
  pending: boolean;
  actionError: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const open = action != null;
  const isImport = action?.mode === "import";
  const entityType =
    action?.mode === "import" ? action.entityType : action?.run.entityType;
  const title = action
    ? isImport
      ? `Import ${entityLabel(entityType!)}`
      : `Reset ${entityLabel(entityType!)} import`
    : "";
  const canConfirm =
    Boolean(preview) &&
    !previewLoading &&
    !previewError &&
    (isImport || (preview as UndoPreview).canUndo);

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <AlertDialogContent size="lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {isImport
              ? "Review the Xero import preview before creating or updating records."
              : "Review the reset preview before undoing this import."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="min-h-24 rounded-md border bg-muted/30 p-3">
          {previewLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Loading preview
            </div>
          ) : previewError ? (
            <p className="text-sm text-destructive">{previewError}</p>
          ) : preview ? (
            isImport ? (
              <ImportPreviewDetails preview={preview as ContactImportPreview} />
            ) : (
              <ResetPreviewDetails preview={preview as UndoPreview} />
            )
          ) : null}
        </div>

        {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button onClick={onConfirm} disabled={!canConfirm || pending}>
            {pending ? (
              <>
                <Spinner />
                Working
              </>
            ) : isImport ? (
              "Import"
            ) : (
              "Reset"
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ImportPreviewDetails({ preview }: { preview: ContactImportPreview }) {
  const entityName =
    preview.entityType === "customers" ? "customers" : "suppliers";

  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <PreviewMetric label="Will load" value={preview.toCreate} />
        <PreviewMetric label="Already exists" value={preview.toUpdate} />
      </div>
      <p className="text-muted-foreground">Xero organisation: {preview.tenantName}</p>
      <p className="text-muted-foreground">
        New records are created only from Xero contacts marked as {entityName}.
        Existing ERP records can still update when matched by Xero ID, email, or name.
      </p>
      {preview.isDemoCompany ? (
        <p className="text-destructive">
          This is Xero Demo Company. Only continue for a test import.
        </p>
      ) : null}
      <PreviewSamples title="Creating" values={preview.sampleCreates} />
      <PreviewSamples title="Updating" values={preview.sampleUpdates} />
      {preview.errors.length > 0 ? (
        <PreviewSamples title="Errors" values={preview.errors.slice(0, 5)} destructive />
      ) : null}
    </div>
  );
}

function ResetPreviewDetails({ preview }: { preview: UndoPreview }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-3">
        <PreviewMetric label="Delete" value={preview.createdRows} />
        <PreviewMetric label="Restore" value={preview.updatedRows} />
        <PreviewMetric label="Blocked" value={preview.blockedRows} />
      </div>
      <p className="text-muted-foreground">Xero organisation: {preview.tenantName}</p>
      {!preview.canUndo ? (
        <p className="text-destructive">
          This import cannot be reset while imported records are referenced.
        </p>
      ) : null}
      <PreviewSamples title="Records" values={preview.sampleNames} />
      <PreviewSamples title="Blocked" values={preview.blockedNames} destructive />
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function PreviewSamples({
  title,
  values,
  destructive,
}: {
  title: string;
  values?: string[];
  destructive?: boolean;
}) {
  if (!values?.length) return null;

  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className={destructive ? "text-destructive" : "text-foreground"}>
        {values.join(", ")}
      </div>
    </div>
  );
}
