"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Add01Icon, Delete02Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { apiJson } from "@/lib/client/api";
import { ERPDataGrid, type ColDef } from "@/components/erp-data-grid";
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
  invalidateQueryKeys: readonly unknown[][];
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
  queryFn: () => Promise<TData[]>;
  searchAriaLabel: string;
  emptyMessage: string;
  addHref?: string;
  addAriaLabel?: string;
  toolbarContent?: ReactNode;
  actions?: ReactNode;
  deleteAction?: DeleteAction<TData>;
  selectedActions?: SelectedAction<TData>[];
  height?: string | number;
  className?: string;
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
  searchAriaLabel,
  emptyMessage,
  addHref,
  addAriaLabel,
  toolbarContent,
  actions,
  deleteAction,
  selectedActions,
  height,
  className,
}: ERPDataGridListProps<TData>) {
  const queryClient = useQueryClient();
  const [searchValue, setSearchValue] = useState("");
  const [selectedRows, setSelectedRows] = useState<TData[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { data = rows } = useQuery({
    queryKey,
    queryFn,
    initialData: rows,
  });
  const selectedCount = selectedRows.length;
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
                {selectedCount > 0 ? (
                  <span
                    aria-hidden
                    className="absolute -top-(--space-2) -right-(--space-2) flex h-(--space-8) min-w-(--space-8) items-center justify-center bg-primary px-(--space-1) font-mono text-[length:var(--text-2xs)] font-medium tabular-nums text-primary-foreground"
                  >
                    {selectedCount}
                  </span>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="bg-popover text-popover-foreground"
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
              setDeleteDialogOpen(true);
            }}
          >
            <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" aria-hidden />
            {selectedCount > 0 ? (
              <span
                aria-hidden
                className="absolute -top-(--space-2) -right-(--space-2) flex h-(--space-8) min-w-(--space-8) items-center justify-center bg-primary px-(--space-1) font-mono text-[length:var(--text-2xs)] font-medium tabular-nums text-primary-foreground"
              >
                {selectedCount}
              </span>
            ) : null}
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
        onSelectionChange={setSelectedRows}
        height={height}
        className={className}
      />
      {deleteAction ? (
        <AlertDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open);
            if (!open) {
              setDeleteError(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {deleteAction.confirmTitle(selectedCount)}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteAction.confirmDescription(selectedCount)}
              </AlertDialogDescription>
              {deleteError ? (
                <div
                  role="alert"
                  className="border border-destructive bg-[var(--color-danger-soft)] px-(--space-6) py-(--space-4) text-[length:var(--text-sm)] text-destructive"
                >
                  {deleteError}
                </div>
              ) : null}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteMutation.isPending || selectedCount === 0}
                onClick={(event) => {
                  event.preventDefault();
                  deleteMutation.mutate(selectedRows.map((row) => row.id));
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
