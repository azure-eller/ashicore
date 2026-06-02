"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import type { BillingPlanIntent } from "@/lib/billing/plan-intent";
import { FREE_SKU_LIMIT } from "@/lib/billing/types";
import type { CellValueChangedEvent, ColDef, ICellRendererParams } from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  CheckmarkCircle02Icon,
  DatabaseImportIcon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { ERPDataGrid } from "@/components/erp-data-grid";
import { FileDropzone } from "@/components/file-dropzone";
import { InsetPanel } from "@/components/inset-panel";
import { OnboardingProgress, onboardingStepIndex } from "@/components/onboarding-stepper";
import { ProgressMeter } from "@/components/progress-meter";
import { SurfacePanel } from "@/components/surface-panel";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { StatusLabel } from "@/components/ui/status-label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBytes } from "@/lib/format";
import type { AccessPresetKey } from "@/lib/authz";
import { cn } from "@/lib/utils";

type Provenance = {
  fileId: string;
  location?: string;
  sheet?: string;
  row?: string | number;
  page?: string | number;
};

type ReviewMeta = { selected?: boolean };
type MatchMeta = {
  suggestion: "create" | "update" | "skip";
  existingId?: string;
  matchedBy?: string;
  fieldDiff?: Record<string, unknown>;
};

type ImportUnit = {
  tempId: string;
  name: string;
  size: string;
  uom: string;
  review?: ReviewMeta;
};

type ImportPartner = {
  tempId: string;
  name: string;
  code?: string | null;
  email?: string | null;
  phone?: string | null;
  match: MatchMeta;
  review?: ReviewMeta;
  provenance?: Provenance[];
  confidence?: number;
};

type ImportItem = {
  tempId: string;
  itemType: "material" | "product";
  name: string;
  sku?: string | null;
  unitRef: string;
  defaultPurchasePrice?: string | null;
  defaultSellingPrice?: string | null;
  match: MatchMeta;
  review?: ReviewMeta;
  provenance?: Provenance[];
  confidence?: number;
};

type ImportOpeningStock = {
  itemRef: string;
  quantity: string;
  unitCost?: string | null;
  lotNumber?: string | null;
  review?: ReviewMeta;
  provenance?: Provenance[];
  confidence?: number;
};

type ImportBom = {
  productRef: string;
  outputQuantity: string;
  outputUnitRef: string;
  components: Array<{ itemRef: string; quantity: string; unitRef?: string | null; basis: string }>;
  review?: ReviewMeta;
  provenance?: Provenance[];
  confidence?: number;
};

type ImportPackage = {
  version: "1";
  openingStockAsOf: string;
  units: ImportUnit[];
  suppliers: ImportPartner[];
  customers: ImportPartner[];
  items: ImportItem[];
  openingStock: ImportOpeningStock[];
  boms: ImportBom[];
  unresolvedQuestions: Array<Record<string, unknown>>;
};

type ImportPreview = {
  hash: string;
  status: string;
  blockingIssueCount: number;
  warningIssueCount: number;
  issues: Array<{ severity: string; message: string; path?: string }>;
  summary: Record<string, number>;
};

type ImportSessionResponse = {
  session: {
    id: string;
    status: string;
    committedAt?: string | null;
    commitSummary?: Record<string, number> | null;
  };
  files?: Array<{
    id?: string;
    filename: string;
    contentType?: string;
    sizeBytes?: number;
    extractionStatus?: string;
    extractionError?: string | null;
  }>;
  preview?: ImportPreview | null;
  reviewPackage?: ImportPackage | null;
  commitSummary?: Record<string, number>;
};

type OnboardingSessionResponse = {
  session: {
    id: string;
    selectedPlan: string | null;
    status: string;
    currentStep: FlowStep;
    importSessionId: string | null;
    invitesDraft?: Array<{ email: string; role: string }> | null;
  } | null;
};

type FlowStep = "invite" | "import" | "extract" | "review" | "connect" | "done";
type EntityTab = "items" | "suppliers" | "customers" | "openingStock" | "boms" | "units";
type InviteRow = { id: string; email: string; presetKey: AccessPresetKey };

type ReviewRow = {
  id: string;
  entity: EntityTab;
  ref: string;
  selected: boolean;
  kind: string;
  action: string;
  primary: string;
  secondary: string;
  quantity: string;
  unitCost: string;
  source: string;
  confidence: number;
};

const entityTabs: Array<{ id: EntityTab; label: string }> = [
  { id: "items", label: "Items" },
  { id: "suppliers", label: "Suppliers" },
  { id: "customers", label: "Customers" },
  { id: "openingStock", label: "Opening stock" },
  { id: "boms", label: "BOMs" },
  { id: "units", label: "Units" },
];

const supportedTypes = [".csv", ".xlsx", ".pdf", "images", "screenshots"];
const inviteRoleOptions: Array<{ value: AccessPresetKey; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "ops_manager", label: "Ops Manager" },
  { value: "ops_operator", label: "Operator" },
  { value: "view_only", label: "View Only" },
];
const integrationTiles = [
  ["Shopify", "Orders & products", false],
  ["QuickBooks", "Invoices & costs", false],
  ["Stripe", "Payments", false],
  ["ShipStation", "Fulfillment", false],
  ["Xero", "Accounting", true],
  ["Square", "POS sales", false],
] as const;

function selected(review?: ReviewMeta) {
  return review?.selected !== false;
}

function sourceLabel(provenance?: Provenance[]) {
  const first = provenance?.[0];
  if (!first) return "Uploaded file";
  return [first.fileId, first.sheet, first.page ? `p.${first.page}` : null, first.row ? `row ${first.row}` : null]
    .filter(Boolean)
    .join(" · ");
}

function confidenceTone(value: number) {
  if (value >= 0.85) return "success";
  if (value >= 0.6) return "warning";
  return "danger";
}

function fileStatusLabel(status?: string) {
  if (status === "extracted") return "Extracted";
  if (status === "failed") return "Failed";
  if (status === "extracting") return "Reading";
  return "Queued";
}

function fileStatusTone(status?: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "extracted") return "success";
  if (status === "failed") return "danger";
  if (status === "extracting") return "warning";
  return "neutral";
}

function createInviteRow(): InviteRow {
  return { id: crypto.randomUUID(), email: "", presetKey: "ops_operator" };
}

function fileTypeBadge(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv") return "CSV";
  if (ext === "xlsx" || ext === "xls") return "XLSX";
  if (ext === "pdf") return "PDF";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return "IMG";
  return ext ? ext.toUpperCase().slice(0, 4) : "FILE";
}

function ConfidenceCell({ value }: ICellRendererParams<ReviewRow, number>) {
  const confidence = typeof value === "number" ? value : 0;
  return (
    <span className="flex h-full items-center gap-(--space-3)">
      <span className={cn("w-16", confidenceTone(confidence) === "success" && "text-[var(--color-success)]", confidenceTone(confidence) === "warning" && "text-[var(--color-warning)]", confidenceTone(confidence) === "danger" && "text-[var(--color-danger)]")}>
        <ProgressMeter label={`${Math.round(confidence * 100)}% confidence`} percent={confidence * 100} />
      </span>
      <span className="font-mono tabular-nums">{Math.round(confidence * 100)}%</span>
    </span>
  );
}

function SelectedCell({
  data,
  onToggle,
}: ICellRendererParams<ReviewRow> & { onToggle?: (row: ReviewRow, selected: boolean) => void }) {
  if (!data) return null;
  return (
    <Checkbox
      checked={data.selected}
      onCheckedChange={(value) => onToggle?.(data, value === true)}
      aria-label={`Include ${data.primary || data.secondary}`}
    />
  );
}

function buildReviewRows(pkg: ImportPackage, entity: EntityTab): ReviewRow[] {
  if (entity === "items") {
    return pkg.items.map((item) => {
      const stock = pkg.openingStock.find((candidate) => candidate.itemRef === item.tempId);
      return {
        id: `items:${item.tempId}`,
        entity,
        ref: item.tempId,
        selected: selected(item.review),
        kind: item.itemType,
        action: item.match.suggestion,
        primary: item.sku ?? "",
        secondary: item.name,
        quantity: stock?.quantity ?? "",
        unitCost: item.defaultPurchasePrice ?? item.defaultSellingPrice ?? stock?.unitCost ?? "",
        source: sourceLabel(item.provenance),
        confidence: item.confidence ?? 0.5,
      };
    });
  }

  if (entity === "suppliers" || entity === "customers") {
    return pkg[entity].map((partner) => ({
      id: `${entity}:${partner.tempId}`,
      entity,
      ref: partner.tempId,
      selected: selected(partner.review),
      kind: entity === "suppliers" ? "supplier" : "customer",
      action: partner.match.suggestion,
      primary: entity === "suppliers" ? partner.code ?? "" : partner.email ?? "",
      secondary: partner.name,
      quantity: "",
      unitCost: "",
      source: sourceLabel(partner.provenance),
      confidence: partner.confidence ?? 0.5,
    }));
  }

  if (entity === "openingStock") {
    return pkg.openingStock.map((stock, index) => ({
      id: `openingStock:${stock.itemRef}:${index}`,
      entity,
      ref: `${stock.itemRef}:${index}`,
      selected: selected(stock.review),
      kind: "stock",
      action: "create",
      primary: stock.itemRef,
      secondary: stock.lotNumber ?? "",
      quantity: stock.quantity,
      unitCost: stock.unitCost ?? "",
      source: sourceLabel(stock.provenance),
      confidence: stock.confidence ?? 0.5,
    }));
  }

  if (entity === "boms") {
    return pkg.boms.map((bom, index) => ({
      id: `boms:${bom.productRef}:${index}`,
      entity,
      ref: `${bom.productRef}:${index}`,
      selected: selected(bom.review),
      kind: "bom",
      action: "create",
      primary: bom.productRef,
      secondary: `${bom.components.length} components`,
      quantity: bom.outputQuantity,
      unitCost: "",
      source: sourceLabel(bom.provenance),
      confidence: bom.confidence ?? 0.5,
    }));
  }

  return pkg.units.map((unit) => ({
    id: `units:${unit.tempId}`,
    entity,
    ref: unit.tempId,
    selected: selected(unit.review),
    kind: "unit",
    action: "create",
    primary: unit.name,
    secondary: unit.uom,
    quantity: unit.size,
    unitCost: "",
    source: "Normalized",
    confidence: 1,
  }));
}

function setReviewSelected(pkg: ImportPackage, row: ReviewRow, nextSelected: boolean): ImportPackage {
  const review = { selected: nextSelected };
  if (row.entity === "items") {
    return {
      ...pkg,
      items: pkg.items.map((item) => (item.tempId === row.ref ? { ...item, review } : item)),
    };
  }
  if (row.entity === "suppliers" || row.entity === "customers") {
    return {
      ...pkg,
      [row.entity]: pkg[row.entity].map((partner) =>
        partner.tempId === row.ref ? { ...partner, review } : partner,
      ),
    };
  }
  if (row.entity === "openingStock") {
    const [itemRef, rawIndex] = row.ref.split(":");
    const index = Number(rawIndex);
    return {
      ...pkg,
      openingStock: pkg.openingStock.map((stock, stockIndex) =>
        stock.itemRef === itemRef && stockIndex === index ? { ...stock, review } : stock,
      ),
    };
  }
  if (row.entity === "boms") {
    const [productRef, rawIndex] = row.ref.split(":");
    const index = Number(rawIndex);
    return {
      ...pkg,
      boms: pkg.boms.map((bom, bomIndex) =>
        bom.productRef === productRef && bomIndex === index ? { ...bom, review } : bom,
      ),
    };
  }
  return {
    ...pkg,
    units: pkg.units.map((unit) => (unit.tempId === row.ref ? { ...unit, review } : unit)),
  };
}

function updateReviewValue(pkg: ImportPackage, row: ReviewRow, field: string, value: string): ImportPackage {
  if (row.entity === "items") {
    return {
      ...pkg,
      items: pkg.items.map((item) => {
        if (item.tempId !== row.ref) return item;
        if (field === "primary") return { ...item, sku: value || null };
        if (field === "secondary") return { ...item, name: value };
        if (field === "unitCost") {
          return item.itemType === "product"
            ? { ...item, defaultSellingPrice: value || null }
            : { ...item, defaultPurchasePrice: value || null };
        }
        return item;
      }),
      openingStock:
        field === "quantity"
          ? pkg.openingStock.map((stock) =>
              stock.itemRef === row.ref ? { ...stock, quantity: value } : stock,
            )
          : pkg.openingStock,
    };
  }

  if (row.entity === "suppliers" || row.entity === "customers") {
    return {
      ...pkg,
      [row.entity]: pkg[row.entity].map((partner) => {
        if (partner.tempId !== row.ref) return partner;
        if (field === "primary") {
          return row.entity === "suppliers"
            ? { ...partner, code: value || null }
            : { ...partner, email: value || null };
        }
        if (field === "secondary") return { ...partner, name: value };
        return partner;
      }),
    };
  }

  if (row.entity === "openingStock") {
    const [itemRef, rawIndex] = row.ref.split(":");
    const index = Number(rawIndex);
    return {
      ...pkg,
      openingStock: pkg.openingStock.map((stock, stockIndex) => {
        if (stock.itemRef !== itemRef || stockIndex !== index) return stock;
        if (field === "quantity") return { ...stock, quantity: value };
        if (field === "unitCost") return { ...stock, unitCost: value || null };
        if (field === "secondary") return { ...stock, lotNumber: value || null };
        return stock;
      }),
    };
  }

  if (row.entity === "units") {
    return {
      ...pkg,
      units: pkg.units.map((unit) => {
        if (unit.tempId !== row.ref) return unit;
        if (field === "primary") return { ...unit, name: value };
        if (field === "secondary") return { ...unit, uom: value };
        if (field === "quantity") return { ...unit, size: value };
        return unit;
      }),
    };
  }

  return pkg;
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Request failed.");
  }
  return body as T;
}

function onboardingActiveIndex(step: FlowStep) {
  switch (step) {
    case "invite":
      return onboardingStepIndex("Invite");
    case "import":
    case "extract":
      return onboardingStepIndex("Import");
    case "review":
      return onboardingStepIndex("Review");
    case "connect":
      return onboardingStepIndex("Connect");
    case "done":
      return onboardingStepIndex("Done");
  }
}

function CountTab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-(--space-2) border-b-2 px-(--space-2) pb-(--space-3) text-[length:var(--text-sm)] font-medium",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {label}
      <span
        className={cn(
          "border px-(--space-2) font-mono text-[length:var(--text-xs)] tabular-nums",
          active ? "border-primary/40 text-foreground" : "border-border text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

export function OnboardingImportPage({ plan }: { plan?: BillingPlanIntent }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const startedRef = useRef(false);
  const finalizeStartedRef = useRef(false);
  const [flowStep, setFlowStep] = useState<FlowStep>("invite");
  const [planIntent, setPlanIntent] = useState<BillingPlanIntent>(plan ?? "free");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [inviteRows, setInviteRows] = useState<InviteRow[]>(() => [createInviteRow()]);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [files, setFiles] = useState<ImportSessionResponse["files"]>([]);
  const [reviewPackage, setReviewPackage] = useState<ImportPackage | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [includeBoms, setIncludeBoms] = useState(true);
  const [activeTab, setActiveTab] = useState<EntityTab>("items");
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [commitSummary, setCommitSummary] = useState<Record<string, number> | null>(null);
  const [committed, setCommitted] = useState(false);
  const [onboardingReady, setOnboardingReady] = useState(false);
  // The approve gate: a paid org pays here; a free org over the SKU cap is offered
  // the upgrade-or-trim choice. Null = no dialog (free + within cap commits directly).
  const [approveDialog, setApproveDialog] = useState<null | "pay" | "upsell">(null);
  const [finalizing, setFinalizing] = useState(false);

  const startMutation = useMutation({
    mutationFn: () =>
      apiJson<OnboardingSessionResponse>("/api/onboarding/session", {
        method: "POST",
        // Only assert the plan when the URL carried it (first entry). On the Stripe
        // return there's no plan param, so we preserve the persisted intent.
        body: JSON.stringify(plan ? { selectedPlan: plan } : {}),
      }),
    onSuccess: (data) => {
      if (!data.session) return;
      setFlowStep(data.session.currentStep ?? "import");
      setSessionId(data.session.importSessionId);
      if (data.session.selectedPlan === "free" || data.session.selectedPlan === "paid") {
        setPlanIntent(data.session.selectedPlan);
      }
      if (data.session.invitesDraft?.length) {
        setInviteRows(
          data.session.invitesDraft.map((invite) => ({
            id: crypto.randomUUID(),
            email: invite.email,
            presetKey: invite.role as AccessPresetKey,
          })),
        );
      }
      setOnboardingReady(true);
    },
    onError: (error) => {
      setOnboardingReady(true);
      setMessage(error instanceof Error ? error.message : String(error));
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (uploadedFiles: File[]) => {
      if (!uploadedFiles.length) throw new Error("Choose at least one file to extract.");
      const form = new FormData();
      uploadedFiles.forEach((file) => form.append("file", file));
      return apiJson<ImportSessionResponse>("/api/onboarding/imports", {
        method: "POST",
        body: form,
      });
    },
    onSuccess: (data) => {
      setSessionId(data.session.id);
      setFiles(data.files ?? []);
      setStagedFiles([]);
      setFlowStep("extract");
      setMessage(null);
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : String(error)),
  });

  const fetchImportMutation = useMutation({
    mutationFn: (id: string) => apiJson<ImportSessionResponse>(`/api/onboarding/imports/${id}`),
    onSuccess: (data) => {
      setFiles(data.files ?? []);
      setPreview(data.preview ?? null);
      if (data.reviewPackage) {
        setReviewPackage(data.reviewPackage);
        setFlowStep("review");
      } else if (data.session.status === "failed") {
        setMessage("Extraction failed. Remove the files and try again.");
      }
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : String(error)),
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId || !reviewPackage) throw new Error("Review data is not ready.");
      return apiJson<ImportSessionResponse>(`/api/onboarding/imports/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({
          openingStockAsOf: reviewPackage.openingStockAsOf,
          includeBoms,
          package: reviewPackage,
        }),
      });
    },
    onSuccess: (data) => {
      setPreview(data.preview ?? null);
      setReviewPackage(data.reviewPackage ?? reviewPackage);
      setDirty(false);
      setMessage(data.preview?.blockingIssueCount ? "Resolve blocking issues before approving." : null);
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : String(error)),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!sessionId || !preview?.hash) throw new Error("Validate the import before approving.");
      return apiJson<ImportSessionResponse>(`/api/onboarding/imports/${sessionId}/approve`, {
        method: "POST",
        body: JSON.stringify({ previewHash: preview.hash }),
      });
    },
    onSuccess: (data) => {
      setCommitSummary(data.commitSummary ?? data.session.commitSummary ?? null);
      setCommitted(true);
      setApproveDialog(null);
      setFlowStep("connect");
      setMessage(null);
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : String(error)),
  });

  // Paid path: open Stripe checkout from the approve gate. On return the finalize
  // effect commits the (now-paid) import.
  const checkoutMutation = useMutation({
    mutationFn: () =>
      apiJson<{ url?: string }>("/api/billing/checkout", {
        method: "POST",
        headers: { "Idempotency-Key": `onboarding-${sessionId ?? "checkout"}` },
        body: JSON.stringify({ flow: "onboarding" }),
      }),
    onSuccess: (data) => {
      if (data.url) {
        window.location.assign(data.url);
      } else {
        setMessage("Could not start checkout. Please try again.");
      }
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : String(error)),
  });

  // Paid path: commit the import once the org has actually paid. Retries a few
  // times to absorb webhook lag between the Stripe redirect and the plan flip.
  const finalizeMutation = useMutation({
    retry: 6,
    retryDelay: 2500,
    mutationFn: (id: string) =>
      apiJson<ImportSessionResponse>(`/api/onboarding/imports/${id}/finalize`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onMutate: () => setFinalizing(true),
    onSuccess: (data) => {
      setCommitSummary(data.commitSummary ?? data.session.commitSummary ?? null);
      setCommitted(true);
      setFinalizing(false);
      setFlowStep("connect");
      setMessage(null);
    },
    onError: (error) => {
      setFinalizing(false);
      setMessage(
        error instanceof Error
          ? `${error.message} You can retry once your payment is confirmed.`
          : String(error),
      );
    },
  });

  const progressMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiJson<OnboardingSessionResponse>("/api/onboarding/session", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
  });

  const inviteMutation = useMutation({
    mutationFn: async (rows: InviteRow[]) => {
      const invites = rows
        .map((row) => ({ ...row, email: row.email.trim() }))
        .filter((row) => row.email.length > 0);

      await apiJson<OnboardingSessionResponse>("/api/onboarding/session", {
        method: "PATCH",
        body: JSON.stringify({
          invitesDraft: invites.map((invite) => ({
            email: invite.email,
            role: invite.presetKey,
          })),
        }),
      });

      await Promise.all(
        invites.map((invite) =>
          apiJson<void>("/api/team/invitations", {
            method: "POST",
            body: JSON.stringify({ email: invite.email, presetKey: invite.presetKey }),
          }),
        ),
      );

      return apiJson<OnboardingSessionResponse>("/api/onboarding/session", {
        method: "PATCH",
        body: JSON.stringify({ status: "org_created", currentStep: "import" }),
      });
    },
    onSuccess: () => {
      setFlowStep("import");
      setMessage(null);
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : String(error)),
  });

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startMutation.mutate();
  }, [startMutation]);

  useEffect(() => {
    if (!sessionId || (flowStep !== "extract" && flowStep !== "review")) return;
    fetchImportMutation.mutate(sessionId);
    if (flowStep === "review") return;
    const timer = window.setInterval(() => fetchImportMutation.mutate(sessionId), 3500);
    return () => window.clearInterval(timer);
  }, [flowStep, sessionId, fetchImportMutation]);

  // Returning from a successful Stripe checkout (paid path): commit the now-paid
  // import. (`onMutate` flips the finalizing flag; the cancel case is derived in
  // render, so this effect performs no synchronous state updates.)
  useEffect(() => {
    if (searchParams.get("checkout") !== "success" || !onboardingReady) return;
    if (!sessionId || committed || finalizeStartedRef.current) return;
    finalizeStartedRef.current = true;
    finalizeMutation.mutate(sessionId);
  }, [searchParams, onboardingReady, sessionId, committed, finalizeMutation]);

  const paymentCanceled = searchParams.get("checkout") === "cancel" && !committed;

  const counts = useMemo(
    () =>
      reviewPackage
        ? {
            items: reviewPackage.items.length,
            suppliers: reviewPackage.suppliers.length,
            customers: reviewPackage.customers.length,
            openingStock: reviewPackage.openingStock.length,
            boms: reviewPackage.boms.length,
            units: reviewPackage.units.length,
          }
        : { items: 0, suppliers: 0, customers: 0, openingStock: 0, boms: 0, units: 0 },
    [reviewPackage],
  );

  const rows = useMemo(() => {
    if (!reviewPackage) return [];
    const allRows = buildReviewRows(reviewPackage, activeTab);
    return needsReviewOnly ? allRows.filter((row) => row.confidence < 0.7 || !row.selected) : allRows;
  }, [activeTab, needsReviewOnly, reviewPackage]);

  const approvedCount = useMemo(() => {
    if (!reviewPackage) return 0;
    return entityTabs.reduce(
      (sum, tab) => sum + buildReviewRows(reviewPackage, tab.id).filter((row) => row.selected).length,
      0,
    );
  }, [reviewPackage]);

  const needsReviewCount = useMemo(() => {
    if (!reviewPackage) return 0;
    return entityTabs.reduce(
      (sum, tab) =>
        sum + buildReviewRows(reviewPackage, tab.id).filter((row) => row.confidence < 0.7 || !row.selected).length,
      0,
    );
  }, [reviewPackage]);

  // New SKUs this import would create (selected items marked "create").
  const selectedNewSkuCount = useMemo(() => {
    if (!reviewPackage) return 0;
    return reviewPackage.items.filter(
      (item) => item.review?.selected !== false && item.match.suggestion === "create",
    ).length;
  }, [reviewPackage]);

  const blockingIssues = useMemo(
    () => (preview?.issues ?? []).filter((issue) => issue.severity === "blocking"),
    [preview],
  );
  // The SKU-cap "blocker" is handled by the approve dialog (upgrade/trim), not by
  // disabling the button — so it must not count as a hard blocker here.
  const skuLimitBlocking = blockingIssues.some((issue) => /SKU limit/i.test(issue.message));
  const hasOtherBlocking = blockingIssues.some((issue) => !/SKU limit/i.test(issue.message));
  const overFreeLimit = planIntent === "free" && (skuLimitBlocking || selectedNewSkuCount > FREE_SKU_LIMIT);
  const approveDisabled =
    dirty ||
    approveMutation.isPending ||
    validateMutation.isPending ||
    !preview?.hash ||
    hasOtherBlocking;

  const columns = useMemo<Array<ColDef<ReviewRow>>>(
    () => [
      {
        field: "selected",
        headerName: "",
        width: 48,
        minWidth: 48,
        maxWidth: 56,
        sortable: false,
        editable: false,
        cellRenderer: (params: ICellRendererParams<ReviewRow>) => (
          <SelectedCell
            {...params}
            onToggle={(row, nextSelected) => {
              setReviewPackage((current) =>
                current ? setReviewSelected(current, row, nextSelected) : current,
              );
              setDirty(true);
            }}
          />
        ),
      },
      { field: "action", headerName: "Action", width: 104, editable: false },
      { field: "kind", headerName: "Type", width: 112, editable: false },
      { field: "primary", headerName: activeTab === "items" ? "SKU" : "Code / email", width: 150, editable: true },
      { field: "secondary", headerName: "Name / detail", flex: 1, minWidth: 220, editable: true },
      { field: "quantity", headerName: "On hand", width: 120, editable: activeTab !== "suppliers" && activeTab !== "customers", cellClass: "font-mono tabular-nums" },
      { field: "unitCost", headerName: "Unit cost", width: 120, editable: activeTab === "items" || activeTab === "openingStock", cellClass: "font-mono tabular-nums" },
      { field: "source", headerName: "Source", width: 210, editable: false },
      {
        field: "confidence",
        headerName: "Confidence",
        width: 160,
        editable: false,
        cellRenderer: ConfidenceCell,
      },
    ],
    [activeTab],
  );

  function handleCellValueChanged(event: CellValueChangedEvent<ReviewRow>) {
    if (!event.data || !reviewPackage) return;
    const field = event.colDef.field;
    if (!field || event.newValue === event.oldValue) return;
    setReviewPackage(updateReviewValue(reviewPackage, event.data, field, String(event.newValue ?? "")));
    setDirty(true);
  }

  function setRowsIncluded(nextRows: ReviewRow[], nextSelected: boolean) {
    setReviewPackage((current) => {
      if (!current) return current;
      return nextRows.reduce(
        (packageDraft, row) => setReviewSelected(packageDraft, row, nextSelected),
        current,
      );
    });
    setDirty(true);
  }

  function skipImport() {
    progressMutation.mutate({ status: "connecting", currentStep: "connect" });
    setFlowStep("connect");
  }

  function skipInvites() {
    progressMutation.mutate({
      invitesDraft: inviteRows
        .map((row) => ({ email: row.email.trim(), role: row.presetKey }))
        .filter((row) => row.email.length > 0),
      status: "org_created",
      currentStep: "import",
    });
    setFlowStep("import");
  }

  function sendInvites() {
    inviteMutation.mutate(inviteRows);
  }

  function stageFiles(nextFiles: FileList | File[]) {
    const incoming = Array.from(nextFiles);
    if (!incoming.length) return;
    setStagedFiles((current) => [...current, ...incoming]);
    setMessage(null);
  }

  function extractStagedFiles() {
    uploadMutation.mutate(stagedFiles);
  }

  // The approve gate: where payment / the SKU-cap choice happens, before anything
  // is written to the DB.
  function handleApproveClick() {
    if (approveDisabled) return;
    if (planIntent === "paid") {
      setApproveDialog("pay");
      return;
    }
    if (overFreeLimit) {
      setApproveDialog("upsell");
      return;
    }
    approveMutation.mutate();
  }

  // From the upsell dialog: keep all the data by moving to Pro, then pay.
  async function upgradeToPaid() {
    setPlanIntent("paid");
    setApproveDialog("pay");
    try {
      await progressMutation.mutateAsync({ selectedPlan: "paid" });
    } catch {
      // non-fatal; the chip/intent are already updated locally
    }
    // Re-validate so the free SKU-cap blocker clears (paid has no cap).
    validateMutation.mutate();
  }

  // From the pay dialog: drop back to Free instead of paying.
  async function downgradeToFree() {
    setPlanIntent("free");
    setApproveDialog(null);
    try {
      await progressMutation.mutateAsync({ selectedPlan: "free" });
    } catch {
      // non-fatal
    }
    validateMutation.mutate();
  }

  function enterWorkspace() {
    progressMutation.mutate({ status: "completed", currentStep: "done" });
    router.push("/");
  }

  // Connect step → done (payment already happened at the approve gate, so this is
  // just the final review screen; completion is marked when entering the app).
  function proceedToDone() {
    progressMutation.mutate({ currentStep: "done" });
    setFlowStep("done");
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <OnboardingProgress activeIndex={onboardingActiveIndex(flowStep)} plan={planIntent} />

      {finalizing ? (
        <div className="fixed inset-0 z-50 grid place-content-center justify-items-center gap-(--space-4) bg-background text-center">
          <Spinner className="size-6" />
          <p className="text-[length:var(--text-sm)] text-muted-foreground">
            Confirming your payment and importing your data…
          </p>
        </div>
      ) : null}

      {flowStep === "invite" ? (
        <main className="onboarding-flow-screen mx-auto grid w-full max-w-5xl flex-1 content-center gap-(--space-10) p-(--space-8) lg:grid-cols-[minmax(0,360px)_minmax(0,420px)] lg:justify-center lg:gap-(--space-16)">
          <aside className="grid content-center gap-(--space-6)">
            <h2 className="max-w-[14ch] text-[length:var(--text-3xl)] font-semibold leading-[var(--leading-tight)] tracking-[var(--tracking-tight)]">
              Bring the team along
            </h2>
            <div className="grid gap-(--space-2)">
              {[
                "Optional — you can do this later.",
                "Invite the people who'll run the floor.",
                "They'll get a calm welcome too.",
              ].map((line, index) => (
                <p
                  key={line}
                  className="onboarding-guide-line text-[length:var(--text-md)] leading-[var(--leading-md)] text-muted-foreground"
                  style={{ animationDelay: `${0.15 + index * 0.12}s` }}
                >
                  {line}
                </p>
              ))}
            </div>
          </aside>

          <SurfacePanel className="grid content-start gap-(--space-5)" padding="md">
            <div>
              <h3 className="text-[length:var(--text-lg)] font-semibold leading-[var(--leading-lg)]">
                Invite your team
              </h3>
              <p className="mt-(--space-2) text-[length:var(--text-sm)] text-muted-foreground">
                Add the people who&apos;ll work in your ERP. Skip if it&apos;s just you for now.
              </p>
            </div>
            <div className="grid gap-(--space-3)">
              {inviteRows.map((row, index) => (
                <div key={row.id} className="grid gap-(--space-3) sm:grid-cols-[minmax(0,1fr)_150px_auto]">
                  <Input
                    type="email"
                    value={row.email}
                    placeholder="name@company.com"
                    aria-label={`Invite email ${index + 1}`}
                    onChange={(event) =>
                      setInviteRows((current) =>
                        current.map((candidate) =>
                          candidate.id === row.id
                            ? { ...candidate, email: event.target.value }
                            : candidate,
                        ),
                      )
                    }
                  />
                  <Select
                    value={row.presetKey}
                    onValueChange={(value) =>
                      setInviteRows((current) =>
                        current.map((candidate) =>
                          candidate.id === row.id
                            ? { ...candidate, presetKey: value as AccessPresetKey }
                            : candidate,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {inviteRoleOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove invite ${index + 1}`}
                    disabled={inviteRows.length === 1}
                    onClick={() =>
                      setInviteRows((current) => current.filter((candidate) => candidate.id !== row.id))
                    }
                  >
                    <HugeiconsIcon icon={Delete02Icon} data-icon="inline-start" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              className="justify-self-start"
              onClick={() => setInviteRows((current) => [...current, createInviteRow()])}
            >
              <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
              Add another
            </Button>
            {message ? <p className="text-[length:var(--text-sm)] text-destructive">{message}</p> : null}
            <div className="flex flex-wrap justify-end gap-(--space-3) border-t pt-(--space-5)">
              <Button
                type="button"
                variant="outline"
                onClick={skipInvites}
                disabled={!onboardingReady || inviteMutation.isPending}
              >
                Skip for now
              </Button>
              <Button
                type="button"
                onClick={sendInvites}
                disabled={!onboardingReady || inviteMutation.isPending}
              >
                {inviteMutation.isPending ? "Sending..." : "Send invites & continue"}
              </Button>
            </div>
          </SurfacePanel>
        </main>
      ) : null}

      {flowStep === "import" ? (
        <main className="onboarding-flow-screen mx-auto grid w-full max-w-3xl flex-1 content-center gap-(--space-8) p-(--space-8)">
          <div className="text-center">
            <h2 className="text-[length:var(--text-2xl)] font-semibold leading-[var(--leading-tight)]">
              Bring in your data
            </h2>
            <p className="mt-(--space-3) text-[length:var(--text-sm)] text-muted-foreground">
              Drop whatever you have — we&apos;ll make sense of it. No templates, no formatting.
              Source documents are processed by OpenAI for extraction.
            </p>
          </div>

          <SurfacePanel className="grid gap-(--space-6)">
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              accept=".csv,.xlsx,.xls,.pdf,image/*"
              onChange={(event) => {
                if (event.target.files?.length) stageFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            <FileDropzone
              label={uploadMutation.isPending ? "Uploading..." : stagedFiles.length ? "Add more files" : "Drag files here or browse your computer"}
              disabled={uploadMutation.isPending}
              className="min-h-56 flex-col py-(--space-24)"
              onBrowse={() => inputRef.current?.click()}
              onFiles={stageFiles}
            />
            <div className="flex flex-wrap justify-center gap-(--space-3)">
              {supportedTypes.map((type) => (
                <span key={type} className="border bg-muted px-(--space-3) py-(--space-1) text-[length:var(--text-xs)] text-muted-foreground">
                  {type}
                </span>
              ))}
            </div>
            {stagedFiles.length ? (
              <div className="grid gap-(--space-2)">
                {stagedFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex items-center gap-(--space-4) border bg-card px-(--space-4) py-(--space-3) text-[length:var(--text-sm)]"
                  >
                    <span className="shrink-0 border bg-muted px-(--space-2) py-px font-mono text-[length:var(--text-xs)] font-medium text-muted-foreground">
                      {fileTypeBadge(file.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
                    <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-muted-foreground">
                      {formatBytes(file.size)}
                    </span>
                    <StatusLabel tone="success" className="shrink-0">
                      Ready
                    </StatusLabel>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex justify-center gap-(--space-3)">
              <Button type="button" variant="outline" onClick={skipImport}>
                I&apos;ll do this later
              </Button>
              {stagedFiles.length ? (
                <Button
                  type="button"
                  onClick={extractStagedFiles}
                  disabled={uploadMutation.isPending}
                >
                  {uploadMutation.isPending ? "Uploading..." : "Extract my data"}
                </Button>
              ) : null}
            </div>
            {message ? <p className="text-center text-[length:var(--text-sm)] text-destructive">{message}</p> : null}
          </SurfacePanel>
        </main>
      ) : null}

      {flowStep === "extract" ? (
        <main className="onboarding-flow-screen mx-auto grid w-full max-w-xl flex-1 content-center gap-(--space-8) p-(--space-8)">
          <div className="grid justify-items-center gap-(--space-5) text-center">
            <span className="relative flex size-20 items-center justify-center border bg-card">
              <HugeiconsIcon icon={DatabaseImportIcon} size={28} aria-hidden />
              <span className="absolute inset-[-6px] animate-pulse border border-primary" aria-hidden />
            </span>
            <div>
              <h2 className="text-[length:var(--text-2xl)] font-semibold leading-[var(--leading-tight)]">
                Reading your data…
              </h2>
              <p className="mt-(--space-3) text-[length:var(--text-sm)] text-muted-foreground">
                You don&apos;t need to do anything — large or image-heavy uploads can take a few minutes.
              </p>
            </div>
          </div>

          <SurfacePanel className="grid gap-(--space-5)">
            {[
              ["Reading your files", files?.some((file) => file.extractionStatus === "extracted") ? "done" : "active"],
              ["Recognizing products and quantities", reviewPackage ? "done" : "active"],
              ["Matching suppliers and customers", reviewPackage ? "done" : "waiting"],
              ["Structuring into your ERP", reviewPackage ? "done" : "waiting"],
            ].map(([label, state]) => (
              <div key={label} className="flex items-center gap-(--space-4) text-[length:var(--text-sm)]">
                {state === "done" ? (
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="text-[var(--color-success)]" aria-hidden />
                ) : state === "active" ? (
                  <Spinner className="size-4" />
                ) : (
                  <span className="size-4 border bg-muted" />
                )}
                <span className={state === "waiting" ? "text-muted-foreground" : "text-foreground"}>{label}</span>
              </div>
            ))}
            <p className="text-[length:var(--text-xs)] text-muted-foreground">
              {files?.length
                ? `${files.length} ${files.length === 1 ? "file" : "files"} queued for extraction.`
                : "Files queued for extraction."}
            </p>
            {files?.length ? (
              <div className="grid gap-(--space-2) border-t pt-(--space-4)">
                {files.map((file, index) => (
                  <div
                    key={file.id ?? `${file.filename}-${index}`}
                    className="grid items-center gap-(--space-3) border bg-background px-(--space-4) py-(--space-3) text-[length:var(--text-sm)] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
                  >
                    <span className="shrink-0 border bg-muted px-(--space-2) py-px font-mono text-[length:var(--text-xs)] font-medium text-muted-foreground">
                      {fileTypeBadge(file.filename)}
                    </span>
                    <span className="min-w-0 truncate font-medium">{file.filename}</span>
                    <span className="font-mono text-[length:var(--text-xs)] text-muted-foreground">
                      {typeof file.sizeBytes === "number" ? formatBytes(file.sizeBytes) : ""}
                    </span>
                    <StatusLabel tone={fileStatusTone(file.extractionStatus)}>
                      {fileStatusLabel(file.extractionStatus)}
                    </StatusLabel>
                  </div>
                ))}
              </div>
            ) : null}
          </SurfacePanel>

          {message ? <p className="text-center text-[length:var(--text-sm)] text-destructive">{message}</p> : null}
        </main>
      ) : null}

      {flowStep === "review" && reviewPackage ? (
        <main className="onboarding-flow-screen grid flex-1 gap-(--space-6) p-(--space-8)">
          <div className="flex flex-wrap items-start justify-between gap-(--space-6)">
            <div>
              <h2 className="text-[length:var(--text-xl)] font-semibold leading-[var(--leading-tight)]">
                Here&apos;s what we found
              </h2>
              <p className="mt-(--space-2) text-[length:var(--text-sm)] text-muted-foreground">
                Review and tidy anything, then approve. Highlighted rows want a second look.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={handleApproveClick}
              disabled={approveDisabled}
            >
              {planIntent === "paid" ? "Approve & pay" : "Approve all & continue"}
            </Button>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-(--space-4) border-b">
            <div className="flex flex-wrap items-end gap-(--space-6)">
              {entityTabs.map((tab) => (
                <CountTab
                  key={tab.id}
                  active={activeTab === tab.id}
                  label={tab.label}
                  count={counts[tab.id]}
                  onClick={() => setActiveTab(tab.id)}
                />
              ))}
            </div>
            <label className="flex items-center gap-(--space-3) pb-(--space-3) text-[length:var(--text-sm)]">
              <Switch checked={needsReviewOnly} onCheckedChange={setNeedsReviewOnly} />
              Needs review only
              {needsReviewCount > 0 ? (
                <span className="border border-[var(--color-warning)] px-(--space-2) font-mono text-[length:var(--text-xs)] tabular-nums text-[var(--color-warning)]">
                  {needsReviewCount}
                </span>
              ) : null}
            </label>
          </div>

          <ERPDataGrid
            rows={rows}
            columns={columns}
            height="min(62vh, 720px)"
            emptyMessage="No rows in this section."
            onCellValueChanged={handleCellValueChanged}
            rowClassRules={{
              "opacity-60": ({ data }) => data?.selected === false,
              "bg-[var(--color-warning-soft)]": ({ data }) =>
                data?.selected !== false && (data?.confidence ?? 1) < 0.7,
            }}
            statusBarContent={
              <>
                <span>
                  {rows.length} shown · <strong className="text-foreground">{needsReviewCount}</strong> need attention
                </span>
                {preview ? (
                  <StatusLabel tone={preview.blockingIssueCount > 0 ? "danger" : preview.warningIssueCount > 0 ? "warning" : "success"}>
                    {preview.blockingIssueCount} blocking · {preview.warningIssueCount} warnings
                  </StatusLabel>
                ) : null}
              </>
            }
          />

          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-(--space-4) border bg-card p-(--space-5)">
            <div className="flex flex-wrap items-center gap-(--space-4)">
              <label className="flex items-center gap-(--space-3) text-[length:var(--text-sm)]">
                <Checkbox checked={includeBoms} onCheckedChange={(value) => setIncludeBoms(value === true)} />
                Create BOM revisions
              </label>
              {paymentCanceled ? (
                <span className="text-[length:var(--text-sm)] text-[var(--color-warning)]">
                  Payment canceled — your data isn&apos;t imported yet. You can pay when you&apos;re ready.
                </span>
              ) : null}
              {message ? <span className="text-[length:var(--text-sm)] text-muted-foreground">{message}</span> : null}
            </div>
            <div className="flex gap-(--space-3)">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRowsIncluded(rows.filter((row) => row.selected), false)}
                disabled={!rows.some((row) => row.selected)}
              >
                Reject selected
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => validateMutation.mutate()}
                disabled={validateMutation.isPending}
              >
                {dirty ? "Update preview" : "Revalidate"}
              </Button>
              <Button type="button" onClick={handleApproveClick} disabled={approveDisabled}>
                {planIntent === "paid"
                  ? "Approve & pay"
                  : overFreeLimit
                    ? "Approve & continue"
                    : `Approve ${approvedCount} & continue`}
              </Button>
            </div>
          </div>

          {preview?.issues.length ? (
            <InsetPanel className="grid gap-(--space-2)">
              {preview.issues.slice(0, 5).map((issue, index) => (
                <p key={`${issue.message}-${index}`} className="text-[length:var(--text-sm)] text-muted-foreground">
                  {issue.message}
                </p>
              ))}
            </InsetPanel>
          ) : null}
        </main>
      ) : null}

      {flowStep === "connect" ? (
        <main className="onboarding-flow-screen mx-auto grid w-full max-w-5xl flex-1 content-center gap-(--space-8) p-(--space-8)">
          <div className="text-center">
            <h2 className="text-[length:var(--text-2xl)] font-semibold leading-[var(--leading-tight)]">
              Connect the tools you already use
            </h2>
            <p className="mt-(--space-3) text-[length:var(--text-sm)] text-muted-foreground">
              Keep inventory and orders in sync automatically. Add these now or anytime later.
            </p>
          </div>
          <div className="grid gap-(--space-5) md:grid-cols-3">
            {integrationTiles.map(([name, purpose, live]) => (
              <SurfacePanel key={name} className="grid gap-(--space-4)">
                <span className="flex size-10 items-center justify-center border bg-muted">
                  <HugeiconsIcon icon={DatabaseImportIcon} size={18} aria-hidden />
                </span>
                <div>
                  <h3 className="font-semibold">{name}</h3>
                  <p className="text-[length:var(--text-sm)] text-muted-foreground">{purpose}</p>
                </div>
                <Button
                  type="button"
                  variant={live ? "outline" : "ghost"}
                  onClick={() => (live ? router.push("/settings/integrations") : undefined)}
                  disabled={!live}
                >
                  {live ? "Connect" : "Coming soon"}
                </Button>
              </SurfacePanel>
            ))}
          </div>
          <div className="flex justify-center gap-(--space-3)">
            <Button type="button" variant="outline" onClick={proceedToDone}>
              Skip for now
            </Button>
            <Button type="button" onClick={proceedToDone}>
              Continue
            </Button>
          </div>
        </main>
      ) : null}

      {flowStep === "done" ? (
        <main className="onboarding-flow-screen mx-auto grid w-full max-w-2xl flex-1 content-center justify-items-center gap-(--space-8) p-(--space-8) text-center">
          <span className="flex size-16 items-center justify-center border bg-card text-[var(--color-success)]">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={28} aria-hidden />
          </span>
          <div>
            <h2 className="text-[length:var(--text-2xl)] font-semibold leading-[var(--leading-tight)]">
              Your workspace is ready
            </h2>
            <p className="mt-(--space-3) text-[length:var(--text-sm)] text-muted-foreground">
              Everything you dropped is in and organized. Here&apos;s the shape of it.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-(--space-4) md:grid-cols-4">
            {[
              ["items", commitSummary?.items ?? 0],
              ["suppliers", commitSummary?.suppliers ?? 0],
              ["customers", commitSummary?.customers ?? 0],
              ["BOMs", commitSummary?.boms ?? 0],
            ].map(([label, count]) => (
              <SurfacePanel key={label} className="py-(--space-5)">
                <div className="font-mono text-[length:var(--text-xl)] tabular-nums">{count}</div>
                <div className="text-[length:var(--text-xs)] text-muted-foreground">{label}</div>
              </SurfacePanel>
            ))}
          </div>
          <Button type="button" onClick={enterWorkspace}>
            Enter your workspace
          </Button>
          <div className="grid justify-items-center gap-(--space-3)">
            <p className="text-[length:var(--text-sm)] text-muted-foreground">Next, you might want to:</p>
            <div className="flex flex-wrap justify-center gap-(--space-3) text-[length:var(--text-xs)] text-muted-foreground">
              <span className="border px-(--space-3) py-(--space-2)">Set reorder points</span>
              <span className="border px-(--space-3) py-(--space-2)">Create a work order</span>
              <span className="border px-(--space-3) py-(--space-2)">Invite more of the team</span>
            </div>
          </div>
        </main>
      ) : null}

      <Dialog
        open={approveDialog !== null}
        onOpenChange={(open) => {
          if (!open) setApproveDialog(null);
        }}
      >
        <DialogContent>
          {approveDialog === "pay" ? (
            <>
              <DialogHeader>
                <DialogTitle>Start your Pro plan</DialogTitle>
                <DialogDescription>
                  Pro is $199/mo — unlimited SKUs, locations and integrations. You&apos;ll
                  go to secure checkout, then your data imports automatically. Nothing is
                  saved until your payment goes through.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={downgradeToFree}
                  disabled={checkoutMutation.isPending}
                >
                  Switch to Free
                </Button>
                <Button
                  type="button"
                  onClick={() => checkoutMutation.mutate()}
                  disabled={
                    checkoutMutation.isPending ||
                    validateMutation.isPending ||
                    hasOtherBlocking ||
                    !preview?.hash
                  }
                >
                  {checkoutMutation.isPending ? "Starting checkout…" : "Pay & import"}
                </Button>
              </DialogFooter>
            </>
          ) : approveDialog === "upsell" ? (
            <>
              <DialogHeader>
                <DialogTitle>That&apos;s more than the Free plan holds</DialogTitle>
                <DialogDescription>
                  Your import adds {selectedNewSkuCount} items, and Free includes{" "}
                  {FREE_SKU_LIMIT}. Keep everything by upgrading to Pro, or unselect some
                  items in the table to stay on Free.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setApproveDialog(null);
                    setActiveTab("items");
                  }}
                >
                  Unselect some items
                </Button>
                <Button type="button" onClick={upgradeToPaid}>
                  Upgrade to Pro
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
