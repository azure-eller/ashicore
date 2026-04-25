"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDown01Icon,
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
  formatInventoryLedgerBalanceDimension,
  formatInventoryLedgerEventLabel,
  formatInventoryLedgerMovementCategory,
  formatInventoryLedgerSourceType,
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

function getQuantityUnit(row: InventoryLedgerRow) {
  return row.item.unitName ?? "units";
}

function formatQuantityWithUnit(
  quantity: string,
  row: InventoryLedgerRow,
  options: { absolute?: boolean; signed?: boolean } = {}
) {
  const parsed = parseFloat(quantity);
  const numeric = Number.isFinite(parsed)
    ? options.absolute
      ? Math.abs(parsed)
      : parsed
    : 0;
  const sign = options.signed && numeric > 0 ? "+" : "";

  return `${sign}${formatQuantity(String(numeric))} ${getQuantityUnit(row)}`;
}

function formatQuantityChange(row: InventoryLedgerRow) {
  if (row.balanceDimension === "none") {
    return "No quantity change";
  }

  return formatQuantityWithUnit(row.signedQuantity, row, { signed: true });
}

function formatQuantityMagnitude(row: InventoryLedgerRow) {
  const signedQuantity = parseFloat(row.signedQuantity);
  const quantity = String(
    Number.isFinite(signedQuantity) && signedQuantity !== 0
      ? Math.abs(signedQuantity)
      : Math.abs(parseFloat(row.quantity))
  );

  return formatQuantityWithUnit(quantity, row);
}

function formatOnHandAfter(row: InventoryLedgerRow) {
  return row.onHandAfter == null ? "—" : formatQuantity(row.onHandAfter);
}

function formatOnHandAfterWithUnit(row: InventoryLedgerRow) {
  return row.onHandAfter == null
    ? "—"
    : `${formatQuantity(row.onHandAfter)} ${getQuantityUnit(row)}`;
}

function getOnHandBefore(row: InventoryLedgerRow) {
  if (row.balanceDimension !== "on_hand" || row.onHandAfter == null) {
    return null;
  }

  const onHandAfter = parseFloat(row.onHandAfter);
  const signedQuantity = parseFloat(row.signedQuantity);

  if (!Number.isFinite(onHandAfter) || !Number.isFinite(signedQuantity)) {
    return null;
  }

  return String(onHandAfter - signedQuantity);
}

function formatOnHandBefore(row: InventoryLedgerRow) {
  const onHandBefore = getOnHandBefore(row);
  return onHandBefore == null
    ? "—"
    : `${formatQuantity(onHandBefore)} ${getQuantityUnit(row)}`;
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

function formatLedgerRowSummary(row: InventoryLedgerRow) {
  const actor = row.actor?.name ?? "System";
  const item = row.item.displayName;
  const quantity = formatQuantityMagnitude(row);
  const source = row.sourceDocument?.label;
  const sourceSuffix = source ? ` on ${source}` : "";
  const supplier = row.sourceContext.supplierName;
  const customer = row.sourceContext.customerName;
  const manufacturingProduct = row.sourceContext.manufacturingProduct;

  switch (row.eventType) {
    case "opening_balance":
      return `${actor} recorded an opening balance of ${quantity} for ${item}.`;
    case "purchase_receipt":
      return `${actor} received ${quantity} of ${item}${
        supplier ? ` from ${supplier}` : ""
      }${sourceSuffix}.`;
    case "manufacturing_output":
      return `${actor} manufactured ${quantity} of ${item}${sourceSuffix}.`;
    case "manufacturing_ingredient_consumption":
      return manufacturingProduct
        ? `${actor} used ${quantity} of ${item} to manufacture ${manufacturingProduct.name}${sourceSuffix}.`
        : `${actor} used ${quantity} of ${item} for manufacturing${sourceSuffix}.`;
    case "manual_adjustment_increase":
      return `${actor} manually increased ${item} by ${quantity}.`;
    case "manual_adjustment_decrease":
      return `${actor} manually decreased ${item} by ${quantity}.`;
    case "stocktake_gain":
      return `${source ?? "Stocktake"} increased ${item} by ${quantity}.`;
    case "stocktake_loss":
      return `${source ?? "Stocktake"} decreased ${item} by ${quantity}.`;
    case "manufacturing_variance_gain":
      return `${actor} recorded a manufacturing variance gain of ${quantity} for ${item}${sourceSuffix}.`;
    case "manufacturing_variance_loss":
      return `${actor} recorded a manufacturing variance loss of ${quantity} for ${item}${sourceSuffix}.`;
    case "unpick_restock":
      return `${actor} returned ${quantity} of ${item} from manufacturing picks${sourceSuffix}.`;
    case "sales_consumption":
      return `${actor} shipped ${quantity} of ${item}${
        customer ? ` to ${customer}` : ""
      }${sourceSuffix}.`;
    case "reservation_increase":
      return `${actor} reserved ${quantity} of ${item}${sourceSuffix}.`;
    case "reservation_release":
      return `${actor} released a reservation for ${quantity} of ${item}${sourceSuffix}.`;
    case "expected_increase":
      return `${actor} added ${quantity} of expected supply for ${item}${sourceSuffix}.`;
    case "expected_release":
      return `${actor} released ${quantity} of expected supply for ${item}${sourceSuffix}.`;
    case "cost_basis_change":
      return `${actor} updated the cost basis for ${item}.`;
    case "stocktake_verification":
      return `${source ?? "Stocktake"} verified ${item}.`;
  }
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Inventory Ledger</h1>
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
            <FieldLabel className="text-xs text-muted-foreground">From</FieldLabel>
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
            <FieldLabel className="text-xs text-muted-foreground">To</FieldLabel>
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
            <FieldLabel className="text-xs text-muted-foreground">Movement</FieldLabel>
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
            <FieldLabel className="text-xs text-muted-foreground">Item Type</FieldLabel>
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
                    <FieldLabel className="text-xs text-muted-foreground">Lot</FieldLabel>
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
                    <FieldLabel className="text-xs text-muted-foreground">Scope</FieldLabel>
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
                      Event Type
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
                      Document Type
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
                    <FieldLabel className="text-xs text-muted-foreground">Actor</FieldLabel>
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
            <Table className="min-w-[1120px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Occurred</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Lot</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">On hand after</TableHead>
                  <TableHead>Actor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialData.rows.map((row) => {
                  const isExpanded = expandedRows[row.id] ?? false;
                  const signedQuantity = parseFloat(row.signedQuantity);
                  const onHandAfter =
                    row.onHandAfter == null ? null : parseFloat(row.onHandAfter);
                  const valueChange = formatValueChange(row);
                  const valueChangeIsNegative = valueChange?.startsWith("-") ?? false;
                  const manufacturingProduct =
                    row.sourceContext.manufacturingProduct;
                  const quantityChange =
                    row.balanceDimension === "none"
                      ? "—"
                      : `${signedQuantity > 0 ? "+" : ""}${formatQuantity(
                          row.signedQuantity
                        )}`;

                  return (
                    <Fragment key={row.id}>
                      <TableRow>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="inline-flex rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
                                aria-hidden
                              />
                            </button>
                            <span>{formatDateTime(row.occurredAt)}</span>
                          </div>
                        </TableCell>
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
                        <TableCell>{row.actor ? row.actor.name : "—"}</TableCell>
                      </TableRow>

                      {isExpanded ? (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell
                            colSpan={8}
                            className="whitespace-normal px-6 py-4"
                          >
                            <div className="space-y-5">
                              <p className="max-w-5xl text-sm font-medium leading-6">
                                {formatLedgerRowSummary(row)}
                              </p>

                              <div className="grid gap-6 lg:grid-cols-[1.05fr_0.85fr_1.1fr]">
                                <section className="space-y-3">
                                  <h3 className="text-sm font-semibold">
                                    Inventory impact
                                  </h3>
                                  <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                                    <div className="contents">
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Balance
                                      </dt>
                                      <dd>
                                        {formatInventoryLedgerBalanceDimension(
                                          row.balanceDimension
                                        )}
                                      </dd>
                                    </div>
                                    <div className="contents">
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Before
                                      </dt>
                                      <dd className="font-mono">
                                        {formatOnHandBefore(row)}
                                      </dd>
                                    </div>
                                    <div className="contents">
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Change
                                      </dt>
                                      <dd
                                        className={cn(
                                          "font-mono",
                                          signedQuantity < 0 && "text-destructive"
                                        )}
                                      >
                                        {formatQuantityChange(row)}
                                      </dd>
                                    </div>
                                    <div className="contents">
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        After
                                      </dt>
                                      <dd
                                        className={cn(
                                          "font-mono",
                                          row.onHandAfter == null &&
                                            "text-muted-foreground",
                                          onHandAfter != null &&
                                            onHandAfter < 0 &&
                                            "text-destructive"
                                        )}
                                      >
                                        {formatOnHandAfterWithUnit(row)}
                                      </dd>
                                    </div>
                                    <div className="contents">
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Lot
                                      </dt>
                                      <dd className="font-mono">{row.lot?.number ?? "—"}</dd>
                                    </div>
                                  </dl>
                                </section>

                                <section className="space-y-3">
                                  <h3 className="text-sm font-semibold">
                                    Cost impact
                                  </h3>
                                  <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                                    <div className="contents">
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Unit cost
                                      </dt>
                                      <dd>{formatPrice(row.unitCost) ?? "—"}</dd>
                                    </div>
                                    <div className="contents">
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Value
                                      </dt>
                                      <dd
                                        className={cn(
                                          valueChangeIsNegative &&
                                            "text-destructive"
                                        )}
                                      >
                                        {valueChange ?? "—"}
                                      </dd>
                                    </div>
                                  </dl>
                                </section>

                                <section className="space-y-3">
                                  <h3 className="text-sm font-semibold">
                                    Document context
                                  </h3>
                                  <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                                    <div className="contents">
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Document
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
                                    <div className="contents">
                                      <dt className="text-xs font-medium text-muted-foreground">
                                        Type
                                      </dt>
                                      <dd>
                                        {row.sourceDocument
                                          ? formatInventoryLedgerSourceType(
                                              row.sourceDocument.type
                                            )
                                          : "—"}
                                      </dd>
                                    </div>
                                    {manufacturingProduct ? (
                                      <div className="contents">
                                        <dt className="text-xs font-medium text-muted-foreground">
                                          Product
                                        </dt>
                                        <dd>
                                          {manufacturingProduct.href ? (
                                            <Link
                                              href={manufacturingProduct.href}
                                              className="font-medium hover:underline"
                                            >
                                              {manufacturingProduct.name}
                                            </Link>
                                          ) : (
                                            manufacturingProduct.name
                                          )}
                                        </dd>
                                      </div>
                                    ) : null}
                                    {row.sourceContext.supplierName ? (
                                      <div className="contents">
                                        <dt className="text-xs font-medium text-muted-foreground">
                                          Supplier
                                        </dt>
                                        <dd>{row.sourceContext.supplierName}</dd>
                                      </div>
                                    ) : null}
                                    {row.sourceContext.customerName ? (
                                      <div className="contents">
                                        <dt className="text-xs font-medium text-muted-foreground">
                                          Customer
                                        </dt>
                                        <dd>{row.sourceContext.customerName}</dd>
                                      </div>
                                    ) : null}
                                    {row.item.sku ? (
                                      <div className="contents">
                                        <dt className="text-xs font-medium text-muted-foreground">
                                          SKU
                                        </dt>
                                        <dd className="break-all font-mono text-xs">
                                          {row.item.sku}
                                        </dd>
                                      </div>
                                    ) : null}
                                  </dl>
                                </section>
                              </div>

                              <div className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                                <span>Recorded {formatDateTime(row.occurredAt)}</span>
                                <span>By {row.actor?.name ?? "System"}</span>
                                {row.actor?.email ? <span>{row.actor.email}</span> : null}
                              </div>
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
