"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Add01Icon, Delete02Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { apiJson } from "@/lib/client/api";
import { ERPDataGrid, type ColDef } from "@/components/erp-data-grid";
import { Panel } from "@/components/panel";
import { SelectionCountBadge } from "@/components/selection-count-badge";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SelectedActionHelpers = {
  clearSelection: () => void;
};

type SelectedAction<TData extends { id: string }> = {
  label: string;
  onSelect: (rows: TData[], helpers: SelectedActionHelpers) => void;
  disabled?: boolean | ((rows: TData[]) => boolean);
  isPending?: boolean;
  variant?: "default" | "destructive";
};

type DeleteAction<TData extends { id: string }> = {
  endpoint: string;
  invalidateQueryKeys: readonly (readonly unknown[])[];
  defaultErrorMessage: string;
  confirmTitle: (count: number) => string;
  confirmDescription: (count: number) => string;
  idempotencyKey?: string;
  isRowSelectable?: (row: TData) => boolean;
};

type ERPDataGridListProps<TData extends { id: string }> = {
  rows: TData[];
  columns: ColDef<TData>[];
  queryKey: readonly unknown[];
  queryFn?: () => Promise<TData[]>;
  queryEndpoint?: string;
  queryErrorMessage?: string;
  searchAriaLabel: string;
  emptyMessage: string;
  addHref?: string;
  addAriaLabel?: string;
  toolbarContent?: ReactNode;
  actions?: ReactNode;
  deleteAction?: DeleteAction<TData>;
  selectedActions?: SelectedAction<TData>[];
  height?: string | number;
  gridClassName?: string;
  className?: string;
  fillViewport?: boolean;
};

export function ERPDataGridList<TData extends { id: string }>({
  ...props
}: ERPDataGridListProps<TData>) {
  return <ERPDataGridListInner {...props} />;
}

function ERPDataGridListInner<TData extends { id: string }>({
  rows,
  columns,
  queryKey,
  queryFn,
  queryEndpoint,
  queryErrorMessage,
  searchAriaLabel,
  emptyMessage,
  addHref,
  addAriaLabel,
  toolbarContent,
  actions,
  deleteAction,
  selectedActions,
  height,
  gridClassName,
  className,
  fillViewport = true,
}: ERPDataGridListProps<TData>) {
  const queryClient = useQueryClient();
  const [searchValue, setSearchValue] = useState("");
  const [selectedRows, setSelectedRows] = useState<TData[]>([]);
  const selectedRowsRef = useRef<TData[]>([]);
  const [deleteRows, setDeleteRows] = useState<TData[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const resolvedQueryFn = useMemo(() => {
    if (queryFn) return queryFn;

    return () => {
      if (!queryEndpoint) {
        throw new Error("ERPDataGridList requires queryFn or queryEndpoint.");
      }

      return apiJson<TData[]>(queryEndpoint, {
        fallbackError: queryErrorMessage ?? "Failed to fetch rows.",
      });
    };
  }, [queryEndpoint, queryErrorMessage, queryFn]);
  const { data = rows } = useQuery({
    queryKey,
    queryFn: resolvedQueryFn,
    initialData: rows,
  });
  const selectedCount = selectedRows.length;
  const deleteCount = deleteRows.length;
  const selectionActions = useMemo(() => selectedActions ?? [], [selectedActions]);
  const hasSelectionMenu = selectionActions.length > 0;
  const anySelectionActionPending = selectionActions.some((action) => action.isPending);
  const allSelectionActionsDisabled =
    selectionActions.length > 0 &&
    selectionActions.every((action) =>
      typeof action.disabled === "function"
        ? action.disabled(selectedRows)
        : action.disabled === true
    );
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!deleteAction) return;

      await apiJson<void>(deleteAction.endpoint, {
        method: "DELETE",
        body: { ids },
        idempotencyKey: deleteAction.idempotencyKey ?? `${String(queryKey[0])}-delete`,
        fallbackError: deleteAction.defaultErrorMessage,
      });
    },
    onMutate: () => {
      setDeleteError(null);
    },
    onSuccess: async () => {
      if (!deleteAction) return;

      await Promise.all(
        deleteAction.invalidateQueryKeys.map((key) =>
          queryClient.invalidateQueries({ queryKey: key })
        )
      );
      setSelectedRows([]);
      setDeleteRows([]);
      setDeleteDialogOpen(false);
    },
    onError: (error) => {
      setDeleteError(
        error instanceof Error
          ? error.message
          : deleteAction?.defaultErrorMessage ?? "Delete failed."
      );
    },
  });
  const clearSelection = () => setSelectedRows([]);
  const gridActions = useMemo(
    () => (
      <>
        {hasSelectionMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={
                  selectedCount === 0 ||
                  deleteMutation.isPending ||
                  anySelectionActionPending ||
                  allSelectionActionsDisabled
                }
                className="relative"
                aria-label={
                  selectedCount > 0
                    ? `Actions (${selectedCount} selected)`
                    : "Actions"
                }
              >
                <HugeiconsIcon icon={MoreVerticalIcon} className="h-4 w-4" aria-hidden />
                <SelectionCountBadge count={selectedCount} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="bg-[var(--color-surface)] text-[var(--color-ink)]"
            >
              {selectionActions.map((action) => {
                const disabled =
                  typeof action.disabled === "function"
                    ? action.disabled(selectedRows)
                    : action.disabled === true;

                return (
                  <DropdownMenuItem
                    key={action.label}
                    variant={
                      action.variant === "destructive" ? "destructive" : undefined
                    }
                    disabled={disabled}
                    onClick={() =>
                      action.onSelect(selectedRows, {
                        clearSelection,
                      })
                    }
                  >
                    {action.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {deleteAction ? (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            disabled={selectedCount === 0 || deleteMutation.isPending}
            className="relative"
            aria-label={
              selectedCount > 0
                ? `Delete ${selectedCount} selected`
                : "Delete selected"
            }
            onClick={() => {
              setDeleteError(null);
              setDeleteRows(selectedRowsRef.current);
              setDeleteDialogOpen(true);
            }}
          >
            <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" aria-hidden />
            <SelectionCountBadge count={selectedCount} />
          </Button>
        ) : null}
        {actions}
        {addHref ? (
          <Button asChild aria-label={addAriaLabel}>
            <Link href={addHref}>
              <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
              {addAriaLabel ?? "New"}
            </Link>
          </Button>
        ) : null}
      </>
    ),
    [
      actions,
      addAriaLabel,
      addHref,
      allSelectionActionsDisabled,
      anySelectionActionPending,
      deleteAction,
      deleteMutation.isPending,
      hasSelectionMenu,
      selectedRows,
      selectionActions,
      selectedCount,
    ]
  );

  return (
    <>
      <ERPDataGrid
        rows={data}
        columns={columns}
        searchAriaLabel={searchAriaLabel}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        emptyMessage={emptyMessage}
        toolbarContent={toolbarContent}
        actions={gridActions}
        enableRowSelection={Boolean(deleteAction) || selectionActions.length > 0}
        isRowSelectable={deleteAction?.isRowSelectable}
        onSelectionChange={(rows) => {
          selectedRowsRef.current = rows;
          setSelectedRows(rows);
        }}
        height={height ?? (fillViewport ? "100%" : undefined)}
        className={cn(
          fillViewport &&
            "flex h-[calc(100dvh_-_var(--height-nav)_-_var(--height-subnav))] min-h-0 flex-col gap-(--space-7) bg-[var(--color-bg)]",
          className,
        )}
        gridClassName={cn(fillViewport && "min-h-0 flex-1", gridClassName)}
      />
      {deleteAction ? (
        <AlertDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open);
            if (!open) {
              setDeleteError(null);
              setDeleteRows([]);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {deleteAction.confirmTitle(deleteCount)}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteAction.confirmDescription(deleteCount)}
              </AlertDialogDescription>
              {deleteError ? (
                <Panel
                  role="alert"
                  tone="destructive"
                  padding="sm"
                  className="text-[length:var(--text-sm)] text-[var(--status-danger-ink)]"
                >
                  {deleteError}
                </Panel>
              ) : null}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="danger"
                disabled={deleteMutation.isPending || deleteCount === 0}
                onClick={(event) => {
                  event.preventDefault();
                  deleteMutation.mutate(deleteRows.map((row) => row.id));
                }}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
