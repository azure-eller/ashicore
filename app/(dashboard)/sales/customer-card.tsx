"use client";

import Link from "next/link";
import { useCallback, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams, ValueSetterParams } from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  MoreVerticalIcon,
  PrinterIcon,
  StarIcon,
} from "@hugeicons/core-free-icons";
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
import { Button } from "@/components/ui/button";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusLabel, type StatusTone } from "@/components/ui/status-label";
import { Textarea } from "@/components/ui/textarea";
import {
  EditableLineDataGrid,
  type ColDef,
  type EditableLineDataGridChange,
} from "@/components/editable-line-data-grid";
import { EditableInfoGrid } from "@/components/editable-info-grid";
import {
  createAddressEntry,
  createCustomer,
  createCustomerContact,
  createCustomerProject,
  deleteCustomer,
  deleteCustomerContact,
  deleteCustomerProject,
  getCustomerCard,
  patchCustomer,
  updateAddressEntry,
  updateCustomerContact,
  updateCustomerProject,
} from "@/lib/api/clients/customers";
import type { AddressEntry } from "@/lib/dal/addresses";
import { formatAddressLines, formatDate, formatPrice, normalizeAddressFields } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createAddressEntrySchema } from "@/lib/schemas/addresses";
import {
  customerDefaultValues,
  type InsertCustomer,
  type PatchCustomer,
} from "@/lib/schemas/customers";
import type {
  CustomerContactRole,
  CustomerContactRow,
  CustomerDetailData,
  CustomerLinkedSalesOrderRow,
  CustomerProjectRow,
} from "./types";
import { useCustomerSaveStatus } from "@/components/customer-card/use-customer-save-status";
import { SalesOrderStatusBadge } from "./status-badge";
import styles from "@/components/card-page/card-page.module.css";

type CustomerCardProps = {
  initialCustomerId: string | null;
  initialCustomer: CustomerDetailData | null;
  addresses: AddressEntry[];
};

type ContactGridRow = CustomerContactRow & { isNew?: boolean };
type ProjectGridRow = CustomerProjectRow & { isNew?: boolean };
type OpenOrderGridRow = CustomerLinkedSalesOrderRow;
type AddressTarget = "billing" | "shipping";
type CustomerAddressFields = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
};
type CustomerAddressOption = CustomerAddressFields & {
  id: string;
  label: string;
  addressEntryId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  deliveryInstructions: string | null;
  notes: string | null;
};
type AddressDialogValues = z.input<typeof createAddressEntrySchema>;
type AddressDialogState = {
  target: AddressTarget;
  option: CustomerAddressOption | null;
};

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

const projectStatusMeta: Record<
  ProjectGridRow["status"],
  { label: string; tone: StatusTone }
> = {
  planning: { label: "Planning", tone: "neutral" },
  active: { label: "In Progress", tone: "warning" },
  hold: { label: "On Hold", tone: "warning" },
  done: { label: "Done", tone: "success" },
};
export function CustomerCard({
  initialCustomerId,
  initialCustomer,
  addresses,
}: CustomerCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [currentCustomerId, setCurrentCustomerId] = useState(initialCustomerId);
  const [addressBook, setAddressBook] = useState(addresses);
  const [addressDialogState, setAddressDialogState] =
    useState<AddressDialogState | null>(null);
  const [draftCustomer, setDraftCustomer] = useState<InsertCustomer>({
    ...customerDefaultValues,
    accountState: "active",
    accountPriority: "standard",
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDraft = currentCustomerId == null;

  const customerQuery = useQuery({
    queryKey: ["customer-card", currentCustomerId ?? "__draft__"],
    queryFn: () => getCustomerCard(currentCustomerId as string),
    initialData: initialCustomer ?? undefined,
    enabled: !isDraft,
    refetchOnWindowFocus: false,
  });
  const customer = isDraft ? null : customerQuery.data ?? initialCustomer;
  const readOnly = Boolean(customer?.deletedAt);
  const saveStatus = useCustomerSaveStatus(currentCustomerId ?? "__draft__");

  const createMutation = useMutation({
    mutationKey: ["customer-card", "__draft__", "create"],
    mutationFn: (input: InsertCustomer) => createCustomer(input),
    onSuccess: async (result) => {
      setCurrentCustomerId(result.id);
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      const next = await getCustomerCard(result.id);
      queryClient.setQueryData(["customer-card", result.id], next);
      router.replace(`/sales/customers/${result.id}`);
    },
  });

  const patchMutation = useMutation({
    mutationKey: ["customer-card", currentCustomerId ?? "__draft__", "patch"],
    mutationFn: (input: PatchCustomer) =>
      patchCustomer(currentCustomerId as string, input),
    onSettled: async () => {
      if (!currentCustomerId) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer-card", currentCustomerId] }),
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationKey: ["customer-card", currentCustomerId ?? "__draft__", "delete"],
    mutationFn: () => deleteCustomer(currentCustomerId as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      router.push("/sales/customers");
    },
  });

  const addressForm = useForm<AddressDialogValues>({
    resolver: zodResolver(createAddressEntrySchema),
    defaultValues: emptyAddressDialogValues,
  });

  const addressMutation = useMutation({
    mutationKey: ["customer-card", currentCustomerId ?? "__draft__", "address-book"],
    mutationFn: ({ id, values }: { id: string | null; values: AddressDialogValues }) => {
      const data = createAddressEntrySchema.parse(values);
      return id ? updateAddressEntry(id, data) : createAddressEntry(data);
    },
    onSuccess: (entry) => {
      const option = addressEntryToOption(entry);
      if (!option || !addressDialogState) return;

      setAddressBook((current) => {
        const next = current.filter((address) => address.id !== entry.id);
        return [...next, entry].sort((a, b) => a.label.localeCompare(b.label));
      });
      applyCustomerAddress(addressDialogState.target, option);
      setAddressDialogState(null);
      addressForm.reset(emptyAddressDialogValues);
    },
  });

  const updateDraft = useCallback((patch: Partial<InsertCustomer>) => {
    setDraftCustomer((current) => ({ ...current, ...patch }));
  }, []);

  const commitDraft = useCallback(
    (patch?: Partial<InsertCustomer>) => {
      if (!isDraft || createMutation.isPending || createMutation.isSuccess) return;
      const next = { ...draftCustomer, ...patch };
      if (!next.name.trim()) return;
      createMutation.mutate({ ...next, name: next.name.trim() });
    },
    [createMutation, draftCustomer, isDraft]
  );

  const commitCustomerPatch = useCallback(
    (patch: PatchCustomer) => {
      if (readOnly) return;
      if (isDraft) {
        updateDraft(patch);
        commitDraft(patch);
        return;
      }
      patchMutation.mutate(patch);
    },
    [commitDraft, isDraft, patchMutation, readOnly, updateDraft]
  );

  const applyCustomerAddress = useCallback(
    (target: AddressTarget, address: CustomerAddressFields | null) => {
      const normalized = address ? normalizeCustomerAddress(address) : emptyCustomerAddress();
      const patch =
        target === "shipping"
          ? shippingAddressPatch(normalized)
          : billingAddressPatch(normalized);
      commitCustomerPatch(patch);
    },
    [commitCustomerPatch]
  );

  const openAddressDialog = useCallback(
    (target: AddressTarget) => {
      addressMutation.reset();
      addressForm.reset(emptyAddressDialogValues);
      setAddressDialogState({ target, option: null });
    },
    [addressForm, addressMutation]
  );

  const openEditAddressDialog = useCallback(
    (target: AddressTarget, option: CustomerAddressOption) => {
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
      setAddressDialogState({ target, option });
    },
    [addressForm, addressMutation]
  );

  const handleAddressDialogSubmit = useCallback(
    (values: AddressDialogValues) => {
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
      addressMutation.mutate({
        id: addressDialogState.option?.addressEntryId ?? null,
        values: { ...values, label },
      });
    },
    [addressBook, addressDialogState, addressMutation]
  );

  const display = customer ?? makeDraftCustomer(draftCustomer);
  const openOrders = display.salesOrders.filter((order) => order.status === "open");
  const billingAddress = getCustomerBillingAddress(display);
  const shippingAddress = getCustomerShippingAddress(display);
  const billingSameAsShipping = isCustomerAddressBlank(billingAddress);
  const addressOptions = useMemo(
    () =>
      addressBook
        .map(addressEntryToOption)
        .filter((option): option is CustomerAddressOption => option != null),
    [addressBook]
  );

  return (
    <div className={styles.sheet}>
      <header className={styles.header}>
        <div className={styles.headerIdentity}>
          <div className={styles.eyebrow}>Customer</div>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>
              {display.name.trim() || "New customer"}
            </h1>
          </div>
          <div className={styles.meta}>
            {display.createdAt ? (
              <span>Customer since {formatDate(dateOnly(display.createdAt))}</span>
            ) : null}
          </div>
        </div>
        <div className={styles.headerRight}>
          <SaveStatus
            status={
              isDraft
                ? createMutation.isPending
                  ? "saving"
                  : createMutation.isError
                    ? "error"
                    : "draft"
                : saveStatus
            }
          />
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Print"
            title="Print"
            onClick={() => window.print()}
          >
            <HugeiconsIcon icon={PrinterIcon} size={14} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="More actions"
            onClick={() => setConfirmDelete(true)}
            disabled={isDraft || readOnly}
          >
            <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Close"
            onClick={() => router.push("/sales/customers")}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>Customer at a glance</h2>
          <EditableInfoGrid
            fields={[
              {
                id: "customer-name",
                label: "Customer name",
                editable: !readOnly && !createMutation.isPending,
                renderEditor: () => (
                  <CompactTextField
                    label="Customer name"
                    value={display.name}
                    disabled={readOnly || createMutation.isPending}
                    autoFocus={isDraft}
                    required
                    onCommit={(name) => {
                      if (name) commitCustomerPatch({ name });
                    }}
                  />
                ),
              },
              {
                id: "email",
                label: "Email",
                editable: !readOnly && !createMutation.isPending,
                renderEditor: () => (
                  <CompactTextField
                    label="Email"
                    value={display.email ?? ""}
                    disabled={readOnly || createMutation.isPending}
                    onCommit={(email) => commitCustomerPatch({ email })}
                  />
                ),
              },
              {
                id: "phone",
                label: "Phone",
                editable: !readOnly && !createMutation.isPending,
                renderEditor: () => (
                  <CompactTextField
                    label="Phone"
                    value={display.phone ?? ""}
                    disabled={readOnly || createMutation.isPending}
                    onCommit={(phone) => commitCustomerPatch({ phone })}
                  />
                ),
              },
              {
                id: "shipping-address",
                label: "Shipping address",
                editable: !readOnly && !createMutation.isPending,
                renderEditor: () => (
                  <CustomerAddressInput
                    id="customer-shipping-address"
                    target="shipping"
                    value={shippingAddress}
                    options={addressOptions}
                    disabled={readOnly || createMutation.isPending}
                    onChange={(address) => applyCustomerAddress("shipping", address)}
                    onAddNew={() => openAddressDialog("shipping")}
                    onEdit={(option) => openEditAddressDialog("shipping", option)}
                  />
                ),
              },
              {
                id: "billing-address",
                label: "Billing address",
                editable: !readOnly && !createMutation.isPending,
                renderEditor: () => (
                  <CustomerAddressInput
                    id="customer-billing-address"
                    target="billing"
                    value={billingSameAsShipping ? null : billingAddress}
                    options={addressOptions}
                    sameAsShipping
                    disabled={readOnly || createMutation.isPending}
                    onChange={(address) => applyCustomerAddress("billing", address)}
                    onAddNew={() => openAddressDialog("billing")}
                    onEdit={(option) => openEditAddressDialog("billing", option)}
                  />
                ),
              },
              {
                id: "customer-since",
                label: "Customer since",
                renderValue: () =>
                  display.createdAt ? formatDate(dateOnly(display.createdAt)) : "-",
              },
            ]}
          />
        </section>

        <ContactsSection
          customerId={currentCustomerId}
          rows={display.contacts}
          readOnly={readOnly || isDraft}
        />

        <ProjectsSection
          customerId={currentCustomerId}
          rows={display.projects}
          readOnly={readOnly || isDraft}
        />

        <section className={styles.section}>
          <div className="grid gap-(--space-7) xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
            <OpenOrdersSection
              customerId={currentCustomerId}
              rows={openOrders}
              readOnly={readOnly || isDraft}
            />
            <div className="relative xl:pl-(--space-7) xl:before:absolute xl:before:bottom-0 xl:before:left-[calc(var(--space-7)/-2)] xl:before:top-[calc(var(--space-5)*-1)] xl:before:w-px xl:before:bg-border xl:before:content-['']">
              <InlineTextareaField
                label="Notes"
                value={display.notes ?? ""}
                disabled={readOnly || createMutation.isPending}
                readOnlyValue={readOnly}
                onDraftChange={(notes) => {
                  if (isDraft) updateDraft({ notes });
                }}
                onCommit={(notes) => commitCustomerPatch({ notes })}
              />
            </div>
          </div>
        </section>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete customer?</AlertDialogTitle>
            <AlertDialogDescription>
              This customer will be soft-deleted. Customers with active sales orders cannot be deleted.
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
        open={addressDialogState != null}
        onOpenChange={(open) => {
          if (!open) setAddressDialogState(null);
        }}
      >
        <DialogContent size="2xl">
          <DialogHeader>
            <DialogTitle>
              {addressDialogState?.option ? "Edit address" : "Add address"}
            </DialogTitle>
          </DialogHeader>
          <form
            id="customer-address-form"
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
                    <FieldLabel htmlFor="customer-address-label">Label</FieldLabel>
                    <Input
                      {...field}
                      id="customer-address-label"
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
                      <FieldLabel htmlFor="customer-address-contact-name">
                        Contact name
                      </FieldLabel>
                      <Input
                        {...field}
                        id="customer-address-contact-name"
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
                      <FieldLabel htmlFor="customer-address-contact-phone">
                        Contact phone
                      </FieldLabel>
                      <Input
                        {...field}
                        id="customer-address-contact-phone"
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
              idPrefix="customer-address"
            />
            <FieldGroup className="mt-4 gap-4">
              <Controller
                control={addressForm.control}
                name="notes"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="customer-address-notes">
                      Notes
                    </FieldLabel>
                    <Textarea
                      {...field}
                      id="customer-address-notes"
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
              onClick={() => setAddressDialogState(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="customer-address-form"
              disabled={addressMutation.isPending}
            >
              {addressMutation.isPending
                ? "Saving..."
                : addressDialogState?.option
                  ? "Save address"
                  : "Add address"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ContactsSection({
  customerId,
  rows: sourceRows,
  readOnly,
}: {
  customerId: string | null;
  rows: CustomerContactRow[];
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useSyncedRows<ContactGridRow>(sourceRows);

  const saveMutation = useMutation({
    mutationKey: ["customer-card", customerId ?? "__draft__", "contact-cell"],
    mutationFn: async (row: ContactGridRow) => {
      if (!customerId) return null;
      const payload = contactPayload(row);
      if (row.isNew) return createCustomerContact(customerId, payload);
      return updateCustomerContact(customerId, row.id, payload);
    },
    onSettled: () => {
      if (customerId) {
        void queryClient.invalidateQueries({ queryKey: ["customer-card", customerId] });
      }
    },
  });
  const deleteMutation = useMutation({
    mutationKey: ["customer-card", customerId ?? "__draft__", "contact-delete"],
    mutationFn: (contactId: string) => deleteCustomerContact(customerId as string, contactId),
    onSettled: () => {
      if (customerId) {
        void queryClient.invalidateQueries({ queryKey: ["customer-card", customerId] });
      }
    },
  });

  const columns = useMemo<ColDef<ContactGridRow>[]>(
    () => [
      {
        colId: "primary",
        headerName: "Primary",
        width: 92,
        minWidth: 92,
        cellRenderer: (params: ICellRendererParams<ContactGridRow>) => {
          const row = params.data;
          if (!row) return null;
          const active = row.roles.includes("primary");
          return (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={readOnly}
              aria-pressed={active}
              aria-label={active ? "Primary contact" : "Set primary contact"}
              title={active ? "Primary contact" : "Set primary contact"}
              className={styles.primaryContactButton}
              onClick={() => {
                const next = {
                  ...row,
                  roles: active
                    ? row.roles.filter((role) => role !== "primary")
                    : [...new Set([...row.roles, "primary"])] as CustomerContactRole[],
                };
                setRows((current) => replaceRow(current, next));
                if (next.name.trim()) saveMutation.mutate(next);
              }}
            >
              <HugeiconsIcon
                icon={StarIcon}
                className={cn(active && styles.primaryContactIconActive)}
              />
            </Button>
          );
        },
      },
      textColumn("name", "Name", !readOnly),
      textColumn("title", "Role", !readOnly),
      textColumn("email", "Email", !readOnly),
      textColumn("phone", "Phone", !readOnly),
    ],
    [readOnly, saveMutation, setRows]
  );

  const onRowsChange = useCallback(
    (nextRows: ContactGridRow[], change: EditableLineDataGridChange<ContactGridRow>) => {
      setRows(nextRows);
      if (change.type === "row_deleted" && change.row && !change.row.isNew) {
        deleteMutation.mutate(change.row.id);
        return;
      }
      if (
        (change.type === "cell_edit_committed" ||
          change.type === "blank_row_committed") &&
        change.row?.name.trim()
      ) {
        saveMutation.mutate(change.row);
      }
    },
    [deleteMutation, saveMutation, setRows]
  );

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        Contacts
        <span className={styles.count}>· {sourceRows.length}</span>
      </h2>
      <EditableLineDataGrid
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        createRow={newContactRow}
        onRowsChange={onRowsChange}
        addLabel="Add contact"
        rowHeight={42}
        enableAddRow={!readOnly}
        enableDelete={!readOnly}
        emptyMessage="No contacts yet."
      />
    </section>
  );
}

function ProjectsSection({
  customerId,
  rows: sourceRows,
  readOnly,
}: {
  customerId: string | null;
  rows: CustomerProjectRow[];
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useSyncedRows<ProjectGridRow>(sourceRows);
  const saveMutation = useMutation({
    mutationKey: ["customer-card", customerId ?? "__draft__", "project-cell"],
    mutationFn: async (row: ProjectGridRow) => {
      if (!customerId) return null;
      const payload = projectPayload(row);
      if (row.isNew) return createCustomerProject(customerId, payload);
      return updateCustomerProject(customerId, row.id, payload);
    },
    onSettled: () => {
      if (customerId) {
        void queryClient.invalidateQueries({ queryKey: ["customer-card", customerId] });
      }
    },
  });
  const deleteMutation = useMutation({
    mutationKey: ["customer-card", customerId ?? "__draft__", "project-delete"],
    mutationFn: (projectId: string) => deleteCustomerProject(customerId as string, projectId),
    onSettled: () => {
      if (customerId) {
        void queryClient.invalidateQueries({ queryKey: ["customer-card", customerId] });
      }
    },
  });
  const columns = useMemo<ColDef<ProjectGridRow>[]>(
    () => [
      textColumn("name", "Project", !readOnly, 1.4),
      {
        field: "status",
        headerName: "Status",
        editable: !readOnly,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: ["planning", "active", "hold", "done"] },
        minWidth: 130,
        cellRenderer: (params: ICellRendererParams<ProjectGridRow>) => {
          const status = params.data?.status;
          if (!status) return null;
          const meta = projectStatusMeta[status];
          return <StatusLabel tone={meta.tone}>{meta.label}</StatusLabel>;
        },
      },
      textColumn("startDate", "Start date", !readOnly, 0.8),
      textColumn("targetEndDate", "Target date", !readOnly, 0.8),
      {
        colId: "orders",
        headerName: "Orders",
        type: "rightAligned",
        minWidth: 100,
        valueGetter: (params) => params.data?.orderCount ?? 0,
      },
      {
        colId: "value",
        headerName: "Value",
        type: "rightAligned",
        minWidth: 120,
        valueGetter: (params) => formatPrice(params.data?.orderValue ?? "0"),
      },
    ],
    [readOnly]
  );
  const onRowsChange = useCallback(
    (nextRows: ProjectGridRow[], change: EditableLineDataGridChange<ProjectGridRow>) => {
      setRows(nextRows);
      if (change.type === "row_deleted" && change.row && !change.row.isNew) {
        deleteMutation.mutate(change.row.id);
        return;
      }
      if (
        (change.type === "cell_edit_committed" ||
          change.type === "blank_row_committed") &&
        change.row?.name.trim()
      ) {
        saveMutation.mutate(change.row);
      }
    },
    [deleteMutation, saveMutation, setRows]
  );

  return (
    <section
      className={styles.section}
      role="region"
      aria-label={`Projects ${sourceRows.length}`}
    >
      <h2 className={styles.sectionHeading}>
        Projects
        <span className={styles.count}>· {sourceRows.length}</span>
      </h2>
      <EditableLineDataGrid
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        createRow={newProjectRow}
        onRowsChange={onRowsChange}
        addLabel="Add project"
        rowHeight={42}
        enableAddRow={!readOnly}
        enableDelete={!readOnly}
        emptyMessage="No projects yet."
      />
    </section>
  );
}

function OpenOrdersSection({
  customerId,
  rows: sourceRows,
  readOnly,
}: {
  customerId: string | null;
  rows: OpenOrderGridRow[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useSyncedRows<OpenOrderGridRow>(sourceRows);

  const columns = useMemo<ColDef<OpenOrderGridRow>[]>(
    () => [
      {
        field: "orderNumber",
        headerName: "Order #",
        minWidth: 150,
        flex: 1,
        cellRenderer: (params: ICellRendererParams<OpenOrderGridRow>) => {
          const order = params.data;
          if (!order) return null;
          return (
            <Link
              href={`/sales/orders/${order.id}`}
              className="font-medium text-primary hover:text-primary"
            >
              {order.orderNumber}
            </Link>
          );
        },
      },
      {
        field: "shipDate",
        headerName: "Date",
        minWidth: 120,
        valueGetter: (params) => params.data?.shipDate ?? params.data?.orderDate ?? "",
        valueFormatter: (params) => params.value ? formatDate(String(params.value)) : "-",
      },
      {
        field: "status",
        headerName: "Status",
        minWidth: 120,
        cellRenderer: (params: ICellRendererParams<OpenOrderGridRow>) => {
          const status = params.data?.status;
          return status ? <SalesOrderStatusBadge status={status} /> : null;
        },
      },
      {
        field: "totalAmount",
        headerName: "Total",
        type: "rightAligned",
        minWidth: 130,
        valueFormatter: (params) => formatPrice(String(params.value ?? "0")) ?? "-",
      },
    ],
    []
  );

  const onRowsChange = useCallback(
    (nextRows: OpenOrderGridRow[]) => {
      setRows(nextRows);
    },
    [setRows]
  );

  const createPlaceholderOrder = useCallback(
    (): OpenOrderGridRow => ({
      id: "__new_order__",
      orderNumber: "",
      status: "open",
      orderDate: "",
      shipDate: null,
      requestedDate: null,
      totalAmount: "0",
      customerProjectId: null,
      customerProjectName: null,
      deletedAt: null,
      createdAt: new Date(),
    }),
    []
  );

  return (
    <div>
      <h2 className={styles.sectionHeading}>
        Open orders
        <span className={styles.count}>· {sourceRows.length}</span>
      </h2>
      <EditableLineDataGrid
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        createRow={createPlaceholderOrder}
        onRowsChange={onRowsChange}
        addLabel="Add order"
        rowHeight={42}
        enableAddRow={!readOnly}
        initializeBlankRow={false}
        enableDelete={false}
        addDisabledReason={!customerId ? "Save the customer before adding orders." : null}
        onAddRow={() => {
          if (!customerId) return null;
          router.push(`/sales/orders/new?customerId=${customerId}`);
          return null;
        }}
        emptyMessage="No open orders."
      />
    </div>
  );
}

function CompactTextField({
  label,
  value,
  disabled,
  required,
  autoFocus,
  onCommit,
}: {
  label: string;
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
    <div className={styles.compactField}>
      <label className={styles.compactLabel} htmlFor={id}>{label}</label>
      <Input
        id={id}
        className={styles.compactInput}
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
    </div>
  );
}

function CustomerAddressInput({
  id,
  target,
  value,
  options,
  sameAsShipping,
  disabled,
  onChange,
  onAddNew,
  onEdit,
}: {
  id: string;
  target: AddressTarget;
  value: CustomerAddressFields | null;
  options: CustomerAddressOption[];
  sameAsShipping?: boolean;
  disabled?: boolean;
  onChange: (address: CustomerAddressFields | null) => void;
  onAddNew: () => void;
  onEdit: (option: CustomerAddressOption) => void;
}) {
  const currentAddressId =
    sameAsShipping && (!value || isCustomerAddressBlank(value))
      ? sameAsShippingValue
      : customerAddressKey(value);
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
        if (itemId === sameAsShippingValue) return "Same as shipping address";
        if (itemId === addAddressValue) return "Add new address";
        if (itemId === editAddressValue) return "Edit selected address";
        return optionMap.get(itemId)?.label ?? "";
      }}
    >
      <ComboboxInput
        id={id}
        placeholder={target === "billing" ? "Billing address" : "Shipping address"}
        disabled={disabled}
        showClear={currentAddressId !== "" && currentAddressId !== sameAsShippingValue}
        className={styles.addressCombobox}
      />
      <ComboboxContent className="w-[min(28rem,calc(100vw-2rem))] bg-popover text-popover-foreground">
        <ComboboxEmpty>No addresses found</ComboboxEmpty>
        <ComboboxList>
          {(itemId: string) => {
            if (itemId === sameAsShippingValue) {
              return (
                <ComboboxItem key={itemId} value={itemId}>
                  Same as shipping address
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
                  <span className="truncate text-xs text-muted-foreground">
                    {option ? customerAddressLabel(option) : ""}
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

function SaveStatus({ status }: { status: "idle" | "saving" | "error" | "draft" }) {
  const className =
    status === "idle"
      ? styles.savedPill
      : status === "saving"
        ? styles.savingPill
        : styles.failedPill;
  const label =
    status === "idle"
      ? "All changes saved"
      : status === "saving"
        ? "Saving..."
        : status === "draft"
          ? "Not saved"
          : "Save failed";
  return (
    <span className={className}>
      <span className={styles.pillSquare} /> {label}
    </span>
  );
}

function textColumn<TData>(
  field: keyof TData & string,
  headerName: string,
  editable: boolean,
  flex = 1
): ColDef<TData> {
  return {
    field: field as unknown as ColDef<TData>["field"],
    headerName,
    editable,
    cellEditor: "agTextCellEditor",
    flex,
    minWidth: 120,
    valueSetter: (params: ValueSetterParams<TData>) => {
      if (!params.data) return false;
      const next =
        typeof params.newValue === "string"
          ? params.newValue.trim() || null
          : params.newValue;
      const data = params.data as Record<string, unknown>;
      const current = data[field] ?? null;
      if (next === current) return false;
      data[field] = next;
      return true;
    },
  };
}

function contactPayload(row: ContactGridRow) {
  return {
    name: row.name.trim(),
    title: row.title || null,
    email: row.email || null,
    phone: row.phone || null,
    addressEntryId: row.addressEntryId || null,
    roles: row.roles,
    notes: row.notes || null,
  };
}

function projectPayload(row: ProjectGridRow) {
  return {
    name: row.name.trim(),
    status: row.status,
    startDate: row.startDate || null,
    targetEndDate: row.targetEndDate || null,
    summary: row.summary || null,
  };
}

function newContactRow(): ContactGridRow {
  const now = new Date();
  return {
    id: `new-${crypto.randomUUID()}`,
    isNew: true,
    name: "",
    title: null,
    email: null,
    phone: null,
    addressEntryId: null,
    roles: [],
    notes: null,
    createdAt: now,
    updatedAt: now,
  };
}

function newProjectRow(): ProjectGridRow {
  const now = new Date();
  return {
    id: `new-${crypto.randomUUID()}`,
    isNew: true,
    name: "",
    status: "planning",
    startDate: null,
    targetEndDate: null,
    summary: null,
    files: [],
    salesOrders: [],
    orderCount: 0,
    orderValue: "0",
    createdAt: now,
    updatedAt: now,
  };
}

function makeDraftCustomer(draft: InsertCustomer): CustomerDetailData {
  const now = new Date();
  return {
    id: "__draft__",
    ...draft,
    customerCategoryName: null,
    openOrderCount: 0,
    openOrderValue: "0",
    latestOrderDate: null,
    xeroContactId: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    contacts: [],
    correspondence: [],
    projects: [],
    salesOrders: [],
  };
}

function useSyncedRows<TRow extends { id: string }>(sourceRows: TRow[]) {
  const [rows, setRows] = useState<TRow[]>(sourceRows);
  const [lastSynced, setLastSynced] = useState(sourceRows);
  if (lastSynced !== sourceRows) {
    setLastSynced(sourceRows);
    setRows(sourceRows);
  }
  return [rows, setRows] as const;
}

function replaceRow<TRow extends { id: string }>(rows: TRow[], next: TRow) {
  return rows.map((row) => (row.id === next.id ? next : row));
}

function dateOnly(value: Date | string) {
  return new Date(value).toISOString().slice(0, 10);
}

export function addressEntryLabel(address: AddressEntry) {
  return (
    formatAddressLines({
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      region: address.region,
      postcode: address.postcode,
      country: address.country,
    }).join(", ") || address.label
  );
}

function normalizeCustomerAddress(address: CustomerAddressFields): CustomerAddressFields {
  return normalizeAddressFields(address);
}

function emptyCustomerAddress(): CustomerAddressFields {
  return {
    line1: null,
    line2: null,
    city: null,
    region: null,
    postcode: null,
    country: null,
  };
}

function getCustomerBillingAddress(customer: CustomerDetailData): CustomerAddressFields {
  return normalizeCustomerAddress({
    line1: customer.billingLine1,
    line2: customer.billingLine2,
    city: customer.billingCity,
    region: customer.billingRegion,
    postcode: customer.billingPostcode,
    country: customer.billingCountry,
  });
}

function getCustomerShippingAddress(customer: CustomerDetailData): CustomerAddressFields {
  return normalizeCustomerAddress({
    line1: customer.shipLine1,
    line2: customer.shipLine2,
    city: customer.shipCity,
    region: customer.shipRegion,
    postcode: customer.shipPostcode,
    country: customer.shipCountry,
  });
}

function isCustomerAddressBlank(address: CustomerAddressFields | null | undefined) {
  if (!address) return true;
  return [
    address.line1,
    address.line2,
    address.city,
    address.region,
    address.postcode,
    address.country,
  ].every((part) => !part);
}

function customerAddressKey(address: CustomerAddressFields | null | undefined) {
  const normalized = address ? normalizeCustomerAddress(address) : emptyCustomerAddress();
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

function customerAddressLabel(address: CustomerAddressFields) {
  return formatAddressLines(address).join(", ");
}

function addressEntryToOption(entry: AddressEntry): CustomerAddressOption | null {
  const normalized = normalizeCustomerAddress({
    line1: entry.line1,
    line2: entry.line2,
    city: entry.city,
    region: entry.region,
    postcode: entry.postcode,
    country: entry.country,
  });
  const id = customerAddressKey(normalized);
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

function shippingAddressPatch(address: CustomerAddressFields): PatchCustomer {
  return {
    shipLine1: address.line1,
    shipLine2: address.line2,
    shipCity: address.city,
    shipRegion: address.region,
    shipPostcode: address.postcode,
    shipCountry: address.country,
  };
}

function billingAddressPatch(address: CustomerAddressFields): PatchCustomer {
  return {
    billingLine1: address.line1,
    billingLine2: address.line2,
    billingCity: address.city,
    billingRegion: address.region,
    billingPostcode: address.postcode,
    billingCountry: address.country,
  };
}
