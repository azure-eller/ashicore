"use client";

import { createContext, useContext, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { EntityCombobox } from "@/components/entity-combobox";
import {
  DeliveryAddressInput,
  makeDeliveryAddressOption,
  normalizeDeliveryAddress,
  type DeliveryAddressFields,
  type DeliveryAddressOption,
} from "@/components/delivery-address-input";
import { patchSalesOrderHeader } from "@/lib/api/clients/sales-orders";
import type {
  CustomerOption,
  SalesOrderDetail,
} from "@/app/(dashboard)/sales/types";
import type { PatchSalesOrderHeader } from "@/lib/schemas/sales-orders";
import type { OrderDraftController } from "./order-draft";
import type { SalesAddressOption } from "./order-card";
import cardStyles from "@/components/card-page/card-page.module.css";
import styles from "./order-card.module.css";

export type OrderDetailsGridProps = {
  order: SalesOrderDetail;
  editable: boolean;
  customerOptions: CustomerOption[];
  addressOptions: SalesAddressOption[];
  draft?: OrderDraftController;
};

const NO_PROJECT_VALUE = "__no_project__";

type GridCtx = { orderId: string; draft?: OrderDraftController };
const DetailsContext = createContext<GridCtx>({ orderId: "" });

export function OrderDetailsGrid({
  order,
  editable,
  customerOptions,
  addressOptions,
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
          <AddressCell
            order={order}
            editable={editable}
            addressOptions={addressOptions}
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
  const commitPatch = useHeaderPatchCommit("customer");

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
                  ...customerDefaultShipAddressPatch(picked),
                });
                return;
              }
              const picked = customerOptions.find((c) => c.id === value);
              commitPatch({
                customerId: value,
                customerProjectId: null,
                ...customerDefaultShipAddressPatch(picked),
              });
            }}
            placeholder="Search customers…"
            emptyMessage="No customers found"
            createLinks={[{ href: "/sales/customer", label: "Create customer" }]}
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

function customerDefaultShipAddressPatch(
  customer: CustomerOption | undefined
): SalesShipAddressPatch {
  return salesAddressPatch(
    normalizeDeliveryAddress({
      shipLine1: customer?.shipLine1 ?? customer?.billingLine1 ?? null,
      shipLine2: customer?.shipLine2 ?? customer?.billingLine2 ?? null,
      shipCity: customer?.shipCity ?? customer?.billingCity ?? null,
      shipRegion: customer?.shipRegion ?? customer?.billingRegion ?? null,
      shipPostcode: customer?.shipPostcode ?? customer?.billingPostcode ?? null,
      shipCountry: customer?.shipCountry ?? customer?.billingCountry ?? null,
    })
  );
}

type SalesShipAddressPatch = Pick<
  PatchSalesOrderHeader,
  "shipLine1" | "shipLine2" | "shipCity" | "shipRegion" | "shipPostcode" | "shipCountry"
>;

function salesAddressPatch(address: DeliveryAddressFields): SalesShipAddressPatch {
  return {
    shipLine1: address.shipLine1 ?? null,
    shipLine2: address.shipLine2 ?? null,
    shipCity: address.shipCity ?? null,
    shipRegion: address.shipRegion ?? null,
    shipPostcode: address.shipPostcode ?? null,
    shipCountry: address.shipCountry ?? null,
  };
}

function buildSalesShipAddressOptions(
  order: SalesOrderDetail,
  addressOptions: SalesAddressOption[]
) {
  const options = new Map<string, DeliveryAddressOption>();
  const add = (option: DeliveryAddressOption | null) => {
    if (option) options.set(option.id, option);
  };

  for (const address of addressOptions) {
    add(
      makeDeliveryAddressOption(
        {
          shipLine1: address.line1,
          shipLine2: address.line2,
          shipCity: address.city,
          shipRegion: address.region,
          shipPostcode: address.postcode,
          shipCountry: address.country,
        },
        address.label,
        address.notes
      )
    );
  }

  const current = makeDeliveryAddressOption(
    {
      shipLine1: order.shipLine1,
      shipLine2: order.shipLine2,
      shipCity: order.shipCity,
      shipRegion: order.shipRegion,
      shipPostcode: order.shipPostcode,
      shipCountry: order.shipCountry,
    }
  );
  if (current && !options.has(current.id)) add(current);

  return [...options.values()];
}

function AddressCell({
  order,
  editable,
  addressOptions,
}: {
  order: SalesOrderDetail;
  editable: boolean;
  addressOptions: SalesAddressOption[];
}) {
  const { draft, orderId } = useContext(DetailsContext);
  const queryClient = useQueryClient();
  const addressMutation = useMutation({
    mutationKey: ["sales-order", orderId, "patch", "shipAddress"],
    mutationFn: (patch: SalesShipAddressPatch) =>
      patchSalesOrderHeader(orderId, patch),
    onSuccess: (next) => {
      queryClient.setQueryData(["sales-order", orderId], next);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-order", orderId] });
    },
  });

  const commitAddress = (address: DeliveryAddressFields | null) => {
    const patch = address
      ? salesAddressPatch(address)
      : {
          shipLine1: null,
          shipLine2: null,
          shipCity: null,
          shipRegion: null,
          shipPostcode: null,
          shipCountry: null,
        };
    if (draft) {
      draft.patchHeader(patch);
      return;
    }
    addressMutation.mutate(patch);
  };

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

  const currentAddress = normalizeDeliveryAddress({
    shipLine1: order.shipLine1,
    shipLine2: order.shipLine2,
    shipCity: order.shipCity,
    shipRegion: order.shipRegion,
    shipPostcode: order.shipPostcode,
    shipCountry: order.shipCountry,
  });
  const shipAddressOptions = buildSalesShipAddressOptions(
    order,
    addressOptions
  );

  return (
    <CellShell label="Ship to" span={2}>
      <div className="flex items-start gap-(--space-4)">
        <div className="min-w-0 flex-1">
          <DeliveryAddressInput
            id="sales-order-shipping-address"
            value={currentAddress}
            options={shipAddressOptions}
            onChange={commitAddress}
            inputClassName="h-(--height-input-sm) w-full text-[length:var(--text-sm)]"
          />
        </div>
        <label className="flex shrink-0 items-center gap-(--space-2) pt-(--space-2) text-[length:var(--text-sm)] text-foreground">
          <Checkbox checked disabled aria-label="Billing address is same as shipping address" />
          <span>Billing same as shipping</span>
        </label>
      </div>
    </CellShell>
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

function useHeaderPatchCommit(mutationLabel: string) {
  const { orderId } = useContext(DetailsContext);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["sales-order", orderId, "patch", mutationLabel],
    mutationFn: (patch: PatchSalesOrderHeader) => patchSalesOrderHeader(orderId, patch),
    onSuccess: (next) => {
      queryClient.setQueryData(["sales-order", orderId], next);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-order", orderId] });
    },
  });
  return (patch: PatchSalesOrderHeader) => mutation.mutate(patch);
}
