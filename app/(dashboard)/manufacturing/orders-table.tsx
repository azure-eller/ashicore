"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { FilterableHeader, multiValueFilter } from "@/components/filterable-header";
import { SortableHeader } from "@/components/sortable-header";
import { TooltipHeader } from "@/components/tooltip-header";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatQuantity } from "@/lib/format";
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
      <span className="shrink-0">{formatQuantity(order.plannedQuantity)}</span>
      <Badge variant="secondary" className="text-xs font-normal">
        {order.unitName}
      </Badge>
      {batchLabel != null && (
        <Badge variant="outline" className="text-xs font-normal">
          {batchLabel}
        </Badge>
      )}
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
        ? `${formatQuantity(row.original.actualQuantity)} ${row.original.unitName}`
        : "\u2014",
  },
  {
    accessorKey: "plannedDate",
    header: ({ column }) => <SortableHeader column={column} label="Planned Date" />,
    cell: ({ row }) => formatDate(row.original.plannedDate),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <FilterableHeader
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
    cell: ({ row }) => formatDate(row.original.completedAt),
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
