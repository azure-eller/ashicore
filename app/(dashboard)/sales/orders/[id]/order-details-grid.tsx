"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { AddressBookFields } from "@/components/address-book-fields";
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
import { CardField } from "@/components/card-page/card-field";
import {
  CardFormRow,
  DisabledFieldTooltip,
  ReadOnlyFieldValue,
  underlineControlClass,
} from "@/components/card-page/form-cell";
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
import { createAddressEntry, updateAddressEntry } from "@/lib/api/clients/customers";
import { makeUniqueAddressLabel } from "@/lib/address-label";
import { formatAddressLines } from "@/lib/format";
import { createAddressEntrySchema } from "@/lib/schemas/addresses";
import type {
  CustomerOption,
  SalesAddressOption,
  SalesOrderDetail,
} from "@/app/(dashboard)/sales/types";
import type { PatchSalesOrderHeader } from "@/lib/schemas/sales-orders";
import type { SalesOrderDraftController } from "./use-sales-order-draft-controller";
import cardStyles from "@/components/card-page/card-page.module.css";

export type OrderDetailsGridProps = {
  order: SalesOrderDetail;
  editable: boolean;
  customerOptions: CustomerOption[];
  addressOptions: SalesAddressOption[];
  controller: SalesOrderDraftController;
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

type GridCtx = { controller: SalesOrderDraftController };
const DetailsContext = createContext<GridCtx | null>(null);
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
  controller,
}: OrderDetailsGridProps) {
  const customerProjects = useMemo(() => {
    const customer = customerOptions.find((c) => c.id === order.customerId);
    return customer?.projects ?? [];
  }, [customerOptions, order.customerId]);

  return (
    <DetailsContext.Provider value={{ controller }}>
      <CardSection title="Order details">
        <CardFormRow columns="four">
          <CustomerCell
            order={order}
            editable={editable}
            customerOptions={customerOptions}
          />
          <TextCell
            label="Sales order"
            field="orderNumber"
            value={order.orderNumber}
            editable={editable && controller.hasPersistedOrder}
            disabledReason={
              !controller.hasPersistedOrder
                ? "Sales order number is assigned after you select a customer."
                : undefined
            }
          />
          <ProjectCell order={order} editable={editable} projects={customerProjects} />
          <DateCell
            label="Delivery deadline"
            field="shipDate"
            value={order.shipDate}
            editable={editable}
          />
        </CardFormRow>
        <CardFormRow columns="four">
          <AddressCell
            order={order}
            editable={editable}
            addressOptions={addressOptions}
          />
        </CardFormRow>
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
  disabledReason,
}: {
  label: string;
  field: Field;
  value: string | null;
  editable: boolean;
  required?: boolean;
  placeholder?: string;
  disabledReason?: string;
}) {
  const { controller } = useDetailsContext();

  return (
    <CardField label={label} required={required}>
      {editable ? (
        <CommitInput
          label={label}
          value={value}
          required={required}
          placeholder={placeholder}
          onDraftChange={(next) => {
            controller.patchHeader({ [field]: next || null } as PatchSalesOrderHeader);
          }}
          onCommit={(next) => {
            if (next === (value ?? null)) return;
            controller.patchHeader({ [field]: next } as PatchSalesOrderHeader);
          }}
        />
      ) : (
        <DisabledFieldTooltip reason={disabledReason}>
          <ReadOnlyFieldValue mono>
            {value || placeholder || ""}
          </ReadOnlyFieldValue>
        </DisabledFieldTooltip>
      )}
    </CardField>
  );
}

function DateCell({
  label,
  field,
  value,
  editable,
  required,
}: {
  label: string;
  field: "shipDate";
  value: string | null;
  editable: boolean;
  required?: boolean;
}) {
  const { controller } = useDetailsContext();

  return (
    <CardField label={label} required={required}>
      {editable ? (
        <DatePicker
          aria-label={label}
          value={value ?? ""}
          className={underlineControlClass()}
          onChange={(next) => {
            const normalized = next || null;
            if (normalized === value) return;
            controller.patchHeader({ [field]: normalized } as PatchSalesOrderHeader);
          }}
        />
      ) : (
        <ReadOnlyFieldValue mono>
          {value || "—"}
        </ReadOnlyFieldValue>
      )}
    </CardField>
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
  const { controller } = useDetailsContext();

  return (
    <CardField label="Customer" required invalid={editable && !order.customerId}>
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
              controller.patchHeader(patch);
            }}
            placeholder="Search customers…"
            emptyMessage="No customers found"
            inputClassName={underlineControlClass(editable && !order.customerId)}
            createLinks={[{ href: "/sales/customer", label: "Create customer" }]}
          />
        </>
      ) : (
        <>
          <ReadOnlyFieldValue>{order.customerName}</ReadOnlyFieldValue>
        </>
      )}
    </CardField>
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
  const { controller } = useDetailsContext();
  const selected = order.customerProjectId ?? NO_PROJECT_VALUE;

  if (!editable) {
    return (
      <CardField label="Project / Job">
        <ReadOnlyFieldValue>
          {order.customerProjectName || "No project"}
        </ReadOnlyFieldValue>
      </CardField>
    );
  }

  return (
    <CardField label="Project / Job">
      <DisabledFieldTooltip
        reason={
          projects.length === 0
            ? order.customerId
              ? "This customer has no projects."
              : "Select a customer before choosing a project."
            : undefined
        }
      >
        <Select
          value={selected}
          onValueChange={(value) => {
            const next = value === NO_PROJECT_VALUE ? null : value;
            if (next === order.customerProjectId) return;
            const name = projects.find((p) => p.id === next)?.name ?? null;
            controller.patchHeader({ customerProjectId: next, customerProjectName: name });
          }}
          disabled={projects.length === 0}
        >
          <SelectTrigger aria-label="Project / Job" className={underlineControlClass()}>
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
      </DisabledFieldTooltip>
    </CardField>
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
  const { controller } = useDetailsContext();
  const [addressBook, setAddressBook] = useState(addressOptions);
  const [addressDialogState, setAddressDialogState] =
    useState<AddressDialogState | null>(null);
  const [addressBookPending, setAddressBookPending] = useState(false);
  const [addressBookError, setAddressBookError] = useState<Error | null>(null);
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
  const billingSameAsShipping = isBlankDeliveryAddress(currentBillingAddress);
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
    controller.patchHeader(patch);
  };

  const openAddressDialog = (target: AddressTarget) => {
    setAddressBookError(null);
    addressForm.reset(EMPTY_ADDRESS_DIALOG_VALUES);
    setAddressDialogState({ target, option: null });
  };

  const openEditAddressDialog = (target: AddressTarget, option: DeliveryAddressOption) => {
    setAddressBookError(null);
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

  const handleAddressDialogSubmit = async (values: AddressDialogValues) => {
    if (!addressDialogState) return;
    const label = makeUniqueAddressLabel(
      values,
      addressBook.map((address) => address.label),
    );
    setAddressBookPending(true);
    setAddressBookError(null);
    try {
      const data = createAddressEntrySchema.parse({ ...values, label });
      const entry = addressDialogState.option?.addressEntryId
        ? await updateAddressEntry(addressDialogState.option.addressEntryId, data)
        : await createAddressEntry(data);
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
    } catch (error) {
      setAddressBookError(error instanceof Error ? error : new Error("Failed to save address"));
    } finally {
      setAddressBookPending(false);
    }
  };

  if (!editable) {
    return (
      <>
        <ReadOnlyAddressCell label="Ship to" address={currentShippingAddress} />
        {billingSameAsShipping ? (
          <CardField label="Billing">
            <ReadOnlyFieldValue>Same as shipping address</ReadOnlyFieldValue>
          </CardField>
        ) : (
          <ReadOnlyAddressCell label="Billing" address={currentBillingAddress} />
        )}
      </>
    );
  }

  return (
    <>
      <CardField label="Ship to">
        <DeliveryAddressInput
          id="sales-order-shipping-address"
          value={currentShippingAddress}
          options={options}
          onChange={(address) => commitAddress("shipping", address)}
          onAddNew={() => openAddressDialog("shipping")}
          onEdit={(option) => openEditAddressDialog("shipping", option)}
          inputClassName={underlineControlClass()}
        />
      </CardField>
      <CardField label="Billing">
        <DeliveryAddressInput
          id="sales-order-billing-address"
          value={billingSameAsShipping ? undefined : currentBillingAddress}
          options={options}
          onChange={(address) => commitAddress("billing", address)}
          onAddNew={() => openAddressDialog("billing")}
          onEdit={(option) => openEditAddressDialog("billing", option)}
          inputClassName={underlineControlClass()}
          nullOptionLabel="Same as shipping address"
        />
        <AddressBookDialog
          state={addressDialogState}
          form={addressForm}
          pending={addressBookPending}
          error={addressBookError}
          onClose={() => {
            setAddressDialogState(null);
            addressForm.reset(EMPTY_ADDRESS_DIALOG_VALUES);
          }}
          onSubmit={handleAddressDialogSubmit}
        />
      </CardField>
    </>
  );
}

function useDetailsContext() {
  const context = useContext(DetailsContext);
  if (!context) {
    throw new Error("OrderDetailsGrid context is missing.");
  }
  return context;
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
    <CardField label={label}>
      {lines.length > 0 ? (
        <div className={cardStyles.readOnlyFieldValue}>
          {lines.map((line, idx) => (
            <div key={idx}>{line}</div>
          ))}
        </div>
      ) : (
        <div className={cardStyles.readOnlyFieldValue}>No address set</div>
      )}
    </CardField>
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
        <form className="space-y-(--space-5)" onSubmit={form.handleSubmit(onSubmit)}>
          <AddressBookFields
            control={form.control}
            addressNames={ADDRESS_DIALOG_FIELD_NAMES}
            idPrefix="sales-order-address"
            labelName="label"
            contactNameName="contactName"
            contactPhoneName="contactPhone"
            contactNameLabel="Contact"
            contactPhoneLabel="Phone"
            notesName="deliveryInstructions"
            notesLabel="Delivery instructions"
          />
          {error ? (
            <p className="text-[length:var(--text-sm)] text-destructive">
              {error.message}
            </p>
          ) : null}
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
