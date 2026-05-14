"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CancelCircleIcon,
  PackageRemoveIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProductLensOption } from "./sales-order-product-lens";

export function SalesOrdersBoardToolbar({
  search,
  onSearchChange,
  productLensOptions,
  selectedItemIds,
  onSelectedItemIdsChange,
  showCancelled,
  onShowCancelledChange,
  cancelledCount,
  allocatedLineCount,
  onUnallocateAll,
  isUnallocatingAll,
  resultCount,
  totalCount,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  productLensOptions: ProductLensOption[];
  selectedItemIds: string[];
  onSelectedItemIdsChange: (value: string[]) => void;
  showCancelled: boolean;
  onShowCancelledChange: (value: boolean) => void;
  cancelledCount: number;
  allocatedLineCount: number;
  onUnallocateAll: () => void;
  isUnallocatingAll: boolean;
  resultCount: number;
  totalCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
        <div className="relative w-full min-w-0 sm:w-80 lg:w-96">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search orders"
            placeholder="Search orders, customers, items..."
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="pl-8"
          />
        </div>
        <ProductFilterDropdown
          options={productLensOptions}
          selectedItemIds={selectedItemIds}
          onSelectedItemIdsChange={onSelectedItemIdsChange}
        />
      </div>
      <div className="ml-auto flex items-center justify-end gap-2">
        <span className="hidden text-sm text-muted-foreground lg:inline">
          Showing {resultCount} of {totalCount} orders
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={allocatedLineCount === 0 || isUnallocatingAll}
              onClick={onUnallocateAll}
            >
              <HugeiconsIcon icon={PackageRemoveIcon} strokeWidth={2} className="size-4" />
              Unallocate all
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            Clear allocations for open sales orders.
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={showCancelled ? "secondary" : "outline"}
              size="icon-sm"
              aria-label={
                showCancelled
                  ? "Hide cancelled orders lane"
                  : `Show cancelled orders lane, ${cancelledCount} cancelled`
              }
              onClick={() => onShowCancelledChange(!showCancelled)}
              className="relative"
            >
              <HugeiconsIcon icon={CancelCircleIcon} strokeWidth={2} className="size-4" />
              <Badge
                variant={showCancelled ? "default" : "secondary"}
                className="absolute -top-2 -right-2 h-5 min-w-5 px-1 text-[10px]"
              >
                {cancelledCount}
              </Badge>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            Cancelled orders.
          </TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="hidden h-7 sm:block" />
        <Button asChild size="sm">
          <Link href="/sales/orders/new" prefetch={false}>
            New Order
          </Link>
        </Button>
      </div>
    </div>
  );
}

function ProductFilterDropdown({
  options,
  selectedItemIds,
  onSelectedItemIdsChange,
}: {
  options: ProductLensOption[];
  selectedItemIds: string[];
  onSelectedItemIdsChange: (value: string[]) => void;
}) {
  const selectedSet = new Set(selectedItemIds);
  const selectedLabels = options
    .filter((option) => selectedSet.has(option.itemId))
    .map((option) => option.label);
  const label =
    selectedLabels.length === 0
      ? "Product"
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : `${selectedLabels.length} products`;

  const toggleItem = (itemId: string) => {
    onSelectedItemIdsChange(
      selectedSet.has(itemId)
        ? selectedItemIds.filter((selected) => selected !== itemId)
        : [...selectedItemIds, itemId]
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={selectedItemIds.length ? "secondary" : "outline"}
          className="w-full justify-between sm:w-64"
          aria-label="Product"
        >
          <span className="truncate">{label}</span>
          {selectedItemIds.length ? (
            <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
              {selectedItemIds.length}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuItem
          disabled={selectedItemIds.length === 0}
          onSelect={() => onSelectedItemIdsChange([])}
        >
          All products
        </DropdownMenuItem>
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.itemId}
            checked={selectedSet.has(option.itemId)}
            onCheckedChange={() => toggleItem(option.itemId)}
            onSelect={(event) => event.preventDefault()}
          >
            <span className="truncate">{option.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
