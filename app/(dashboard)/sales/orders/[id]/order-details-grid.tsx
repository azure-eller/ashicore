"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntityCombobox } from "@/components/entity-combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { patchSalesOrderHeader } from "@/lib/api/clients/sales-orders";
import { formatDate } from "@/lib/format";
import type {
  CustomerOption,
  SalesOrderDetail,
} from "@/app/(dashboard)/sales/types";
import type { PatchSalesOrderHeader } from "@/lib/schemas/sales-orders";
import type { OrderDraftController } from "./order-draft";
import cardStyles from "@/components/card-page/card-page.module.css";
import styles from "./order-card.module.css";

export type OrderDetailsGridProps = {
  order: SalesOrderDetail;
  editable: boolean;
  customerOptions: CustomerOption[];
  draft?: OrderDraftController;
};

const NO_PROJECT_VALUE = "__no_project__";

type GridCtx = { orderId: string; draft?: OrderDraftController };
const DetailsContext = createContext<GridCtx>({ orderId: "" });

export function OrderDetailsGrid({
  order,
  editable,
  customerOptions,
  draft,
}: OrderDetailsGridProps) {
  const customerProjects = useMemo(() => {
    const customer = customerOptions.find((c) => c.id === order.customerId);
    return customer?.projects ?? [];
  }, [customerOptions, order.customerId]);

  return (
    <DetailsContext.Provider value={{ orderId: order.id, draft }}>
      <section className={cardStyles.section}>
        <h2 className={cardStyles.sectionHeading}>Order details</h2>
        <div className={styles.detailsGrid}>
          <CustomerCell
            order={order}
            editable={editable}
            customerOptions={customerOptions}
          />
          <ProjectCell order={order} editable={editable} projects={customerProjects} />
          <DateCell
            order={order}
            editable={editable}
            field="orderDate"
            label="Order date"
            value={order.orderDate}
          />
          <AddressCell order={order} editable={editable} />
          <DateCell
            order={order}
            editable={editable}
            field="shipDate"
            label="Shipping date"
            value={order.shipDate}
          />
          <DateCell
            order={order}
            editable={editable}
            field="requestedDate"
            label="Requested date"
            value={order.requestedDate}
          />
        </div>
      </section>
    </DetailsContext.Provider>
  );
}

// ============================================================================
// Cells
// ============================================================================

function CustomerCell({
  order,
  editable,
  customerOptions,
}: {
  order: SalesOrderDetail;
  editable: boolean;
  customerOptions: CustomerOption[];
}) {
  const { draft } = useContext(DetailsContext);
  const commit = useFieldCommit("customerId");

  return (
    <CellShell label="Customer" span={2}>
      {editable ? (
        <>
          <EntityCombobox
            options={customerOptions}
            value={order.customerId}
            onValueChange={(value) => {
              if (!value || value === order.customerId) return;
              if (draft) {
                const picked = customerOptions.find((c) => c.id === value);
                draft.patchHeader({
                  customerId: value,
                  customerName: picked?.name ?? "",
                  customerProjectId: null,
                  customerProjectName: null,
                });
                return;
              }
              commit(value);
            }}
            placeholder="Search customers…"
            emptyMessage="No customers found"
            createLinks={[{ href: "/sales/customers/new", label: "Create customer" }]}
          />
          {order.customerEmail ? (
            <div className={styles.detailsCellSub}>{order.customerEmail}</div>
          ) : null}
        </>
      ) : (
        <>
          <div className={styles.detailsCellValue}>{order.customerName}</div>
          {order.customerEmail ? (
            <div className={styles.detailsCellSub}>{order.customerEmail}</div>
          ) : null}
        </>
      )}
    </CellShell>
  );
}

function ProjectCell({
  order,
  editable,
  projects,
}: {
  order: SalesOrderDetail;
  editable: boolean;
  projects: CustomerOption["projects"];
}) {
  const { draft } = useContext(DetailsContext);
  const commit = useFieldCommit("customerProjectId");
  const selected = order.customerProjectId ?? NO_PROJECT_VALUE;

  if (!editable) {
    return (
      <CellShell label="Project / Job">
        {order.customerProjectName ? (
          <div className={styles.detailsCellValue}>{order.customerProjectName}</div>
        ) : (
          <div className={`${styles.detailsCellValue} ${styles.detailsCellPlaceholder}`}>—</div>
        )}
      </CellShell>
    );
  }

  return (
    <CellShell label="Project / Job">
      <Select
        key={`${order.customerId}-${selected}`}
        value={selected}
        onValueChange={(value) => {
          const next = value === NO_PROJECT_VALUE ? null : value;
          if (next === order.customerProjectId) return;
          if (draft) {
            const name = projects.find((p) => p.id === next)?.name ?? null;
            draft.patchHeader({ customerProjectId: next, customerProjectName: name });
            return;
          }
          commit(next);
        }}
        disabled={projects.length === 0}
      >
        <SelectTrigger className="h-(--height-input-sm) text-[length:var(--text-sm)]">
          <SelectValue placeholder={projects.length === 0 ? "No projects" : "No project"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_PROJECT_VALUE}>No project</SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </CellShell>
  );
}

function DateCell({
  order,
  editable,
  field,
  label,
  value,
}: {
  order: SalesOrderDetail;
  editable: boolean;
  field: "orderDate" | "shipDate" | "requestedDate";
  label: string;
  value: string | null;
}) {
  const { draft } = useContext(DetailsContext);
  const commit = useFieldCommit(field);

  if (!editable) {
    return (
      <CellShell label={label}>
        {value ? (
          <div className={`${styles.detailsCellValue} ${cardStyles.mono}`}>{formatDate(value)}</div>
        ) : (
          <div className={`${styles.detailsCellValue} ${styles.detailsCellPlaceholder}`}>—</div>
        )}
      </CellShell>
    );
  }

  return (
    <CellShell label={label}>
      <DatePicker
        value={value ?? ""}
        onChange={(next) => {
          const normalized = field === "orderDate" ? next || "" : next || null;
          if (field === "orderDate" && !normalized) return;
          if (normalized === (value ?? (field === "orderDate" ? "" : null))) return;
          if (draft) {
            draft.patchHeader({ [field]: normalized } as PatchSalesOrderHeader);
            return;
          }
          commit(normalized);
        }}
      />
    </CellShell>
  );
}

function AddressCell({ order, editable }: { order: SalesOrderDetail; editable: boolean }) {
  if (!editable) {
    const lines = [
      order.shipLine1,
      order.shipLine2,
      [order.shipCity, order.shipRegion, order.shipPostcode].filter(Boolean).join(", "),
      order.shipCountry,
    ].filter((line): line is string => Boolean(line && line.trim()));

    return (
      <CellShell label="Ship to" span={2}>
        {lines.length > 0 ? (
          <div
            className={styles.detailsCellValue}
            style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}
          >
            {lines.map((line, idx) => (
              <span key={idx}>{line}</span>
            ))}
          </div>
        ) : (
          <div className={`${styles.detailsCellValue} ${styles.detailsCellPlaceholder}`}>
            No shipping address set
          </div>
        )}
      </CellShell>
    );
  }

  return (
    <CellShell label="Ship to" span={2}>
      <div className="grid grid-cols-1 gap-(--space-2) sm:grid-cols-2">
        <AddressInputField order={order} field="shipLine1" placeholder="Address line 1" />
        <AddressInputField order={order} field="shipLine2" placeholder="Address line 2" />
        <AddressInputField order={order} field="shipCity" placeholder="City" />
        <AddressInputField order={order} field="shipRegion" placeholder="State / region" />
        <AddressInputField order={order} field="shipPostcode" placeholder="Postcode" />
        <AddressInputField order={order} field="shipCountry" placeholder="Country" />
      </div>
    </CellShell>
  );
}

function AddressInputField({
  order,
  field,
  placeholder,
}: {
  order: SalesOrderDetail;
  field: "shipLine1" | "shipLine2" | "shipCity" | "shipRegion" | "shipPostcode" | "shipCountry";
  placeholder: string;
}) {
  const { draft } = useContext(DetailsContext);
  const initial = order[field] ?? "";
  const commit = useFieldCommit(field);
  const [draftValue, setDraftValue] = useState(initial);

  return (
    <Input
      value={draftValue}
      placeholder={placeholder}
      onChange={(event) => setDraftValue(event.target.value)}
      onBlur={() => {
        const trimmed = draftValue.trim();
        const next = trimmed === "" ? null : trimmed;
        if (next === (order[field] ?? null)) return;
        if (draft) {
          draft.patchHeader({ [field]: next } as PatchSalesOrderHeader);
          return;
        }
        commit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      className="h-(--height-input-sm) text-[length:var(--text-sm)]"
    />
  );
}

// ============================================================================
// Shared helpers
// ============================================================================

function CellShell({
  label,
  span,
  children,
}: {
  label: string;
  span?: 1 | 2;
  children: React.ReactNode;
}) {
  const className = [styles.detailsCell, span === 2 ? styles.detailsCellSpan2 : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className}>
      <div className={styles.detailsCellLabel}>{label}</div>
      {children}
    </div>
  );
}

/** Live-mode per-field PATCH commit. In draft mode the cells short-circuit to
 *  the draft controller before calling this. */
function useFieldCommit<Field extends keyof PatchSalesOrderHeader>(field: Field) {
  const { orderId } = useContext(DetailsContext);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["sales-order", orderId, "patch", field],
    mutationFn: (value: PatchSalesOrderHeader[Field]) =>
      patchSalesOrderHeader(orderId, { [field]: value } as PatchSalesOrderHeader),
    onSuccess: (next) => {
      queryClient.setQueryData(["sales-order", orderId], next);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-order", orderId] });
    },
  });
  return (value: PatchSalesOrderHeader[Field]) => mutation.mutate(value);
}
