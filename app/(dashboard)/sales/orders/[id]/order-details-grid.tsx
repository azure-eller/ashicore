"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { AddressFields } from "@/components/address-fields";
import { CommitInput } from "@/components/card-page/commit-input";
import {
  DeliveryAddressInput,
  makeDeliveryAddressOption,
  normalizeDeliveryAddress,
  type DeliveryAddressFields,
  type DeliveryAddressOption,
} from "@/components/delivery-address-input";
import { EntityCombobox } from "@/components/entity-combobox";
import { CardSection } from "@/components/card-page/card-page";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
import { CellShell } from "@/components/card-page/form-cell";
import { useEntityFieldCommit } from "@/components/card-page/use-entity-field-commit";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createAddressEntry, updateAddressEntry } from "@/lib/api/clients/customers";
import { patchSalesOrderHeader } from "@/lib/api/clients/sales-orders";
import { formatAddressLines } from "@/lib/format";
import { createAddressEntrySchema } from "@/lib/schemas/addresses";
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
const ADDRESS_DIALOG_FIELD_NAMES = {
  line1: "line1",
  line2: "line2",
  city: "city",
  region: "region",
  postcode: "postcode",
  country: "country",
} as const;
const EMPTY_ADDRESS_DIALOG_VALUES: AddressDialogValues = {
  label: "",
  contactName: null,
  contactPhone: null,
  line1: null,
  line2: null,
  city: null,
  region: null,
  postcode: null,
  country: null,
  deliveryInstructions: null,
  notes: null,
};

type GridCtx = { orderId: string; draft?: OrderDraftController };
const DetailsContext = createContext<GridCtx>({ orderId: "" });
type HeaderOptimisticPatch = PatchSalesOrderHeader &
  Partial<
    Pick<SalesOrderDetail, "customerName" | "customerEmail" | "customerProjectName">
  >;
type AddressTarget = "shipping" | "billing";
type AddressDialogValues = z.input<typeof createAddressEntrySchema>;
type AddressDialogState = {
  target: AddressTarget;
  option: DeliveryAddressOption | null;
};

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
      <CardSection title="Order details">
        <div className={`${cardStyles.formRow} ${cardStyles.formRowFive}`}>
          <TextCell
            label="Sales order"
            field="orderNumber"
            value={order.orderNumber}
            editable={editable}
            placeholder="Auto"
          />
          <CustomerCell
            order={order}
            editable={editable}
            customerOptions={customerOptions}
          />
          <ProjectCell order={order} editable={editable} projects={customerProjects} />
          <DateCell
            label="Order date"
            field="orderDate"
            value={order.orderDate}
            editable={editable}
            required
          />
          <DateCell
            label="Ship date"
            field="shipDate"
            value={order.shipDate}
            editable={editable}
          />
        </div>
        <div className={`${cardStyles.formRow} ${cardStyles.formRowFour}`}>
          <AddressCell
            order={order}
            editable={editable}
            addressOptions={addressOptions}
          />
        </div>
      </CardSection>
    </DetailsContext.Provider>
  );
}

function TextCell<Field extends keyof PatchSalesOrderHeader>({
  label,
  field,
  value,
  editable,
  required,
  placeholder,
}: {
  label: string;
  field: Field;
  value: string | null;
  editable: boolean;
  required?: boolean;
  placeholder?: string;
}) {
  const { draft } = useContext(DetailsContext);
  const commit = useFieldCommit(field);

  return (
    <CellShell label={label} required={required}>
      {editable ? (
        <CommitInput
          label={label}
          value={value}
          required={required}
          placeholder={placeholder}
          onDraftChange={(next) => {
            if (draft) {
              draft.patchHeader({ [field]: next || null } as PatchSalesOrderHeader);
            }
          }}
          onCommit={(next) => {
            if (next === (value ?? null)) return;
            if (draft) {
              draft.patchHeader({ [field]: next } as PatchSalesOrderHeader);
              return;
            }
            commit(next as PatchSalesOrderHeader[Field]);
          }}
        />
      ) : (
        <div className={`${cardStyles.readOnlyFieldValue} ${cardStyles.mono}`}>
          {value || "—"}
        </div>
      )}
    </CellShell>
  );
}

function DateCell({
  label,
  field,
  value,
  editable,
  required,
  hint,
}: {
  label: string;
  field: "orderDate" | "shipDate" | "requestedDate";
  value: string | null;
  editable: boolean;
  required?: boolean;
  hint?: string;
}) {
  const { draft } = useContext(DetailsContext);
  const commit = useFieldCommit(field);

  return (
    <CellShell label={label} required={required}>
      {editable ? (
        <DatePicker
          aria-label={label}
          value={value ?? ""}
          className={cardStyles.underlineControl}
          onChange={(next) => {
            const normalized = next || null;
            if (normalized === value) return;
            if (draft) {
              draft.patchHeader({ [field]: normalized } as PatchSalesOrderHeader);
              return;
            }
            commit(normalized as PatchSalesOrderHeader[typeof field]);
          }}
        />
      ) : (
        <div className={`${cardStyles.readOnlyFieldValue} ${cardStyles.mono}`}>
          {value || "—"}
        </div>
      )}
      {hint ? <div className={cardStyles.fieldHint}>{hint}</div> : null}
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
              const picked = customerOptions.find((c) => c.id === value);
              const patch = {
                customerId: value,
                customerName: picked?.name ?? "",
                customerProjectId: null,
                customerProjectName: null,
                ...customerDefaultShipAddressPatch(picked),
                ...emptySalesBillingAddressPatch(),
              };
              if (draft) {
                draft.patchHeader(patch);
                return;
              }
              commitPatch(patch);
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
        <div className={cardStyles.readOnlyFieldValue}>
          {order.customerProjectName || "No project"}
        </div>
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
  const commitPatch = useHeaderPatchCommit("address");
  const [addressBook, setAddressBook] = useState(addressOptions);
  const [showSeparateBilling, setShowSeparateBilling] = useState(false);
  const [addressDialogState, setAddressDialogState] =
    useState<AddressDialogState | null>(null);
  const currentShippingAddress = normalizeDeliveryAddress({
    shipLine1: order.shipLine1,
    shipLine2: order.shipLine2,
    shipCity: order.shipCity,
    shipRegion: order.shipRegion,
    shipPostcode: order.shipPostcode,
    shipCountry: order.shipCountry,
  });
  const currentBillingAddress = normalizeDeliveryAddress({
    shipLine1: order.billingLine1,
    shipLine2: order.billingLine2,
    shipCity: order.billingCity,
    shipRegion: order.billingRegion,
    shipPostcode: order.billingPostcode,
    shipCountry: order.billingCountry,
  });
  const billingSameAsShipping =
    isBlankDeliveryAddress(currentBillingAddress) && !showSeparateBilling;
  const options = buildSalesShipAddressOptions(order, addressBook);

  const addressForm = useForm<AddressDialogValues>({
    resolver: zodResolver(createAddressEntrySchema),
    defaultValues: EMPTY_ADDRESS_DIALOG_VALUES,
  });

  const commitAddress = (target: AddressTarget, address: DeliveryAddressFields | null) => {
    const patch =
      target === "shipping"
        ? address
          ? salesAddressPatch(address)
          : emptySalesShipAddressPatch()
        : address
          ? salesBillingAddressPatch(address)
          : emptySalesBillingAddressPatch();
    if (draft) {
      draft.patchHeader(patch);
      return;
    }
    commitPatch(patch);
  };

  const addressBookMutation = useMutation({
    mutationKey: cardSaveMutationKey("sales-order", order.id, "address-book"),
    mutationFn: ({ id, values }: { id: string | null; values: AddressDialogValues }) => {
      const data = createAddressEntrySchema.parse(values);
      return id ? updateAddressEntry(id, data) : createAddressEntry(data);
    },
    onSuccess: (entry) => {
      if (!addressDialogState) return;
      const option = makeDeliveryAddressOption(
        {
          shipAddressEntryId: entry.id,
          shipContactName: entry.contactName,
          shipContactPhone: entry.contactPhone,
          shipLine1: entry.line1,
          shipLine2: entry.line2,
          shipCity: entry.city,
          shipRegion: entry.region,
          shipPostcode: entry.postcode,
          shipCountry: entry.country,
          shipDeliveryInstructions: entry.deliveryInstructions,
        },
        entry.label,
        entry.notes
      );
      setAddressBook((current) => {
        const next = current.filter((address) => address.id !== entry.id);
        return [...next, entry].sort((a, b) => a.label.localeCompare(b.label));
      });
      if (option) commitAddress(addressDialogState.target, option);
      setAddressDialogState(null);
      addressForm.reset(EMPTY_ADDRESS_DIALOG_VALUES);
    },
  });

  const openAddressDialog = (target: AddressTarget) => {
    addressBookMutation.reset();
    addressForm.reset(EMPTY_ADDRESS_DIALOG_VALUES);
    setAddressDialogState({ target, option: null });
  };

  const openEditAddressDialog = (target: AddressTarget, option: DeliveryAddressOption) => {
    addressBookMutation.reset();
    addressForm.reset({
      label: option.label,
      contactName: option.shipContactName,
      contactPhone: option.shipContactPhone,
      line1: option.shipLine1,
      line2: option.shipLine2,
      city: option.shipCity,
      region: option.shipRegion,
      postcode: option.shipPostcode,
      country: option.shipCountry,
      deliveryInstructions: option.shipDeliveryInstructions,
      notes: option.notes,
    });
    setAddressDialogState({ target, option });
  };

  const handleAddressDialogSubmit = (values: AddressDialogValues) => {
    if (!addressDialogState) return;
    const baseLabel =
      values.label.trim() ||
      formatAddressLines({
        line1: values.line1,
        line2: values.line2,
        city: values.city,
        region: values.region,
        postcode: values.postcode,
        country: values.country,
      }).join(", ") ||
      "Address";
    const existingLabels = new Set(addressBook.map((address) => address.label));
    let label = baseLabel;
    if (!values.label.trim()) {
      let suffix = 2;
      while (existingLabels.has(label)) {
        label = `${baseLabel} (${suffix})`;
        suffix += 1;
      }
    }
    addressBookMutation.mutate({
      id: addressDialogState.option?.addressEntryId ?? null,
      values: { ...values, label },
    });
  };

  if (!editable) {
    return (
      <>
        <ReadOnlyAddressCell label="Ship to" address={currentShippingAddress} />
        {billingSameAsShipping ? (
          <CellShell label="Billing">
            <div className={cardStyles.readOnlyFieldValue}>Same as shipping</div>
          </CellShell>
        ) : (
          <ReadOnlyAddressCell label="Billing" address={currentBillingAddress} />
        )}
      </>
    );
  }

  return (
    <>
      <CellShell label="Ship to">
        <DeliveryAddressInput
          id="sales-order-shipping-address"
          value={currentShippingAddress}
          options={options}
          onChange={(address) => commitAddress("shipping", address)}
          onAddNew={() => openAddressDialog("shipping")}
          onEdit={(option) => openEditAddressDialog("shipping", option)}
          inputClassName={cardStyles.underlineControl}
        />
      </CellShell>
      <CellShell label="Billing">
        {billingSameAsShipping ? (
          <label className={cardStyles.ck}>
            <input
              type="checkbox"
              checked
              onChange={(event) => {
                if (!event.currentTarget.checked) {
                  setShowSeparateBilling(true);
                }
              }}
            />
            Billing same as shipping
          </label>
        ) : (
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 flex-1">
              <DeliveryAddressInput
                id="sales-order-billing-address"
                value={currentBillingAddress}
                options={options}
                onChange={(address) => commitAddress("billing", address)}
                onAddNew={() => openAddressDialog("billing")}
                onEdit={(option) => openEditAddressDialog("billing", option)}
                inputClassName={cardStyles.underlineControl}
              />
            </div>
            <label className={cardStyles.ck}>
              <input
                type="checkbox"
                checked={false}
                onChange={(event) => {
                  if (event.currentTarget.checked) {
                    setShowSeparateBilling(false);
                    commitAddress("billing", null);
                  }
                }}
              />
              Same
            </label>
          </div>
        )}
        <AddressBookDialog
          state={addressDialogState}
          form={addressForm}
          pending={addressBookMutation.isPending}
          error={addressBookMutation.error}
          onClose={() => {
            setAddressDialogState(null);
            addressForm.reset(EMPTY_ADDRESS_DIALOG_VALUES);
          }}
          onSubmit={handleAddressDialogSubmit}
        />
      </CellShell>
    </>
  );
}

function ReadOnlyAddressCell({
  label,
  address,
}: {
  label: string;
  address: DeliveryAddressFields;
}) {
  const lines = formatAddressLines({
    line1: address.shipLine1,
    line2: address.shipLine2,
    city: address.shipCity,
    region: address.shipRegion,
    postcode: address.shipPostcode,
    country: address.shipCountry,
  });

  return (
    <CellShell label={label}>
      {lines.length > 0 ? (
        <div className={cardStyles.readOnlyAddress}>
          {lines.map((line, idx) => (
            <div key={idx}>{line}</div>
          ))}
        </div>
      ) : (
        <div className={cardStyles.readOnlyAddress}>No address set</div>
      )}
    </CellShell>
  );
}

type SalesShipAddressPatch = Pick<
  PatchSalesOrderHeader,
  "shipLine1" | "shipLine2" | "shipCity" | "shipRegion" | "shipPostcode" | "shipCountry"
>;
type SalesBillingAddressPatch = Pick<
  PatchSalesOrderHeader,
  | "billingLine1"
  | "billingLine2"
  | "billingCity"
  | "billingRegion"
  | "billingPostcode"
  | "billingCountry"
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

function emptySalesShipAddressPatch(): SalesShipAddressPatch {
  return {
    shipLine1: null,
    shipLine2: null,
    shipCity: null,
    shipRegion: null,
    shipPostcode: null,
    shipCountry: null,
  };
}

function salesBillingAddressPatch(
  address: DeliveryAddressFields
): SalesBillingAddressPatch {
  return {
    billingLine1: address.shipLine1 ?? null,
    billingLine2: address.shipLine2 ?? null,
    billingCity: address.shipCity ?? null,
    billingRegion: address.shipRegion ?? null,
    billingPostcode: address.shipPostcode ?? null,
    billingCountry: address.shipCountry ?? null,
  };
}

function emptySalesBillingAddressPatch(): SalesBillingAddressPatch {
  return {
    billingLine1: null,
    billingLine2: null,
    billingCity: null,
    billingRegion: null,
    billingPostcode: null,
    billingCountry: null,
  };
}

function isBlankDeliveryAddress(address: DeliveryAddressFields) {
  const normalized = normalizeDeliveryAddress(address);
  return [
    normalized.shipLine1,
    normalized.shipLine2,
    normalized.shipCity,
    normalized.shipRegion,
    normalized.shipPostcode,
    normalized.shipCountry,
  ].every((part) => !part);
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
          shipAddressEntryId: address.id,
          shipContactName: address.contactName,
          shipContactPhone: address.contactPhone,
          shipLine1: address.line1,
          shipLine2: address.line2,
          shipCity: address.city,
          shipRegion: address.region,
          shipPostcode: address.postcode,
          shipCountry: address.country,
          shipDeliveryInstructions: address.deliveryInstructions,
        },
        address.label,
        address.notes
      )
    );
  }

  add(
    makeDeliveryAddressOption({
      shipLine1: order.shipLine1,
      shipLine2: order.shipLine2,
      shipCity: order.shipCity,
      shipRegion: order.shipRegion,
      shipPostcode: order.shipPostcode,
      shipCountry: order.shipCountry,
    })
  );
  add(
    makeDeliveryAddressOption({
      shipLine1: order.billingLine1,
      shipLine2: order.billingLine2,
      shipCity: order.billingCity,
      shipRegion: order.billingRegion,
      shipPostcode: order.billingPostcode,
      shipCountry: order.billingCountry,
    })
  );

  return [...options.values()];
}

function AddressBookDialog({
  state,
  form,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  state: AddressDialogState | null;
  form: ReturnType<typeof useForm<AddressDialogValues>>;
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onSubmit: (values: AddressDialogValues) => void;
}) {
  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => (!open ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state?.option ? "Edit selected address" : "Add new address"}
          </DialogTitle>
        </DialogHeader>
        <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Controller
              control={form.control}
              name="label"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="sales-order-address-label">Label</FieldLabel>
                  <Input
                    {...field}
                    id="sales-order-address-label"
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value)}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="contactName"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="sales-order-address-contact-name">
                      Contact
                    </FieldLabel>
                    <Input
                      {...field}
                      id="sales-order-address-contact-name"
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value || null)}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="contactPhone"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="sales-order-address-contact-phone">
                      Phone
                    </FieldLabel>
                    <Input
                      {...field}
                      id="sales-order-address-contact-phone"
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value || null)}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
            </FieldGroup>
            <AddressFields
              control={form.control}
              names={ADDRESS_DIALOG_FIELD_NAMES}
              idPrefix="sales-order-address"
            />
            <Controller
              control={form.control}
              name="deliveryInstructions"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="sales-order-address-delivery-instructions">
                    Delivery instructions
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="sales-order-address-delivery-instructions"
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value || null)}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </FieldGroup>
          {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {state?.option ? "Save address" : "Add address"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function useHeaderPatchCommit(scope: string) {
  const { orderId } = useContext(DetailsContext);
  return useEntityFieldCommit<HeaderOptimisticPatch, SalesOrderDetail>({
    entityKey: "sales-order",
    entityId: orderId,
    scope,
    mutationFn: (patch) => patchSalesOrderHeader(orderId, persistedHeaderPatch(patch)),
    setQueryDataKey: ["sales-order", orderId],
    optimisticUpdate: (current, patch) =>
      current ? ({ ...current, ...patch } as SalesOrderDetail) : current,
  });
}

function useFieldCommit<Field extends keyof PatchSalesOrderHeader>(field: Field) {
  const { orderId } = useContext(DetailsContext);
  return useEntityFieldCommit<PatchSalesOrderHeader[Field], SalesOrderDetail>({
    entityKey: "sales-order",
    entityId: orderId,
    scope: String(field),
    mutationFn: (value) =>
      patchSalesOrderHeader(orderId, { [field]: value } as PatchSalesOrderHeader),
    setQueryDataKey: ["sales-order", orderId],
    optimisticUpdate: (current, value) =>
      current ? ({ ...current, [field]: value } as SalesOrderDetail) : current,
  });
}

function persistedHeaderPatch(patch: HeaderOptimisticPatch): PatchSalesOrderHeader {
  const { customerName, customerEmail, customerProjectName, ...persisted } = patch;
  void customerName;
  void customerEmail;
  void customerProjectName;
  return persisted;
}
