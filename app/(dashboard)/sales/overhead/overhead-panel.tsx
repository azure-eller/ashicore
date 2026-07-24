"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon, Alert02Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { apiJson, ApiJsonError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { OverheadSettingsData, OverheadComputeResult } from "@/lib/dal/overhead-settings";
import {
  computeOverhead,
  type ClassifiedLine,
  type OverheadClass,
} from "@/lib/overhead/compute";

const CLASS_OPTIONS: { value: OverheadClass; label: string }[] = [
  { value: "overhead", label: "Overhead" },
  { value: "revenue", label: "Revenue" },
  { value: "excluded", label: "Excluded" },
];

function fmtMoney(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtPeriod(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function OverheadPanel({
  initialSettings,
  defaultPeriod,
  canOperate,
}: {
  initialSettings: OverheadSettingsData;
  defaultPeriod: { periodStart: string; periodEnd: string };
  canOperate: boolean;
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Use the same decimal arithmetic as the authoritative server recompute so
  // classification edits cannot preview a rate that differs from the saved rate.
  const derived = useMemo(
    () => computeOverhead(lines, period),
    [lines, period]
  );
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

  const overridesFromLines = () =>
    Object.fromEntries([
      ...Object.entries(settings.accountOverrides),
      ...lines
        .filter((line) => line.classificationSource === "override")
        .map((line) => [line.accountId, line.classification] as const),
    ]);

  const isMissingScopeError = (error: unknown) =>
    error instanceof ApiJsonError &&
    typeof error.body === "object" &&
    error.body != null &&
    "reason" in error.body &&
    error.body.reason === "missing_scope";

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
        setError(e instanceof Error ? e.message : "Failed to load from Xero.");
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
      setDirty(false);
    } catch (e) {
      if (isMissingScopeError(e)) setNeedsReconnect(true);
      else setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  function setLineClass(accountId: string, classification: OverheadClass) {
    setLines((prev) =>
      prev.map((l) =>
        l.accountId === accountId ? { ...l, classification, classificationSource: "override" } : l
      )
    );
    setDirty(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-(--space-6) p-(--space-6)">
      <header className="flex flex-col gap-(--space-2)">
        <h1 className="text-[length:var(--text-xl)] font-semibold">Overhead</h1>
        <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
          Derive your overhead rate from your Xero Profit &amp; Loss, then use it as the
          default in pricing scenarios. Overhead % = operating overhead ÷ revenue over the
          period.
        </p>
      </header>

      {needsReconnect ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-(--space-2)">
              <HugeiconsIcon icon={Alert02Icon} className="size-(--space-6)" strokeWidth={2} />
              Reconnect to Xero
            </CardTitle>
            <CardDescription>
              Your Xero connection needs read access to your Profit &amp; Loss report. Reconnect
              once to grant it — nothing else about the connection changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="/api/xero/connect">
                <HugeiconsIcon icon={LinkSquare02Icon} className="size-(--space-5)" strokeWidth={2} />
                Reconnect to Xero
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Current overhead rate</CardTitle>
          <CardDescription>
            {settings.overheadPercent != null && settings.periodStart && settings.periodEnd
              ? `Saved default: ${settings.overheadPercent}% — ${fmtPeriod(settings.periodStart, settings.periodEnd)}`
              : "No overhead rate saved yet. Load your P&L to compute one."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-(--space-4)">
          <div className="flex flex-wrap items-end gap-(--space-4)">
            <label className="flex flex-col gap-(--space-1) text-[length:var(--text-2xs)] text-[var(--color-ink-muted)]">
              From
              <input
                type="date"
                value={period.periodStart}
                onChange={(e) => setPeriod((p) => ({ ...p, periodStart: e.target.value }))}
                disabled={!canOperate}
                className="rounded-(--radius-sm) border border-[var(--color-border)] bg-transparent px-(--space-2) py-(--space-1) font-mono text-[length:var(--text-sm)]"
              />
            </label>
            <label className="flex flex-col gap-(--space-1) text-[length:var(--text-2xs)] text-[var(--color-ink-muted)]">
              To
              <input
                type="date"
                value={period.periodEnd}
                onChange={(e) => setPeriod((p) => ({ ...p, periodEnd: e.target.value }))}
                disabled={!canOperate}
                className="rounded-(--radius-sm) border border-[var(--color-border)] bg-transparent px-(--space-2) py-(--space-1) font-mono text-[length:var(--text-sm)]"
              />
            </label>
            <Button variant="outline" onClick={refresh} disabled={!canOperate || loading}>
              {loading ? (
                <Spinner className="size-(--space-5)" />
              ) : (
                <HugeiconsIcon icon={RefreshIcon} className="size-(--space-5)" strokeWidth={2} />
              )}
              Load from Xero
            </Button>
          </div>

          {error ? (
            <p className="text-[length:var(--text-sm)] text-[var(--status-danger-ink)]">{error}</p>
          ) : null}

          {hasCurrentPreview ? (
            <>
              <div className="flex items-baseline justify-between rounded-(--radius-md) bg-[var(--color-surface-muted)] px-(--space-4) py-(--space-3)">
                <div>
                  <div className="text-[length:var(--text-2xs)] uppercase text-[var(--color-ink-muted)]">
                    Derived overhead
                  </div>
                  <div className="font-mono text-[length:var(--text-2xl)] font-semibold tabular-nums">
                    {derived.overheadPercent != null ? `${derived.overheadPercent}%` : "—"}
                  </div>
                </div>
                <div className="text-right font-mono text-[length:var(--text-xs)] text-[var(--color-ink-muted)] tabular-nums">
                  <div>overhead {fmtMoney(derived.overheadPool)}</div>
                  <div>revenue {fmtMoney(derived.revenueTotal)}</div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[length:var(--text-sm)]">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-[length:var(--text-2xs)] uppercase text-[var(--color-ink-muted)]">
                      <th className="py-(--space-2) pr-(--space-3) font-medium">Account</th>
                      <th className="py-(--space-2) px-(--space-3) text-right font-medium">Amount</th>
                      <th className="py-(--space-2) pl-(--space-3) font-medium">Classification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.accountId} className="border-b border-[var(--color-border-subtle)]">
                        <td className="py-(--space-2) pr-(--space-3)">{line.name}</td>
                        <td className="py-(--space-2) px-(--space-3) text-right font-mono tabular-nums">
                          {fmtMoney(line.amount)}
                        </td>
                        <td className="py-(--space-2) pl-(--space-3)">
                          <select
                            value={line.classification}
                            onChange={(e) => setLineClass(line.accountId, e.target.value as OverheadClass)}
                            disabled={!canOperate}
                            className={cn(
                              "rounded-(--radius-sm) border border-[var(--color-border)] bg-transparent px-(--space-2) py-(--space-1) text-[length:var(--text-xs)]",
                              line.classification === "overhead" && "text-[var(--status-warning-ink)]",
                              line.classification === "revenue" && "text-[var(--status-success-ink)]"
                            )}
                          >
                            {CLASS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-(--space-3)">
                {!canSaveDerived ? (
                  <span className="text-[length:var(--text-2xs)] text-[var(--status-danger-ink)]">
                    Pricing overhead must be at least 0% and below 100%.
                  </span>
                ) : null}
                {dirty ? (
                  <span className="text-[length:var(--text-2xs)] text-[var(--color-ink-muted)]">
                    Unsaved classification changes
                  </span>
                ) : null}
                <Button
                  onClick={save}
                  disabled={!canOperate || saving || !canSaveDerived}
                >
                  {saving ? <Spinner className="size-(--space-5)" /> : null}
                  Save as pricing default
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
