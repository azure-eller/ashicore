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
import type { CardSaveState } from "@/components/card-page/card-save-status";
import {
  AddressBookInput,
  useAddressBookDialog,
} from "@/components/card-page/address-book";
import {
  createSupplier,
  deleteSupplier,
  getSupplierCard,
  patchSupplier,
} from "@/lib/api/clients/suppliers";
import { useDraftSaveEngine } from "@/lib/hooks/use-draft-save-engine";
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
  type InsertSupplier,
  type PatchSupplier,
} from "@/lib/schemas/suppliers";
import {
  PAYMENT_TERMS_TOOLTIP,
  SUPPLIER_CODE_TOOLTIP,
} from "@/lib/tooltip-copy";
import type { SupplierRow } from "@/lib/purchasing/types";
import { queryKeys } from "@/lib/client/query-keys";

const SupplierFields = createCardFields<PatchSupplier>();

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
  const engine = useDraftSaveEngine<
    SupplierRow,
    { type: "patch"; patch: PatchSupplier },
    SupplierRow
  >({
    initialDraft: initialSupplier ?? makeDraftSupplier(supplierDefaultValues),
    initialServerSnapshot: initialSupplier,
    initialId: initialSupplierId,
    isSaveable: (draft) => Boolean(draft.name.trim()),
    applyOp: (draft, op) => mergeSupplierPatch(draft, op.patch),
    coalesceOps: (existing, next) => [
      {
        op: {
          type: "patch",
          patch: [...existing, next].reduce<PatchSupplier>(
            (patch, queued) => ({ ...patch, ...queued.op.patch }),
            {},
          ),
        },
        revision: next.revision,
      },
    ],
    // Single request: a follow-up GET that failed would re-queue the ops and
    // make the next flush create a second supplier.
    create: (draft) => createSupplier(supplierToInsertInput(draft)),
    save: async (supplierId, draft, ops) => {
      if (ops.length === 0) return null;
      const patch = ops.reduce<PatchSupplier>(
        (nextPatch, queued) => ({ ...nextPatch, ...queued.op.patch }),
        {},
      );
      await patchSupplier(supplierId, draft, patch);
      return getSupplierCard(supplierId);
    },
    getResultId: (result) => result.id,
    applyPersistedIdentity: (draft, result) => ({
      ...draft,
      id: result.id,
      createdAt: result.createdAt,
    }),
    mergeServerOwnedFields: (draft, result) => ({
      ...result,
      ...supplierEditableSnapshot(draft),
    }),
    onPersisted: (id) => {
      reflectPersistedCardUrlWithoutNavigation(`/purchasing/suppliers/${id}`);
    },
    onResult: (result, draft) => {
      queryClient.setQueryData(queryKeys.suppliers.card(result.id), draft);
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.root });
    },
  });
  const currentSupplierId = engine.currentId;
  const isDraft = !engine.hasPersistedEntity;

  const display = engine.draft;
  const readOnly = Boolean(display.deletedAt);

  const actions = useCardEntityActions({
    entity: "supplier-action",
    getId: () => engine.currentId,
    flush: engine.flush,
    invalidateQueryKeys: [queryKeys.suppliers.root],
    delete: {
      label: "Delete supplier",
      run: (id) => deleteSupplier(id),
      navigateTo: "/purchasing/suppliers",
      confirm: {
        title: "Delete supplier?",
        description: (
          <>
            This supplier will be soft-deleted. Suppliers with active draft,
            ordered, or partially received purchase orders cannot be deleted.
          </>
        ),
      },
    },
  });


  const commitSupplierPatch = useCallback(
    (patch: PatchSupplier) => {
      if (readOnly) return;
      engine.applyLocalOp({ type: "patch", patch });
    },
    [engine, readOnly]
  );

  const applySupplierAddress = useCallback(
    (address: SupplierAddressFields | null) => {
      commitSupplierPatch(billingAddressPatch(address ? normalizeAddressFields(address) : emptyAddressFields()));
    },
    [commitSupplierPatch]
  );

  const addressDialog = useAddressBookDialog({
    entity: "supplier",
    entityId: currentSupplierId,
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
  const cardSaveState: CardSaveState = readOnly
    ? "readonly"
    : engine.status === "saving" || engine.status === "dirty"
      ? "saving"
      : engine.status === "error"
        ? "failed"
        : isDraft
          ? "not_saved"
          : "saved";
  const cardSaveMessage =
    cardSaveState === "saved"
      ? "Saved"
      : cardSaveState === "failed"
        ? engine.error
        : null;

  return (
    <CardPage>
      <CardPageHeader
        title={display.name.trim() || "New supplier"}
        saveState={cardSaveState}
        saveMessage={cardSaveMessage}
        fallbackHref="/purchasing/suppliers"
        showPrint={false}
        menuActions={
          isDraft || readOnly
            ? []
            : [
                {
                  label: "Print",
                  onClick: () => window.print(),
                },
                ...(actions.deleteAction ? [actions.deleteAction] : []),
              ]
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
              errors={engine.fieldErrors}
            >
              <SupplierFields.Text
                name="name"
                label="Name"
                required
                autoFocus={isDraft}
                invalid={isDraft && !display.name.trim()}
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
              if (isDraft) engine.applyLocalOp({ type: "patch", patch: { notes } }, Number.POSITIVE_INFINITY);
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

function makeDraftSupplier(draft: InsertSupplier): SupplierRow {
  const now = new Date();
  return {
    id: "__draft__",
    ...draft,
    xeroContactId: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeSupplierDraft(draft: InsertSupplier): InsertSupplier {
  return {
    ...draft,
    name: draft.name.trim(),
  };
}

function mergeSupplierPatch(supplier: SupplierRow, patch: PatchSupplier): SupplierRow {
  return {
    ...supplier,
    ...patch,
    updatedAt: new Date(),
  };
}

function supplierToInsertInput(supplier: SupplierRow): InsertSupplier {
  return normalizeSupplierDraft({
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
  });
}

function supplierEditableSnapshot(supplier: SupplierRow): Pick<
  SupplierRow,
  | "name"
  | "code"
  | "contactName"
  | "email"
  | "phone"
  | "billingLine1"
  | "billingLine2"
  | "billingCity"
  | "billingRegion"
  | "billingPostcode"
  | "billingCountry"
  | "paymentTerms"
  | "notes"
> {
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
