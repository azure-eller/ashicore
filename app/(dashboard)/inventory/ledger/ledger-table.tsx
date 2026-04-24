"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
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
  formatDateTime,
  formatPrice,
  formatQuantity,
} from "@/lib/format";
import {
  formatInventoryLedgerBalanceDimension,
  formatInventoryLedgerEventClass,
  formatInventoryLedgerSourceType,
  INVENTORY_LEDGER_EVENT_CLASSES,
  INVENTORY_LEDGER_SCOPE_VALUES,
  INVENTORY_LEDGER_SOURCE_TYPES,
} from "@/lib/inventory/ledger";
import type { InventoryLedgerFilters } from "@/lib/schemas/inventory-ledger";
import { ITEM_TYPES } from "../types";
import { buildInventoryLedgerSearchParams } from "./filters";
import type { InventoryLedgerPageProps } from "./types";

const ALL_VALUE = "__all__";

type DraftFilters = InventoryLedgerFilters;

function normalizeOptionalValue(value: string) {
  return value === ALL_VALUE || value === "" ? undefined : value;
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
    navigate({
      ...draftFilters,
      page: 1,
    });
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
      page: 1,
      pageSize: initialFilters.pageSize,
    });
  };

  const goToPage = (page: number) => {
    navigate({
      ...initialFilters,
      page,
    });
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Event Class
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
                <SelectTrigger aria-label="Filter by event class">
                  <SelectValue placeholder="All event classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All event classes</SelectItem>
                  {INVENTORY_LEDGER_EVENT_CLASSES.map((eventClass) => (
                    <SelectItem key={eventClass} value={eventClass}>
                      {formatInventoryLedgerEventClass(eventClass)}
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
                      {eventType}
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

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
          </div>

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
                    <>
                      <TableRow key={row.id}>
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
                          <div className="space-y-1">
                            <Link href={row.item.href} className="font-medium hover:underline">
                              {row.item.displayName}
                            </Link>
                            {row.item.sku ? (
                              <div className="text-xs text-muted-foreground">{row.item.sku}</div>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium">{row.eventLabel}</div>
                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <Badge variant="outline">
                                {formatInventoryLedgerEventClass(row.eventClass)}
                              </Badge>
                              <span>
                                {formatInventoryLedgerBalanceDimension(
                                  row.balanceDimension
                                )}
                              </span>
                            </div>
                          </div>
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
                            signedQuantity < 0 ? "text-destructive" : undefined
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
                            <div className="space-y-1">
                              <div>{row.actor.name}</div>
                              {row.actor.email ? (
                                <div className="text-xs text-muted-foreground">
                                  {row.actor.email}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>

                      {isExpanded ? (
                        <TableRow key={`${row.id}-details`} className="bg-muted/20">
                          <TableCell colSpan={8} className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                              <div className="space-y-1">
                                <div className="text-xs font-medium text-muted-foreground">
                                  Event Type
                                </div>
                                <div>{row.eventType}</div>
                              </div>
                              <div className="space-y-1">
                                <div className="text-xs font-medium text-muted-foreground">
                                  Event Subtype
                                </div>
                                <div>{row.eventSubtype ?? "—"}</div>
                              </div>
                              <div className="space-y-1">
                                <div className="text-xs font-medium text-muted-foreground">
                                  Reference
                                </div>
                                <div className="break-all">
                                  {row.referenceType ?? "—"} / {row.referenceId ?? "—"}
                                </div>
                              </div>
                              <div className="space-y-1">
                                <div className="text-xs font-medium text-muted-foreground">
                                  Costs
                                </div>
                                <div>
                                  {formatPrice(row.unitCost) ?? "—"}
                                  {" / "}
                                  {formatPrice(row.extendedCost) ?? "—"}
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-3">
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

                            {row.metadata ? (
                              <div className="space-y-2">
                                <div className="text-xs font-medium text-muted-foreground">
                                  Metadata
                                </div>
                                <pre className="overflow-x-auto rounded-md border bg-background p-3 text-xs">
                                  {JSON.stringify(row.metadata, null, 2)}
                                </pre>
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </>
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
