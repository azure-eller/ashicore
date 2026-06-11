"use client";

import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { AddressBookFields } from "@/components/address-book-fields";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
import styles from "@/components/card-page/card-page.module.css";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { createAddressEntry, updateAddressEntry } from "@/lib/api/clients/addresses";
import {
  addressEntryToAddressOption,
  addressKey,
  formatAddressInline,
  isAddressBlank,
  makeUniqueAddressLabel,
  type AddressEntryOption,
  type StructuredAddress,
} from "@/lib/addresses";
import type { AddressEntry } from "@/lib/dal/addresses";
import { createAddressEntrySchema } from "@/lib/schemas/addresses";

const addAddressValue = "__add_address__";
const editAddressValue = "__edit_address__";
const sameAsShippingValue = "__same_as_shipping__";

const addressFieldNames = {
  line1: "line1",
  line2: "line2",
  city: "city",
  region: "region",
  postcode: "postcode",
  country: "country",
} as const;

type AddressDialogValues = z.input<typeof createAddressEntrySchema>;

const emptyAddressDialogValues: AddressDialogValues = {
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

/**
 * Saved-address combobox for card pages: pick from the org address book,
 * with add-new / edit-selected affordances and an optional
 * "same as shipping" sentinel for billing fields.
 */
export function AddressBookInput({
  id,
  value,
  options,
  placeholder,
  sameAsShipping,
  sameAsShippingLabel,
  disabled,
  onChange,
  onAddNew,
  onEdit,
}: {
  id: string;
  value: StructuredAddress | null;
  options: AddressEntryOption[];
  placeholder: string;
  sameAsShipping?: boolean;
  sameAsShippingLabel?: string;
  disabled?: boolean;
  onChange: (address: StructuredAddress | null) => void;
  onAddNew: () => void;
  onEdit: (option: AddressEntryOption) => void;
}) {
  const currentAddressId =
    sameAsShipping && (!value || isAddressBlank(value))
      ? sameAsShippingValue
      : addressKey(value);
  const canEditCurrent =
    currentAddressId !== "" && currentAddressId !== sameAsShippingValue;
  const optionIds = options.map((option) => option.id);
  const optionMap = new Map(options.map((option) => [option.id, option]));
  const items = [
    ...(sameAsShipping ? [sameAsShippingValue] : []),
    ...optionIds,
    ...(canEditCurrent ? [editAddressValue] : []),
    addAddressValue,
  ];

  return (
    <Combobox
      items={items}
      value={currentAddressId}
      onValueChange={(nextValue) => {
        if (!nextValue) {
          onChange(null);
          return;
        }
        if (nextValue === sameAsShippingValue) {
          onChange(null);
          return;
        }
        if (nextValue === addAddressValue) {
          onAddNew();
          return;
        }
        if (nextValue === editAddressValue) {
          const option = optionMap.get(currentAddressId);
          if (option) onEdit(option);
          return;
        }
        onChange(optionMap.get(nextValue) ?? null);
      }}
      itemToStringLabel={(itemId) => {
        if (itemId === sameAsShippingValue) {
          return sameAsShippingLabel || "Same as shipping address";
        }
        if (itemId === addAddressValue) return "Add new address";
        if (itemId === editAddressValue) return "Edit selected address";
        return optionMap.get(itemId)?.label ?? "";
      }}
    >
      <ComboboxInput
        id={id}
        placeholder={placeholder}
        disabled={disabled}
        showClear={currentAddressId !== "" && currentAddressId !== sameAsShippingValue}
        className={styles.underlineControl}
      />
      <ComboboxContent className="w-[min(28rem,calc(100vw-2rem))] bg-[var(--color-surface)] text-[var(--color-ink)]">
        <ComboboxEmpty>No addresses found</ComboboxEmpty>
        <ComboboxList>
          {(itemId: string) => {
            if (itemId === sameAsShippingValue) {
              return (
                <ComboboxItem key={itemId} value={itemId}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">
                      {sameAsShippingLabel || "Same as shipping address"}
                    </span>
                    {sameAsShippingLabel ? (
                      <span className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                        Same as shipping address
                      </span>
                    ) : null}
                  </span>
                </ComboboxItem>
              );
            }
            if (itemId === addAddressValue) {
              return (
                <ComboboxItem key={itemId} value={itemId}>
                  Add new address
                </ComboboxItem>
              );
            }
            if (itemId === editAddressValue) {
              return (
                <ComboboxItem key={itemId} value={itemId}>
                  Edit selected address
                </ComboboxItem>
              );
            }

            const option = optionMap.get(itemId);
            return (
              <ComboboxItem key={itemId} value={itemId}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{option?.label}</span>
                  <span className="truncate text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                    {option ? formatAddressInline(option) : ""}
                  </span>
                </span>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
        {optionIds.length > 0 ? <ComboboxSeparator /> : null}
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * Address-book add/edit dialog lifecycle for card pages: owns the form,
 * the create/update mutation, label uniquing, and the dialog JSX.
 * `TContext` carries call-site state through open -> save (e.g. which
 * address field the save applies to).
 */
export function useAddressBookDialog<TContext = void>({
  entity,
  entityId,
  idPrefix,
  addressBook,
  setAddressBook,
  onSaved,
}: {
  entity: string;
  entityId: string | null;
  idPrefix: string;
  addressBook: AddressEntry[];
  setAddressBook: React.Dispatch<React.SetStateAction<AddressEntry[]>>;
  onSaved: (option: AddressEntryOption, context: TContext) => void;
}) {
  const [dialogState, setDialogState] = useState<{
    context: TContext;
    option: AddressEntryOption | null;
  } | null>(null);

  const form = useForm<AddressDialogValues>({
    resolver: zodResolver(createAddressEntrySchema),
    defaultValues: emptyAddressDialogValues,
  });

  const mutation = useMutation({
    mutationKey: cardSaveMutationKey(entity, entityId ?? "__draft__", "address-book"),
    mutationFn: ({ id, values }: { id: string | null; values: AddressDialogValues }) => {
      const data = createAddressEntrySchema.parse(values);
      return id ? updateAddressEntry(id, data) : createAddressEntry(data);
    },
    onSuccess: (entry) => {
      const option = addressEntryToAddressOption(entry);
      if (!option || !dialogState) return;

      setAddressBook((current) => {
        const next = current.filter((address) => address.id !== entry.id);
        return [...next, entry].sort((a, b) => a.label.localeCompare(b.label));
      });
      onSaved(option, dialogState.context);
      setDialogState(null);
      form.reset(emptyAddressDialogValues);
    },
  });

  const openNew = useCallback(
    (context: TContext) => {
      mutation.reset();
      form.reset(emptyAddressDialogValues);
      setDialogState({ context, option: null });
    },
    [form, mutation]
  );

  const openEdit = useCallback(
    (option: AddressEntryOption, context: TContext) => {
      mutation.reset();
      form.reset({
        label: option.label,
        contactName: option.contactName,
        contactPhone: option.contactPhone,
        line1: option.line1,
        line2: option.line2,
        city: option.city,
        region: option.region,
        postcode: option.postcode,
        country: option.country,
        notes: option.notes,
        deliveryInstructions: option.deliveryInstructions,
      });
      setDialogState({ context, option });
    },
    [form, mutation]
  );

  const handleSubmit = useCallback(
    (values: AddressDialogValues) => {
      if (!dialogState) return;
      const label = makeUniqueAddressLabel(
        values,
        addressBook.map((address) => address.label),
      );
      mutation.mutate({
        id: dialogState.option?.addressEntryId ?? null,
        values: { ...values, label },
      });
    },
    [addressBook, dialogState, mutation]
  );

  const formId = `${idPrefix}-address-form`;
  const dialog = (
    <Dialog
      open={dialogState != null}
      onOpenChange={(open) => {
        if (!open) setDialogState(null);
      }}
    >
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>
            {dialogState?.option ? "Edit address" : "Add address"}
          </DialogTitle>
        </DialogHeader>
        <form id={formId} onSubmit={form.handleSubmit(handleSubmit)}>
          {mutation.error ? (
            <FieldError>
              {(mutation.error as Error).message || "Failed to save address."}
            </FieldError>
          ) : null}
          <AddressBookFields
            control={form.control}
            addressNames={addressFieldNames}
            idPrefix={`${idPrefix}-address`}
            labelName="label"
            contactNameName="contactName"
            contactPhoneName="contactPhone"
            notesName="notes"
          />
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDialogState(null)}
          >
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={mutation.isPending}>
            {mutation.isPending
              ? "Saving..."
              : dialogState?.option
                ? "Save address"
                : "Add address"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { dialog, openNew, openEdit };
}
