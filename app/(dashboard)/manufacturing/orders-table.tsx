"use client";

import Link from "next/link";
import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { multiValueFilter } from "@/components/filterable-header";
import { QuantityWithUnit } from "@/components/quantity-with-unit";
import { SortableHeader } from "@/components/sortable-header";
import { TooltipHeader } from "@/components/tooltip-header";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { DateTimeText } from "@/components/date-time-text";
import { DataTableStatusFilter } from "@/components/data-table-status-filter";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import {
  MANUFACTURING_ACTUAL_QTY_TOOLTIP,
  MANUFACTURING_ORDER_STATUS_COLUMN_TOOLTIP,
  MANUFACTURING_PLANNED_QTY_TOOLTIP,
  MANUFACTURING_SALES_ORDER_TOOLTIP,
} from "@/lib/tooltip-copy";
import { MoStageAction } from "./mo-stage-action";
import { ManufacturingOrderStatusBadge } from "./status-badge";
import type { ManufacturingOrderListRow } from "./types";

const BADGE_VARIANTS = ["secondary", "outline", "default"] as const;

const MANUFACTURING_STATUS_FILTER_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "released", label: "Released" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

function AttributeBadges({ attrs }: { attrs: string[] }) {
  return attrs.map((attr, index) => (
    <Badge
      key={`${attr}-${index}`}
      variant={BADGE_VARIANTS[index % BADGE_VARIANTS.length]}
      className="text-xs font-normal"
    >
      {attr}
    </Badge>
  ));
}

function ProductCell({ order }: { order: ManufacturingOrderListRow }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="truncate">{order.productMasterName}</span>
      <AttributeBadges attrs={order.productAttrs} />
    </div>
  );
}

function PlannedQuantityCell({ order }: { order: ManufacturingOrderListRow }) {
  const batchLabel =
    order.manufacturingMode === "batch" && order.numberOfBatches != null
      ? `${order.numberOfBatches}b`
      : null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <QuantityWithUnit value={order.plannedQuantity} unitName={order.unitName} />
      {batchLabel != null && (
        <Badge variant="outline" className="text-xs font-normal">
          {batchLabel}
        </Badge>
      )}
    </div>
  );
}

function comparePriorityRank(
  left: ManufacturingOrderListRow,
  right: ManufacturingOrderListRow
) {
  if (left.priorityRank == null && right.priorityRank == null) {
    return 0;
  }

  if (left.priorityRank == null) {
    return 1;
  }

  if (right.priorityRank == null) {
    return -1;
  }

  return left.priorityRank - right.priorityRank;
}

function PriorityRankCell({ order }: { order: ManufacturingOrderListRow }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(order.priorityRank?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const canEdit = order.status === "draft" || order.status === "released";

  const mutation = useMutation({
    mutationFn: async (priorityRank: number | null) => {
      const response = await fetch(`/api/manufacturing-orders/${order.id}/priority`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priorityRank }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to update priority rank.");
      }
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["manufacturing-orders"] });
    },
    onError: (updateError) => {
      setError(updateError.message);
    },
  });

  const commit = () => {
    const trimmed = value.trim();
    const nextRank = trimmed ? Number(trimmed) : null;

    if (
      trimmed &&
      (typeof nextRank !== "number" || !Number.isInteger(nextRank) || nextRank <= 0)
    ) {
      setError("Invalid");
      return;
    }

    if (
      nextRank === order.priorityRank ||
      (nextRank == null && order.priorityRank == null)
    ) {
      return;
    }

    mutation.mutate(nextRank);
  };

  if (!canEdit) {
    return order.priorityRank == null ? (
      <span className="text-muted-foreground">-</span>
    ) : (
      <span className="font-mono text-sm">#{order.priorityRank}</span>
    );
  }

  return (
    <div className="w-16">
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        disabled={mutation.isPending}
        inputMode="numeric"
        aria-label={`Priority rank for ${order.orderNumber}`}
        placeholder="-"
        className="h-8 px-2 text-center font-mono text-sm"
        data-row-click-ignore="true"
      />
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

const columns: ColumnDef<ManufacturingOrderListRow>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all manufacturing orders"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label={`Select ${row.original.orderNumber}`}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "priorityRank",
    header: ({ column }) => <SortableHeader column={column} label="Rank" />,
    sortingFn: (a, b) => {
      const rankCompare = comparePriorityRank(a.original, b.original);

      if (rankCompare !== 0) {
        return rankCompare;
      }

      return a.original.orderNumber.localeCompare(b.original.orderNumber, undefined, {
        numeric: true,
      });
    },
    cell: ({ row }) => (
      <PriorityRankCell
        key={`${row.original.id}-${row.original.priorityRank ?? "none"}`}
        order={row.original}
      />
    ),
    meta: { className: "w-20" },
  },
  {
    accessorKey: "orderNumber",
    header: ({ column }) => <SortableHeader column={column} label="Order" />,
    cell: ({ row }) => (
      <Link
        href={`/manufacturing/orders/${row.original.id}`}
        className="hover:underline"
      >
        {row.original.orderNumber}
      </Link>
    ),
  },
  {
    accessorKey: "productName",
    header: ({ column }) => <SortableHeader column={column} label="Product" />,
    cell: ({ row }) => <ProductCell order={row.original} />,
  },
  {
    accessorKey: "salesOrderNumber",
    header: () => (
      <TooltipHeader label="Sales Order" tooltip={MANUFACTURING_SALES_ORDER_TOOLTIP} />
    ),
    cell: ({ row }) => row.original.salesOrderNumber ?? "\u2014",
  },
  {
    accessorKey: "plannedQuantity",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Planned"
        tooltip={MANUFACTURING_PLANNED_QTY_TOOLTIP}
      />
    ),
    sortingFn: (a, b) =>
      parseFloat(a.original.plannedQuantity) - parseFloat(b.original.plannedQuantity),
    cell: ({ row }) => <PlannedQuantityCell order={row.original} />,
  },
  {
    accessorKey: "actualQuantity",
    header: () => (
      <TooltipHeader label="Actual" tooltip={MANUFACTURING_ACTUAL_QTY_TOOLTIP} />
    ),
    cell: ({ row }) =>
      row.original.actualQuantity != null
        ? (
            <QuantityWithUnit
              value={row.original.actualQuantity}
              unitName={row.original.unitName}
            />
          )
        : "\u2014",
  },
  {
    accessorKey: "plannedDate",
    header: ({ column }) => <SortableHeader column={column} label="Planned Date" />,
    sortingFn: (a, b) => {
      const dateCompare = (a.original.plannedDate ?? "").localeCompare(
        b.original.plannedDate ?? ""
      );

      if (dateCompare !== 0) {
        return dateCompare;
      }

      return a.original.orderNumber.localeCompare(b.original.orderNumber, undefined, {
        numeric: true,
      });
    },
    cell: ({ row }) => formatDate(row.original.plannedDate),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <SortableHeader
        column={column}
        label="Status"
        tooltip={MANUFACTURING_ORDER_STATUS_COLUMN_TOOLTIP}
      />
    ),
    filterFn: multiValueFilter,
    cell: ({ row }) => <ManufacturingOrderStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "completedAt",
    header: ({ column }) => <SortableHeader column={column} label="Completed" />,
    cell: ({ row }) => <DateTimeText value={row.original.completedAt} />,
  },
  {
    id: "action",
    header: "",
    cell: ({ row }) => (
      <MoStageAction orderId={row.original.id} status={row.original.status} />
    ),
    enableSorting: false,
  },
];

export function OrdersTable({
  initialData,
}: {
  initialData: ManufacturingOrderListRow[];
}) {
  return (
    <DashboardDataTable
      columns={columns}
      initialData={initialData}
      queryKey={["manufacturing-orders"]}
      queryFn={async () => {
        const response = await fetch("/api/manufacturing-orders");
        if (!response.ok) {
          throw new Error("Failed to fetch manufacturing orders");
        }

        return response.json();
      }}
      searchAriaLabel="Search manufacturing orders"
      addHref="/manufacturing/orders/new"
      addAriaLabel="New Order"
      emptyMessage="No manufacturing orders yet."
      toolbarContent={({ table }) => (
        <DataTableStatusFilter
          table={table}
          options={MANUFACTURING_STATUS_FILTER_OPTIONS}
          ariaLabel="Filter manufacturing orders by status"
        />
      )}
      initialSorting={[{ id: "priorityRank", desc: false }]}
      deleteAction={{
        endpoint: "/api/manufacturing-orders",
        invalidateQueryKeys: [["manufacturing-orders"], ["items"]],
        defaultErrorMessage: "Failed to delete manufacturing orders.",
        confirmTitle: (count) =>
          `Delete ${count} manufacturing order${count !== 1 ? "s" : ""}?`,
        confirmDescription: () =>
          "Draft, completed, or cancelled orders will be soft-deleted and removed from normal views. Released orders must be cancelled first.",
      }}
    />
  );
}
