"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  RefreshIcon,
  Alert02Icon,
  LinkSquare02Icon,
  ArrowReloadHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsCard, SettingsBlock } from "@/components/settings-panel";
import {
  FramedTable,
  FramedTableHead,
  FramedTableBody,
  FramedTableRow,
  FramedTableHeaderCell,
  FramedTableCell,
} from "@/components/table-frame";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  OverheadSettingsData,
  OverheadComputeResult,
} from "@/lib/dal/overhead-settings";
import { apiJson, ApiJsonError } from "@/lib/client/api";
import {
  computeOverhead,
  isUnresolvedType,
  type ClassifiedLine,
  type OverheadClass,
} from "@/lib/overhead/compute";

const CLASS_OPTIONS: { value: OverheadClass; label: string }[] = [
  { value: "overhead", label: "Overhead" },
  { value: "revenue", label: "Revenue" },
  { value: "excluded", label: "Excluded" },
];

const BUCKET_TONE: Record<OverheadClass, string> = {
  overhead: "text-[var(--color-accent-ink)]",
  revenue: "text-[var(--color-success)]",
  excluded: "text-[var(--color-ink-faint)]",
};

// Xero account-type codes are all-caps machine tokens; show them the way an
// operator would read them on a P&L.
const TYPE_LABELS: Record<string, string> = {
  REVENUE: "Revenue",
  SALES: "Sales",
  OTHERINCOME: "Other income",
  DIRECTCOSTS: "Direct costs",
  OVERHEADS: "Overhead",
  EXPENSE: "Expense",
  DEPRECIATN: "Depreciation",
};

function humanizeType(type: string | null): string {
  if (!type) return "—";
  return TYPE_LABELS[type.toUpperCase()] ?? type.charAt(0) + type.slice(1).toLowerCase();
}

function money(value: string | number): string {
  return formatCurrency(value) ?? "—";
}

function fmtPeriod(start: string, end: string): string {
  const label = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return `${label(start)} – ${label(end)}`;
}

/**
 * The overhead-rate worksheet: derive one company-wide rate from the Xero P&L,
 * review every account, and save it as the pricing default. Rendered inside the
 * scenario card's overhead drawer — the frame (header, padding) is the caller's.
 * `onSaved` fires after a successful save so the field that opened it can adopt
 * the freshly derived rate without a reload.
 */
export function OverheadWorksheet({
  initialSettings,
  defaultPeriod,
  canOperate,
  onSaved,
}: {
  initialSettings: OverheadSettingsData;
  defaultPeriod: { periodStart: string; periodEnd: string };
  canOperate: boolean;
  onSaved?: (settings: OverheadSettingsData) => void;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [lines, setLines] = useState<ClassifiedLine[]>(
    initialSettings.derivation?.lines ?? []
  );
  const [period, setPeriod] = useState({
    periodStart: initialSettings.periodStart ?? defaultPeriod.periodStart,
    periodEnd: initialSettings.periodEnd ?? defaultPeriod.periodEnd,
  });
  const [loadedPeriod, setLoadedPeriod] = useState(
    initialSettings.derivation
      ? {
          periodStart: initialSettings.derivation.periodStart,
          periodEnd: initialSettings.derivation.periodEnd,
        }
      : null
  );
  const [previewIsSaved, setPreviewIsSaved] = useState(
    initialSettings.derivation != null
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Same decimal arithmetic as the authoritative server recompute, so
  // classification edits can never preview a rate that differs from what
  // the server will persist.
  const derived = useMemo(() => computeOverhead(lines, period), [lines, period]);
  const derivedPercent = Number(derived.overheadPercent);
  const hasCurrentPreview =
    lines.length > 0 &&
    loadedPeriod?.periodStart === period.periodStart &&
    loadedPeriod.periodEnd === period.periodEnd;
  const canSaveDerived =
    hasCurrentPreview &&
    derived.overheadPercent != null &&
    Number.isFinite(derivedPercent) &&
    derivedPercent >= 0 &&
    derivedPercent < 100;

  const excludedTotal = useMemo(
    () =>
      lines
        .filter((line) => line.classification === "excluded")
        .reduce((total, line) => total + Number(line.amount || 0), 0),
    [lines]
  );

  // Accounts whose Xero type we didn't recognise auto-default to Excluded. Count
  // the ones still on that default (not user-classified) so the operator can
  // confirm none are really overhead being left out of the pool.
  const unresolvedCount = useMemo(
    () =>
      lines.filter(
        (line) =>
          line.classificationSource === "auto" && isUnresolvedType(line.accountType)
      ).length,
    [lines]
  );

  const isDefaultPeriod =
    period.periodStart === defaultPeriod.periodStart &&
    period.periodEnd === defaultPeriod.periodEnd;

  const savedIsCurrent =
    settings.overheadPercent != null &&
    settings.periodStart === period.periodStart &&
    settings.periodEnd === period.periodEnd &&
    previewIsSaved &&
    !dirty;

  const overridesFromLines = () =>
    Object.fromEntries([
      ...Object.entries(settings.accountOverrides),
      ...lines
        .filter((line) => line.classificationSource === "override")
        .map((line) => [line.accountId, line.classification] as const),
    ]);

  const isMissingScopeError = (err: unknown) =>
    err instanceof ApiJsonError &&
    typeof err.body === "object" &&
    err.body != null &&
    "reason" in err.body &&
    err.body.reason === "missing_scope";

  async function refresh() {
    setLoading(true);
    setError(null);
    setNeedsReconnect(false);
    const overrides = overridesFromLines();
    try {
      const result = await apiJson<OverheadComputeResult>("/api/overhead-settings", {
        method: "POST",
        body: {
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          overrides,
        },
      });
      setLines(result.derivation.lines);
      setLoadedPeriod({
        periodStart: result.derivation.periodStart,
        periodEnd: result.derivation.periodEnd,
      });
      setPreviewIsSaved(false);
      setDirty(
        Object.entries(overrides).some(
          ([accountId, classification]) =>
            settings.accountOverrides[accountId] !== classification
        )
      );
    } catch (e) {
      if (isMissingScopeError(e)) {
        setNeedsReconnect(true);
      } else {
        setError(e instanceof Error ? e.message : "Couldn't load from Xero.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await apiJson<OverheadSettingsData>("/api/overhead-settings", {
        method: "PUT",
        body: {
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          overrides: overridesFromLines(),
        },
      });
      setSettings(saved);
      setLines(saved.derivation?.lines ?? lines);
      setLoadedPeriod(
        saved.derivation
          ? {
              periodStart: saved.derivation.periodStart,
              periodEnd: saved.derivation.periodEnd,
            }
          : null
      );
      setPreviewIsSaved(saved.derivation != null);
      setDirty(false);
      onSaved?.(saved);
    } catch (e) {
      if (isMissingScopeError(e)) setNeedsReconnect(true);
      else setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  function setLineClass(accountId: string, classification: OverheadClass) {
    setLines((prev) =>
      prev.map((line) =>
        line.accountId === accountId
          ? { ...line, classification, classificationSource: "override" }
          : line
      )
    );
    setPreviewIsSaved(false);
    setDirty(true);
  }

  function setPeriodValue(nextPeriod: { periodStart: string; periodEnd: string }) {
    setPeriod(nextPeriod);
    setLines([]);
    setPreviewIsSaved(false);
    setDirty(false);
  }

  const hasLines = hasCurrentPreview;

  return (
    <div className="flex flex-col gap-(--space-8)">
      {needsReconnect ? <ReconnectCard /> : null}

      <SettingsCard>
        <SettingsBlock
          title="Rate"
          actions={
            <Button variant="outline" onClick={refresh} disabled={!canOperate || loading}>
              {loading ? (
                <Spinner className="size-(--space-6)" />
              ) : (
                <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" strokeWidth={2} />
              )}
              {hasLines ? "Reload from Xero" : "Load from Xero"}
            </Button>
          }
        >
          <div className="flex flex-col gap-(--space-6)">
            <div className="flex flex-wrap items-end gap-(--space-5)">
              <PeriodField
                label="From"
                value={period.periodStart}
                onChange={(value) =>
                  setPeriodValue({ ...period, periodStart: value })
                }
                disabled={!canOperate}
              />
              <PeriodField
                label="To"
                value={period.periodEnd}
                onChange={(value) =>
                  setPeriodValue({ ...period, periodEnd: value })
                }
                disabled={!canOperate}
              />
              {!isDefaultPeriod ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPeriodValue(defaultPeriod)}
                  disabled={!canOperate}
                  className="mb-(--space-1) text-[var(--color-ink-faint)]"
                >
                  <HugeiconsIcon
                    icon={ArrowReloadHorizontalIcon}
                    data-icon="inline-start"
                    strokeWidth={2}
                  />
                  Trailing 12 months
                </Button>
              ) : null}
            </div>

            {error ? (
              <p
                role="alert"
                className="text-[length:var(--text-sm)] text-[var(--status-danger-ink)]"
              >
                {error}
              </p>
            ) : null}

            {hasLines ? (
              <RateEquation
                pool={derived.overheadPool}
                revenue={derived.revenueTotal}
                percent={derived.overheadPercent}
                period={period}
                savedIsCurrent={savedIsCurrent}
              />
            ) : !error && !needsReconnect ? (
              <EmptyState>
                Load your Profit &amp; Loss to derive your overhead rate. Every
                account stays reviewable before it counts.
              </EmptyState>
            ) : null}
          </div>
        </SettingsBlock>

        {hasLines ? (
          <SettingsBlock
            title="Accounts"
            count={lines.length}
            actions={
              <div className="flex flex-wrap items-center justify-end gap-(--space-5)">
                {!canSaveDerived ? (
                  <span className="text-[length:var(--text-xs)] text-[var(--status-danger-ink)]">
                    Rate must be 0–100% to save
                  </span>
                ) : dirty ? (
                  <span className="text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                    Unsaved changes
                  </span>
                ) : null}
                <Button
                  onClick={save}
                  disabled={!canOperate || saving || !canSaveDerived || savedIsCurrent}
                >
                  {saving ? <Spinner className="size-(--space-6)" /> : null}
                  {savedIsCurrent ? "Saved as default" : "Save as pricing default"}
                </Button>
              </div>
            }
          >
            {unresolvedCount > 0 ? (
              <p className="mb-(--space-5) text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-[var(--status-warning-ink)]">
                {unresolvedCount === 1
                  ? "1 account had an unrecognized type and defaults to Excluded"
                  : `${unresolvedCount} accounts had an unrecognized type and default to Excluded`}
                {" "}— confirm none of them belong in the overhead pool.
              </p>
            ) : null}
            <AccountLedger
              lines={lines}
              onClassify={setLineClass}
              canOperate={canOperate}
              revenueTotal={derived.revenueTotal}
              overheadPool={derived.overheadPool}
              excludedTotal={excludedTotal}
            />
          </SettingsBlock>
        ) : null}
      </SettingsCard>
    </div>
  );
}

function PeriodField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex min-w-[180px] flex-col gap-(--space-2)">
      <span className="text-[length:var(--text-card-label)] font-bold tracking-[0.04em] text-[var(--color-ink-2)] uppercase">
        {label}
      </span>
      <DatePicker value={value} onChange={onChange} disabled={disabled} />
    </label>
  );
}

function RateEquation({
  pool,
  revenue,
  percent,
  period,
  savedIsCurrent,
}: {
  pool: string;
  revenue: string;
  percent: string | null;
  period: { periodStart: string; periodEnd: string };
  savedIsCurrent: boolean;
}) {
  return (
    <div className="flex flex-col gap-(--space-4)">
      <div className="flex flex-col divide-y divide-[var(--color-line-soft)] overflow-hidden rounded-(--radius-md) border border-[var(--color-line)] sm:flex-row sm:divide-x sm:divide-y-0">
        <Operand label="Overhead pool" value={money(pool)} />
        <Operator symbol="÷" />
        <Operand label="Revenue" value={money(revenue)} />
        <Operator symbol="=" />
        <div className="flex flex-1 flex-col justify-center gap-(--space-1) bg-[var(--color-accent-soft)] p-(--space-6)">
          <span className="text-[length:var(--text-card-label)] font-bold tracking-[0.04em] text-[var(--color-accent-ink)] uppercase">
            Overhead rate
          </span>
          <span className="font-mono text-[length:var(--text-2xl)] font-semibold tabular-nums text-[var(--color-accent-ink)]">
            {percent != null ? `${percent}%` : "—"}
          </span>
        </div>
      </div>
      <p className="text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-[var(--color-ink-faint)]">
        From your Xero Profit &amp; Loss · {fmtPeriod(period.periodStart, period.periodEnd)}
        {savedIsCurrent ? " · saved as your pricing default" : " · not saved"}
      </p>
    </div>
  );
}

function Operand({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-(--space-1) p-(--space-6)">
      <span className="text-[length:var(--text-card-label)] font-bold tracking-[0.04em] text-[var(--color-ink-faint)] uppercase">
        {label}
      </span>
      <span className="font-mono text-[length:var(--text-lg)] font-semibold tabular-nums text-[var(--color-ink)]">
        {value}
      </span>
    </div>
  );
}

function Operator({ symbol }: { symbol: string }) {
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center px-(--space-6) py-(--space-2) font-mono text-[length:var(--text-lg)] text-[var(--color-ink-faint)] sm:py-0"
    >
      {symbol}
    </div>
  );
}

function AccountLedger({
  lines,
  onClassify,
  canOperate,
  revenueTotal,
  overheadPool,
  excludedTotal,
}: {
  lines: ClassifiedLine[];
  onClassify: (accountId: string, classification: OverheadClass) => void;
  canOperate: boolean;
  revenueTotal: string;
  overheadPool: string;
  excludedTotal: number;
}) {
  return (
    <FramedTable containerClassName="rounded-(--radius-md) border border-[var(--color-line)]">
      <FramedTableHead>
        <FramedTableRow>
          <FramedTableHeaderCell>Account</FramedTableHeaderCell>
          <FramedTableHeaderCell>Type</FramedTableHeaderCell>
          <FramedTableHeaderCell align="right">Amount</FramedTableHeaderCell>
          <FramedTableHeaderCell align="right">Bucket</FramedTableHeaderCell>
        </FramedTableRow>
      </FramedTableHead>
      <FramedTableBody>
        {lines.map((line) => (
          <FramedTableRow key={line.accountId}>
            <FramedTableCell strong>{line.name}</FramedTableCell>
            <FramedTableCell muted>{humanizeType(line.accountType)}</FramedTableCell>
            <FramedTableCell numeric>{money(line.amount)}</FramedTableCell>
            <FramedTableCell align="right" className="py-(--space-2)">
              <div className="flex justify-end">
                <Select
                  value={line.classification}
                  onValueChange={(value) =>
                    onClassify(line.accountId, value as OverheadClass)
                  }
                  disabled={!canOperate}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={`Bucket for ${line.name}`}
                    className={cn(
                      "w-[128px] justify-between font-semibold",
                      BUCKET_TONE[line.classification]
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {CLASS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </FramedTableCell>
          </FramedTableRow>
        ))}
      </FramedTableBody>
      <tfoot className="bg-[var(--color-surface-sunk)]">
        <ReconcileRow
          label="Revenue"
          value={money(revenueTotal)}
          tone="text-[var(--color-success)]"
        />
        <ReconcileRow
          label="Overhead pool"
          value={money(overheadPool)}
          tone="text-[var(--color-accent-ink)]"
          emphasized
        />
        <ReconcileRow
          label="Excluded"
          value={money(excludedTotal)}
          tone="text-[var(--color-ink-faint)]"
        />
      </tfoot>
    </FramedTable>
  );
}

function ReconcileRow({
  label,
  value,
  tone,
  emphasized = false,
}: {
  label: string;
  value: string;
  tone: string;
  emphasized?: boolean;
}) {
  return (
    <tr className="border-t border-[var(--color-line-soft)]">
      <td
        colSpan={2}
        className={cn(
          "h-(--height-framed-table-row) px-(--space-7) text-right align-middle text-[length:var(--text-card-control)] font-semibold tracking-[0.04em] uppercase",
          tone
        )}
      >
        {label}
      </td>
      <td
        className={cn(
          "h-(--height-framed-table-row) px-(--space-7) text-right align-middle font-mono text-[length:var(--text-card-control)] tabular-nums text-[var(--color-ink)]",
          emphasized && "text-[length:var(--text-md)] font-semibold"
        )}
      >
        {value}
      </td>
      <td className="border-l border-[var(--color-line-soft)]" />
    </tr>
  );
}

function ReconnectCard() {
  return (
    <div className="flex flex-col gap-(--space-5) rounded-(--radius-lg) border border-[color-mix(in_oklch,var(--color-warning),transparent_60%)] bg-[var(--color-warning-soft)] p-(--space-8)">
      <div className="flex items-start gap-(--space-5)">
        <span className="grid size-(--space-16) shrink-0 place-items-center rounded-(--radius-md) bg-[var(--color-surface)] text-[var(--status-warning-ink)]">
          <HugeiconsIcon icon={Alert02Icon} size={20} strokeWidth={2} aria-hidden />
        </span>
        <div className="flex flex-col gap-(--space-2)">
          <h2 className="text-[length:var(--text-md)] font-semibold text-[var(--color-ink)]">
            Reconnect Xero to load your Profit &amp; Loss
          </h2>
          <p className="max-w-xl text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-[var(--color-ink-2)]">
            Overhead reads your Profit &amp; Loss, and this connection can&apos;t
            do that yet — either it needs read access or its authorization has
            expired. Continue to Xero to renew the connection and grant the
            report access this calculation needs.
          </p>
        </div>
      </div>
      <Button asChild className="w-fit">
        <a href="/api/xero/connect">
          <HugeiconsIcon icon={LinkSquare02Icon} data-icon="inline-start" strokeWidth={2} />
          Continue to Xero
        </a>
      </Button>
    </div>
  );
}
