"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams } from "ag-grid-community";
import { Copy01Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DateTimeText } from "@/components/date-time-text";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import type { ColDef } from "@/components/erp-data-grid";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiJson } from "@/lib/client/api";
import { defaultStocktakeCopyName } from "@/lib/stocktake-names";
import type { CloneStocktake } from "@/lib/schemas/stocktakes";
import {
  STOCKTAKE_STATUS_COLUMN_TOOLTIP,
  STOCKTAKE_COUNTED_TOOLTIP,
  STOCKTAKE_ITEM_COUNT_TOOLTIP,
  STOCKTAKE_SCOPE_TOOLTIP,
  STOCKTAKE_VARIANCE_TOOLTIP,
} from "@/lib/tooltip-copy";
import { StocktakeStatusBadge } from "./status-badge";
import { CreateStocktakeDialog } from "./create-stocktake-dialog";
import { CloneStocktakeReasonDialog } from "./clone-stocktake-reason-dialog";
import { queryKeys } from "@/lib/client/query-keys";
import { openGeneratedPdf } from "@/lib/client/generated-pdf";
import {
  formatCloneSkippedItemsWarning,
  formatScope,
  type CloneStocktakeResult,
  type StocktakeListRow,
} from "./types";

const columns: ColDef<StocktakeListRow>[] = [
  {
    field: "name",
    headerName: "Name",
    width: 280,
    minWidth: 200,
    flex: 1.2,
    cellRenderer: ({ data }: ICellRendererParams<StocktakeListRow>) =>
      data ? (
        <Link href={`/inventory/stocktakes/${data.id}`} className="hover:underline">
          {data.name}
        </Link>
      ) : null,
  },
  {
    field: "scope",
    headerName: "Scope",
    headerTooltip: STOCKTAKE_SCOPE_TOOLTIP,
    width: 190,
    valueFormatter: ({ value }) => formatScope(value),
  },
  {
    field: "status",
    headerName: "Status",
    headerTooltip: STOCKTAKE_STATUS_COLUMN_TOOLTIP,
    width: 150,
    cellRenderer: ({ data }: ICellRendererParams<StocktakeListRow>) =>
      data ? <StocktakeStatusBadge status={data.status} /> : null,
  },
  {
    field: "itemCount",
    headerName: "Items",
    headerTooltip: STOCKTAKE_ITEM_COUNT_TOOLTIP,
    width: 120,
  },
  {
    colId: "countedCount",
    headerName: "Counted",
    headerTooltip: STOCKTAKE_COUNTED_TOOLTIP,
    width: 140,
    valueGetter: ({ data }) =>
      data ? `${data.countedCount} / ${data.itemCount}` : "",
    comparator: (_left, _right, leftNode, rightNode) =>
      (leftNode.data?.countedCount ?? 0) - (rightNode.data?.countedCount ?? 0),
  },
  {
    field: "varianceCount",
    headerName: "Variance",
    headerTooltip: STOCKTAKE_VARIANCE_TOOLTIP,
    width: 130,
  },
  {
    field: "createdAt",
    headerName: "Created",
    width: 190,
    cellRenderer: ({ data }: ICellRendererParams<StocktakeListRow>) =>
      data ? <DateTimeText value={data.createdAt} /> : null,
  },
  {
    field: "completedAt",
    headerName: "Completed",
    width: 190,
    cellRenderer: ({ data }: ICellRendererParams<StocktakeListRow>) =>
      data ? <DateTimeText value={data.completedAt} /> : null,
  },
  {
    colId: "actions",
    headerName: "",
    width: 54,
    minWidth: 48,
    maxWidth: 60,
    resizable: false,
    sortable: false,
    pinned: "right",
    cellRenderer: ({ data }: ICellRendererParams<StocktakeListRow>) =>
      data ? <StocktakeRowActions stocktake={data} /> : null,
    getQuickFilterText: () => "",
  },
];

export function StocktakesTable({ initialData }: { initialData: StocktakeListRow[] }) {
  const [pdfError, setPdfError] = useState<string | null>(null);
  const generatePdf = (
    rows: StocktakeListRow[],
    template: "count-sheet" | "reconciliation-report",
    disposition: "inline" | "attachment",
  ) => {
    setPdfError(null);
    void openGeneratedPdf(
      "/api/stocktakes/pdf",
      { ids: rows.map((row) => row.id), template },
      disposition,
    ).catch((error) => setPdfError(error instanceof Error ? error.message : "Failed to generate PDF."));
  };

  return (
    <ERPDataGridList
      rows={initialData}
      columns={columns}
      queryKey={queryKeys.stocktakes.root}
      queryEndpoint="/api/stocktakes"
      queryErrorMessage="Failed to fetch stocktakes"
      searchAriaLabel="Search stocktakes"
      actions={<CreateStocktakeDialog />}
      toolbarContent={pdfError ? <p role="alert" className="text-sm text-destructive">{pdfError}</p> : null}
      emptyMessage="No stocktakes yet."
      selectedActions={[
        {
          label: "Print selected count sheets",
          onSelect: (rows) => generatePdf(rows, "count-sheet", "inline"),
          disabled: (rows) => rows.some((row) => row.status === "completed"),
        },
        {
          label: "Download selected count sheets PDF",
          onSelect: (rows) => generatePdf(rows, "count-sheet", "attachment"),
          disabled: (rows) => rows.some((row) => row.status === "completed"),
        },
        {
          label: "Print selected reconciliation reports",
          onSelect: (rows) => generatePdf(rows, "reconciliation-report", "inline"),
          disabled: (rows) => rows.some((row) => row.status !== "completed"),
        },
        {
          label: "Download selected reconciliation PDF",
          onSelect: (rows) => generatePdf(rows, "reconciliation-report", "attachment"),
          disabled: (rows) => rows.some((row) => row.status !== "completed"),
        },
      ]}
      deleteAction={{
        endpoint: "/api/stocktakes",
        invalidateQueryKeys: [queryKeys.stocktakes.root],
        defaultErrorMessage: "Failed to delete stocktakes.",
        confirmTitle: (count) =>
          `Delete ${count} stocktake${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected draft stocktake${count !== 1 ? "s" : ""} will be removed from normal views. Completed stocktakes cannot be deleted.`,
        isRowSelectable: (row) => row.status === "draft",
      }}
    />
  );
}

function StocktakeRowActions({ stocktake }: { stocktake: StocktakeListRow }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const cloneMutation = useMutation({
    mutationFn: (input: CloneStocktake) =>
      apiJson<CloneStocktakeResult>(`/api/stocktakes/${stocktake.id}/clone`, {
        method: "POST",
        body: input,
        idempotencyKey: "stocktake-clone",
        fallbackError: "Failed to clone stocktake.",
      }),
    onSuccess: async (created) => {
      setCloneDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.stocktakes.root });
      const warning = formatCloneSkippedItemsWarning(created);
      if (warning) window.alert(warning);
      router.push(`/inventory/stocktakes/${created.id}`);
    },
  });

  return (
    <>
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
          className="bg-[var(--color-surface)] text-[var(--color-ink)]"
        >
          <DropdownMenuItem
            disabled={cloneMutation.isPending}
            onSelect={(event) => {
              event.preventDefault();
              setCloneDialogOpen(true);
            }}
          >
            <HugeiconsIcon icon={Copy01Icon} className="h-4 w-4" aria-hidden />
            {cloneMutation.isPending ? "Cloning..." : "Clone"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CloneStocktakeReasonDialog
        key={cloneDialogOpen ? defaultStocktakeCopyName(stocktake.name) : "closed"}
        open={cloneDialogOpen}
        pending={cloneMutation.isPending}
        defaultName={defaultStocktakeCopyName(stocktake.name)}
        onOpenChange={setCloneDialogOpen}
        onSubmit={(input) => cloneMutation.mutate(input)}
      />
    </>
  );
}
