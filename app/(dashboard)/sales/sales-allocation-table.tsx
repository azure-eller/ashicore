"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListSettingIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SortableHeader } from "@/components/sortable-header";
import { apiJson } from "@/lib/client/api";
import { formatDate } from "@/lib/format";
import { SALES_ORDER_SHIP_DATE_TOOLTIP } from "@/lib/tooltip-copy";
import {
  ALLOCATOR_PREFERENCE_ENDPOINT,
  AllocationSourceDialog,
  AllocatorCell,
  getLineAllocatedQty,
  productLabel,
  type AllocationTarget,
  type AllocatorPreference,
  type AllocatorProduct,
} from "./sales-order-allocator";
import type { SalesOrderListLine, SalesOrderListRow } from "./types";

const OPEN_SALES_STATUSES = ["draft", "confirmed", "partially_shipped"] as const;
const MISC_FAMILY_LABEL = "MISC";

function isOpenSalesOrder(order: SalesOrderListRow) {
  return (OPEN_SALES_STATUSES as readonly string[]).includes(order.status);
}

function parseQuantity(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function displayDate(value: string | null | undefined) {
  return value == null ? "" : formatDate(value);
}

function getAllocatorProducts(orders: SalesOrderListRow[]) {
  const byId = new Map<string, AllocatorProduct>();

  orders.forEach((order) => {
    if (!isOpenSalesOrder(order)) return;

    order.lines.forEach((line) => {
      if (line.itemType !== "product") return;
      if (byId.has(line.itemId)) return;

      byId.set(line.itemId, {
        itemId: line.itemId,
        label: productLabel(line),
        familyLabel: line.attrs.length > 0 ? line.masterName : MISC_FAMILY_LABEL,
        variantLabel: line.attrs.length > 0 ? line.attrs.join(" ") : line.masterName,
        sku: line.itemSku ?? null,
        unitName: line.unitName,
      });
    });
  });

  return [...byId.values()].sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

function buildAllocatorColumns({
  products,
  onAllocate,
}: {
  products: AllocatorProduct[];
  onAllocate: (target: AllocationTarget) => void;
}): ColumnDef<SalesOrderListRow>[] {
  const productsByFamily = products.reduce((groups, product) => {
    const bucket = groups.get(product.familyLabel) ?? [];
    bucket.push(product);
    groups.set(product.familyLabel, bucket);
    return groups;
  }, new Map<string, AllocatorProduct[]>());

  const miscProducts = productsByFamily.get(MISC_FAMILY_LABEL) ?? [];
  productsByFamily.delete(MISC_FAMILY_LABEL);
  const miscProductById = new Map(
    miscProducts.map((product) => [product.itemId, product])
  );

  return [
    {
      accessorKey: "customerName",
      header: ({ column }) => <SortableHeader column={column} label="Customer" />,
      cell: ({ row }) => (
        <Link href={`/sales/orders/${row.original.id}`} className="hover:underline">
          {row.original.customerName}
        </Link>
      ),
      meta: { className: "min-w-48 font-medium" },
    },
    {
      accessorKey: "shipDate",
      header: ({ column }) => (
        <SortableHeader
          column={column}
          label="Ship"
          tooltip={SALES_ORDER_SHIP_DATE_TOOLTIP}
        />
      ),
      sortingFn: (a, b) => {
        const dateCompare = (a.original.shipDate ?? "").localeCompare(
          b.original.shipDate ?? ""
        );

        if (dateCompare !== 0) {
          return dateCompare;
        }

        return a.original.orderNumber.localeCompare(b.original.orderNumber, undefined, {
          numeric: true,
        });
      },
      cell: ({ row }) => displayDate(row.original.shipDate),
      meta: { className: "min-w-24" },
    },
    ...(miscProducts.length > 0
      ? [
          {
            id: "allocator-family:misc",
            header: () => (
              <div className="px-2 text-center font-semibold uppercase tracking-normal">
                {MISC_FAMILY_LABEL}
              </div>
            ),
            columns: [
              {
                id: "allocator:misc",
                header: () => (
                  <div className="px-1 py-1 text-center font-medium">Product</div>
                ),
                sortingFn: (a, b) => {
                  const totalAllocated = (order: SalesOrderListRow) =>
                    order.lines.reduce((sum, line) => {
                      if (!miscProductById.has(line.itemId)) return sum;
                      return sum + parseQuantity(line.allocatedQty);
                    }, 0);

                  return totalAllocated(a.original) - totalAllocated(b.original);
                },
                cell: ({ row }) => {
                  const lines = row.original.lines.filter(
                    (candidate): candidate is SalesOrderListLine & { id: string } =>
                      Boolean(candidate.id) && miscProductById.has(candidate.itemId)
                  );

                  if (lines.length === 0) {
                    return null;
                  }

                  return (
                    <div className="flex flex-col">
                      {lines.map((line) => {
                        const product = miscProductById.get(line.itemId);
                        if (!product) return null;

                        return (
                          <AllocatorCell
                            key={`${line.id}:${getLineAllocatedQty(line)}`}
                            line={line}
                            label={product.label}
                            onCommit={(targetQty) =>
                              onAllocate({
                                order: row.original,
                                line,
                                product,
                                targetQty,
                              })
                            }
                          />
                        );
                      })}
                    </div>
                  );
                },
                meta: { className: "w-36 min-w-36 p-0" },
              },
            ],
          } satisfies ColumnDef<SalesOrderListRow>,
        ]
      : []),
    ...[...productsByFamily.entries()].map(
      ([familyLabel, familyProducts]): ColumnDef<SalesOrderListRow> => ({
        id: `allocator-family:${familyLabel}`,
        header: () => (
          <div className="px-2 text-center font-semibold uppercase tracking-normal">
            {familyLabel}
          </div>
        ),
        columns: familyProducts.map(
          (product): ColumnDef<SalesOrderListRow> => ({
            id: `allocator:${product.itemId}`,
            header: () => (
              <div className="flex max-w-20 flex-col items-center px-1 py-1 text-center">
                <span className="w-full truncate">{product.variantLabel}</span>
                <span className="w-full truncate text-xs font-normal text-muted-foreground">
                  {product.sku ?? product.unitName}
                </span>
              </div>
            ),
            sortingFn: (a, b) => {
              const aLine = a.original.lines.find(
                (line) => line.itemId === product.itemId
              );
              const bLine = b.original.lines.find(
                (line) => line.itemId === product.itemId
              );
              return (
                parseQuantity(aLine?.allocatedQty) -
                parseQuantity(bLine?.allocatedQty)
              );
            },
            cell: ({ row }) => {
              const line = row.original.lines.find(
                (candidate): candidate is SalesOrderListLine & { id: string } =>
                  candidate.itemId === product.itemId && Boolean(candidate.id)
              );

              if (!line) {
                return null;
              }

              return (
                <AllocatorCell
                  key={`${line.id}:${getLineAllocatedQty(line)}`}
                  line={line}
                  onCommit={(targetQty) =>
                    onAllocate({
                      order: row.original,
                      line,
                      product,
                      targetQty,
                    })
                  }
                />
              );
            },
            meta: { className: "w-20 min-w-20 p-0" },
          })
        ),
      })
    ),
  ];
}

export function SalesAllocationTable({
  initialData,
}: {
  initialData: SalesOrderListRow[];
}) {
  const queryClient = useQueryClient();
  const [allocationTarget, setAllocationTarget] = useState<AllocationTarget | null>(
    null
  );
  const { data: orders = initialData } = useQuery({
    queryKey: ["sales-orders"],
    queryFn: () =>
      apiJson<SalesOrderListRow[]>("/api/sales-orders", {
        fallbackError: "Failed to fetch orders.",
      }),
    initialData,
  });

  const openOrders = useMemo(() => orders.filter(isOpenSalesOrder), [orders]);
  const allocatorProducts = useMemo(() => getAllocatorProducts(orders), [orders]);
  const allocatorPreferenceQuery = useQuery({
    queryKey: ["sales-orders-allocator-preference"],
    queryFn: () =>
      apiJson<AllocatorPreference>(ALLOCATOR_PREFERENCE_ENDPOINT, {
        fallbackError: "Failed to load allocator preferences.",
      }),
    initialData: { hiddenProductIds: [] },
  });
  const hiddenProductIds = allocatorPreferenceQuery.data.hiddenProductIds;
  const hiddenProductIdSet = useMemo(
    () => new Set(hiddenProductIds),
    [hiddenProductIds]
  );
  const visibleAllocatorProducts = useMemo(
    () =>
      allocatorProducts.filter(
        (product) => !hiddenProductIdSet.has(product.itemId)
      ),
    [allocatorProducts, hiddenProductIdSet]
  );
  const allocatorPreferenceMutation = useMutation({
    mutationFn: (nextHiddenProductIds: string[]) =>
      apiJson<AllocatorPreference>(ALLOCATOR_PREFERENCE_ENDPOINT, {
        method: "PUT",
        body: { hiddenProductIds: nextHiddenProductIds },
        fallbackError: "Failed to save allocator preferences.",
      }),
    onMutate: async (nextHiddenProductIds) => {
      await queryClient.cancelQueries({
        queryKey: ["sales-orders-allocator-preference"],
      });
      const previous = queryClient.getQueryData<AllocatorPreference>([
        "sales-orders-allocator-preference",
      ]);
      queryClient.setQueryData<AllocatorPreference>(
        ["sales-orders-allocator-preference"],
        { hiddenProductIds: nextHiddenProductIds }
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["sales-orders-allocator-preference"],
          context.previous
        );
      }
    },
    onSuccess: (preference) => {
      queryClient.setQueryData(
        ["sales-orders-allocator-preference"],
        preference
      );
    },
  });

  function setProductHidden(productId: string, hidden: boolean) {
    const next = new Set(hiddenProductIds);
    if (hidden) {
      next.add(productId);
    } else {
      next.delete(productId);
    }
    allocatorPreferenceMutation.mutate([...next]);
  }

  const allocatorColumns = useMemo(
    () =>
      buildAllocatorColumns({
        products: visibleAllocatorProducts,
        onAllocate: setAllocationTarget,
      }),
    [visibleAllocatorProducts]
  );

  return (
    <>
      <DashboardDataTable
        columns={allocatorColumns}
        data={openOrders}
        initialData={initialData.filter(isOpenSalesOrder)}
        queryKey={["sales-orders"]}
        searchAriaLabel="Search sales allocations"
        emptyMessage="No open sales orders."
        tableClassName="min-w-max border-collapse"
        tableWrapperClassName="rounded-none"
        verticalColumnBorders
        toolbarContent={
          <AllocatorColumnMenu
            products={allocatorProducts}
            hiddenProductIdSet={hiddenProductIdSet}
            onHiddenChange={setProductHidden}
          />
        }
        initialSorting={[{ id: "shipDate", desc: false }]}
      />
      <AllocationSourceDialog
        target={allocationTarget}
        onOpenChange={(open) => {
          if (!open) setAllocationTarget(null);
        }}
      />
    </>
  );
}

function AllocatorColumnMenu({
  products,
  hiddenProductIdSet,
  onHiddenChange,
}: {
  products: AllocatorProduct[];
  hiddenProductIdSet: Set<string>;
  onHiddenChange: (productId: string, hidden: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Columns
          <HugeiconsIcon
            icon={ListSettingIcon}
            data-icon="inline-end"
            aria-hidden
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Product columns</DropdownMenuLabel>
        {products.length === 0 ? (
          <div className="px-1.5 py-2 text-sm text-muted-foreground">
            No open order products.
          </div>
        ) : (
          products.map((product) => (
            <DropdownMenuCheckboxItem
              key={product.itemId}
              checked={!hiddenProductIdSet.has(product.itemId)}
              onCheckedChange={(checked) =>
                onHiddenChange(product.itemId, checked !== true)
              }
            >
              <span className="min-w-0 truncate">{product.label}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
