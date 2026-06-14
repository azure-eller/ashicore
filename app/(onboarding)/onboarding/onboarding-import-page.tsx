"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  billingSelectionLookupKey,
  normalizeBillingSelection,
  type BillingSelection,
} from "@/lib/billing/plan-intent";
import { getBillingOffer } from "@/lib/billing/types";
import type { CellValueChangedEvent, ColDef, ICellRendererParams } from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { ERPDataGrid } from "@/components/erp-data-grid";
import { OnboardingProgress, onboardingStepIndex } from "@/components/onboarding-stepper";
import { OnboardingSplit } from "@/components/onboarding-rail";
import { ProgressMeter } from "@/components/progress-meter";
import { ShopifyConnectDialog } from "@/app/(dashboard)/settings/shopify-connect-dialog";
import {
  AccountingPurchaseOrderImportButton,
  XeroImportSection,
} from "@/app/(dashboard)/settings/integrations/xero-import-section";
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
import { Spinner } from "@/components/ui/spinner";
import {
  ACCOUNTING_PROVIDER_QUICKBOOKS,
  ACCOUNTING_PROVIDERS,
  type AccountingProvider,
} from "@/lib/accounting/constants";
import { apiJson } from "@/lib/client/api";
import { formatBytes } from "@/lib/format";
import { getAccessPresetKeys, formatAccessPresetLabel, type AccessPresetKey } from "@/lib/authz";
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
type OnboardingIntegrationState = {
  xero: { connected: boolean; tenantName?: string };
  quickbooks: { connected: boolean; tenantName?: string };
  shopify: { connected: boolean; tenantName?: string };
};

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
// Every assignable role, straight from the canonical preset list, with its
// canonical label (admin, ops/sales manager + operator, view only).
const inviteRoleOptions: Array<{ value: AccessPresetKey; label: string }> =
  getAccessPresetKeys().map((value) => ({ value, label: formatAccessPresetLabel(value) }));
const integrationTiles = [
  {
    key: "xero",
    name: "Xero",
    purpose: "Accounting, contacts, suppliers, and purchase orders.",
    href: "/api/xero/connect?returnTo=onboarding",
  },
  {
    key: "quickbooks",
    name: "QuickBooks",
    purpose: "Accounting defaults and purchase order import.",
    href: "/api/quickbooks/connect?returnTo=onboarding",
  },
  {
    key: "shopify",
    name: "Shopify",
    purpose: "Paid order import from your storefront.",
  },
] as const;
const integrationDisplayNames: Record<string, string> = Object.fromEntries(
  integrationTiles.map((tile) => [tile.key, tile.name]),
);

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

// Maps a filename to the format-chip color class (blue/green/red/violet).
function fileTypeKind(name: string): "csv" | "xls" | "pdf" | "img" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "xlsx" || ext === "xls") return "xls";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return "img";
  return "csv";
}

// Small inline brand glyphs (not a UI-icon library) used by the import-phase
// screens, lifted from the design reference.
function UploadGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}
function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12l5 5L20 6" />
    </svg>
  );
}

function ConfidenceCell({ value }: ICellRendererParams<ReviewRow, number>) {
  const confidence = typeof value === "number" ? value : 0;
  return (
    <span className="flex h-full items-center gap-(--space-3)">
      <span className={cn("w-16", confidenceTone(confidence) === "success" && "text-[var(--status-success-ink)]", confidenceTone(confidence) === "warning" && "text-[var(--status-warning-ink)]", confidenceTone(confidence) === "danger" && "text-[var(--status-danger-ink)]")}>
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

const connectErrorReasons: Record<string, string> = {
  state_mismatch: "your session expired before we could finish",
  quickbooks_state_mismatch: "your session expired before we could finish",
  callback_failed: "we couldn't complete the connection",
  quickbooks_callback_failed: "we couldn't complete the connection",
  access_denied: "access was declined",
};

function connectErrorMessage(code: string | null) {
  const reason = code ? connectErrorReasons[code] : null;
  return reason ? `Connection failed — ${reason}.` : "Connection failed. Please try again.";
}

export function OnboardingImportPage({
  plan,
  integrations,
}: {
  plan?: BillingSelection;
  integrations: OnboardingIntegrationState;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const startedRef = useRef(false);
  const finalizeStartedRef = useRef(false);
  const [flowStep, setFlowStep] = useState<FlowStep>("invite");
  const [billingSelection, setBillingSelection] = useState<BillingSelection>(() =>
    normalizeBillingSelection(plan ?? "free"),
  );
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
  // The approve gate: paid selections pay here; free commits directly.
  // Null = no dialog.
  const [approveDialog, setApproveDialog] = useState<null | "pay">(null);
  const [finalizing, setFinalizing] = useState(false);
  const [shopifyDialogOpen, setShopifyDialogOpen] = useState(false);
  const [quickBooksImportSummary, setQuickBooksImportSummary] = useState<{
    created: number;
    updated: number;
  } | null>(null);

  const startMutation = useMutation({
    mutationFn: () =>
      apiJson<OnboardingSessionResponse>("/api/onboarding/session", {
        method: "POST",
        // Only assert the plan when the URL carried it (first entry). On the Stripe
        // return there's no plan param, so we preserve the persisted intent.
        body: plan ? { selectedPlan: normalizeBillingSelection(plan) } : {},
      }),
    onSuccess: (data) => {
      if (!data.session) return;
      setFlowStep(data.session.currentStep ?? "import");
      setSessionId(data.session.importSessionId);
      if (data.session.selectedPlan) {
        setBillingSelection(normalizeBillingSelection(data.session.selectedPlan));
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
        body: {
          openingStockAsOf: reviewPackage.openingStockAsOf,
          includeBoms,
          package: reviewPackage,
        },
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
        body: { previewHash: preview.hash },
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
        body: {
          flow: "onboarding",
          lookupKey: billingSelectionLookupKey(billingSelection) ?? "everything",
        },
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
        body: {},
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
        body: body,
      }),
  });

  const inviteMutation = useMutation({
    mutationFn: async (rows: InviteRow[]) => {
      const invites = rows
        .map((row) => ({ ...row, email: row.email.trim() }))
        .filter((row) => row.email.length > 0);

      await apiJson<OnboardingSessionResponse>("/api/onboarding/session", {
        method: "PATCH",
        body: {
          invitesDraft: invites.map((invite) => ({
            email: invite.email,
            role: invite.presetKey,
          })),
        },
      });

      await Promise.all(
        invites.map((invite) =>
          apiJson<void>("/api/team/invitations", {
            method: "POST",
            body: { email: invite.email, presetKey: invite.presetKey },
          }),
        ),
      );

      return apiJson<OnboardingSessionResponse>("/api/onboarding/session", {
        method: "PATCH",
        body: { status: "org_created", currentStep: "import" },
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

  const fetchImport = fetchImportMutation.mutate;

  useEffect(() => {
    if (!sessionId) return;
    if (flowStep === "extract") {
      fetchImport(sessionId);
      const timer = window.setInterval(() => fetchImport(sessionId), 3500);
      return () => window.clearInterval(timer);
    }
    if (flowStep === "review" && !reviewPackage) {
      fetchImport(sessionId);
    }
  }, [flowStep, sessionId, reviewPackage, fetchImport]);

  // Returning from a successful Stripe checkout (paid path): commit the now-paid
  // import. (`onMutate` flips the finalizing flag; the cancel case is derived in
  // render, so this effect performs no synchronous state updates.)
  useEffect(() => {
    if (searchParams.get("checkout") !== "success" || !onboardingReady) return;
    if (!sessionId || committed || finalizeStartedRef.current) return;
    finalizeStartedRef.current = true;
    finalizeMutation.mutate(sessionId);
  }, [searchParams, onboardingReady, sessionId, committed, finalizeMutation]);

  const selectedOffer = useMemo(() => {
    const lookupKey = billingSelectionLookupKey(billingSelection);
    return lookupKey ? getBillingOffer(lookupKey) : null;
  }, [billingSelection]);

  const paymentCanceled = searchParams.get("checkout") === "cancel" && !committed;
  const connectedIntegration = searchParams.get("integration");
  const integrationError = searchParams.get("error");

  const connectedAccountingName = integrations.xero.connected
    ? "Xero"
    : integrations.quickbooks.connected
      ? "QuickBooks"
      : null;

  const justConnectedName = connectedIntegration?.endsWith("_connected")
    ? integrationDisplayNames[connectedIntegration.replace("_connected", "")] ?? null
    : null;

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

  const blockingIssues = useMemo(
    () => (preview?.issues ?? []).filter((issue) => issue.severity === "blocking"),
    [preview],
  );
  const hasBlocking = blockingIssues.length > 0;
  const approveDisabled =
    dirty ||
    approveMutation.isPending ||
    validateMutation.isPending ||
    !preview?.hash ||
    hasBlocking;

  const columns = useMemo<Array<ColDef<ReviewRow>>>(() => {
    const includeColumn: ColDef<ReviewRow> = {
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
      };
    const actionColumn: ColDef<ReviewRow> = { field: "action", headerName: "Action", width: 104, editable: false };
    const sourceColumn: ColDef<ReviewRow> = { field: "source", headerName: "Source", width: 210, editable: false };
    const confidenceColumn: ColDef<ReviewRow> = {
      field: "confidence",
      headerName: "Confidence",
      width: 160,
      editable: false,
      cellRenderer: ConfidenceCell,
    };
    const reviewColumns = [sourceColumn, confidenceColumn];

    if (activeTab === "items") {
      return [
        includeColumn,
        actionColumn,
        { field: "kind", headerName: "Type", width: 112, editable: false },
        { field: "primary", headerName: "SKU", width: 150, editable: true },
        { field: "secondary", headerName: "Name", flex: 1, minWidth: 220, editable: true },
        { field: "quantity", headerName: "On hand", width: 120, editable: true, cellClass: "font-mono tabular-nums" },
        { field: "unitCost", headerName: "Price / cost", width: 120, editable: true, cellClass: "font-mono tabular-nums" },
        ...reviewColumns,
      ];
    }

    if (activeTab === "suppliers") {
      return [
        includeColumn,
        actionColumn,
        { field: "primary", headerName: "Code", width: 150, editable: true },
        { field: "secondary", headerName: "Supplier", flex: 1, minWidth: 220, editable: true },
        ...reviewColumns,
      ];
    }

    if (activeTab === "customers") {
      return [
        includeColumn,
        actionColumn,
        { field: "primary", headerName: "Email", width: 220, editable: true },
        { field: "secondary", headerName: "Customer", flex: 1, minWidth: 220, editable: true },
        ...reviewColumns,
      ];
    }

    if (activeTab === "openingStock") {
      return [
        includeColumn,
        actionColumn,
        { field: "primary", headerName: "Item", flex: 1, minWidth: 220, editable: false },
        { field: "secondary", headerName: "Lot", width: 160, editable: true },
        { field: "quantity", headerName: "On hand", width: 120, editable: true, cellClass: "font-mono tabular-nums" },
        { field: "unitCost", headerName: "Unit cost", width: 120, editable: true, cellClass: "font-mono tabular-nums" },
        ...reviewColumns,
      ];
    }

    if (activeTab === "boms") {
      return [
        includeColumn,
        actionColumn,
        { field: "primary", headerName: "Product", flex: 1, minWidth: 220, editable: false },
        { field: "secondary", headerName: "Components", width: 160, editable: false },
        { field: "quantity", headerName: "Output qty", width: 120, editable: false, cellClass: "font-mono tabular-nums" },
        ...reviewColumns,
      ];
    }

    return [
      includeColumn,
      { field: "action", headerName: "Action", width: 104, editable: false },
      { field: "primary", headerName: "Name", flex: 1, minWidth: 220, editable: true },
      { field: "secondary", headerName: "UOM", width: 120, editable: true },
      { field: "quantity", headerName: "Size", width: 120, editable: true, cellClass: "font-mono tabular-nums" },
      ...reviewColumns,
    ];
  }, [activeTab]);

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

  // The approve gate: where payment happens, before anything is written to the DB.
  function handleApproveClick() {
    if (approveDisabled) return;
    if (selectedOffer) {
      setApproveDialog("pay");
      return;
    }
    approveMutation.mutate();
  }

  // From the pay dialog: drop back to Free instead of paying.
  async function downgradeToFree() {
    setBillingSelection("free");
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

  // Stepper navigation. Each top-bar node maps to a flow step; jumps are gated by
  // what's actually reachable so you can step back/forward without skipping work
  // or re-committing. Account/Workspace live on earlier routes and aren't jumpable
  // from here. Once committed, navigation is limited to the post-import steps.
  const stepIndexToFlowStep: Partial<Record<number, FlowStep>> = {
    [onboardingStepIndex("Invite")]: "invite",
    [onboardingStepIndex("Import")]: "import",
    [onboardingStepIndex("Review")]: "review",
    [onboardingStepIndex("Connect")]: "connect",
    [onboardingStepIndex("Done")]: "done",
  };
  const isStepNavigable = (index: number) => {
    const target = stepIndexToFlowStep[index];
    if (!target) return false;
    if (committed) return target === "connect" || target === "done";
    if (target === "invite" || target === "import") return true;
    if (target === "review") return reviewPackage != null;
    return false;
  };
  const navigateToStep = (index: number) => {
    const target = stepIndexToFlowStep[index];
    if (target && isStepNavigable(index)) {
      setMessage(null);
      setFlowStep(target);
    }
  };

  return (
    <div className="onboarding-flow-screen flex min-h-svh flex-col">
      <OnboardingProgress
        activeIndex={onboardingActiveIndex(flowStep)}
        plan={billingSelection}
        onNavigate={navigateToStep}
        isNavigable={isStepNavigable}
      />

      {finalizing ? (
        <div className="fixed inset-0 z-50 grid place-content-center justify-items-center gap-(--space-4) bg-[var(--color-bg)] text-center">
          <Spinner className="size-6" />
          <p className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
            Confirming your payment and importing your data…
          </p>
        </div>
      ) : null}

      <div className="ob-stage ob-anim-fade" key={flowStep}>
      {flowStep === "invite" ? (
        <OnboardingSplit
          step={3}
          guideTitle={
            <>
              Bring the
              <br />
              team along
            </>
          }
          guideLines={[
            "Optional — you can do this later.",
            "Invite the people who'll run the floor.",
            "They'll get a calm welcome too.",
          ]}
        >
          <h1 className="ob-form-title ob-stagger">Invite your team</h1>
          <p className="ob-form-sub ob-stagger">
            Add the people who&apos;ll work in your ERP. Skip if it&apos;s just you for now.
          </p>
          <div className="ob-form-stack ob-form-stack--tight">
            {inviteRows.map((row, index) => (
              <div key={row.id} className="ob-invite-row">
                <input
                  className="ob-input"
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
                <select
                  className="ob-input"
                  value={row.presetKey}
                  aria-label={`Invite role ${index + 1}`}
                  onChange={(event) =>
                    setInviteRows((current) =>
                      current.map((candidate) =>
                        candidate.id === row.id
                          ? { ...candidate, presetKey: event.target.value as AccessPresetKey }
                          : candidate,
                      ),
                    )
                  }
                >
                  {inviteRoleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ob-icon-btn"
                  aria-label={`Remove invite ${index + 1}`}
                  disabled={inviteRows.length === 1}
                  onClick={() =>
                    setInviteRows((current) => current.filter((candidate) => candidate.id !== row.id))
                  }
                >
                  <HugeiconsIcon icon={Delete02Icon} size={15} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="ob-link-add"
              onClick={() => setInviteRows((current) => [...current, createInviteRow()])}
            >
              <HugeiconsIcon icon={Add01Icon} size={15} /> Add another
            </button>
          </div>
          {message ? <p className="ob-form-error">{message}</p> : null}
          <div className="ob-form-actions ob-form-actions--split ob-form-actions--ruled">
            <button
              type="button"
              className="ob-btn ob-btn--quiet"
              onClick={skipInvites}
              disabled={!onboardingReady || inviteMutation.isPending}
            >
              Skip for now
            </button>
            <button
              type="button"
              className="ob-btn ob-btn--primary"
              onClick={sendInvites}
              disabled={!onboardingReady || inviteMutation.isPending}
            >
              {inviteMutation.isPending ? "Sending…" : "Send invites & continue"}
            </button>
          </div>
        </OnboardingSplit>
      ) : null}

      {flowStep === "import" ? (
        <div className="ob-scr ob-scr--center ob-scr--wide">
          <div className="ob-scr-inner">
            <div className="ob-scr-head">
              <span className="ob-eyebrow">AI Onboarding</span>
              <h1 className="ob-scr-title">Bring in your data</h1>
              <p className="ob-scr-sub">
                Drop whatever you have — spreadsheets, price lists, even photos of batch tickets.
                AI reads &amp; structures it. No templates, no formatting; source documents are
                processed by OpenAI for extraction.
              </p>
            </div>

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
            <div
              className="ob-dropzone"
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (event.dataTransfer.files?.length) stageFiles(event.dataTransfer.files);
              }}
            >
              <span className="ob-dropzone-glyph">
                <UploadGlyph />
              </span>
              <div className="ob-dropzone-big">
                {uploadMutation.isPending ? "Uploading…" : "Drag files here"}
              </div>
              <div className="ob-dropzone-or">
                or <span className="ob-link">browse your computer</span>
              </div>
              <div className="ob-dropzone-types">
                {supportedTypes.map((type) => (
                  <span key={type} className="ob-chip">
                    {type}
                  </span>
                ))}
              </div>
            </div>

            {stagedFiles.length ? (
              <div className="ob-droplist">
                {stagedFiles.map((file, index) => (
                  <div key={`${file.name}-${file.size}-${index}`} className="ob-dropfile">
                    <span className={`ob-ftype ob-ftype--${fileTypeKind(file.name)}`}>
                      {fileTypeBadge(file.name)}
                    </span>
                    <div className="ob-dropfile-meta">
                      <div className="ob-dropfile-name">{file.name}</div>
                      <div className="ob-dropfile-sub">{formatBytes(file.size)}</div>
                    </div>
                    <span className="ob-dropfile-ok ob-dropfile-ok--good">
                      <CheckGlyph /> ready
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="ob-form-actions ob-form-actions--center">
              <button type="button" className="ob-btn ob-btn--quiet" onClick={skipImport}>
                I&apos;ll do this later
              </button>
              {stagedFiles.length ? (
                <button
                  type="button"
                  className="ob-btn ob-btn--primary"
                  onClick={extractStagedFiles}
                  disabled={uploadMutation.isPending}
                >
                  {uploadMutation.isPending ? "Uploading…" : "Extract my data"}{" "}
                  <span className="ob-arr">→</span>
                </button>
              ) : null}
            </div>
            {message ? (
              <p className="ob-form-error ob-form-error--center">
                {message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {flowStep === "extract" ? (
        <div className="ob-scr ob-scr--center">
          <div className="ob-extract">
            <div className="ob-aicore">
              <span className="ob-aicore-ring" />
              <span className="ob-aicore-ring r2" />
              <span className="ob-aicore-ring r3" />
              <span className="ob-aicore-hex">ai</span>
            </div>
            <h1 className="ob-extract-title">Reading your data…</h1>
            <p className="ob-extract-sub">
              You don&apos;t need to do anything — large or image-heavy uploads can take a few minutes.
            </p>
            <div className="ob-extract-steps">
              {(
                [
                  ["Reading your files", files?.some((file) => file.extractionStatus === "extracted") ? "done" : "active"],
                  ["Recognizing products & quantities", reviewPackage ? "done" : "active"],
                  ["Matching suppliers and customers", reviewPackage ? "done" : "waiting"],
                  ["Structuring into your ERP", reviewPackage ? "done" : "waiting"],
                ] as const
              ).map(([label, state]) => (
                <div
                  key={label}
                  className={cn(
                    "ob-estep",
                    state === "done" && "ob-estep--done",
                    state === "active" && "ob-estep--active",
                  )}
                >
                  <span className="ob-estep-dot">{state === "done" ? <CheckGlyph /> : null}</span>
                  <span className="ob-estep-label">{label}</span>
                </div>
              ))}
            </div>
            <p className="ob-extract-hint">
              {files?.length
                ? `${files.length} ${files.length === 1 ? "file" : "files"} · structuring records`
                : "Files queued for extraction."}
            </p>
            {message ? (
              <p className="ob-form-error ob-form-error--spaced">
                {message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {flowStep === "review" && reviewPackage ? (
        <div className="ob-review">
          <div className="ob-review-top">
            <div>
              <h1 className="ob-review-title">Here&apos;s what we found</h1>
              <p className="ob-review-sub">
                Review and tidy anything, then approve — fix a value in place and its confidence
                updates. Highlighted rows want a second look.
              </p>
            </div>
            <button
              type="button"
              className="ob-btn ob-btn--quiet"
              onClick={handleApproveClick}
              disabled={approveDisabled}
            >
              {selectedOffer ? "Approve & pay" : "Approve all & continue"}
            </button>
          </div>

          <div className="ob-review-tabs">
            {entityTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={cn("ob-rtab", activeTab === tab.id && "is-active")}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                <span className="ob-rtab-n">{counts[tab.id]}</span>
              </button>
            ))}
            <span className="ob-review-filter">
              <button
                type="button"
                className={cn("ob-toggle", needsReviewOnly && "is-on")}
                onClick={() => setNeedsReviewOnly(!needsReviewOnly)}
                aria-pressed={needsReviewOnly}
              >
                <span className="ob-toggle-track" />
                Needs review only
              </button>
              {needsReviewCount > 0 ? <span className="ob-chip ob-chip--warn">{needsReviewCount}</span> : null}
            </span>
          </div>

          <ERPDataGrid
            rows={rows}
            columns={columns}
            height="min(58vh, 680px)"
            emptyMessage="No rows in this section."
            onCellValueChanged={handleCellValueChanged}
            rowClassRules={{
              "opacity-60": ({ data }) => data?.selected === false,
              "bg-[var(--color-warning-soft)]": ({ data }) =>
                data?.selected !== false && (data?.confidence ?? 1) < 0.7,
            }}
          />

          <div className="ob-review-footbar">
            <div className="ob-review-meta">
              <label className="ob-review-count ob-review-check">
                <Checkbox checked={includeBoms} onCheckedChange={(value) => setIncludeBoms(value === true)} />
                Create BOM revisions
              </label>
              <span className="ob-review-count">
                {rows.length} shown · <b>{needsReviewCount} need attention</b> ·{" "}
                {preview?.blockingIssueCount ?? 0} blocking · {preview?.warningIssueCount ?? 0} warnings
              </span>
              {paymentCanceled ? (
                <span className="ob-review-count ob-review-count--warn">
                  Payment canceled — your data isn&apos;t imported yet.
                </span>
              ) : null}
              {message ? (
                <span className="ob-review-count ob-review-count--soft">
                  {message}
                </span>
              ) : null}
            </div>
            <div className="ob-review-actions">
              <button
                type="button"
                className="ob-btn ob-btn--quiet"
                onClick={() => setRowsIncluded(rows.filter((row) => row.selected), false)}
                disabled={!rows.some((row) => row.selected)}
              >
                Reject selected
              </button>
              <button
                type="button"
                className="ob-btn ob-btn--ghost"
                onClick={() => validateMutation.mutate()}
                disabled={validateMutation.isPending}
              >
                {dirty ? "Update preview" : "Revalidate"}
              </button>
              <button type="button" className="ob-btn ob-btn--primary" onClick={handleApproveClick} disabled={approveDisabled}>
                {selectedOffer
                  ? "Approve & pay"
                  : `Approve ${approvedCount} & continue`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {flowStep === "connect" ? (
        <div className="ob-scr ob-scr--center ob-scr--wide">
          <div className="ob-scr-inner">
            <div className="ob-scr-head">
              <span className="ob-eyebrow">Integrations</span>
              <h1 className="ob-scr-title">Connect the tools you already use</h1>
              <p className="ob-scr-sub">
                Keep inventory and orders in sync automatically. Add these now or anytime later.
              </p>
            </div>
            {justConnectedName ? (
              <p className="ob-connect-banner">
                <span className="ob-connect-banner-glyph">
                  <CheckGlyph />
                </span>
                {justConnectedName} connected. Import existing records below, or continue
                and do it later.
              </p>
            ) : null}
            {connectedIntegration?.endsWith("_error") ? (
              <p className="ob-form-error">{connectErrorMessage(integrationError)}</p>
            ) : null}
            <div className="ob-tool-grid">
              {integrationTiles.map((integration) => {
                const state = integrations[integration.key];
                const blockedByOtherAccounting =
                  !state.connected &&
                  connectedAccountingName !== null &&
                  ACCOUNTING_PROVIDERS.includes(integration.key as AccountingProvider);
                return (
                  <div
                    key={integration.key}
                    className={cn(
                      "ob-tool",
                      state.connected && "ob-tool--connected",
                      blockedByOtherAccounting && "ob-tool--blocked",
                    )}
                  >
                    <span className="ob-tool-logo">{integration.name.charAt(0)}</span>
                    <div className="ob-tool-name">{integration.name}</div>
                    <div className="ob-tool-sub">
                      {state.connected && state.tenantName
                        ? state.tenantName
                        : blockedByOtherAccounting
                          ? `${connectedAccountingName} is already connected.`
                          : integration.purpose}
                    </div>
                    <div className="ob-tool-action">
                      {state.connected ? (
                        <span className="ob-tool-status ob-tool-status--connected">
                          <span className="ob-tool-status-glyph">
                            <CheckGlyph />
                          </span>
                          Connected
                        </span>
                      ) : blockedByOtherAccounting ? (
                        <span className="ob-tool-status ob-tool-status--blocked">
                          Unavailable
                        </span>
                      ) : integration.key === "shopify" ? (
                        <button
                          type="button"
                          className="ob-btn ob-btn--ghost ob-btn--block"
                          onClick={() => setShopifyDialogOpen(true)}
                        >
                          Connect
                        </button>
                      ) : (
                        <a
                          className="ob-btn ob-btn--ghost ob-btn--block"
                          href={integration.href}
                        >
                          Connect
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {integrations.xero.connected ? (
              <div className="ob-integration-import">
                <h2 className="ob-section-title">Import from Xero</h2>
                <XeroImportSection canImportCustomers canImportSuppliers />
              </div>
            ) : null}
            {integrations.quickbooks.connected ? (
              <div className="ob-integration-import">
                <h2 className="ob-section-title">Import from QuickBooks</h2>
                <div className="ob-inline-actions">
                  <AccountingPurchaseOrderImportButton
                    provider={ACCOUNTING_PROVIDER_QUICKBOOKS}
                    onComplete={setQuickBooksImportSummary}
                  />
                </div>
                {quickBooksImportSummary ? (
                  <p className="ob-form-note">
                    Purchase orders: {quickBooksImportSummary.created} imported,{" "}
                    {quickBooksImportSummary.updated} updated.
                  </p>
                ) : null}
              </div>
            ) : null}
            <ShopifyConnectDialog
              open={shopifyDialogOpen}
              connection={null}
              onOpenChange={setShopifyDialogOpen}
            />
            <div className="ob-form-actions ob-form-actions--center">
              <button type="button" className="ob-btn ob-btn--quiet" onClick={proceedToDone}>
                Skip for now
              </button>
              <button type="button" className="ob-btn ob-btn--primary" onClick={proceedToDone}>
                Continue <span className="ob-arr">→</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {flowStep === "done" ? (
        <div className="ob-scr ob-scr--center">
          <div className="ob-done">
            <span className="ob-done-mark">
              <CheckGlyph />
            </span>
            <h1 className="ob-done-title">Your workspace is ready</h1>
            <p className="ob-done-sub">
              Everything you dropped is in and organized. Here&apos;s the shape of it.
            </p>
            <div className="ob-done-stats">
              {(
                [
                  ["items", commitSummary?.items ?? 0],
                  ["suppliers", commitSummary?.suppliers ?? 0],
                  ["customers", commitSummary?.customers ?? 0],
                  ["BOMs", commitSummary?.boms ?? 0],
                ] as const
              ).map(([label, count]) => (
                <div key={label} className="ob-done-stat">
                  <div className="ob-done-statn">{count}</div>
                  <div className="ob-done-statl">{label}</div>
                </div>
              ))}
            </div>
            <button type="button" className="ob-btn ob-btn--primary ob-btn--lg" onClick={enterWorkspace}>
              Enter your workspace <span className="ob-arr">→</span>
            </button>
            <div className="ob-done-next">
              <span>Next, you might want to:</span>
              <div className="ob-done-chips">
                <span className="ob-done-chip">Set reorder points</span>
                <span className="ob-done-chip">Create a work order</span>
                <span className="ob-done-chip">Invite more of the team</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      </div>{/* ob-stage */}

      <Dialog
        open={approveDialog !== null}
        onOpenChange={(open) => {
          if (!open) setApproveDialog(null);
        }}
      >
        <DialogContent className="onboarding-flow-screen">
          {approveDialog === "pay" ? (
            <>
              <DialogHeader>
                <DialogTitle>Start with {selectedOffer?.name ?? "paid plugins"}</DialogTitle>
                <DialogDescription>
                  {selectedOffer?.name ?? "Your selection"} is $
                  {selectedOffer?.monthlyUsd ?? 0}/mo. You&apos;ll
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
                    hasBlocking ||
                    !preview?.hash
                  }
                >
                  {checkoutMutation.isPending ? "Starting checkout…" : "Pay & import"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
