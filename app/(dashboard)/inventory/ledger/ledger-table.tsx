"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  INVENTORY_EVENT_TYPES,
} from "@/lib/db/schema";
import {
  formatDate,
  formatDateTime,
  formatPrice,
  formatQuantity,
} from "@/lib/format";
import {
  formatInventoryLedgerBalanceDimension,
  formatInventoryLedgerEventLabel,
  formatInventoryLedgerMovementCategory,
  formatInventoryLedgerSourceType,
  formatInventoryLedgerSummaryAction,
  INVENTORY_LEDGER_EVENT_CLASSES,
  INVENTORY_LEDGER_SCOPE_VALUES,
  INVENTORY_LEDGER_SOURCE_TYPES,
} from "@/lib/inventory/ledger";
import type { InventoryLedgerFilters } from "@/lib/schemas/inventory-ledger";
import { ITEM_TYPES } from "../types";
import { buildInventoryLedgerSearchParams } from "./filters";
import type { InventoryLedgerPageProps, InventoryLedgerRow } from "./types";

const ALL_VALUE = "__all__";

type DraftFilters = InventoryLedgerFilters;

function normalizeOptionalValue(value: string) {
  return value === ALL_VALUE || value === "" ? undefined : value;
}

function getBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function withDateFilterTimeZone(filters: InventoryLedgerFilters) {
  if (!filters.dateFrom && !filters.dateTo) {
    return {
      ...filters,
      timeZone: undefined,
    };
  }

  return {
    ...filters,
    timeZone: filters.timeZone ?? getBrowserTimeZone(),
  };
}

function formatQuantityChange(row: InventoryLedgerRow) {
  if (row.balanceDimension === "none") {
    return "No quantity change";
  }

  const signedQuantity = parseFloat(row.signedQuantity);
  const sign = signedQuantity > 0 ? "+" : "";
  return `${sign}${formatQuantity(row.signedQuantity)} units`;
}

function formatQuantityMagnitude(row: InventoryLedgerRow) {
  const signedQuantity = parseFloat(row.signedQuantity);
  const quantity =
    Number.isFinite(signedQuantity) && signedQuantity !== 0
      ? Math.abs(signedQuantity)
      : Math.abs(parseFloat(row.quantity));

  return `${formatQuantity(String(quantity))} units`;
}

function formatLedgerRowSummary(row: InventoryLedgerRow) {
  const actor = row.actor?.name ?? "System";
  const action = formatInventoryLedgerSummaryAction(row.eventType);
  const date = formatDate(row.occurredAt);

  if (row.balanceDimension === "none") {
    return `${actor} ${action} ${row.item.displayName} on ${date}.`;
  }

  return `${actor} ${action} ${row.item.displayName} by ${formatQuantityMagnitude(
    row
  )} on ${date}.`;
}

export function LedgerTable({
  initialData,
  initialFilters,
  actorOptions,
}: InventoryLedgerPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<DraftFilters>(initialFilters);

  useEffect(() => {
    setDraftFilters(initialFilters);
  }, [initialFilters]);

  const totalPages = initialData.totalPages;
  const currentPage = initialData.page;
  const startRow =
    initialData.totalCount === 0
      ? 0
      : (currentPage - 1) * initialData.pageSize + 1;
  const endRow = Math.min(
    initialData.totalCount,
    currentPage * initialData.pageSize
  );

  const activeFilterBadges = useMemo(() => {
    const badges: Array<{ label: string; value: string }> = [];

    if (initialData.resolvedFilters.itemLabel) {
      badges.push({ label: "Item", value: initialData.resolvedFilters.itemLabel });
    }

    if (initialData.resolvedFilters.documentLabel && initialFilters.documentType) {
      badges.push({
        label: formatInventoryLedgerSourceType(initialFilters.documentType),
        value: initialData.resolvedFilters.documentLabel,
      });
    }

    return badges;
  }, [initialData.resolvedFilters, initialFilters.documentType]);

  const navigate = (filters: InventoryLedgerFilters) => {
    startTransition(() => {
      const searchParams = buildInventoryLedgerSearchParams(filters);
      const query = searchParams.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    });
  };

  const updateDraftFilters = (patch: Partial<DraftFilters>) => {
    setDraftFilters((current) => ({
      ...current,
      ...patch,
      page: 1,
    }));
  };

  const handleApply = () => {
    navigate(withDateFilterTimeZone({
      ...draftFilters,
      page: 1,
    }));
  };

  const handleClear = () => {
    navigate({
      q: undefined,
      lot: undefined,
      itemId: undefined,
      itemType: undefined,
      scope: "stock",
      eventClass: undefined,
      eventType: undefined,
      documentType: undefined,
      documentId: undefined,
      actorUserId: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      timeZone: undefined,
      page: 1,
      pageSize: initialFilters.pageSize,
    });
  };

  const goToPage = (page: number) => {
    navigate(withDateFilterTimeZone({
      ...initialFilters,
      page,
    }));
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Inventory Ledger</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Inspect inventory events across purchasing, sales, manufacturing,
              stocktakes, and manual item activity.
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            {initialData.totalCount === 0
              ? "No matching events"
              : `Showing ${startRow}-${endRow} of ${initialData.totalCount}`}
          </div>
        </div>

        {activeFilterBadges.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {activeFilterBadges.map((badge) => (
              <Badge key={`${badge.label}-${badge.value}`} variant="outline">
                {badge.label}: {badge.value}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border bg-card">
        <div className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Search
              </label>
              <Input
                aria-label="Search ledger"
                placeholder="Item, lot, order, stocktake, actor..."
                value={draftFilters.q ?? ""}
                onChange={(event) =>
                  updateDraftFilters({ q: normalizeOptionalValue(event.target.value) })
                }
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                From
              </label>
              <DatePicker
                value={draftFilters.dateFrom ?? ""}
                onChange={(value) =>
                  updateDraftFilters({
                    dateFrom: normalizeOptionalValue(value),
                  })
                }
                aria-label="Filter from date"
                placeholder="Start date"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <DatePicker
                value={draftFilters.dateTo ?? ""}
                onChange={(value) =>
                  updateDraftFilters({
                    dateTo: normalizeOptionalValue(value),
                  })
                }
                aria-label="Filter to date"
                placeholder="End date"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Movement Category
              </label>
              <Select
                value={draftFilters.eventClass ?? ALL_VALUE}
                onValueChange={(value) =>
                  updateDraftFilters({
                    eventClass: normalizeOptionalValue(
                      value
                    ) as InventoryLedgerFilters["eventClass"],
                    scope:
                      value !== ALL_VALUE && value !== "stock" ? "all" : draftFilters.scope,
                  })
                }
              >
                <SelectTrigger aria-label="Filter by movement category">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All categories</SelectItem>
                  {INVENTORY_LEDGER_EVENT_CLASSES.map((eventClass) => (
                    <SelectItem key={eventClass} value={eventClass}>
                      {formatInventoryLedgerMovementCategory(eventClass)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Item Type
              </label>
              <Select
                value={draftFilters.itemType ?? ALL_VALUE}
                onValueChange={(value) =>
                  updateDraftFilters({
                    itemType: normalizeOptionalValue(value) as InventoryLedgerFilters["itemType"],
                  })
                }
              >
                <SelectTrigger aria-label="Filter by item type">
                  <SelectValue placeholder="All item types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All item types</SelectItem>
                  {ITEM_TYPES.map((itemType) => (
                    <SelectItem key={itemType} value={itemType}>
                      {itemType === "material" ? "Materials" : "Products"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Collapsible open={moreFiltersOpen} onOpenChange={setMoreFiltersOpen}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm">
                  <HugeiconsIcon
                    icon={moreFiltersOpen ? ArrowDown01Icon : ArrowRight01Icon}
                    size={14}
                    aria-hidden
                  />
                  More filters
                </Button>
              </CollapsibleTrigger>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleApply}
                  disabled={isPending}
                >
                  {isPending ? "Applying..." : "Apply Filters"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  disabled={isPending}
                >
                  Clear All
                </Button>
              </div>
            </div>

            <CollapsibleContent>
              <div className="grid gap-3 pt-4 md:grid-cols-2 xl:grid-cols-5">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Lot</label>
                  <Input
                    aria-label="Filter by lot"
                    placeholder="Lot number"
                    value={draftFilters.lot ?? ""}
                    onChange={(event) =>
                      updateDraftFilters({ lot: normalizeOptionalValue(event.target.value) })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Scope</label>
                  <Select
                    value={draftFilters.scope ?? "stock"}
                    onValueChange={(value) =>
                      updateDraftFilters({
                        scope: value as InventoryLedgerFilters["scope"],
                      })
                    }
                  >
                    <SelectTrigger aria-label="Filter by scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INVENTORY_LEDGER_SCOPE_VALUES.map((scope) => (
                        <SelectItem key={scope} value={scope}>
                          {scope === "stock" ? "Stock events" : "All events"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Event Type
                  </label>
                  <Select
                    value={draftFilters.eventType ?? ALL_VALUE}
                    onValueChange={(value) =>
                      updateDraftFilters({
                        eventType: normalizeOptionalValue(
                          value
                        ) as InventoryLedgerFilters["eventType"],
                      })
                    }
                  >
                    <SelectTrigger aria-label="Filter by event type">
                      <SelectValue placeholder="All event types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>All event types</SelectItem>
                      {INVENTORY_EVENT_TYPES.map((eventType) => (
                        <SelectItem key={eventType} value={eventType}>
                          {formatInventoryLedgerEventLabel(eventType)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Document Type
                  </label>
                  <Select
                    value={draftFilters.documentType ?? ALL_VALUE}
                    onValueChange={(value) =>
                      updateDraftFilters({
                        documentType: normalizeOptionalValue(
                          value
                        ) as InventoryLedgerFilters["documentType"],
                      })
                    }
                  >
                    <SelectTrigger aria-label="Filter by document type">
                      <SelectValue placeholder="All documents" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>All documents</SelectItem>
                      {INVENTORY_LEDGER_SOURCE_TYPES.map((documentType) => (
                        <SelectItem key={documentType} value={documentType}>
                          {formatInventoryLedgerSourceType(documentType)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Actor</label>
                  <Select
                    value={draftFilters.actorUserId ?? ALL_VALUE}
                    onValueChange={(value) =>
                      updateDraftFilters({
                        actorUserId: normalizeOptionalValue(value),
                      })
                    }
                  >
                    <SelectTrigger aria-label="Filter by actor">
                      <SelectValue placeholder="All actors" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>All actors</SelectItem>
                      {actorOptions.map((actor) => (
                        <SelectItem key={actor.id} value={actor.id}>
                          {actor.email ? `${actor.name} (${actor.email})` : actor.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <Separator />

        <div className="p-4 pt-0">
          {initialData.rows.length === 0 ? (
            <div className="py-10 text-sm text-muted-foreground">
              No inventory events matched the current filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" />
                  <TableHead>Occurred</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Lot</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Actor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialData.rows.map((row) => {
                  const isExpanded = expandedRows[row.id] ?? false;
                  const signedQuantity = parseFloat(row.signedQuantity);

                  return (
                    <Fragment key={row.id}>
                      <TableRow>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={isExpanded ? "Collapse row" : "Expand row"}
                            onClick={() =>
                              setExpandedRows((current) => ({
                                ...current,
                                [row.id]: !current[row.id],
                              }))
                            }
                          >
                            <HugeiconsIcon
                              icon={isExpanded ? ArrowDown01Icon : ArrowRight01Icon}
                              className="h-4 w-4"
                            />
                          </Button>
                        </TableCell>
                        <TableCell>{formatDateTime(row.occurredAt)}</TableCell>
                        <TableCell>
                          <Link href={row.item.href} className="font-medium hover:underline">
                            {row.item.displayName}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{row.eventLabel}</div>
                        </TableCell>
                        <TableCell>
                          {row.sourceDocument ? (
                            row.sourceDocument.href ? (
                              <Link
                                href={row.sourceDocument.href}
                                className="hover:underline"
                              >
                                {row.sourceDocument.label}
                              </Link>
                            ) : (
                              row.sourceDocument.label
                            )
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="font-mono">
                          {row.lot?.number ?? "—"}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono ${
                            signedQuantity < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {row.balanceDimension === "none"
                            ? "—"
                            : `${signedQuantity > 0 ? "+" : ""}${formatQuantity(
                                row.signedQuantity
                              )}`}
                        </TableCell>
                        <TableCell>
                          {row.actor ? (
                            row.actor.name
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>

                      {isExpanded ? (
                        <TableRow className="bg-muted/20">
                          <TableCell colSpan={8} className="py-4">
                            <div className="space-y-5">
                              <p className="text-sm font-medium">
                                {formatLedgerRowSummary(row)}
                              </p>

                              <div className="grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
                                <section className="space-y-3">
                                  <h3 className="text-sm font-semibold">Movement</h3>
                                  <dl className="space-y-2 text-sm">
                                    <div>
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Quantity change
                                      </dt>
                                      <dd className="font-mono">
                                        {formatQuantityChange(row)}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Lot
                                      </dt>
                                      <dd className="font-mono">{row.lot?.number ?? "—"}</dd>
                                    </div>
                                    {row.unitCost ? (
                                      <div>
                                        <dt className="text-xs font-medium text-muted-foreground">
                                          Unit cost
                                        </dt>
                                        <dd>{formatPrice(row.unitCost) ?? "—"}</dd>
                                      </div>
                                    ) : null}
                                    {row.extendedCost ? (
                                      <div>
                                        <dt className="text-xs font-medium text-muted-foreground">
                                          Value change
                                        </dt>
                                        <dd>{formatPrice(row.extendedCost) ?? "—"}</dd>
                                      </div>
                                    ) : null}
                                  </dl>
                                </section>

                                <section className="space-y-3">
                                  <h3 className="text-sm font-semibold">Source</h3>
                                  <dl className="space-y-2 text-sm">
                                    <div>
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Source document
                                      </dt>
                                      <dd>
                                        {row.sourceDocument ? (
                                          row.sourceDocument.href ? (
                                            <Link
                                              href={row.sourceDocument.href}
                                              className="font-medium hover:underline"
                                            >
                                              {row.sourceDocument.label}
                                            </Link>
                                          ) : (
                                            row.sourceDocument.label
                                          )
                                        ) : (
                                          "—"
                                        )}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Source type
                                      </dt>
                                      <dd>
                                        {row.sourceDocument
                                          ? formatInventoryLedgerSourceType(
                                              row.sourceDocument.type
                                            )
                                          : "—"}
                                      </dd>
                                    </div>
                                    {row.item.sku ? (
                                      <div>
                                        <dt className="text-xs font-medium text-muted-foreground">
                                          Item SKU
                                        </dt>
                                        <dd className="font-mono text-xs">
                                          {row.item.sku}
                                        </dd>
                                      </div>
                                    ) : null}
                                    <div>
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Reference
                                      </dt>
                                      <dd className="break-all font-mono text-xs">
                                        {row.referenceType ?? "—"} / {row.referenceId ?? "—"}
                                      </dd>
                                    </div>
                                  </dl>
                                  <div className="flex flex-wrap gap-2">
                                    <Button variant="outline" size="sm" asChild>
                                      <Link href={row.item.href}>View Item</Link>
                                    </Button>
                                    {row.sourceDocument?.href ? (
                                      <Button variant="outline" size="sm" asChild>
                                        <Link href={row.sourceDocument.href}>
                                          View Source
                                        </Link>
                                      </Button>
                                    ) : null}
                                  </div>
                                </section>

                                <section className="space-y-3">
                                  <h3 className="text-sm font-semibold">Audit</h3>
                                  <dl className="space-y-2 text-sm">
                                    <div>
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Actor
                                      </dt>
                                      <dd>
                                        {row.actor ? (
                                          <>
                                            <div>{row.actor.name}</div>
                                            {row.actor.email ? (
                                              <div className="text-xs text-muted-foreground">
                                                {row.actor.email}
                                              </div>
                                            ) : null}
                                          </>
                                        ) : (
                                          "—"
                                        )}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Timestamp
                                      </dt>
                                      <dd>{formatDateTime(row.occurredAt)}</dd>
                                    </div>
                                  </dl>
                                </section>
                              </div>

                              <details className="rounded-md border bg-background p-3">
                                <summary className="cursor-pointer text-sm font-semibold">
                                  Advanced
                                </summary>
                                <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                  <div className="space-y-1">
                                    <div className="text-xs font-medium text-muted-foreground">
                                      Movement category
                                    </div>
                                    <div className="text-sm">
                                      {formatInventoryLedgerMovementCategory(
                                        row.eventClass
                                      )}
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-xs font-medium text-muted-foreground">
                                      Balance dimension
                                    </div>
                                    <div className="text-sm">
                                      {formatInventoryLedgerBalanceDimension(
                                        row.balanceDimension
                                      )}
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-xs font-medium text-muted-foreground">
                                      Event type
                                    </div>
                                    <div className="break-all font-mono text-sm">
                                      {row.eventType}
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-xs font-medium text-muted-foreground">
                                      Event subtype
                                    </div>
                                    <div className="break-all font-mono text-sm">
                                      {row.eventSubtype ?? "—"}
                                    </div>
                                  </div>
                                  <div className="space-y-2 md:col-span-2 xl:col-span-3">
                                    <div className="text-xs font-medium text-muted-foreground">
                                      Metadata
                                    </div>
                                    {row.metadataSummary.length > 0 ? (
                                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                        {row.metadataSummary.map((entry) => (
                                          <div
                                            key={entry.label}
                                            className="rounded-md border p-3"
                                          >
                                            <div className="text-xs font-medium text-muted-foreground">
                                              {entry.label}
                                            </div>
                                            <div className="mt-1 break-words text-sm">
                                              {entry.value}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="text-sm text-muted-foreground">
                                        No metadata
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </details>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        <Separator />

        <div className="flex items-center justify-between p-4">
          <div className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1 || isPending}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= totalPages || isPending}
            >
              Next
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
