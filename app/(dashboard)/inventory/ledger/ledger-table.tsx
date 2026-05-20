"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FilterHeaderButton,
  ServerFilterableHeader,
} from "@/components/filterable-header";
import { ERPDataGrid, type ColDef } from "@/components/erp-data-grid";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  INVENTORY_EVENT_TYPES,
} from "@/lib/db/schema";
import {
  formatDateTime,
  formatPrice,
  formatQuantity,
} from "@/lib/format";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import { cn } from "@/lib/utils";
import {
  formatInventoryLedgerEventLabel,
  formatInventoryLedgerMovementCategory,
  formatInventoryLedgerSourceType,
  INVENTORY_LEDGER_EVENT_CLASSES,
  INVENTORY_LEDGER_SOURCE_TYPES,
} from "@/lib/inventory/ledger";
import {
  LEDGER_ACTOR_TOOLTIP,
  LEDGER_CHANGE_TOOLTIP,
  LEDGER_EVENT_TYPE_TOOLTIP,
  LEDGER_LOT_TOOLTIP,
  LEDGER_MOVEMENT_TOOLTIP,
  LEDGER_ON_HAND_AFTER_TOOLTIP,
  LEDGER_ON_HAND_BEFORE_TOOLTIP,
  LEDGER_OCCURRED_TOOLTIP,
  LEDGER_SOURCE_TOOLTIP,
  LEDGER_VALUE_CHANGE_TOOLTIP,
} from "@/lib/tooltip-copy";
import type { InventoryLedgerFilters } from "@/lib/schemas/inventory-ledger";
import { buildInventoryLedgerSearchParams } from "./filters";
import type { InventoryLedgerPageProps, InventoryLedgerRow } from "./types";

type FilterOption = {
  value: string;
  label: string;
  description?: string;
  searchLabel?: string;
};

const EVENT_TYPE_FILTER_OPTIONS: FilterOption[] = INVENTORY_EVENT_TYPES.map(
  (eventType) => ({
    value: eventType,
    label: formatInventoryLedgerEventLabel(eventType),
  })
);

const DOCUMENT_TYPE_FILTER_OPTIONS: FilterOption[] =
  INVENTORY_LEDGER_SOURCE_TYPES.map((documentType) => ({
    value: documentType,
    label: formatInventoryLedgerSourceType(documentType),
  }));

const MOVEMENT_FILTER_OPTIONS: FilterOption[] = INVENTORY_LEDGER_EVENT_CLASSES.map(
  (eventClass) => ({
    value: eventClass,
    label: formatInventoryLedgerMovementCategory(eventClass),
  })
);

function normalizeOptionalValue(value: string) {
  return value === "" ? undefined : value;
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

function formatOnHandBefore(row: InventoryLedgerRow) {
  return row.onHandBefore == null ? "—" : formatQuantity(row.onHandBefore);
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

function OccurredFilterHeader({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClear,
}: {
  dateFrom?: string;
  dateTo?: string;
  onDateFromChange: (value: string | undefined) => void;
  onDateToChange: (value: string | undefined) => void;
  onClear: () => void;
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const selectedCount = Number(dateFrom != null) + Number(dateTo != null);
  const button = (
    <FilterHeaderButton label="Occurred" selectedCount={selectedCount} />
  );

  function handleDropdownOpenChange(open: boolean) {
    setIsDropdownOpen(open);
    if (open) {
      setIsTooltipOpen(false);
    }
  }

  return (
    <Tooltip
      open={!isDropdownOpen && isTooltipOpen}
      onOpenChange={setIsTooltipOpen}
    >
      <DropdownMenu open={isDropdownOpen} onOpenChange={handleDropdownOpenChange}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent
          align="start"
          className="w-72 bg-popover text-popover-foreground"
        >
          <div className="grid gap-3 p-1">
            <Field className="gap-1.5">
              <FieldLabel className="text-xs text-muted-foreground">From</FieldLabel>
              <DatePicker
                value={dateFrom ?? ""}
                onChange={(value) => onDateFromChange(normalizeOptionalValue(value))}
                aria-label="Filter from date"
                placeholder="Start date"
              />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel className="text-xs text-muted-foreground">To</FieldLabel>
              <DatePicker
                value={dateTo ?? ""}
                onChange={(value) => onDateToChange(normalizeOptionalValue(value))}
                aria-label="Filter to date"
                placeholder="End date"
              />
            </Field>
          </div>
          {selectedCount > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onClear}>
                Clear filter
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent side="top">{LEDGER_OCCURRED_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}

function TextFilterHeader({
  label,
  tooltip,
  value,
  inputLabel,
  placeholder,
  debounceRef,
  onInputChange,
  onValueChange,
}: {
  label: string;
  tooltip?: string;
  value?: string;
  inputLabel: string;
  placeholder: string;
  debounceRef: { current: ReturnType<typeof setTimeout> | null };
  onInputChange: (value: string) => void;
  onValueChange: (value: string | undefined) => void;
}) {
  const initialValue = value ?? "";
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const [state, setState] = useState({
    urlValue: initialValue,
    value: initialValue,
  });
  const displayValue =
    state.urlValue === initialValue ? state.value : initialValue;
  const button = (
    <FilterHeaderButton
      label={label}
      selectedCount={value == null ? 0 : 1}
    />
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [debounceRef]);

  function handleDropdownOpenChange(open: boolean) {
    setIsDropdownOpen(open);
    if (open) {
      setIsTooltipOpen(false);
    }
  }

  function handleChange(nextValue: string) {
    onInputChange(nextValue);
    setState({
      urlValue: initialValue,
      value: nextValue,
    });
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onValueChange(normalizeOptionalValue(nextValue));
    }, 300);
  }

  function handleClear() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    onInputChange("");
    setState({
      urlValue: initialValue,
      value: "",
    });
    onValueChange(undefined);
  }

  return (
    <Tooltip
      open={!isDropdownOpen && isTooltipOpen}
      onOpenChange={setIsTooltipOpen}
    >
      <DropdownMenu open={isDropdownOpen} onOpenChange={handleDropdownOpenChange}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent
          align="start"
          className="w-72 bg-popover text-popover-foreground"
        >
          <div className="p-1">
            <Input
              aria-label={inputLabel}
              placeholder={placeholder}
              value={displayValue}
              onChange={(event) => handleChange(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
          {value != null ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleClear}>
                Clear filter
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {tooltip ? <TooltipContent side="top">{tooltip}</TooltipContent> : null}
    </Tooltip>
  );
}

function SearchableFilterHeader({
  label,
  tooltip,
  value,
  options,
  inputLabel,
  placeholder,
  emptyMessage,
  onValueChange,
}: {
  label: string;
  tooltip?: string;
  value?: string;
  options: readonly FilterOption[];
  inputLabel: string;
  placeholder: string;
  emptyMessage: string;
  onValueChange: (value: string | undefined) => void;
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedCount = value == null ? 0 : 1;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions =
    normalizedQuery.length === 0
      ? options
      : options.filter((option) =>
          [option.label, option.description, option.searchLabel]
            .filter((part): part is string => part != null)
            .some((part) => part.toLowerCase().includes(normalizedQuery))
        );
  const button = (
    <FilterHeaderButton label={label} selectedCount={selectedCount} />
  );

  function handleDropdownOpenChange(open: boolean) {
    setIsDropdownOpen(open);
    if (open) {
      setIsTooltipOpen(false);
      return;
    }
    setQuery("");
  }

  return (
    <Tooltip
      open={!isDropdownOpen && isTooltipOpen}
      onOpenChange={setIsTooltipOpen}
    >
      <DropdownMenu open={isDropdownOpen} onOpenChange={handleDropdownOpenChange}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent
          align="start"
          className="w-80 bg-popover text-popover-foreground"
        >
          <div className="p-1">
            <Input
              aria-label={inputLabel}
              placeholder={placeholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {visibleOptions.length === 0 ? (
              <div className="px-2 py-2 text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            ) : (
              visibleOptions.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() =>
                    onValueChange(value === option.value ? undefined : option.value)
                  }
                >
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </div>
          {value != null ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onValueChange(undefined)}>
                Clear filter
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {tooltip ? <TooltipContent side="top">{tooltip}</TooltipContent> : null}
    </Tooltip>
  );
}

function MultiSelectFilterHeader({
  label,
  tooltip,
  values,
  defaultValues,
  options,
  onValuesChange,
}: {
  label: string;
  tooltip?: string;
  values?: readonly string[];
  defaultValues?: readonly string[];
  options: readonly FilterOption[];
  onValuesChange: (values: string[] | undefined) => void;
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const selected = values ?? [];
  const defaultSelected = defaultValues ?? [];
  const selectedCount =
    selected.length === defaultSelected.length &&
    selected.every((value) => defaultSelected.includes(value))
      ? 0
      : selected.length;
  const button = (
    <FilterHeaderButton label={label} selectedCount={selectedCount} />
  );

  function handleDropdownOpenChange(open: boolean) {
    setIsDropdownOpen(open);
    if (open) {
      setIsTooltipOpen(false);
    }
  }

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((selectedValue) => selectedValue !== value)
      : [...selected, value];
    onValuesChange(next.length > 0 ? next : undefined);
  }

  return (
    <Tooltip
      open={!isDropdownOpen && isTooltipOpen}
      onOpenChange={setIsTooltipOpen}
    >
      <DropdownMenu open={isDropdownOpen} onOpenChange={handleDropdownOpenChange}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent
          align="start"
          className="w-60 bg-popover text-popover-foreground"
        >
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={selected.includes(option.value)}
              onCheckedChange={() => toggle(option.value)}
              onSelect={(event) => event.preventDefault()}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
          {selectedCount > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onValuesChange(undefined)}>
                Clear filter
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {tooltip ? <TooltipContent side="top">{tooltip}</TooltipContent> : null}
    </Tooltip>
  );
}

export function LedgerTable({
  initialData,
  initialFilters,
  actorOptions,
  itemOptions,
}: InventoryLedgerPageProps) {
  const timeZone = useOrganizationTimeZone();
  const displayTimeZone = initialFilters.timeZone ?? timeZone;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const initialSearchValue = initialFilters.q ?? "";
  const [searchState, setSearchState] = useState({
    urlValue: initialSearchValue,
    value: initialSearchValue,
  });
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLotValue = initialFilters.lot ?? "";
  const [lotState, setLotState] = useState({
    urlValue: initialLotValue,
    value: initialLotValue,
  });
  const lotDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchValue =
    searchState.urlValue === initialSearchValue
      ? searchState.value
      : initialSearchValue;
  const lotValue =
    lotState.urlValue === initialLotValue ? lotState.value : initialLotValue;

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
      if (lotDebounceRef.current) {
        clearTimeout(lotDebounceRef.current);
      }
    };
  }, []);

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

  const cancelPendingFilterNavigation = () => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (lotDebounceRef.current) {
      clearTimeout(lotDebounceRef.current);
      lotDebounceRef.current = null;
    }
  };

  const getDraftFilters = () => ({
    ...initialFilters,
    q: normalizeOptionalValue(searchValue),
    lot: normalizeOptionalValue(lotValue),
  });

  const navigate = (filters: InventoryLedgerFilters) => {
    startTransition(() => {
      const searchParams = buildInventoryLedgerSearchParams(filters);
      const query = searchParams.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    });
  };

  const goToPage = (page: number) => {
    cancelPendingFilterNavigation();
    navigate(withDateFilterTimeZone({
      ...getDraftFilters(),
      page,
    }));
  };

  const updateColumnFilter = (patch: Partial<InventoryLedgerFilters>) => {
    cancelPendingFilterNavigation();
    navigate(withDateFilterTimeZone({
      ...getDraftFilters(),
      ...patch,
      page: 1,
    }));
  };

  const updatePageSize = (pageSize: number) => {
    cancelPendingFilterNavigation();
    navigate(withDateFilterTimeZone({
      ...getDraftFilters(),
      page: 1,
      pageSize,
    }));
  };

  const actorFilterOptions = actorOptions.map((actor) => ({
    value: actor.id,
    label: actor.email ? `${actor.name} (${actor.email})` : actor.name,
  }));
  const itemFilterOptions = itemOptions.map((item) => ({
    value: item.id,
    label: item.displayName,
    description: [
      item.sku,
      item.itemType === "material" ? "Material" : "Product",
    ]
      .filter((part): part is string => part != null)
      .join(" · "),
    searchLabel: `${item.displayName} ${item.sku ?? ""}`,
  }));

  const handleSearchChange = (value: string) => {
    setSearchState({
      urlValue: initialSearchValue,
      value,
    });
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null;
      navigate(withDateFilterTimeZone({
        ...getDraftFilters(),
        q: normalizeOptionalValue(value),
        page: 1,
      }));
    }, 300);
  };

  const columns: ColDef<InventoryLedgerRow>[] = [
    {
      colId: "occurredAt",
      minWidth: 170,
      flex: 1,
      headerComponent: () => (
        <OccurredFilterHeader
          dateFrom={initialFilters.dateFrom}
          dateTo={initialFilters.dateTo}
          onDateFromChange={(value) =>
            updateColumnFilter({ dateFrom: value })
          }
          onDateToChange={(value) => updateColumnFilter({ dateTo: value })}
          onClear={() =>
            updateColumnFilter({
              dateFrom: undefined,
              dateTo: undefined,
              timeZone: undefined,
            })
          }
        />
      ),
      valueGetter: ({ data }) =>
        data ? formatDateTime(data.occurredAt, displayTimeZone) : "",
    },
    {
      colId: "item",
      minWidth: 220,
      flex: 1.3,
      headerComponent: () => (
        <SearchableFilterHeader
          label="Item"
          options={itemFilterOptions}
          value={initialFilters.itemId}
          inputLabel="Search item options"
          placeholder="Search items..."
          emptyMessage="No items found"
          onValueChange={(value) =>
            updateColumnFilter({
              itemId: value,
              itemType: undefined,
            })
          }
        />
      ),
      valueGetter: ({ data }) => data?.item.displayName ?? "",
      cellRenderer: ({ data }: { data?: InventoryLedgerRow }) =>
        data ? (
          <Link href={data.item.href} className="font-medium hover:underline">
            {data.item.displayName}
          </Link>
        ) : null,
    },
    {
      colId: "event",
      minWidth: 180,
      flex: 1,
      headerComponent: () => (
        <SearchableFilterHeader
          label="Event"
          tooltip={LEDGER_EVENT_TYPE_TOOLTIP}
          options={EVENT_TYPE_FILTER_OPTIONS}
          value={initialFilters.eventType}
          inputLabel="Search event options"
          placeholder="Search events..."
          emptyMessage="No events found"
          onValueChange={(value) =>
            updateColumnFilter({
              eventType: value as InventoryLedgerFilters["eventType"],
              eventClasses: undefined,
            })
          }
        />
      ),
      valueGetter: ({ data }) => data?.eventLabel ?? "",
      cellClass: "font-medium",
    },
    {
      colId: "movement",
      minWidth: 150,
      flex: 0.9,
      headerComponent: () => (
        <MultiSelectFilterHeader
          label="Movement"
          tooltip={LEDGER_MOVEMENT_TOOLTIP}
          options={MOVEMENT_FILTER_OPTIONS}
          values={initialFilters.eventClasses}
          defaultValues={["stock"]}
          onValuesChange={(values) =>
            updateColumnFilter({
              eventClasses: values as InventoryLedgerFilters["eventClasses"],
              eventType: undefined,
            })
          }
        />
      ),
      valueGetter: ({ data }) =>
        data ? formatInventoryLedgerMovementCategory(data.eventClass) : "",
    },
    {
      colId: "source",
      minWidth: 210,
      flex: 1.2,
      headerComponent: () => (
        <ServerFilterableHeader
          label="Source"
          tooltip={LEDGER_SOURCE_TOOLTIP}
          options={DOCUMENT_TYPE_FILTER_OPTIONS}
          value={initialFilters.documentType}
          onValueChange={(value) =>
            updateColumnFilter({
              documentType: value as InventoryLedgerFilters["documentType"],
              documentId: undefined,
            })
          }
        />
      ),
      valueGetter: ({ data }) => data?.sourceDocument?.label ?? "",
      cellRenderer: ({ data }: { data?: InventoryLedgerRow }) => {
        const sourceDocument = data?.sourceDocument;
        if (!sourceDocument) {
          return <span className="text-muted-foreground">—</span>;
        }

        return sourceDocument.href ? (
          <Link href={sourceDocument.href} className="hover:underline">
            {sourceDocument.label}
          </Link>
        ) : (
          sourceDocument.label
        );
      },
    },
    {
      colId: "lot",
      minWidth: 130,
      flex: 0.8,
      headerComponent: () => (
        <TextFilterHeader
          label="Lot"
          tooltip={LEDGER_LOT_TOOLTIP}
          value={initialFilters.lot}
          inputLabel="Lot filter value"
          placeholder="Lot number"
          debounceRef={lotDebounceRef}
          onInputChange={(value) =>
            setLotState({
              urlValue: initialLotValue,
              value,
            })
          }
          onValueChange={(value) => updateColumnFilter({ lot: value })}
        />
      ),
      valueGetter: ({ data }) => data?.lot?.number ?? "",
      cellClass: "font-mono",
      cellRenderer: ({ data }: { data?: InventoryLedgerRow }) =>
        data?.lot?.number ?? <span className="text-muted-foreground">—</span>,
    },
    {
      colId: "change",
      minWidth: 125,
      flex: 0.75,
      headerComponent: () => (
        <TooltipHeader label="Change" tooltip={LEDGER_CHANGE_TOOLTIP} />
      ),
      cellClass: ({ data }) =>
        cn(
          "text-right font-mono",
          data && parseFloat(data.signedQuantity) < 0 && "text-destructive"
        ),
      valueGetter: ({ data }) => {
        if (!data || data.balanceDimension === "none") {
          return "—";
        }

        const signedQuantity = parseFloat(data.signedQuantity);
        return `${signedQuantity > 0 ? "+" : ""}${formatQuantity(
          data.signedQuantity
        )}`;
      },
    },
    {
      colId: "onHandBefore",
      minWidth: 150,
      flex: 0.85,
      headerComponent: () => (
        <TooltipHeader
          label="On hand before"
          tooltip={LEDGER_ON_HAND_BEFORE_TOOLTIP}
        />
      ),
      cellClass: ({ data }) => {
        const onHandBefore =
          data?.onHandBefore == null ? null : parseFloat(data.onHandBefore);
        return cn(
          "text-right font-mono",
          data?.onHandBefore == null && "text-muted-foreground",
          onHandBefore != null && onHandBefore < 0 && "text-destructive"
        );
      },
      valueGetter: ({ data }) => (data ? formatOnHandBefore(data) : "—"),
    },
    {
      colId: "onHandAfter",
      minWidth: 145,
      flex: 0.85,
      headerComponent: () => (
        <TooltipHeader
          label="On hand after"
          tooltip={LEDGER_ON_HAND_AFTER_TOOLTIP}
        />
      ),
      cellClass: ({ data }) => {
        const onHandAfter =
          data?.onHandAfter == null ? null : parseFloat(data.onHandAfter);
        return cn(
          "text-right font-mono",
          data?.onHandAfter == null && "text-muted-foreground",
          onHandAfter != null && onHandAfter < 0 && "text-destructive"
        );
      },
      valueGetter: ({ data }) => (data ? formatOnHandAfter(data) : "—"),
    },
    {
      colId: "valueChange",
      minWidth: 140,
      flex: 0.85,
      headerComponent: () => (
        <TooltipHeader
          label="Value change"
          tooltip={LEDGER_VALUE_CHANGE_TOOLTIP}
        />
      ),
      cellClass: ({ data }) => {
        const valueChange = data ? formatValueChange(data) : null;
        return cn(
          "text-right font-mono",
          valueChange == null && "text-muted-foreground",
          valueChange?.startsWith("-") && "text-destructive"
        );
      },
      valueGetter: ({ data }) => (data ? formatValueChange(data) ?? "—" : "—"),
    },
    {
      colId: "actor",
      minWidth: 180,
      flex: 1,
      headerComponent: () => (
        <ServerFilterableHeader
          label="Actor"
          tooltip={LEDGER_ACTOR_TOOLTIP}
          options={actorFilterOptions}
          value={initialFilters.actorUserId}
          onValueChange={(value) => updateColumnFilter({ actorUserId: value })}
        />
      ),
      valueGetter: ({ data }) => data?.actor?.name ?? "",
      cellRenderer: ({ data }: { data?: InventoryLedgerRow }) =>
        data?.actor?.name ?? <span className="text-muted-foreground">—</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {activeFilterBadges.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {activeFilterBadges.map((badge) => (
              <Badge key={`${badge.label}-${badge.value}`} variant="outline">
                {badge.label}: {badge.value}
              </Badge>
            ))}
          </div>
        ) : (
          <div />
        )}
        <div className="text-sm text-muted-foreground">
          {initialData.totalCount === 0
            ? "No matching events"
            : `Showing ${startRow}-${endRow} of ${initialData.totalCount}`}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <Field className="max-w-sm gap-1.5">
            <FieldLabel className="text-xs text-muted-foreground">Search</FieldLabel>
            <Input
              aria-label="Search ledger"
              placeholder="Item, lot, order, actor..."
              value={searchValue}
              onChange={(event) => handleSearchChange(event.target.value)}
            />
          </Field>
        </div>

        <ERPDataGrid
          rows={initialData.rows}
          columns={columns}
          emptyMessage="No inventory events matched the current filters."
          enableQuickFilter={false}
          defaultColDef={{ sortable: false }}
          suppressColumnVirtualisation
          height="calc(100dvh - 22rem)"
          className="space-y-0"
        />

        <div className="flex items-center justify-between py-4">
          <div className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows</span>
              <Select
                value={String(initialData.pageSize)}
                onValueChange={(value) => updatePageSize(Number(value))}
              >
                <SelectTrigger size="sm" className="w-auto" aria-label="Rows per page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
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
    </div>
  );
}
