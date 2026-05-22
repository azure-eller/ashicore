"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AddressFields } from "@/components/address-fields";
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
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHeader } from "@/components/tooltip-header";
import {
  CardPage,
  CardPageBody,
  CardSection,
} from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { CellShell } from "@/components/card-page/form-cell";
import {
  cardSaveMutationKey,
  saveStateFromEntityStatus,
  useEntitySaveStatus,
  type CardSaveState,
} from "@/components/card-page/card-save-status";
import { useOrganizationTimeZone } from "@/components/time-zone-provider";
import {
  createAddressEntry,
  updateAddressEntry,
} from "@/lib/api/clients/customers";
import {
  createSupplier,
  deleteSupplier,
  getSupplierCard,
  patchSupplier,
} from "@/lib/api/clients/suppliers";
import type { AddressEntry } from "@/lib/dal/addresses";
import { createAddressEntrySchema } from "@/lib/schemas/addresses";
import {
  supplierDefaultValues,
  type InsertSupplier,
  type PatchSupplier,
} from "@/lib/schemas/suppliers";
import { formatAddressLines, formatDateTime, normalizeAddressFields } from "@/lib/format";
import {
  PAYMENT_TERMS_TOOLTIP,
  SUPPLIER_CODE_TOOLTIP,
} from "@/lib/tooltip-copy";
import type { SupplierRow } from "./types";
import styles from "@/components/card-page/card-page.module.css";

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

type SupplierAddressOption = SupplierAddressFields & {
  id: string;
  label: string;
  addressEntryId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  deliveryInstructions: string | null;
  notes: string | null;
};

type AddressDialogValues = z.input<typeof createAddressEntrySchema>;

const addAddressValue = "__add_address__";
const editAddressValue = "__edit_address__";
const addressFieldNames = {
  line1: "line1",
  line2: "line2",
  city: "city",
  region: "region",
  postcode: "postcode",
  country: "country",
} as const;
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

export function SupplierCard({
  initialSupplierId,
  initialSupplier,
  addresses,
}: SupplierCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const timeZone = useOrganizationTimeZone();
  const [currentSupplierId, setCurrentSupplierId] = useState(initialSupplierId);
  const [localSupplier, setLocalSupplier] = useState<SupplierRow | null>(
    initialSupplier
  );
  const [addressBook, setAddressBook] = useState(addresses);
  const [addressDialogOption, setAddressDialogOption] =
    useState<SupplierAddressOption | null>(null);
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [draftSupplier, setDraftSupplier] =
    useState<InsertSupplier>(supplierDefaultValues);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDraft = currentSupplierId == null;

  const supplierQuery = useQuery({
    queryKey: ["supplier-card", currentSupplierId ?? "__draft__"],
    queryFn: () => getSupplierCard(currentSupplierId as string),
    initialData: initialSupplier ?? undefined,
    enabled: !isDraft && !initialSupplier?.deletedAt,
    refetchOnWindowFocus: false,
  });
  const supplier = isDraft ? null : localSupplier ?? supplierQuery.data ?? initialSupplier;
  const display = supplier ?? makeDraftSupplier(draftSupplier);
  const readOnly = Boolean(display.deletedAt);
  const saveStatus = useEntitySaveStatus("supplier", currentSupplierId ?? "__draft__");

  const createMutation = useMutation({
    mutationKey: cardSaveMutationKey("supplier", "__draft__", "create"),
    mutationFn: (input: InsertSupplier) => createSupplier(input),
    onSuccess: async (result) => {
      setCurrentSupplierId(result.id);
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      const next = await getSupplierCard(result.id);
      setLocalSupplier(next);
      queryClient.setQueryData(["supplier-card", result.id], next);
      router.replace(`/purchasing/suppliers/${result.id}`);
    },
  });

  const patchMutation = useMutation({
    mutationKey: cardSaveMutationKey("supplier", currentSupplierId ?? "__draft__", "patch"),
    mutationFn: (input: { current: SupplierRow; patch: PatchSupplier }) =>
      patchSupplier(currentSupplierId as string, input.current, input.patch),
    onSettled: async () => {
      if (!currentSupplierId) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["supplier-card", currentSupplierId] }),
        queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationKey: ["supplier-action", currentSupplierId ?? "__draft__", "delete"],
    mutationFn: () => deleteSupplier(currentSupplierId as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      router.push("/purchasing/suppliers");
    },
  });

  const addressForm = useForm<AddressDialogValues>({
    resolver: zodResolver(createAddressEntrySchema),
    defaultValues: emptyAddressDialogValues,
  });

  const addressMutation = useMutation({
    mutationKey: cardSaveMutationKey("supplier", currentSupplierId ?? "__draft__", "address-book"),
    mutationFn: ({ id, values }: { id: string | null; values: AddressDialogValues }) => {
      const data = createAddressEntrySchema.parse(values);
      return id ? updateAddressEntry(id, data) : createAddressEntry(data);
    },
    onSuccess: (entry) => {
      const option = addressEntryToOption(entry);
      if (!option) return;
      setAddressBook((current) => {
        const next = current.filter((address) => address.id !== entry.id);
        return [...next, entry].sort((a, b) => a.label.localeCompare(b.label));
      });
      applySupplierAddress(option);
      setAddressDialogOpen(false);
      setAddressDialogOption(null);
      addressForm.reset(emptyAddressDialogValues);
    },
  });

  const updateDraft = useCallback((patch: Partial<InsertSupplier>) => {
    setDraftSupplier((current) => ({ ...current, ...patch }));
  }, []);

  const commitDraft = useCallback(
    (patch?: Partial<InsertSupplier>) => {
      if (!isDraft || createMutation.isPending || createMutation.isSuccess) return;
      const next = { ...draftSupplier, ...patch };
      if (!next.name.trim()) return;
      createMutation.mutate({ ...next, name: next.name.trim() });
    },
    [createMutation, draftSupplier, isDraft]
  );

  const commitSupplierPatch = useCallback(
    (patch: PatchSupplier) => {
      if (readOnly) return;
      if (isDraft) {
        updateDraft(patch);
        commitDraft(patch);
        return;
      }
      const nextSupplier = mergeSupplierPatch(display, patch);
      setLocalSupplier(nextSupplier);
      patchMutation.mutate({ current: nextSupplier, patch: {} });
    },
    [commitDraft, display, isDraft, patchMutation, readOnly, updateDraft]
  );

  const applySupplierAddress = useCallback(
    (address: SupplierAddressFields | null) => {
      commitSupplierPatch(billingAddressPatch(address ? normalizeSupplierAddress(address) : emptySupplierAddress()));
    },
    [commitSupplierPatch]
  );

  const openAddressDialog = useCallback(() => {
    addressMutation.reset();
    addressForm.reset(emptyAddressDialogValues);
    setAddressDialogOption(null);
    setAddressDialogOpen(true);
  }, [addressForm, addressMutation]);

  const openEditAddressDialog = useCallback(
    (option: SupplierAddressOption) => {
      addressMutation.reset();
      addressForm.reset({
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
      setAddressDialogOption(option);
      setAddressDialogOpen(true);
    },
    [addressForm, addressMutation]
  );

  const handleAddressDialogSubmit = useCallback(
    (values: AddressDialogValues) => {
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
      addressMutation.mutate({
        id: addressDialogOption?.addressEntryId ?? null,
        values: { ...values, label },
      });
    },
    [addressBook, addressDialogOption, addressMutation]
  );

  const billingAddress = getSupplierBillingAddress(display);
  const addressOptions = useMemo(
    () =>
      addressBook
        .map(addressEntryToOption)
        .filter((option): option is SupplierAddressOption => option != null),
    [addressBook]
  );
  const cardSaveState: CardSaveState = readOnly
    ? "readonly"
    : isDraft
      ? createMutation.isPending
        ? "saving"
        : createMutation.isError
          ? "failed"
          : "not_saved"
      : saveStateFromEntityStatus(saveStatus.status);

  return (
    <CardPage>
      <CardPageHeader
        eyebrow="Supplier"
        title={display.name.trim() || "New supplier"}
        meta={<SupplierMeta supplier={display} isDraft={isDraft} timeZone={timeZone} />}
        saveState={cardSaveState}
        fallbackHref="/purchasing/suppliers"
        menuActions={
          isDraft || readOnly
            ? []
            : [
                {
                  label: "Delete supplier",
                  destructive: true,
                  onClick: () => setConfirmDelete(true),
                },
              ]
        }
      />
      <CardPageBody>
        <CardSection title="Supplier at a glance">
          <div className={`${styles.formRow} ${styles.formRowThree}`}>
            <CellShell label="Name" required>
              <UnderlineCommitInput
                label="Name"
                value={display.name}
                disabled={readOnly || createMutation.isPending}
                autoFocus={isDraft}
                required
                onCommit={(name) => {
                  if (name) commitSupplierPatch({ name });
                }}
              />
            </CellShell>
            <CellShell label={<TooltipHeader label="Code" tooltip={SUPPLIER_CODE_TOOLTIP} />}>
              <UnderlineCommitInput
                label="Code"
                value={display.code ?? ""}
                disabled={readOnly || createMutation.isPending}
                onCommit={(code) => commitSupplierPatch({ code })}
              />
            </CellShell>
            <CellShell label="Contact name">
              <UnderlineCommitInput
                label="Contact name"
                value={display.contactName ?? ""}
                disabled={readOnly || createMutation.isPending}
                onCommit={(contactName) => commitSupplierPatch({ contactName })}
              />
            </CellShell>
            <CellShell label="Email">
              <UnderlineCommitInput
                label="Email"
                type="email"
                value={display.email ?? ""}
                disabled={readOnly || createMutation.isPending}
                onCommit={(email) => commitSupplierPatch({ email })}
              />
            </CellShell>
            <CellShell label="Phone">
              <UnderlineCommitInput
                label="Phone"
                value={display.phone ?? ""}
                disabled={readOnly || createMutation.isPending}
                onCommit={(phone) => commitSupplierPatch({ phone })}
              />
            </CellShell>
            <CellShell label={<TooltipHeader label="Payment terms" tooltip={PAYMENT_TERMS_TOOLTIP} />}>
              <UnderlineCommitInput
                label="Payment terms"
                value={display.paymentTerms ?? ""}
                disabled={readOnly || createMutation.isPending}
                onCommit={(paymentTerms) => commitSupplierPatch({ paymentTerms })}
              />
            </CellShell>
            <CellShell label="Billing address">
              <SupplierAddressInput
                id="supplier-billing-address"
                value={billingAddress}
                options={addressOptions}
                disabled={readOnly || createMutation.isPending}
                onChange={applySupplierAddress}
                onAddNew={openAddressDialog}
                onEdit={openEditAddressDialog}
              />
            </CellShell>
          </div>
        </CardSection>

        <CardSection title="Notes">
          <InlineTextareaField
            label="Notes"
            value={display.notes ?? ""}
            disabled={readOnly || createMutation.isPending}
            readOnlyValue={readOnly}
            onDraftChange={(notes) => {
              if (isDraft) updateDraft({ notes });
            }}
            onCommit={(notes) => commitSupplierPatch({ notes })}
          />
        </CardSection>
      </CardPageBody>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete supplier?</AlertDialogTitle>
            <AlertDialogDescription>
              This supplier will be soft-deleted. Suppliers with active draft,
              ordered, or partially received purchase orders cannot be deleted.
              {deleteMutation.error ? (
                <span className="mt-(--space-2) block text-destructive">
                  {(deleteMutation.error as Error).message}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => deleteMutation.reset()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={addressDialogOpen}
        onOpenChange={(open) => {
          setAddressDialogOpen(open);
          if (!open) setAddressDialogOption(null);
        }}
      >
        <DialogContent size="2xl">
          <DialogHeader>
            <DialogTitle>
              {addressDialogOption ? "Edit address" : "Add address"}
            </DialogTitle>
          </DialogHeader>
          <form
            id="supplier-address-form"
            onSubmit={addressForm.handleSubmit(handleAddressDialogSubmit)}
          >
            {addressMutation.error ? (
              <FieldError>
                {(addressMutation.error as Error).message || "Failed to save address."}
              </FieldError>
            ) : null}
            <FieldGroup className="gap-4">
              <Controller
                control={addressForm.control}
                name="label"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="supplier-address-label">Label</FieldLabel>
                    <Input
                      {...field}
                      id="supplier-address-label"
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value)}
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : null}
                  </Field>
                )}
              />
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Controller
                  control={addressForm.control}
                  name="contactName"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="supplier-address-contact-name">
                        Contact name
                      </FieldLabel>
                      <Input
                        {...field}
                        id="supplier-address-contact-name"
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid ? (
                        <FieldError errors={[fieldState.error]} />
                      ) : null}
                    </Field>
                  )}
                />
                <Controller
                  control={addressForm.control}
                  name="contactPhone"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="supplier-address-contact-phone">
                        Contact phone
                      </FieldLabel>
                      <Input
                        {...field}
                        id="supplier-address-contact-phone"
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid ? (
                        <FieldError errors={[fieldState.error]} />
                      ) : null}
                    </Field>
                  )}
                />
              </FieldGroup>
            </FieldGroup>
            <AddressFields
              control={addressForm.control}
              names={addressFieldNames}
              idPrefix="supplier-address"
            />
            <FieldGroup className="mt-4 gap-4">
              <Controller
                control={addressForm.control}
                name="notes"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="supplier-address-notes">Notes</FieldLabel>
                    <Textarea
                      {...field}
                      id="supplier-address-notes"
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value || null)}
                      aria-invalid={fieldState.invalid}
                      rows={3}
                    />
                    {fieldState.invalid ? (
                      <FieldError errors={[fieldState.error]} />
                    ) : null}
                  </Field>
                )}
              />
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddressDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="supplier-address-form"
              disabled={addressMutation.isPending}
            >
              {addressMutation.isPending
                ? "Saving..."
                : addressDialogOption
                  ? "Save address"
                  : "Add address"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardPage>
  );
}

function SupplierMeta({
  supplier,
  isDraft,
  timeZone,
}: {
  supplier: SupplierRow;
  isDraft: boolean;
  timeZone: string;
}) {
  const parts = [];
  if (supplier.code) {
    parts.push(
      <span key="code" className={styles.mono}>
        {supplier.code}
      </span>
    );
  }
  if (!isDraft) {
    parts.push(<span key="created">Created {formatDateTime(supplier.createdAt, timeZone)}</span>);
    parts.push(<span key="updated">Updated {formatDateTime(supplier.updatedAt, timeZone)}</span>);
  }
  if (parts.length === 0) return null;
  return (
    <>
      {parts.map((part, index) => (
        <span key={part.key ?? index} className="inline-flex items-center gap-(--space-2)">
          {index > 0 ? <span className={styles.metaDot} /> : null}
          {part}
        </span>
      ))}
    </>
  );
}

function UnderlineCommitInput({
  label,
  type,
  value,
  disabled,
  required,
  autoFocus,
  onCommit,
}: {
  label: string;
  type?: string;
  value: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  onCommit: (value: string | null) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value ?? "");
  if (draft !== (value ?? "") && disabled) setDraft(value ?? "");
  return (
    <Input
      id={id}
      type={type}
      aria-label={label}
      className={styles.underlineControl}
      value={draft}
      autoFocus={autoFocus}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim() || null;
        if (required && next == null) {
          setDraft(value ?? "");
          return;
        }
        if (next === (value || null)) return;
        onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function SupplierAddressInput({
  id,
  value,
  options,
  disabled,
  onChange,
  onAddNew,
  onEdit,
}: {
  id: string;
  value: SupplierAddressFields | null;
  options: SupplierAddressOption[];
  disabled?: boolean;
  onChange: (address: SupplierAddressFields | null) => void;
  onAddNew: () => void;
  onEdit: (option: SupplierAddressOption) => void;
}) {
  const currentAddressId = supplierAddressKey(value);
  const canEditCurrent = currentAddressId !== "";
  const optionIds = options.map((option) => option.id);
  const optionMap = new Map(options.map((option) => [option.id, option]));
  const items = [
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
        if (itemId === addAddressValue) return "Add new address";
        if (itemId === editAddressValue) return "Edit selected address";
        return optionMap.get(itemId)?.label ?? "";
      }}
    >
      <ComboboxInput
        id={id}
        placeholder="Billing address"
        disabled={disabled}
        showClear={currentAddressId !== ""}
        className={styles.underlineControl}
      />
      <ComboboxContent className="w-[min(28rem,calc(100vw-2rem))] bg-popover text-popover-foreground">
        <ComboboxEmpty>No addresses found</ComboboxEmpty>
        <ComboboxList>
          {(itemId: string) => {
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
                  <span className="truncate text-xs text-muted-foreground">
                    {option ? supplierAddressLabel(option) : ""}
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

function InlineTextareaField({
  label,
  value,
  disabled,
  readOnlyValue,
  onDraftChange,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  readOnlyValue?: boolean;
  onDraftChange?: (value: string) => void;
  onCommit: (value: string | null) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value ?? "");
  if (draft !== (value ?? "") && disabled) setDraft(value ?? "");

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {readOnlyValue ? (
        <div className="min-h-36 border border-border p-(--space-4) text-[length:var(--text-sm)]">
          {value || "-"}
        </div>
      ) : (
        <Textarea
          id={id}
          className="min-h-36"
          value={draft}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            onDraftChange?.(event.target.value);
          }}
          onBlur={() => {
            const next = draft.trim() || null;
            if (next === (value || null)) return;
            onCommit(next);
          }}
        />
      )}
    </Field>
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

function mergeSupplierPatch(supplier: SupplierRow, patch: PatchSupplier): SupplierRow {
  return {
    ...supplier,
    ...patch,
    updatedAt: new Date(),
  };
}

function normalizeSupplierAddress(address: SupplierAddressFields): SupplierAddressFields {
  return normalizeAddressFields(address);
}

function emptySupplierAddress(): SupplierAddressFields {
  return {
    line1: null,
    line2: null,
    city: null,
    region: null,
    postcode: null,
    country: null,
  };
}

function getSupplierBillingAddress(supplier: SupplierRow): SupplierAddressFields {
  return normalizeSupplierAddress({
    line1: supplier.billingLine1,
    line2: supplier.billingLine2,
    city: supplier.billingCity,
    region: supplier.billingRegion,
    postcode: supplier.billingPostcode,
    country: supplier.billingCountry,
  });
}

function supplierAddressKey(address: SupplierAddressFields | null | undefined) {
  const normalized = address ? normalizeSupplierAddress(address) : emptySupplierAddress();
  return [
    normalized.line1,
    normalized.line2,
    normalized.city,
    normalized.region,
    normalized.postcode,
    normalized.country,
  ]
    .map((part) => part ?? "")
    .join("\u001f")
    .replace(/^\u001f+|\u001f+$/g, "");
}

function supplierAddressLabel(address: SupplierAddressFields) {
  return formatAddressLines(address).join(", ");
}

function addressEntryToOption(entry: AddressEntry): SupplierAddressOption | null {
  const normalized = normalizeSupplierAddress({
    line1: entry.line1,
    line2: entry.line2,
    city: entry.city,
    region: entry.region,
    postcode: entry.postcode,
    country: entry.country,
  });
  const id = supplierAddressKey(normalized);
  if (!id) return null;
  return {
    ...normalized,
    id,
    label: entry.label,
    addressEntryId: entry.id,
    contactName: entry.contactName,
    contactPhone: entry.contactPhone,
    deliveryInstructions: entry.deliveryInstructions,
    notes: entry.notes,
  };
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
