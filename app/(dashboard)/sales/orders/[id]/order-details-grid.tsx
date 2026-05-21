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
import {
  DeliveryAddressInput,
  makeDeliveryAddressOption,
  normalizeDeliveryAddress,
  type DeliveryAddressFields,
  type DeliveryAddressOption,
} from "@/components/delivery-address-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
import { patchSalesOrderHeader } from "@/lib/api/clients/sales-orders";
import { formatDate } from "@/lib/format";
import type {
  CustomerOption,
  SalesAddressOption,
  SalesOrderDetail,
} from "@/app/(dashboard)/sales/types";
import type { PatchSalesOrderHeader } from "@/lib/schemas/sales-orders";
import type { OrderDraftController } from "./order-draft";
import cardStyles from "@/components/card-page/card-page.module.css";

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
        <div className={cardStyles.formRowFour}>
          <OrderNumberCell order={order} editable={editable} />
          <CustomerCell
            order={order}
            editable={editable}
            customerOptions={customerOptions}
          />
          <ProjectCell order={order} editable={editable} projects={customerProjects} />
          <DateCell
            editable={editable}
            field="orderDate"
            label="Order date"
            value={order.orderDate}
          />
        </div>
        <div className={cardStyles.formRowFour}>
          <DateCell
            editable={editable}
            field="requestedDate"
            label="Requested date"
            value={order.requestedDate}
          />
          <DateCell
            editable={editable}
            field="shipDate"
            label="Shipping date"
            value={order.shipDate}
          />
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

function OrderNumberCell({
  order,
  editable,
}: {
  order: SalesOrderDetail;
  editable: boolean;
}) {
  const { draft } = useContext(DetailsContext);
  const commit = useFieldCommit("orderNumber");
  const [value, setValue] = useState(order.orderNumber ?? "");

  if (!editable) {
    return (
      <CellShell label="Sales order #">
        <div className={`${cardStyles.readOnlyFieldValue} ${cardStyles.mono}`}>
          {order.orderNumber || "Assigned on save"}
        </div>
      </CellShell>
    );
  }

  return (
    <CellShell label="Sales order #">
      <Input
        value={value}
        placeholder="Assigned on save"
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          const next = value.trim() || null;
          if (next === (order.orderNumber || null)) return;
          if (draft) {
            draft.patchHeader({ orderNumber: next });
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
        className={`${cardStyles.underlineInput} ${cardStyles.mono}`}
      />
    </CellShell>
  );
}

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
    <CellShell label="Customer" required>
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
            inputClassName={cardStyles.underlineControl}
            createLinks={[{ href: "/sales/customer", label: "Create customer" }]}
          />
          {order.customerEmail ? (
            <div className={cardStyles.fieldMeta}>{order.customerEmail}</div>
          ) : null}
        </>
      ) : (
        <>
          <div className={cardStyles.readOnlyFieldValue}>{order.customerName}</div>
          {order.customerEmail ? (
            <div className={cardStyles.fieldMeta}>{order.customerEmail}</div>
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
          <div className={cardStyles.readOnlyFieldValue}>{order.customerProjectName}</div>
        ) : (
          <div className={cardStyles.readOnlyFieldValue}>No project</div>
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
        <SelectTrigger className={cardStyles.underlineControl}>
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
  editable,
  field,
  label,
  value,
}: {
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
          <div className={`${cardStyles.readOnlyFieldValue} ${cardStyles.mono}`}>{formatDate(value)}</div>
        ) : (
          <div className={cardStyles.readOnlyFieldValue}>—</div>
        )}
      </CellShell>
    );
  }

  return (
    <CellShell label={label}>
      <DatePicker
        value={value ?? ""}
        className={cardStyles.underlineControl}
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

function AddressCell({
  order,
  editable,
  addressOptions,
}: {
  order: SalesOrderDetail;
  editable: boolean;
  addressOptions: SalesAddressOption[];
}) {
  const { draft } = useContext(DetailsContext);
  const commitPatch = useHeaderPatchCommit("shipping-address");
  const currentAddress = normalizeDeliveryAddress({
    shipLine1: order.shipLine1,
    shipLine2: order.shipLine2,
    shipCity: order.shipCity,
    shipRegion: order.shipRegion,
    shipPostcode: order.shipPostcode,
    shipCountry: order.shipCountry,
  });
  const options = buildSalesShipAddressOptions(order, addressOptions);

  if (!editable) {
    const lines = [
      order.shipLine1,
      order.shipLine2,
      [order.shipCity, order.shipRegion, order.shipPostcode].filter(Boolean).join(", "),
      order.shipCountry,
    ].filter((line): line is string => Boolean(line && line.trim()));

    return (
      <CellShell label="Shipping address" span={3}>
        {lines.length > 0 ? (
          <div className={cardStyles.readOnlyAddress}>
            {lines.map((line, idx) => (
              <div key={idx}>{line}</div>
            ))}
          </div>
        ) : (
          <div className={cardStyles.readOnlyAddress}>
            No shipping address set
          </div>
        )}
      </CellShell>
    );
  }

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
    commitPatch(patch);
  };

  return (
    <CellShell label="Shipping address" span={3}>
      <DeliveryAddressInput
        id="sales-order-shipping-address"
        value={currentAddress}
        options={options}
        onChange={commitAddress}
        inputClassName={cardStyles.underlineControl}
      />
    </CellShell>
  );
}

// ============================================================================
// Shared helpers
// ============================================================================

function CellShell({
  label,
  span,
  required,
  children,
}: {
  label: string;
  span?: 1 | 2 | 3 | 4;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cardStyles.formField}
      style={span && span > 1 ? { gridColumn: `span ${span}` } : undefined}
    >
      <label className={cardStyles.formLabel}>
        {label}
        {required ? <span className={cardStyles.requiredMark}> *</span> : null}
      </label>
      {children}
    </div>
  );
}

type SalesShipAddressPatch = Pick<
  PatchSalesOrderHeader,
  "shipLine1" | "shipLine2" | "shipCity" | "shipRegion" | "shipPostcode" | "shipCountry"
>;

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

  const current = makeDeliveryAddressOption({
    shipLine1: order.shipLine1,
    shipLine2: order.shipLine2,
    shipCity: order.shipCity,
    shipRegion: order.shipRegion,
    shipPostcode: order.shipPostcode,
    shipCountry: order.shipCountry,
  });
  if (current && !options.has(current.id)) add(current);

  return [...options.values()];
}

function useHeaderPatchCommit(scope: string) {
  const { orderId } = useContext(DetailsContext);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: cardSaveMutationKey("sales-order", orderId, "header", scope),
    mutationFn: (patch: PatchSalesOrderHeader) =>
      patchSalesOrderHeader(orderId, patch),
    onSuccess: (next) => {
      queryClient.setQueryData(["sales-order", orderId], next);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-order", orderId] });
    },
  });
  return (patch: PatchSalesOrderHeader) => mutation.mutate(patch);
}

/** Live-mode per-field PATCH commit. In draft mode the cells short-circuit to
 *  the draft controller before calling this. */
function useFieldCommit<Field extends keyof PatchSalesOrderHeader>(field: Field) {
  const { orderId } = useContext(DetailsContext);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: cardSaveMutationKey("sales-order", orderId, "header", field),
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
