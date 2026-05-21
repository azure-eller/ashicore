"use client";

import { createContext, useContext, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntityCombobox } from "@/components/entity-combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { patchSalesOrderHeader } from "@/lib/api/clients/sales-orders";
import { formatAddressLines, formatDate, normalizeAddressFields } from "@/lib/format";
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
          <DateCell
            editable={editable}
            field="orderDate"
            label="Order date"
            value={order.orderDate}
          />
          <AddressCell
            order={order}
            editable={editable}
            customerOptions={customerOptions}
            addressOptions={addressOptions}
          />
          <DateCell
            editable={editable}
            field="shipDate"
            label="Ship date"
            value={order.shipDate}
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
  editable,
  field,
  label,
  value,
}: {
  editable: boolean;
  field: "orderDate" | "shipDate";
  label: string;
  value: string | null;
}) {
  const { draft } = useContext(DetailsContext);
  const commit = useFieldCommit(field);
  const commitPatch = useHeaderPatchCommit(field);

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
          if (field === "shipDate") {
            const patch = { shipDate: normalized, requestedDate: normalized };
            if (draft) {
              draft.patchHeader(patch);
              return;
            }
            commitPatch(patch);
            return;
          }
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

type SalesShipAddressFields = Pick<
  PatchSalesOrderHeader,
  "shipLine1" | "shipLine2" | "shipCity" | "shipRegion" | "shipPostcode" | "shipCountry"
>;

type SalesShipAddressOption = SalesShipAddressFields & {
  id: string;
  label: string;
  source: "address_book" | "customer_shipping" | "customer_billing" | "current";
};

const CLEAR_SHIP_ADDRESS_VALUE = "__clear_ship_address__";

function normalizeSalesShipAddress(
  address: Partial<SalesShipAddressFields> | null | undefined
): SalesShipAddressFields {
  const normalized = normalizeAddressFields({
    line1: address?.shipLine1,
    line2: address?.shipLine2,
    city: address?.shipCity,
    region: address?.shipRegion,
    postcode: address?.shipPostcode,
    country: address?.shipCountry,
  });

  return {
    shipLine1: normalized.line1,
    shipLine2: normalized.line2,
    shipCity: normalized.city,
    shipRegion: normalized.region,
    shipPostcode: normalized.postcode,
    shipCountry: normalized.country,
  };
}

function salesShipAddressKey(address: Partial<SalesShipAddressFields> | null | undefined) {
  const normalized = normalizeSalesShipAddress(address);
  return [
    normalized.shipLine1,
    normalized.shipLine2,
    normalized.shipCity,
    normalized.shipRegion,
    normalized.shipPostcode,
    normalized.shipCountry,
  ]
    .map((part) => part ?? "")
    .join("\u001f")
    .replace(/^\u001f+|\u001f+$/g, "");
}

function salesShipAddressLabel(address: Partial<SalesShipAddressFields>) {
  return formatAddressLines({
    line1: address.shipLine1,
    line2: address.shipLine2,
    city: address.shipCity,
    region: address.shipRegion,
    postcode: address.shipPostcode,
    country: address.shipCountry,
  }).join(", ");
}

function makeSalesShipAddressOption(
  address: Partial<SalesShipAddressFields>,
  label: string | null | undefined,
  source: SalesShipAddressOption["source"]
): SalesShipAddressOption | null {
  const normalized = normalizeSalesShipAddress(address);
  const key = salesShipAddressKey(normalized);
  if (!key) return null;

  return {
    ...normalized,
    id: `${source}:${encodeURIComponent(key)}`,
    label: label?.trim() || salesShipAddressLabel(normalized),
    source,
  };
}

function customerDefaultShipAddressPatch(
  customer: CustomerOption | undefined
): SalesShipAddressFields {
  return normalizeSalesShipAddress({
    shipLine1: customer?.shipLine1 ?? customer?.billingLine1 ?? null,
    shipLine2: customer?.shipLine2 ?? customer?.billingLine2 ?? null,
    shipCity: customer?.shipCity ?? customer?.billingCity ?? null,
    shipRegion: customer?.shipRegion ?? customer?.billingRegion ?? null,
    shipPostcode: customer?.shipPostcode ?? customer?.billingPostcode ?? null,
    shipCountry: customer?.shipCountry ?? customer?.billingCountry ?? null,
  });
}

function buildSalesShipAddressOptions(
  order: SalesOrderDetail,
  customerOptions: CustomerOption[],
  addressOptions: SalesAddressOption[]
) {
  const options = new Map<string, SalesShipAddressOption>();
  const keys = new Set<string>();
  const add = (option: SalesShipAddressOption | null) => {
    if (!option) return;
    const key = salesShipAddressKey(option);
    if (keys.has(key)) return;
    keys.add(key);
    options.set(option.id, option);
  };
  const customer = customerOptions.find((candidate) => candidate.id === order.customerId);

  if (customer) {
    add(
      makeSalesShipAddressOption(
        {
          shipLine1: customer.shipLine1,
          shipLine2: customer.shipLine2,
          shipCity: customer.shipCity,
          shipRegion: customer.shipRegion,
          shipPostcode: customer.shipPostcode,
          shipCountry: customer.shipCountry,
        },
        "Customer shipping address",
        "customer_shipping"
      )
    );
    add(
      makeSalesShipAddressOption(
        {
          shipLine1: customer.billingLine1,
          shipLine2: customer.billingLine2,
          shipCity: customer.billingCity,
          shipRegion: customer.billingRegion,
          shipPostcode: customer.billingPostcode,
          shipCountry: customer.billingCountry,
        },
        "Customer billing address",
        "customer_billing"
      )
    );
  }
  for (const address of addressOptions) {
    add(
      makeSalesShipAddressOption(
        {
          shipLine1: address.line1,
          shipLine2: address.line2,
          shipCity: address.city,
          shipRegion: address.region,
          shipPostcode: address.postcode,
          shipCountry: address.country,
        },
        address.label,
        "address_book"
      )
    );
  }
  add(
    makeSalesShipAddressOption(
      {
        shipLine1: order.shipLine1,
        shipLine2: order.shipLine2,
        shipCity: order.shipCity,
        shipRegion: order.shipRegion,
        shipPostcode: order.shipPostcode,
        shipCountry: order.shipCountry,
      },
      "Current shipping address",
      "current"
    )
  );

  return [...options.values()];
}

function AddressCell({
  order,
  editable,
  customerOptions,
  addressOptions,
}: {
  order: SalesOrderDetail;
  editable: boolean;
  customerOptions: CustomerOption[];
  addressOptions: SalesAddressOption[];
}) {
  const { draft, orderId } = useContext(DetailsContext);
  const queryClient = useQueryClient();
  const addressMutation = useMutation({
    mutationKey: ["sales-order", orderId, "patch", "shipAddress"],
    mutationFn: (patch: SalesShipAddressFields) =>
      patchSalesOrderHeader(orderId, patch),
    onSuccess: (next) => {
      queryClient.setQueryData(["sales-order", orderId], next);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sales-order", orderId] });
    },
  });

  const commitAddress = (address: SalesShipAddressFields) => {
    if (draft) {
      draft.patchHeader(address);
      return;
    }
    addressMutation.mutate(address);
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

  const normalizedCurrent = normalizeSalesShipAddress({
    shipLine1: order.shipLine1,
    shipLine2: order.shipLine2,
    shipCity: order.shipCity,
    shipRegion: order.shipRegion,
    shipPostcode: order.shipPostcode,
    shipCountry: order.shipCountry,
  });
  const currentAddressId = salesShipAddressKey(normalizedCurrent);
  const shipAddressOptions = buildSalesShipAddressOptions(
    order,
    customerOptions,
    addressOptions
  );
  const selectedAddressId =
    shipAddressOptions.find(
      (option) => salesShipAddressKey(option) === currentAddressId
    )?.id ?? "";
  const optionMap = new Map(shipAddressOptions.map((option) => [option.id, option]));
  const items = [
    ...shipAddressOptions.map((option) => option.id),
    ...(currentAddressId ? [CLEAR_SHIP_ADDRESS_VALUE] : []),
  ];

  return (
    <CellShell label="Ship to" span={2}>
      <Combobox
        items={items}
        value={selectedAddressId}
        onValueChange={(nextValue) => {
          if (!nextValue || nextValue === CLEAR_SHIP_ADDRESS_VALUE) {
            commitAddress({
              shipLine1: null,
              shipLine2: null,
              shipCity: null,
              shipRegion: null,
              shipPostcode: null,
              shipCountry: null,
            });
            return;
          }
          const selected = optionMap.get(nextValue);
          if (selected) {
            commitAddress({
              shipLine1: selected.shipLine1,
              shipLine2: selected.shipLine2,
              shipCity: selected.shipCity,
              shipRegion: selected.shipRegion,
              shipPostcode: selected.shipPostcode,
              shipCountry: selected.shipCountry,
            });
          }
        }}
        itemToStringLabel={(itemId) => {
          if (itemId === CLEAR_SHIP_ADDRESS_VALUE) return "Clear shipping address";
          return optionMap.get(itemId)?.label ?? "";
        }}
      >
        <ComboboxInput
          placeholder="Address book"
          showClear={currentAddressId !== ""}
          className="h-(--height-input-sm) w-full text-[length:var(--text-sm)]"
        />
        <ComboboxContent className="w-[min(28rem,calc(100vw-2rem))] bg-popover text-popover-foreground">
          <ComboboxEmpty>No addresses found</ComboboxEmpty>
          <ComboboxList>
            {(itemId: string) => {
              if (itemId === CLEAR_SHIP_ADDRESS_VALUE) {
                return (
                  <ComboboxItem key={itemId} value={itemId}>
                    Clear shipping address
                  </ComboboxItem>
                );
              }

              const option = optionMap.get(itemId);
              return (
                <ComboboxItem key={itemId} value={itemId}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{option?.label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {option ? salesShipAddressLabel(option) : ""}
                    </span>
                  </span>
                </ComboboxItem>
              );
            }}
          </ComboboxList>
          {currentAddressId ? <ComboboxSeparator /> : null}
        </ComboboxContent>
      </Combobox>
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
