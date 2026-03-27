"use client";

import Link from "next/link";
import { useState } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { SortableHeader } from "@/components/sortable-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { StocktakeStatusBadge } from "./status-badge";
import { formatScope, type StocktakeListRow } from "./types";

const columns: ColumnDef<StocktakeListRow>[] = [
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
    header: ({ column }) => <SortableHeader column={column} label="Scope" />,
    cell: ({ row }) => formatScope(row.original.scope),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StocktakeStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "itemCount",
    header: ({ column }) => <SortableHeader column={column} label="Items" />,
  },
  {
    accessorKey: "countedCount",
    header: ({ column }) => <SortableHeader column={column} label="Counted" />,
    cell: ({ row }) =>
      `${row.original.countedCount} / ${row.original.itemCount}`,
  },
  {
    accessorKey: "varianceCount",
    header: ({ column }) => <SortableHeader column={column} label="Variance" />,
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => <SortableHeader column={column} label="Created" />,
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
  {
    accessorKey: "completedAt",
    header: ({ column }) => <SortableHeader column={column} label="Completed" />,
    cell: ({ row }) => formatDate(row.original.completedAt),
  },
];

export function StocktakesTable({ initialData }: { initialData: StocktakeListRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const { data = initialData } = useQuery<StocktakeListRow[]>({
    queryKey: ["stocktakes"],
    queryFn: async () => {
      const response = await fetch("/api/stocktakes");
      if (!response.ok) {
        throw new Error("Failed to fetch stocktakes");
      }
      return response.json();
    },
    initialData,
    initialDataUpdatedAt: 0,
  });

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      globalFilter,
    },
  });

  return (
    <div className="w-full">
      <div className="flex items-center justify-between py-4">
        <Input
          placeholder="Search..."
          aria-label="Search stocktakes"
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          className="max-w-sm"
        />

        <Button variant="default" size="icon" aria-label="Add stocktake" asChild>
          <Link href="/inventory/stocktakes/new">
            <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {globalFilter
                    ? `No results for "${globalFilter}"`
                    : "No stocktakes yet."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
