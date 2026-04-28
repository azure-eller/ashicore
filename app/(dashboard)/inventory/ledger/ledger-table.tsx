"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  FilterHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
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
import { cn } from "@/lib/utils";
import {
  formatInventoryLedgerEventLabel,
  formatInventoryLedgerMovementCategory,
  formatInventoryLedgerSourceType,
  INVENTORY_LEDGER_EVENT_CLASSES,
  INVENTORY_LEDGER_SCOPE_VALUES,
  INVENTORY_LEDGER_SOURCE_TYPES,
} from "@/lib/inventory/ledger";
import {
  LEDGER_ACTOR_TOOLTIP,
  LEDGER_CHANGE_TOOLTIP,
  LEDGER_DOCUMENT_TYPE_TOOLTIP,
  LEDGER_EVENT_TOOLTIP,
  LEDGER_EVENT_TYPE_TOOLTIP,
  LEDGER_LOT_TOOLTIP,
  LEDGER_MOVEMENT_TOOLTIP,
  LEDGER_ON_HAND_AFTER_TOOLTIP,
  LEDGER_OCCURRED_TOOLTIP,
  LEDGER_SCOPE_TOOLTIP,
  LEDGER_SOURCE_TOOLTIP,
  LEDGER_VALUE_CHANGE_TOOLTIP,
  ITEM_TYPE_TOOLTIP,
} from "@/lib/tooltip-copy";
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

function formatOnHandAfter(row: InventoryLedgerRow) {
  return row.onHandAfter == null ? "—" : formatQuantity(row.onHandAfter);
}

function formatValueChange(row: InventoryLedgerRow) {
  if (!row.extendedCost) {
    return null;
  }

  const signedQuantity = parseFloat(row.signedQuantity);
  const extendedCost = parseFloat(row.extendedCost);

  if (!Number.isFinite(extendedCost)) {
    return formatPrice(row.extendedCost);
  }

  const signedValue =
    row.balanceDimension === "on_hand" && signedQuantity < 0
      ? -Math.abs(extendedCost)
      : extendedCost;

  return formatPrice(String(signedValue));
}

export function LedgerTable({
  initialData,
  initialFilters,
  actorOptions,
}: InventoryLedgerPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Inventory Activity</h1>
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
        <div className="text-sm text-muted-foreground">
          {initialData.totalCount === 0
            ? "No matching events"
            : `Showing ${startRow}-${endRow} of ${initialData.totalCount}`}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <FieldGroup className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(16rem,1.4fr)_minmax(9rem,0.75fr)_minmax(9rem,0.75fr)_minmax(12rem,1fr)_minmax(10rem,0.8fr)_auto]">
          <Field className="gap-1.5">
            <FieldLabel className="text-xs text-muted-foreground">Search</FieldLabel>
            <Input
              aria-label="Search ledger"
              placeholder="Item, lot, order, actor..."
              value={draftFilters.q ?? ""}
              onChange={(event) =>
                updateDraftFilters({ q: normalizeOptionalValue(event.target.value) })
              }
            />
          </Field>

          <Field className="gap-1.5">
            <FieldLabel className="text-xs text-muted-foreground">
              <TooltipHeader label="From" tooltip="Start date for occurred timestamps." />
            </FieldLabel>
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
          </Field>

          <Field className="gap-1.5">
            <FieldLabel className="text-xs text-muted-foreground">
              <TooltipHeader label="To" tooltip="End date for occurred timestamps." />
            </FieldLabel>
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
          </Field>

          <Field className="gap-1.5">
            <FieldLabel className="text-xs text-muted-foreground">
              <TooltipHeader label="Movement" tooltip={LEDGER_MOVEMENT_TOOLTIP} />
            </FieldLabel>
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
                <SelectGroup>
                  <SelectItem value={ALL_VALUE}>All categories</SelectItem>
                  {INVENTORY_LEDGER_EVENT_CLASSES.map((eventClass) => (
                    <SelectItem key={eventClass} value={eventClass}>
                      {formatInventoryLedgerMovementCategory(eventClass)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field className="gap-1.5">
            <FieldLabel className="text-xs text-muted-foreground">
              <TooltipHeader label="Item Type" tooltip={ITEM_TYPE_TOOLTIP} />
            </FieldLabel>
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
                <SelectGroup>
                  <SelectItem value={ALL_VALUE}>All item types</SelectItem>
                  {ITEM_TYPES.map((itemType) => (
                    <SelectItem key={itemType} value={itemType}>
                      {itemType === "material" ? "Materials" : "Products"}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <div className="flex items-end gap-2">
            <Popover open={moreFiltersOpen} onOpenChange={setMoreFiltersOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="More filters"
                >
                  <HugeiconsIcon
                    icon={FilterHorizontalIcon}
                    data-icon="inline-start"
                    aria-hidden
                  />
                  More
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <FieldGroup className="gap-3">
                  <Field className="gap-1.5">
                    <FieldLabel className="text-xs text-muted-foreground">
                      <TooltipHeader label="Lot" tooltip={LEDGER_LOT_TOOLTIP} />
                    </FieldLabel>
                    <Input
                      aria-label="Filter by lot"
                      placeholder="Lot number"
                      value={draftFilters.lot ?? ""}
                      onChange={(event) =>
                        updateDraftFilters({ lot: normalizeOptionalValue(event.target.value) })
                      }
                    />
                  </Field>

                  <Field className="gap-1.5">
                    <FieldLabel className="text-xs text-muted-foreground">
                      <TooltipHeader label="Scope" tooltip={LEDGER_SCOPE_TOOLTIP} />
                    </FieldLabel>
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
                        <SelectGroup>
                          {INVENTORY_LEDGER_SCOPE_VALUES.map((scope) => (
                            <SelectItem key={scope} value={scope}>
                              {scope === "stock" ? "Stock events" : "All events"}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field className="gap-1.5">
                    <FieldLabel className="text-xs text-muted-foreground">
                      <TooltipHeader label="Event Type" tooltip={LEDGER_EVENT_TYPE_TOOLTIP} />
                    </FieldLabel>
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
                        <SelectGroup>
                          <SelectItem value={ALL_VALUE}>All event types</SelectItem>
                          {INVENTORY_EVENT_TYPES.map((eventType) => (
                            <SelectItem key={eventType} value={eventType}>
                              {formatInventoryLedgerEventLabel(eventType)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field className="gap-1.5">
                    <FieldLabel className="text-xs text-muted-foreground">
                      <TooltipHeader
                        label="Document Type"
                        tooltip={LEDGER_DOCUMENT_TYPE_TOOLTIP}
                      />
                    </FieldLabel>
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
                        <SelectGroup>
                          <SelectItem value={ALL_VALUE}>All documents</SelectItem>
                          {INVENTORY_LEDGER_SOURCE_TYPES.map((documentType) => (
                            <SelectItem key={documentType} value={documentType}>
                              {formatInventoryLedgerSourceType(documentType)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field className="gap-1.5">
                    <FieldLabel className="text-xs text-muted-foreground">
                      <TooltipHeader label="Actor" tooltip={LEDGER_ACTOR_TOOLTIP} />
                    </FieldLabel>
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
                        <SelectGroup>
                          <SelectItem value={ALL_VALUE}>All actors</SelectItem>
                          {actorOptions.map((actor) => (
                            <SelectItem key={actor.id} value={actor.id}>
                              {actor.email ? `${actor.name} (${actor.email})` : actor.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
              </PopoverContent>
            </Popover>

            <Button
              type="button"
              size="sm"
              onClick={handleApply}
              disabled={isPending}
            >
              {isPending ? "Applying..." : "Apply"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={isPending}
            >
              Clear
            </Button>
          </div>
        </FieldGroup>

        <div className="overflow-hidden rounded-md border">
          {initialData.rows.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted-foreground">
              No inventory events matched the current filters.
            </div>
          ) : (
            <Table className="min-w-[1180px]">
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <TooltipHeader label="Occurred" tooltip={LEDGER_OCCURRED_TOOLTIP} />
                  </TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>
                    <TooltipHeader label="Event" tooltip={LEDGER_EVENT_TOOLTIP} />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader label="Source" tooltip={LEDGER_SOURCE_TOOLTIP} />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader label="Lot" tooltip={LEDGER_LOT_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Change" tooltip={LEDGER_CHANGE_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="On hand after" tooltip={LEDGER_ON_HAND_AFTER_TOOLTIP} />
                  </TableHead>
                  <TableHead className="text-right">
                    <TooltipHeader label="Value change" tooltip={LEDGER_VALUE_CHANGE_TOOLTIP} />
                  </TableHead>
                  <TableHead>
                    <TooltipHeader label="Actor" tooltip={LEDGER_ACTOR_TOOLTIP} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialData.rows.map((row) => {
                  const signedQuantity = parseFloat(row.signedQuantity);
                  const onHandAfter =
                    row.onHandAfter == null ? null : parseFloat(row.onHandAfter);
                  const valueChange = formatValueChange(row);
                  const valueChangeIsNegative = valueChange?.startsWith("-") ?? false;
                  const quantityChange =
                    row.balanceDimension === "none"
                      ? "—"
                      : `${signedQuantity > 0 ? "+" : ""}${formatQuantity(
                          row.signedQuantity
                        )}`;

                  return (
                    <TableRow key={row.id}>
                      <TableCell>{formatDateTime(row.occurredAt)}</TableCell>
                      <TableCell>
                        <Link
                          href={row.item.href}
                          className="font-medium hover:underline"
                        >
                          {row.item.displayName}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">{row.eventLabel}</TableCell>
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
                        className={cn(
                          "text-right font-mono",
                          signedQuantity < 0 && "text-destructive"
                        )}
                      >
                        {quantityChange}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono",
                          row.onHandAfter == null && "text-muted-foreground",
                          onHandAfter != null &&
                            onHandAfter < 0 &&
                            "text-destructive"
                        )}
                      >
                        {formatOnHandAfter(row)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono",
                          valueChange == null && "text-muted-foreground",
                          valueChangeIsNegative && "text-destructive"
                        )}
                      >
                        {valueChange ?? "—"}
                      </TableCell>
                      <TableCell>{row.actor ? row.actor.name : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="flex items-center justify-between py-1">
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
              <HugeiconsIcon
                icon={ArrowLeft01Icon}
                data-icon="inline-start"
                aria-hidden
              />
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
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                data-icon="inline-end"
                aria-hidden
              />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
