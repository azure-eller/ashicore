"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams } from "ag-grid-community";
import { Checkbox } from "@/components/ui/checkbox";
import { patchCustomerActivity } from "@/lib/api/clients/customers";
import { ERPDataGridList } from "@/components/erp-data-grid-list";
import type { ColDef } from "@/components/erp-data-grid";
import { SegmentedCountFilter } from "@/components/segmented-count-filter";
import { apiJson } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { CUSTOMER_CATEGORY_TOOLTIP } from "@/lib/tooltip-copy";
import {
  accountPriorityDots,
  accountPriorityOptions,
  accountStateDots,
  accountStateOptions,
  optionLabel,
  shortDayLabel,
} from "./customer-meta";
import type { CustomerRow } from "@/lib/sales/types";
import { queryKeys } from "@/lib/client/query-keys";

type CustomerView = "all" | "due";

export function CustomersTable({
  initialData,
  today,
}: {
  initialData: CustomerRow[];
  today: string;
}) {
  const [view, setView] = useState<CustomerView>("all");
  const queryClient = useQueryClient();
  const completeTask = useMutation({
    mutationFn: ({ customerId, taskId }: { customerId: string; taskId: string }) =>
      patchCustomerActivity(customerId, taskId, { status: "done" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.customers.root }),
  });
  const columns = useMemo<ColDef<CustomerRow>[]>(
    () => [
      {
        field: "name",
        headerName: "Name",
        width: 260,
        minWidth: 190,
        flex: 1.2,
        cellRenderer: ({ data }: ICellRendererParams<CustomerRow>) =>
          data ? (
            <Link href={`/sales/customers/${data.id}`} className="hover:underline">
              {data.name}
            </Link>
          ) : null,
      },
      {
        field: "nextTaskTitle",
        headerName: "Next action",
        width: 320,
        minWidth: 220,
        flex: 1.2,
        tooltipValueGetter: ({ data }) => data?.nextTaskTitle ?? "",
        cellRenderer: ({ data }: ICellRendererParams<CustomerRow>) => {
          if (!data?.nextTaskId || !data.nextTaskTitle) return "—";
          const due = data.nextTaskDueDate;
          const overdue = Boolean(due && due < today);
          const dueToday = due === today;
          return (
            <span className="flex min-w-0 items-center gap-(--space-3)">
              <Checkbox
                aria-label={`Complete "${data.nextTaskTitle}"`}
                checked={false}
                disabled={completeTask.isPending}
                onCheckedChange={() =>
                  completeTask.mutate({
                    customerId: data.id,
                    taskId: data.nextTaskId as string,
                  })
                }
              />
              <span className="min-w-0 truncate">{data.nextTaskTitle}</span>
              {due ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-(--space-3) font-mono text-[length:var(--text-2xs)]",
                    overdue
                      ? "border-transparent bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                      : dueToday
                        ? "border-transparent bg-[var(--color-warning-soft)] text-[var(--color-accent-ink)]"
                        : "border-[var(--color-line)] text-[var(--color-ink-faint)]"
                  )}
                >
                  {overdue
                    ? `Overdue · ${shortDayLabel(due)}`
                    : dueToday
                      ? "Today"
                      : shortDayLabel(due)}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        field: "accountState",
        headerName: "State",
        width: 130,
        cellRenderer: ({ value }: ICellRendererParams<CustomerRow>) => (
          <span className="flex items-center gap-(--space-3)">
            <span
              className={cn(
                "size-(--space-4) shrink-0 rounded-full",
                accountStateDots[value as string] ?? "bg-[var(--color-line)]"
              )}
            />
            {optionLabel(accountStateOptions, value as string)}
          </span>
        ),
      },
      {
        field: "accountPriority",
        headerName: "Priority",
        width: 130,
        cellRenderer: ({ value }: ICellRendererParams<CustomerRow>) => (
          <span className="flex items-center gap-(--space-3)">
            <span
              className={cn(
                "size-(--space-4) shrink-0 rounded-full",
                accountPriorityDots[value as string] ?? "bg-[var(--color-line)]"
              )}
            />
            {optionLabel(accountPriorityOptions, value as string)}
          </span>
        ),
      },
      {
        field: "customerCategoryName",
        headerName: "Category",
        headerTooltip: CUSTOMER_CATEGORY_TOOLTIP,
        width: 180,
        valueFormatter: ({ value }) => value ?? "Uncategorized",
      },
      {
        field: "email",
        headerName: "Email",
        width: 260,
        minWidth: 180,
        flex: 1,
        valueGetter: ({ data }) => data?.primaryContactEmail ?? data?.email ?? null,
        valueFormatter: ({ value }) => value ?? "—",
        tooltipValueGetter: ({ data }) => data?.primaryContactEmail ?? data?.email ?? "",
      },
      {
        field: "phone",
        headerName: "Phone",
        width: 160,
        valueGetter: ({ data }) => data?.primaryContactPhone ?? data?.phone ?? null,
        valueFormatter: ({ value }) => value ?? "—",
      },
    ],
    [completeTask, today]
  );
  const filteredRows = useMemo(
    () => filterCustomersForView(initialData, view, today),
    [initialData, today, view]
  );
  const dueCount = useMemo(
    () => initialData.filter((row) => hasDueTask(row, today)).length,
    [initialData, today]
  );

  return (
    <ERPDataGridList
      rows={filteredRows}
      columns={columns}
      queryKey={queryKeys.customers.list(view)}
      queryFn={async () => {
        const rows = await apiJson<CustomerRow[]>("/api/customers");
        return filterCustomersForView(rows, view, today);
      }}
      queryErrorMessage="Failed to fetch customers"
      searchAriaLabel="Search customers"
      addHref="/sales/customer"
      addAriaLabel="New Customer"
      emptyMessage="No customers yet."
      toolbarContent={
        <SegmentedCountFilter
          value={view}
          ariaLabel="Customer task view"
          options={[
            {
              value: "all",
              label: "All",
              count: initialData.length,
              ariaLabel: "Show all customers",
            },
            {
              value: "due",
              label: "Due",
              count: dueCount,
              ariaLabel: "Show customers with a task due today or overdue",
            },
          ]}
          onValueChange={(value) => setView(value || "all")}
        />
      }
      deleteAction={{
        endpoint: "/api/customers",
        invalidateQueryKeys: [queryKeys.customers.root],
        defaultErrorMessage: "Failed to delete customer.",
        confirmTitle: (count) =>
          `Delete ${count} customer${count !== 1 ? "s" : ""}?`,
        confirmDescription: (count) =>
          `The selected customer${count !== 1 ? "s" : ""} will be soft-deleted. Existing sales orders keep their customer snapshot.`,
      }}
    />
  );
}

function filterCustomersForView(
  rows: CustomerRow[],
  view: CustomerView,
  today: string
) {
  if (view === "due") {
    return rows.filter((row) => hasDueTask(row, today));
  }
  return rows;
}

function hasDueTask(row: CustomerRow, today: string) {
  return Boolean(row.nextTaskDueDate && row.nextTaskDueDate <= today);
}
