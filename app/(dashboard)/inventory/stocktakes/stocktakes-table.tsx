"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy01Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { FilterableHeader, multiValueFilter } from "@/components/filterable-header";
import { SortableHeader } from "@/components/sortable-header";
import { DashboardDataTable } from "@/components/dashboard-data-table";
import { DateTimeText } from "@/components/date-time-text";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiJson } from "@/lib/client/api";
import {
  STOCKTAKE_STATUS_COLUMN_TOOLTIP,
  STOCKTAKE_COUNTED_TOOLTIP,
  STOCKTAKE_ITEM_COUNT_TOOLTIP,
  STOCKTAKE_SCOPE_TOOLTIP,
  STOCKTAKE_VARIANCE_TOOLTIP,
} from "@/lib/tooltip-copy";
import { StocktakeStatusBadge } from "./status-badge";
import { formatScope, type StocktakeListRow } from "./types";

const columns: ColumnDef<StocktakeListRow>[] = [
  {
    id: "select",
    header: ({ table }) => {
      const canSelectAny = table
        .getPaginationRowModel()
        .flatRows.some((row) => row.getCanSelect());

      return (
        <Checkbox
          checked={
            canSelectAny &&
            (table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate"))
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all draft stocktakes"
          disabled={!canSelectAny}
        />
      );
    },
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label={`Select ${row.original.name}`}
        disabled={!row.getCanSelect()}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column} label="Name" />,
    cell: ({ row }) => (
      <Link href={`/inventory/stocktakes/${row.original.id}`} className="hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "scope",
    header: ({ column }) => (
      <SortableHeader column={column} label="Scope" tooltip={STOCKTAKE_SCOPE_TOOLTIP} />
    ),
    cell: ({ row }) => formatScope(row.original.scope),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <FilterableHeader
        column={column}
        label="Status"
        tooltip={STOCKTAKE_STATUS_COLUMN_TOOLTIP}
      />
    ),
    filterFn: multiValueFilter,
    cell: ({ row }) => <StocktakeStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "itemCount",
    header: ({ column }) => (
      <SortableHeader column={column} label="Items" tooltip={STOCKTAKE_ITEM_COUNT_TOOLTIP} />
    ),
  },
  {
    accessorKey: "countedCount",
    header: ({ column }) => (
      <SortableHeader column={column} label="Counted" tooltip={STOCKTAKE_COUNTED_TOOLTIP} />
    ),
    cell: ({ row }) =>
      `${row.original.countedCount} / ${row.original.itemCount}`,
  },
  {
    accessorKey: "varianceCount",
    header: ({ column }) => (
      <SortableHeader column={column} label="Variance" tooltip={STOCKTAKE_VARIANCE_TOOLTIP} />
    ),
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => <SortableHeader column={column} label="Created" />,
    cell: ({ row }) => <DateTimeText value={row.original.createdAt} />,
  },
  {
    accessorKey: "completedAt",
    header: ({ column }) => <SortableHeader column={column} label="Completed" />,
    cell: ({ row }) => <DateTimeText value={row.original.completedAt} />,
  },
  {
    id: "actions",
    cell: ({ row }) => <StocktakeRowActions stocktake={row.original} />,
    enableSorting: false,
    enableHiding: false,
    size: 40,
    minSize: 40,
    maxSize: 48,
    enableResizing: false,
  },
];

export function StocktakesTable({ initialData }: { initialData: StocktakeListRow[] }) {
  return (
    <DashboardDataTable
      columns={columns}
      initialData={initialData}
      queryKey={["stocktakes"]}
      queryFn={async () => {
        const response = await fetch("/api/stocktakes");
        if (!response.ok) {
          throw new Error("Failed to fetch stocktakes");
        }

        return response.json();
      }}
      enableRowSelection={(row) => row.original.status === "draft"}
      searchAriaLabel="Search stocktakes"
      addHref="/inventory/stocktakes/new"
      addAriaLabel="New Stocktake"
      emptyMessage="No stocktakes yet."
      deleteAction={{
        endpoint: "/api/stocktakes",
        invalidateQueryKeys: [["stocktakes"]],
        defaultErrorMessage: "Failed to delete stocktakes.",
        confirmTitle: (count) =>
          `Delete ${count} stocktake${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected draft stocktake${count !== 1 ? "s" : ""} will be cancelled. Only draft stocktakes can be deleted.`,
      }}
    />
  );
}

function StocktakeRowActions({ stocktake }: { stocktake: StocktakeListRow }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const cloneMutation = useMutation({
    mutationFn: () =>
      apiJson<{ id: string }>(`/api/stocktakes/${stocktake.id}/clone`, {
        method: "POST",
        idempotencyKey: "stocktake-clone",
        fallbackError: "Failed to clone stocktake.",
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["stocktakes"] });
      router.push(`/inventory/stocktakes/${created.id}`);
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`More actions for ${stocktake.name}`}
        >
          <HugeiconsIcon icon={MoreVerticalIcon} className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="bg-popover text-popover-foreground"
      >
        <DropdownMenuItem
          disabled={cloneMutation.isPending}
          onSelect={(event) => {
            event.preventDefault();
            cloneMutation.mutate();
          }}
        >
          <HugeiconsIcon icon={Copy01Icon} className="h-4 w-4" aria-hidden />
          {cloneMutation.isPending ? "Cloning..." : "Clone"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
