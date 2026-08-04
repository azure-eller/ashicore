"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CardPage,
  CardPageBody,
  CardSection,
} from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { CardField } from "@/components/card-page/card-field";
import { CardFormRow } from "@/components/card-page/form-cell";
import { createCardFields } from "@/components/card-page/bound-fields";
import { NotesField } from "@/components/card-page/notes-field";
import { useCardEntityActions } from "@/components/card-page/use-card-entity-actions";
import {
  AddressBookInput,
  useAddressBookDialog,
} from "@/components/card-page/address-book";
import {
  createSupplierDoc,
  deleteSupplier,
  updateSupplierDoc,
} from "@/lib/api/clients/suppliers";
import { useCardKernel } from "@/lib/card-kernel/use-card-kernel";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import type { AddressEntry } from "@/lib/dal/addresses";
import {
  addressEntryToAddressOption,
  emptyAddressFields,
  normalizeAddressFields,
  type AddressEntryOption,
} from "@/lib/addresses";
import {
  supplierDefaultValues,
  updateSupplierSchema,
  type PatchSupplier,
  type UpdateSupplier,
} from "@/lib/schemas/suppliers";
import {
  PAYMENT_TERMS_TOOLTIP,
  SUPPLIER_CODE_TOOLTIP,
} from "@/lib/tooltip-copy";
import type { SupplierRow } from "@/lib/purchasing/types";
import { queryKeys } from "@/lib/client/query-keys";

const SupplierFields = createCardFields<PatchSupplier>();

type SupplierPayload = Omit<UpdateSupplier, "expectedVersion">;

type SupplierCardProps = {
  initialSupplierId: string | null;
  initialSupplier: SupplierRow | null;
  addresses: AddressEntry[];
};

type SupplierAddressFields = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
};

type SupplierAddressOption = AddressEntryOption;

export function SupplierCard({
  initialSupplierId,
  initialSupplier,
  addresses,
}: SupplierCardProps) {
  const queryClient = useQueryClient();
  const [addressBook, setAddressBook] = useState(addresses);
  const [newSupplierId] = useState(() => crypto.randomUUID());
  const supplierId = initialSupplierId ?? newSupplierId;

  const kernel = useCardKernel<SupplierRow, SupplierPayload>({
    entityType: "supplier",
    id: supplierId,
    initialServerDoc: initialSupplier,
    makeNewDoc: makeDraftSupplier,
    schema: updateSupplierSchema,
    serialize: (draft) => ({ payload: supplierToPayload(draft) }),
    create: (payload, opts) =>
      createSupplierDoc({ ...payload, id: supplierId }, opts),
    update: (id, payload, opts) => updateSupplierDoc(id, payload, opts),
    onServerDoc: (doc) => {
      queryClient.setQueryData(queryKeys.suppliers.card(doc.id), doc);
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.root });
    },
    onCreated: (doc) => {
      reflectPersistedCardUrlWithoutNavigation(`/purchasing/suppliers/${doc.id}`);
    },
  });

  const isDraft = !kernel.isPersisted;
  const display = kernel.draft;
  const readOnly = Boolean(display.deletedAt);

  const actions = useCardEntityActions({
    entity: "supplier-action",
    getId: () => (kernel.isPersisted ? supplierId : null),
    flush: kernel.flush,
    invalidateQueryKeys: [queryKeys.suppliers.root],
    delete: {
      label: "Delete supplier",
      run: (id) => deleteSupplier(id),
      navigateTo: "/purchasing/suppliers",
      confirm: {
        title: "Delete supplier?",
        description: (
          <>
            This supplier will be soft-deleted. Suppliers with active not received
            or partially received purchase orders cannot be deleted.
          </>
        ),
      },
    },
  });

  const commitSupplierPatch = useCallback(
    (patch: PatchSupplier) => {
      if (readOnly) return;
      kernel.update((draft) => ({ ...draft, ...patch }));
    },
    [kernel, readOnly]
  );

  const applySupplierAddress = useCallback(
    (address: SupplierAddressFields | null) => {
      commitSupplierPatch(billingAddressPatch(address ? normalizeAddressFields(address) : emptyAddressFields()));
    },
    [commitSupplierPatch]
  );

  const addressDialog = useAddressBookDialog({
    entity: "supplier",
    entityId: kernel.isPersisted ? supplierId : null,
    idPrefix: "supplier",
    addressBook,
    setAddressBook,
    onSaved: (option) => applySupplierAddress(option),
  });

  const billingAddress = getSupplierBillingAddress(display);
  const addressOptions = useMemo(
    () =>
      addressBook
        .map(addressEntryToAddressOption)
        .filter((option): option is SupplierAddressOption => option != null),
    [addressBook]
  );

  const cardSaveState = readOnly ? "readonly" : kernel.saveState;
  const cardSaveMessage = readOnly ? null : kernel.saveMessage;

  return (
    <CardPage>
      <CardPageHeader
        title={(display.name ?? "").trim() || "New supplier"}
        saveState={cardSaveState}
        saveMessage={cardSaveMessage}
        fallbackHref="/purchasing/suppliers"
        showPrint={false}
        menuActions={
          isDraft || readOnly
            ? []
            : [...(actions.deleteAction ? [actions.deleteAction] : [])]
        }
      />
      <CardPageBody>
        <CardSection>
          <CardFormRow columns="three">
            <SupplierFields.Provider
              values={display}
              commit={commitSupplierPatch}
              readOnly={readOnly}
              idPrefix="supplier"
              errors={kernel.fieldErrors}
            >
              <SupplierFields.Text
                name="name"
                label="Name"
                required
                autoFocus={isDraft}
              />
              <SupplierFields.Text name="code" label="Code" tooltip={SUPPLIER_CODE_TOOLTIP} />
              <SupplierFields.Text name="contactName" label="Contact name" />
              <SupplierFields.Text name="email" label="Email" type="email" />
              <SupplierFields.Text name="phone" label="Phone" />
              <SupplierFields.Text
                name="paymentTerms"
                label="Payment terms"
                tooltip={PAYMENT_TERMS_TOOLTIP}
              />
            </SupplierFields.Provider>
            <CardField label="Billing address" htmlFor="supplier-billing-address">
              <AddressBookInput
                id="supplier-billing-address"
                value={billingAddress}
                options={addressOptions}
                placeholder="Billing address"
                disabled={readOnly}
                onChange={applySupplierAddress}
                onAddNew={() => addressDialog.openNew()}
                onEdit={(option) => addressDialog.openEdit(option)}
              />
            </CardField>
          </CardFormRow>
        </CardSection>

        <CardSection title="Notes">
          <NotesField
            hideLabel
            value={display.notes ?? ""}
            disabled={readOnly}
            readOnlyValue={readOnly}
            commitUnchangedValue={isDraft}
            onDraftChange={(notes) => {
              if (isDraft) {
                kernel.update((draft) => ({ ...draft, notes }), {
                  debounceMs: Number.POSITIVE_INFINITY,
                });
              }
            }}
            onCommit={(notes) => commitSupplierPatch({ notes })}
          />
        </CardSection>
      </CardPageBody>

      {actions.dialogs}

      {addressDialog.dialog}
    </CardPage>
  );
}

function makeDraftSupplier(id: string): SupplierRow {
  const now = new Date();
  return {
    ...supplierDefaultValues,
    id,
    name: supplierDefaultValues.name,
    code: supplierDefaultValues.code ?? null,
    contactName: supplierDefaultValues.contactName ?? null,
    email: supplierDefaultValues.email ?? null,
    phone: supplierDefaultValues.phone ?? null,
    billingLine1: supplierDefaultValues.billingLine1 ?? null,
    billingLine2: supplierDefaultValues.billingLine2 ?? null,
    billingCity: supplierDefaultValues.billingCity ?? null,
    billingRegion: supplierDefaultValues.billingRegion ?? null,
    billingPostcode: supplierDefaultValues.billingPostcode ?? null,
    billingCountry: supplierDefaultValues.billingCountry ?? null,
    paymentTerms: supplierDefaultValues.paymentTerms ?? null,
    notes: supplierDefaultValues.notes ?? null,
    xeroContactId: null,
    version: 0,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function supplierToPayload(supplier: SupplierRow): SupplierPayload {
  return {
    name: supplier.name,
    code: supplier.code,
    contactName: supplier.contactName,
    email: supplier.email,
    phone: supplier.phone,
    billingLine1: supplier.billingLine1,
    billingLine2: supplier.billingLine2,
    billingCity: supplier.billingCity,
    billingRegion: supplier.billingRegion,
    billingPostcode: supplier.billingPostcode,
    billingCountry: supplier.billingCountry,
    paymentTerms: supplier.paymentTerms,
    notes: supplier.notes,
  };
}

function getSupplierBillingAddress(supplier: SupplierRow): SupplierAddressFields {
  return normalizeAddressFields({
    line1: supplier.billingLine1,
    line2: supplier.billingLine2,
    city: supplier.billingCity,
    region: supplier.billingRegion,
    postcode: supplier.billingPostcode,
    country: supplier.billingCountry,
  });
}

function billingAddressPatch(address: SupplierAddressFields): PatchSupplier {
  return {
    billingLine1: address.line1,
    billingLine2: address.line2,
    billingCity: address.city,
    billingRegion: address.region,
    billingPostcode: address.postcode,
    billingCountry: address.country,
  };
}
