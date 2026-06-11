"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  ConfiguredBadge,
  type ConfiguredBadgeConfig,
} from "@/components/configured-badge";
import { Panel } from "@/components/panel";
import { MetricTile } from "@/components/metric-tile";
import { SurfacePanel } from "@/components/surface-panel";
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
  FramedTable,
  FramedTableBody,
  FramedTableCell,
  FramedTableHeaderCell,
  FramedTableHead,
  FramedTableRow,
} from "@/components/table-frame";
import {
  ACCOUNTING_PROVIDER_XERO,
  type AccountingProvider,
} from "@/lib/accounting/constants";
import { apiJson } from "@/lib/client/api";
import { formatCurrency } from "@/lib/format";

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

type PurchaseOrderImportCandidateStatus =
  | "ready"
  | "creates_records"
  | "excluded";

type PurchaseOrderImportCandidate = {
  id: string;
  status: PurchaseOrderImportCandidateStatus;
  selectedByDefault: boolean;
  selectable: boolean;
  exclusionReason: string | null;
  externalPurchaseOrderNumber: string;
  externalStatus: string;
  supplierName: string;
  supplierMatched: boolean;
  createsSupplier: boolean;
  createsMaterials: number;
  needsPurchaseConversionReview: number;
  reviewReason: string | null;
  lineCount: number;
  matchedLineCount: number;
  orderDate: string | null;
  deliveryDate: string | null;
  total: string | null;
};

const purchaseOrderImportStatusBadgeConfig = {
  ready: { label: "Ready", variant: "outline" },
  creates_records: { label: "Review", variant: "secondary" },
  excluded: { label: "Excluded", variant: "secondary" },
} satisfies ConfiguredBadgeConfig<PurchaseOrderImportCandidateStatus>;

type PurchaseOrderImportPreview = {
  tenantName: string;
  sinceDate: string;
  totalExternalPurchaseOrders: number;
  summary: {
    ready: number;
    createsRecords: number;
    excluded: number;
    selectedByDefault: number;
  };
  candidates: PurchaseOrderImportCandidate[];
};

type PurchaseOrderImportResult = {
  runId: string;
  tenantName: string;
  created: number;
  updated: number;
  createdSuppliers: number;
  createdItems: number;
  protected: number;
  skipped: number;
  errors: string[];
};

type DialogAction = { mode: "import"; entityType: EntityType };

function entityLabel(entityType: EntityType) {
  if (entityType === "customers") return "customers";
  return "suppliers";
}

async function fetchPreview(action: DialogAction) {
  return apiJson<ContactImportPreview>(
    `/api/accounting/import/${action.entityType}/preview`,
    {
      method: "POST",
      fallbackError: "Failed to preview import.",
    }
  );
}

export function XeroImportSection({
  canImportCustomers,
  canImportSuppliers,
}: {
  canImportCustomers: boolean;
  canImportSuppliers: boolean;
}) {
  const router = useRouter();
  const [dialogAction, setDialogAction] = useState<DialogAction | null>(null);
  const [preview, setPreview] = useState<ContactImportPreview | null>(
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
  const [purchaseOrderSummary, setPurchaseOrderSummary] =
    useState<PurchaseOrderImportResult | null>(null);

  const beginImport = (entityType: EntityType) => {
    const action = { mode: "import" as const, entityType };
    setDialogAction(action);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);

    fetchPreview(action)
      .then((data) => {
        setPreview(data);
      })
      .catch((error) => {
        setPreviewError((error as Error).message);
      })
      .finally(() => {
        setPreviewLoading(false);
      });
  };

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!dialogAction || !preview) return null;

      const importPreview = preview as ContactImportPreview;
      const data = await apiJson<ImportResult>(
        `/api/accounting/import/${dialogAction.entityType}`,
        {
          method: "POST",
          body: {
            allowDemoCompany: importPreview.isDemoCompany,
          },
          fallbackError: "Import failed.",
        }
      );
      return {
        entityType: dialogAction.entityType,
        data,
      };
    },
    onSuccess: (result) => {
      if (!result) return;

      if (result.entityType === "customers") {
        setCustomerSummary(result.data);
      } else {
        setSupplierSummary(result.data);
      }

      setDialogAction(null);
      router.refresh();
    },
  });

  if (!canImportCustomers && !canImportSuppliers) {
    return null;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          {canImportCustomers ? (
            <ImportActionGroup title="Contacts">
              <Button
                variant="outline"
                size="sm"
                onClick={() => beginImport("customers")}
              >
                Import customers
              </Button>
            </ImportActionGroup>
          ) : null}
          {canImportSuppliers ? (
            <ImportActionGroup title="Purchasing">
              <Button
                variant="outline"
                size="sm"
                onClick={() => beginImport("suppliers")}
              >
                Import suppliers
              </Button>
              <PurchaseOrderImportDialog
                onComplete={(summary) => {
                  setPurchaseOrderSummary(summary);
                  router.refresh();
                }}
              />
            </ImportActionGroup>
          ) : null}
        </div>

        <div className="space-y-2">
          {customerSummary ? (
            <ImportSummary label="Customers" summary={customerSummary} />
          ) : null}
          {supplierSummary ? (
            <ImportSummary label="Suppliers" summary={supplierSummary} />
          ) : null}
          {purchaseOrderSummary ? (
            <PurchaseOrderImportSummary summary={purchaseOrderSummary} />
          ) : null}
        </div>
      </div>

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

function ImportActionGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <h4 className="mb-2 text-sm font-medium text-[var(--color-ink)]">{title}</h4>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function ImportSummaryFrame({
  children,
  errors,
}: {
  children: ReactNode;
  errors: string[];
}) {
  return (
    <SurfacePanel padding="sm" className="text-sm">
      {children}
      <ImportErrorList errors={errors} />
    </SurfacePanel>
  );
}

function ImportErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;

  return (
    <ul className="mt-2 list-disc pl-5 text-xs text-[var(--status-danger-ink)]">
      {errors.map((error, index) => (
        <li key={index}>{error}</li>
      ))}
    </ul>
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
    <ImportSummaryFrame errors={summary.errors ?? []}>
      <p className="font-medium">
        {label}: {summary.created} loaded, {summary.updated} already existed
      </p>
    </ImportSummaryFrame>
  );
}

function PurchaseOrderImportSummary({
  summary,
}: {
  summary: PurchaseOrderImportResult;
}) {
  return (
    <ImportSummaryFrame errors={summary.errors}>
      <p className="font-medium">
        Purchase orders: {summary.created} imported, {summary.updated} updated
      </p>
      {summary.createdSuppliers > 0 || summary.createdItems > 0 ? (
        <p className="text-xs text-[var(--color-ink-faint)]">
          Created {summary.createdSuppliers} suppliers and {summary.createdItems} materials
        </p>
      ) : null}
      {summary.protected > 0 || summary.skipped > 0 ? (
        <p className="text-xs text-[var(--color-ink-faint)]">
          {summary.protected} protected after receiving, {summary.skipped} skipped
        </p>
      ) : null}
    </ImportSummaryFrame>
  );
}

function formatMoneyValue(value: string | null) {
  if (value == null) return "—";
  if (!Number.isFinite(Number(value))) return value;
  return formatCurrency(value, "USD", {
    maximumFractionDigits: 4,
  }) ?? value;
}

function PurchaseOrderImportDialog({
  provider = ACCOUNTING_PROVIDER_XERO,
  onComplete,
}: {
  provider?: AccountingProvider;
  onComplete: (summary: PurchaseOrderImportResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PurchaseOrderImportPreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const previewMutation = useMutation({
    mutationFn: async () => {
      return apiJson<PurchaseOrderImportPreview>(
        "/api/accounting/import/purchase-orders/preview",
        {
          method: "POST",
          body: { provider },
          fallbackError: "Failed to preview purchase order import.",
        }
      );
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
      return apiJson<PurchaseOrderImportResult>(
        "/api/accounting/import/purchase-orders",
        {
          method: "POST",
          body: { candidateIds: [...selectedIds], provider },
          fallbackError: "Purchase order import failed.",
        }
      );
    },
    onSuccess: (summary) => {
      onComplete(summary);
      setOpen(false);
    },
  });

  const readyCandidates =
    preview?.candidates.filter((candidate) => candidate.status === "ready") ?? [];
  const creatableCandidates =
    preview?.candidates.filter((candidate) => candidate.status === "creates_records") ??
    [];
  const allReadySelected =
    readyCandidates.length > 0 &&
    readyCandidates.every((candidate) => selectedIds.has(candidate.id));
  const allCreatableSelected =
    creatableCandidates.length > 0 &&
    creatableCandidates.every((candidate) => selectedIds.has(candidate.id));

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
        Bulk import purchase orders
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent
          size="content"
          className="h-[min(46rem,calc(100vh-2rem))] !w-[min(calc(100vw-2rem),72rem)] !max-w-[min(calc(100vw-2rem),72rem)] grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-hidden"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Bulk import purchase orders</AlertDialogTitle>
            <AlertDialogDescription>
              Imports open accounting purchase orders into ERP for receiving. Checked rows
              that need review can create missing suppliers or materials or require unit
              conversion checks.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Panel className="min-h-0 overflow-hidden rounded-md">
            {previewMutation.isPending ? (
              <div className="flex items-center gap-2 text-sm text-[var(--color-ink-faint)]">
                <Spinner />
                Loading preview
              </div>
            ) : previewMutation.error ? (
              <p className="text-sm text-[var(--status-danger-ink)]">
                {(previewMutation.error as Error).message}
              </p>
            ) : preview ? (
              <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
                <div className="grid min-w-0 gap-2 sm:grid-cols-5">
                  <MetricTile
                    label="Matched"
                    value={preview.summary.ready}
                    density="compact"
                  />
                  <MetricTile
                    label="Selected"
                    value={selectedIds.size}
                    density="compact"
                  />
                  <MetricTile
                    label="Review"
                    value={preview.summary.createsRecords}
                    density="compact"
                  />
                  <MetricTile
                    label="Excluded"
                    value={preview.summary.excluded}
                    density="compact"
                  />
                  <MetricTile
                    label="Provider POs"
                    value={preview.totalExternalPurchaseOrders}
                    density="compact"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <label className="flex items-center gap-2">
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
                    <span>Select matched POs from {preview.tenantName}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={allCreatableSelected}
                      disabled={creatableCandidates.length === 0}
                      onCheckedChange={(checked) => {
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          for (const candidate of creatableCandidates) {
                            if (checked) next.add(candidate.id);
                            else next.delete(candidate.id);
                          }
                          return next;
                        });
                      }}
                    />
                    <span>Select POs that need review</span>
                  </label>
                </div>
                <SurfacePanel
                  tone="background"
                  padding="sm"
                  className="min-h-0 min-w-0 flex-1 overflow-hidden p-0"
                >
                  <FramedTable
                    className="min-w-[64rem] table-fixed text-sm"
                    containerClassName="h-full overflow-auto"
                  >
                    <colgroup>
                      <col className="w-10" />
                      <col className="w-32" />
                      <col className="w-36" />
                      <col className="w-56" />
                      <col className="w-36" />
                      <col className="w-28" />
                      <col className="w-28" />
                    </colgroup>
                    <FramedTableHead className="sticky top-0 z-10">
                      <FramedTableRow>
                        <FramedTableHeaderCell />
                        <FramedTableHeaderCell>Status</FramedTableHeaderCell>
                        <FramedTableHeaderCell>Provider PO</FramedTableHeaderCell>
                        <FramedTableHeaderCell>Supplier</FramedTableHeaderCell>
                        <FramedTableHeaderCell>Materials</FramedTableHeaderCell>
                        <FramedTableHeaderCell>Delivery</FramedTableHeaderCell>
                        <FramedTableHeaderCell>Total</FramedTableHeaderCell>
                      </FramedTableRow>
                    </FramedTableHead>
                    <FramedTableBody>
                      {preview.candidates.map((candidate) => (
                        <FramedTableRow key={candidate.id}>
                          <FramedTableCell>
                            <Checkbox
                              disabled={!candidate.selectable}
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
                          </FramedTableCell>
                          <FramedTableCell>
                            <ConfiguredBadge
                              value={candidate.status}
                              config={purchaseOrderImportStatusBadgeConfig}
                            />
                            {candidate.exclusionReason ? (
                              <div className="truncate text-xs text-[var(--color-ink-faint)]">
                                {candidate.exclusionReason}
                              </div>
                            ) : null}
                            {candidate.reviewReason ? (
                              <div className="truncate text-xs text-[var(--color-ink-faint)]">
                                {candidate.reviewReason}
                              </div>
                            ) : null}
                          </FramedTableCell>
                          <FramedTableCell>
                            <div className="truncate">
                              {candidate.externalPurchaseOrderNumber}
                            </div>
                            <div className="truncate text-xs text-[var(--color-ink-faint)]">
                              {candidate.externalStatus}
                            </div>
                          </FramedTableCell>
                          <FramedTableCell>
                            <div className="truncate" title={candidate.supplierName}>
                              {candidate.supplierName}
                            </div>
                            <div className="truncate text-xs text-[var(--color-ink-faint)]">
                              {candidate.createsSupplier ? "Creates supplier" : "Matched"}
                            </div>
                          </FramedTableCell>
                          <FramedTableCell>
                            {candidate.matchedLineCount}/{candidate.lineCount} matched
                            {candidate.createsMaterials > 0 ? (
                              <div className="truncate text-xs text-[var(--color-ink-faint)]">
                                Creates {candidate.createsMaterials}
                              </div>
                            ) : null}
                            {candidate.needsPurchaseConversionReview > 0 ? (
                              <div className="truncate text-xs text-[var(--color-ink-faint)]">
                                Units {candidate.needsPurchaseConversionReview}
                              </div>
                            ) : null}
                          </FramedTableCell>
                          <FramedTableCell>{candidate.deliveryDate ?? candidate.orderDate ?? "—"}</FramedTableCell>
                          <FramedTableCell>{formatMoneyValue(candidate.total)}</FramedTableCell>
                        </FramedTableRow>
                      ))}
                    </FramedTableBody>
                  </FramedTable>
                </SurfacePanel>
              </div>
            ) : null}
          </Panel>

          {applyMutation.error ? (
            <p className="text-sm text-[var(--status-danger-ink)]">
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
                  Importing
                </>
              ) : (
                "Import selected POs"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function AccountingPurchaseOrderImportButton({
  provider,
  onComplete,
}: {
  provider: AccountingProvider;
  onComplete: (summary: PurchaseOrderImportResult) => void;
}) {
  return <PurchaseOrderImportDialog provider={provider} onComplete={onComplete} />;
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
  preview: ContactImportPreview | null;
  previewError: string | null;
  previewLoading: boolean;
  pending: boolean;
  actionError: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const open = action != null;
  const title = action ? `Import ${entityLabel(action.entityType)}` : "";
  const canConfirm =
    Boolean(preview) &&
    !previewLoading &&
    !previewError;

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <AlertDialogContent size="lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            Review the accounting import preview before creating or updating records.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Panel className="min-h-24 rounded-md">
          {previewLoading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--color-ink-faint)]">
              <Spinner />
              Loading preview
            </div>
          ) : previewError ? (
            <p className="text-sm text-[var(--status-danger-ink)]">{previewError}</p>
          ) : preview ? (
            <ImportPreviewDetails preview={preview} />
          ) : null}
        </Panel>

        {actionError ? <p className="text-sm text-[var(--status-danger-ink)]">{actionError}</p> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button onClick={onConfirm} disabled={!canConfirm || pending}>
            {pending ? (
              <>
                <Spinner />
                Working
              </>
            ) : (
              "Import"
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
        <MetricTile
          label="Will load"
          value={preview.toCreate}
          density="compact"
        />
        <MetricTile
          label="Already exists"
          value={preview.toUpdate}
          density="compact"
        />
      </div>
      <p className="text-[var(--color-ink-faint)]">Xero organisation: {preview.tenantName}</p>
      <p className="text-[var(--color-ink-faint)]">
        New records are created only from Xero contacts marked as {entityName}.
        Existing ERP records can still update when matched by Xero ID, email, or name.
      </p>
      {preview.isDemoCompany ? (
        <p className="text-[var(--status-danger-ink)]">
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
      <div className="text-xs font-medium text-[var(--color-ink-faint)]">{title}</div>
      <div className={destructive ? "text-[var(--status-danger-ink)]" : "text-[var(--color-ink)]"}>
        {values.join(", ")}
      </div>
    </div>
  );
}
