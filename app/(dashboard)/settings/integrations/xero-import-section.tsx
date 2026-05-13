"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import type { XeroImportRunSummary } from "@/lib/dal/xero";

type EntityType = "customers" | "suppliers";
type ImportRunEntityType = EntityType | "purchasing";

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

type PurchasingCandidateStatus =
  | "ready"
  | "needs_item_match"
  | "needs_supplier_match"
  | "excluded";

type PurchasingCandidate = {
  id: string;
  status: PurchasingCandidateStatus;
  selectedByDefault: boolean;
  exclusionReason: string | null;
  supplierName: string;
  itemName: string | null;
  itemSku: string | null;
  xeroItemCode: string;
  xeroItemName: string | null;
  latestUnitCost: string | null;
  xeroItemUnitPrice: string | null;
  existingSupplierItemUnitCost: string | null;
  occurrences: number;
  latestDate: string | null;
  latestSource: string | null;
};

type PurchasingPreview = {
  tenantName: string;
  sinceDate: string;
  totalXeroPurchasedItems: number;
  totalSourceLines: number;
  summary: {
    ready: number;
    selectedByDefault: number;
    needsItemMatch: number;
    needsSupplierMatch: number;
    excluded: number;
  };
  candidates: PurchasingCandidate[];
};

type PurchasingApplyResult = {
  runId: string;
  tenantName: string;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
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

function entityLabel(entityType: ImportRunEntityType) {
  if (entityType === "customers") return "customers";
  if (entityType === "suppliers") return "suppliers";
  return "purchasing data";
}

function entityTitle(entityType: ImportRunEntityType) {
  if (entityType === "customers") return "Customers";
  if (entityType === "suppliers") return "Suppliers";
  return "Purchasing";
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
  const timeZone = useOrganizationTimeZone();
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
  const [purchasingSummary, setPurchasingSummary] =
    useState<PurchasingApplyResult | null>(null);

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
      <div className="grid gap-3 lg:grid-cols-2">
        {canImportCustomers ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-3 text-sm font-medium text-foreground">Sales</div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogAction({ mode: "import", entityType: "customers" })}
            >
              Import customers
            </Button>
          </div>
        ) : null}
        {canImportSuppliers ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-3 text-sm font-medium text-foreground">Purchasing</div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialogAction({ mode: "import", entityType: "suppliers" })}
              >
                Import suppliers
              </Button>
              <PurchasingSyncDialog
                onComplete={(summary) => {
                  setPurchasingSummary(summary);
                  const nextRun: XeroImportRunSummary = {
                    id: summary.runId,
                    entityType: "purchasing",
                    tenantName: summary.tenantName,
                    status: "completed",
                    createdCount: summary.created,
                    updatedCount: summary.updated,
                    skippedCount: summary.skipped,
                    errorCount: summary.errors.length,
                    createdAt: new Date(),
                    undoneAt: null,
                  };
                  setRuns((current) => [nextRun, ...current].slice(0, 8));
                }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {customerSummary ? (
        <ImportSummary label="Customers" summary={customerSummary} />
      ) : null}
      {supplierSummary ? (
        <ImportSummary label="Suppliers" summary={supplierSummary} />
      ) : null}
      {purchasingSummary ? (
        <PurchasingSummary summary={purchasingSummary} />
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
                      {run.tenantName} · {formatDateTime(run.createdAt, timeZone)} ·{" "}
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

function PurchasingSummary({ summary }: { summary: PurchasingApplyResult }) {
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm">
      <p className="font-medium">
        Purchasing: {summary.created} supplier items created, {summary.updated} updated
      </p>
      {summary.skipped > 0 ? (
        <p className="text-xs text-muted-foreground">{summary.skipped} skipped</p>
      ) : null}
      {summary.errors.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-xs text-destructive">
          {summary.errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatMoneyValue(value: string | null) {
  if (value == null) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(parsed);
}

function statusLabel(status: PurchasingCandidateStatus) {
  if (status === "ready") return "Ready";
  if (status === "needs_item_match") return "Needs item";
  if (status === "needs_supplier_match") return "Needs supplier";
  return "Excluded";
}

function PurchasingSyncDialog({
  onComplete,
}: {
  onComplete: (summary: PurchasingApplyResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PurchasingPreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/xero/import/purchasing/preview", {
        method: "POST",
      });
      return readJson<PurchasingPreview>(res, "Failed to preview purchasing sync.");
    },
    onSuccess: (data) => {
      setPreview(data);
      setSelectedIds(
        new Set(
          data.candidates
            .filter((candidate) => candidate.selectedByDefault)
            .map((candidate) => candidate.id)
        )
      );
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/xero/import/purchasing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: [...selectedIds] }),
      });
      return readJson<PurchasingApplyResult>(res, "Purchasing sync failed.");
    },
    onSuccess: (summary) => {
      onComplete(summary);
      setOpen(false);
    },
  });

  const readyCandidates =
    preview?.candidates.filter((candidate) => candidate.status === "ready") ?? [];
  const allReadySelected =
    readyCandidates.length > 0 &&
    readyCandidates.every((candidate) => selectedIds.has(candidate.id));

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          if (!preview) previewMutation.mutate();
        }}
      >
        Sync purchasing data
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Sync purchasing data</AlertDialogTitle>
            <AlertDialogDescription>
              Review matched Xero purchasing rows before supplier item prices are updated.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="min-h-80 rounded-md border bg-muted/30 p-3">
            {previewMutation.isPending ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                Loading preview
              </div>
            ) : previewMutation.error ? (
              <p className="text-sm text-destructive">
                {(previewMutation.error as Error).message}
              </p>
            ) : preview ? (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-5">
                  <PreviewMetric label="Ready" value={preview.summary.ready} />
                  <PreviewMetric label="Selected" value={selectedIds.size} />
                  <PreviewMetric label="Needs item" value={preview.summary.needsItemMatch} />
                  <PreviewMetric label="Excluded" value={preview.summary.excluded} />
                  <PreviewMetric label="Xero lines" value={preview.totalSourceLines} />
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={allReadySelected}
                    onCheckedChange={(checked) => {
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        for (const candidate of readyCandidates) {
                          if (checked) next.add(candidate.id);
                          else next.delete(candidate.id);
                        }
                        return next;
                      });
                    }}
                  />
                  <span>Select all ready rows from {preview.tenantName}</span>
                </div>
                <div className="max-h-[22rem] overflow-auto rounded-md border bg-background">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>Status</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>ERP item</TableHead>
                        <TableHead>Xero code</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>History</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.candidates.map((candidate) => {
                        const selectable = candidate.status === "ready";
                        return (
                          <TableRow key={candidate.id}>
                            <TableCell>
                              <Checkbox
                                disabled={!selectable}
                                checked={selectedIds.has(candidate.id)}
                                onCheckedChange={(checked) => {
                                  setSelectedIds((current) => {
                                    const next = new Set(current);
                                    if (checked) next.add(candidate.id);
                                    else next.delete(candidate.id);
                                    return next;
                                  });
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  candidate.status === "ready" ? "outline" : "secondary"
                                }
                              >
                                {statusLabel(candidate.status)}
                              </Badge>
                              {candidate.exclusionReason ? (
                                <div className="text-xs text-muted-foreground">
                                  {candidate.exclusionReason}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell>{candidate.supplierName}</TableCell>
                            <TableCell>
                              {candidate.itemName ?? "—"}
                              {candidate.itemSku ? (
                                <div className="text-xs text-muted-foreground">
                                  {candidate.itemSku}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              {candidate.xeroItemCode}
                              {candidate.xeroItemName ? (
                                <div className="max-w-64 truncate text-xs text-muted-foreground">
                                  {candidate.xeroItemName}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              {formatMoneyValue(candidate.latestUnitCost)}
                              {candidate.existingSupplierItemUnitCost ? (
                                <div className="text-xs text-muted-foreground">
                                  ERP {formatMoneyValue(candidate.existingSupplierItemUnitCost)}
                                </div>
                              ) : candidate.xeroItemUnitPrice ? (
                                <div className="text-xs text-muted-foreground">
                                  Xero item {formatMoneyValue(candidate.xeroItemUnitPrice)}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              {candidate.occurrences}
                              {candidate.latestDate ? (
                                <div className="text-xs text-muted-foreground">
                                  {candidate.latestDate}
                                </div>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}
          </div>

          {applyMutation.error ? (
            <p className="text-sm text-destructive">
              {(applyMutation.error as Error).message}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={applyMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              onClick={() => applyMutation.mutate()}
              disabled={
                !preview ||
                selectedIds.size === 0 ||
                previewMutation.isPending ||
                applyMutation.isPending
              }
            >
              {applyMutation.isPending ? (
                <>
                  <Spinner />
                  Syncing
                </>
              ) : (
                "Apply selected"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
