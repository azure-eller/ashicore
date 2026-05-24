"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ICellRendererParams, ValueSetterParams } from "ag-grid-community";
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon } from "@hugeicons/core-free-icons";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusLabel, type StatusTone } from "@/components/ui/status-label";
import { Textarea } from "@/components/ui/textarea";
import {
  MutableLines,
  type EditableLineDataGridChange,
  type LineField,
} from "@/components/editable-lines";
import {
  CardPage,
  CardPageBody,
  CardSection,
} from "@/components/card-page/card-page";
import { CardPageHeader } from "@/components/card-page/card-page-header";
import { CellShell, underlineControlClass } from "@/components/card-page/form-cell";
import { CommitInput } from "@/components/card-page/commit-input";
import { NotesField } from "@/components/card-page/notes-field";
import { useConfirmMutation } from "@/components/card-page/use-confirm-mutation";
import { useDeleteEntity } from "@/components/card-page/use-delete-entity";
import {
  cardSaveMutationKey,
  type CardSaveState,
} from "@/components/card-page/card-save-status";
import {
  createAddressEntry,
  createCustomer,
  createCustomerContact,
  createCustomerProject,
  deleteCustomer,
  deleteCustomerContact,
  deleteCustomerProjectFile,
  deleteCustomerProject,
  getCustomerCard,
  patchCustomer,
  uploadCustomerProjectFile,
  updateAddressEntry,
  updateCustomerContact,
  updateCustomerProject,
} from "@/lib/api/clients/customers";
import { useDraftSaveEngine } from "@/lib/hooks/use-draft-save-engine";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import type { AddressEntry } from "@/lib/dal/addresses";
import {
  formatAddressLines,
  formatDate,
  formatPrice,
  normalizeAddressFields,
  toDateOnlyString,
} from "@/lib/format";
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
  CustomerProjectFileRow,
  CustomerProjectRow,
} from "./types";
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
type CustomerDraftOp =
  | { type: "patch"; patch: PatchCustomer }
  | { type: "upsertContact"; row: ContactGridRow }
  | { type: "deleteContact"; contactId: string }
  | { type: "upsertProject"; row: ProjectGridRow }
  | { type: "deleteProject"; projectId: string };
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
  const [addressBook, setAddressBook] = useState(addresses);
  const [addressDialogState, setAddressDialogState] =
    useState<AddressDialogState | null>(null);
  const engine = useDraftSaveEngine<
    CustomerDetailData,
    CustomerDraftOp,
    CustomerDetailData
  >({
    initialDraft:
      initialCustomer ??
      makeDraftCustomer({
        ...customerDefaultValues,
        accountState: "active",
        accountPriority: "standard",
      }),
    initialServerSnapshot: initialCustomer,
    initialId: initialCustomerId,
    isSaveable: (draft) => Boolean(draft.name.trim()),
    applyOp: (draft, op) => applyCustomerDraftOp(draft, op),
    create: async (draft) => {
      const created = await createCustomer(customerToInsertInput(draft));
      return getCustomerCard(created.id);
    },
    save: async (customerId, draft, ops) => {
      if (ops.length === 0) return null;
      return saveCustomerOps(customerId, draft, ops.map(({ op }) => op));
    },
    getResultId: (result) => result.id,
    applyPersistedIdentity: (draft, result) => ({
      ...draft,
      id: result.id,
      createdAt: result.createdAt,
    }),
    mergeServerOwnedFields: (draft, result) => ({
      ...result,
      ...customerEditableSnapshot(draft),
    }),
    onPersisted: (id) => {
      reflectPersistedCardUrlWithoutNavigation(`/sales/customers/${id}`);
    },
    onResult: (result, draft) => {
      queryClient.setQueryData(["customer-card", result.id], draft);
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
  const currentCustomerId = engine.currentId;
  const isDraft = !engine.hasPersistedEntity;

  const customerQuery = useQuery({
    queryKey: ["customer-card", currentCustomerId ?? "__draft__"],
    queryFn: () => getCustomerCard(currentCustomerId as string),
    initialData: initialCustomer ?? undefined,
    enabled: !isDraft,
    refetchOnWindowFocus: false,
  });
  const serverCustomer = isDraft ? null : customerQuery.data ?? initialCustomer;
  const display = isDraft
    ? engine.draft
    : serverCustomer
      ? {
          ...serverCustomer,
          ...customerEditableSnapshot(engine.draft),
          contacts: engine.draft.contacts,
          projects: engine.draft.projects,
        }
      : engine.draft;
  const readOnly = Boolean(display.deletedAt);

  const deleteMutation = useDeleteEntity({
    mutationKey: ["customer-action", currentCustomerId ?? "__draft__", "delete"],
    mutationFn: () => deleteCustomer(currentCustomerId as string),
    invalidateQueryKeys: [["customers"]],
    onDeleted: () => router.push("/sales/customers"),
  });
  const deleteConfirm = useConfirmMutation<void>({
    title: "Delete customer?",
    description: (
      <>
        This customer will be soft-deleted. Existing sales orders keep their customer snapshot.
      </>
    ),
    confirmLabel: "Delete",
    pendingLabel: "Deleting...",
    mutation: deleteMutation,
  });

  const addressForm = useForm<AddressDialogValues>({
    resolver: zodResolver(createAddressEntrySchema),
    defaultValues: emptyAddressDialogValues,
  });

  const addressMutation = useMutation({
    mutationKey: cardSaveMutationKey("customer", currentCustomerId ?? "__draft__", "address-book"),
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

  const commitCustomerPatch = useCallback(
    (patch: PatchCustomer) => {
      if (readOnly) return;
      engine.applyLocalOp({ type: "patch", patch });
    },
    [engine, readOnly]
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
        title={display.name.trim() || "New customer"}
        saveState={cardSaveState}
        saveMessage={cardSaveMessage}
        fallbackHref="/sales/customers"
        showPrint={false}
        menuActions={
          isDraft || readOnly
            ? []
            : [
                {
                  label: "Print",
                  onClick: () => window.print(),
                },
                {
                  label: "Delete customer",
                  onClick: () => deleteConfirm.trigger(undefined),
                  destructive: true,
                },
              ]
        }
      />

      <CardPageBody>
        <CardSection title="Customer at a glance">
          <div className={`${styles.formRow} ${styles.formRowThree}`}>
            <CellShell label="Customer name" required invalid={isDraft && !display.name.trim()}>
              <CommitInput
                label="Customer name"
                value={display.name}
                disabled={readOnly}
                autoFocus={isDraft}
                required
                className={underlineControlClass(isDraft && !display.name.trim())}
                onCommit={(name) => {
                  if (name) commitCustomerPatch({ name });
                }}
              />
            </CellShell>
            <CellShell label="Email">
              <CommitInput
                label="Email"
                type="email"
                value={display.email ?? ""}
                disabled={readOnly}
                onCommit={(email) => commitCustomerPatch({ email })}
              />
            </CellShell>
            <CellShell label="Phone">
              <CommitInput
                label="Phone"
                value={display.phone ?? ""}
                disabled={readOnly}
                onCommit={(phone) => commitCustomerPatch({ phone })}
              />
            </CellShell>
            <CellShell label="Shipping address">
              <CustomerAddressInput
                id="customer-shipping-address"
                target="shipping"
                value={shippingAddress}
                options={addressOptions}
                disabled={readOnly}
                onChange={(address) => applyCustomerAddress("shipping", address)}
                onAddNew={() => openAddressDialog("shipping")}
                onEdit={(option) => openEditAddressDialog("shipping", option)}
              />
            </CellShell>
            <CellShell label="Billing address">
              <CustomerAddressInput
                id="customer-billing-address"
                target="billing"
                value={billingSameAsShipping ? null : billingAddress}
                sameAsShippingLabel={customerAddressLabel(shippingAddress)}
                options={addressOptions}
                sameAsShipping
                disabled={readOnly}
                onChange={(address) => applyCustomerAddress("billing", address)}
                onAddNew={() => openAddressDialog("billing")}
                onEdit={(option) => openEditAddressDialog("billing", option)}
              />
            </CellShell>
            <CellShell label="Customer since">
              <div className={styles.readOnlyFieldValue}>
                {display.createdAt ? formatDate(toDateOnlyString(display.createdAt)) : "-"}
              </div>
            </CellShell>
          </div>
        </CardSection>

        <div className={styles.sectionRowTwo}>
          <ContactsSection
            rows={display.contacts}
            readOnly={readOnly || isDraft}
            onSave={(row) => {
              if (readOnly || isDraft) return;
              engine.applyLocalOp({ type: "upsertContact", row });
            }}
            onDelete={(contactId) => {
              if (readOnly || isDraft) return;
              engine.applyLocalOp({ type: "deleteContact", contactId });
            }}
          />
          <ProjectsSection
            customerId={currentCustomerId}
            rows={display.projects}
            readOnly={readOnly || isDraft}
            error={engine.error}
            onSave={(row, options) => {
              if (readOnly || isDraft) return;
              engine.applyLocalOp(
                { type: "upsertProject", row },
                Number.POSITIVE_INFINITY,
              );
              void engine
                .flush()
                .then(() => options?.onSuccess?.())
                .catch(reportCustomerSaveError);
            }}
            onDelete={(projectId, options) => {
              if (readOnly || isDraft) return;
              engine.applyLocalOp(
                { type: "deleteProject", projectId },
                Number.POSITIVE_INFINITY,
              );
              void engine
                .flush()
                .then(() => options?.onSuccess?.())
                .catch(reportCustomerSaveError);
            }}
          />
        </div>

        <div className={styles.sectionRowTwo}>
          <OpenOrdersSection
            customerId={currentCustomerId}
            rows={openOrders}
          />
          <CardSection title="Notes">
            <NotesField
              label="Notes"
              value={display.notes ?? ""}
              disabled={readOnly}
              readOnlyValue={readOnly}
              commitUnchangedValue={isDraft}
              onDraftChange={(notes) => {
                if (isDraft) engine.applyLocalOp({ type: "patch", patch: { notes } }, Number.POSITIVE_INFINITY);
              }}
              onCommit={(notes) => commitCustomerPatch({ notes })}
            />
          </CardSection>
        </div>
      </CardPageBody>

      {deleteConfirm.dialog}

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
    </CardPage>
  );
}

function ContactsSection({
  rows: sourceRows,
  readOnly,
  onSave,
  onDelete,
}: {
  rows: CustomerContactRow[];
  readOnly: boolean;
  onSave: (row: ContactGridRow) => void;
  onDelete: (contactId: string) => void;
}) {
  const [rows, setRows] = useSyncedRows<ContactGridRow>(sourceRows);

  const columns = useMemo<LineField<ContactGridRow>[]>(
    () => [
      {
        colId: "primary",
        kind: "display",
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
                if (next.name.trim()) onSave(next);
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
    [onSave, readOnly, setRows]
  );

  const onRowsChange = useCallback(
    (nextRows: ContactGridRow[], change: EditableLineDataGridChange<ContactGridRow>) => {
      setRows(nextRows);
      if (change.type === "row_deleted" && change.row && !change.row.isNew) {
        onDelete(change.row.id);
        return;
      }
      if (
        change.type === "cell_edit_committed" &&
        change.row?.name.trim()
      ) {
        onSave(change.row);
      }
    },
    [onDelete, onSave, setRows]
  );

  return (
    <CardSection title="Contacts" count={`· ${sourceRows.length}`}>
      <MutableLines
        rows={rows}
        fields={columns}
        getRowId={(row) => row.id}
        createRow={newContactRow}
        onRowsChange={onRowsChange}
        addLabel="Add contact"
        readOnly={readOnly}
        emptyMessage="No contacts yet."
      />
    </CardSection>
  );
}

function ProjectsSection({
  customerId,
  rows: sourceRows,
  readOnly,
  error,
  onSave,
  onDelete,
}: {
  customerId: string | null;
  rows: CustomerProjectRow[];
  readOnly: boolean;
  error: string | null;
  onSave: (row: ProjectGridRow, options?: { onSuccess?: () => void }) => void;
  onDelete: (projectId: string, options?: { onSuccess?: () => void }) => void;
}) {
  const [activeProject, setActiveProject] = useState<CustomerProjectRow | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);

  return (
    <CardSection
      title="Projects"
      count={`· ${sourceRows.length}`}
      actions={
        !readOnly ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCreatingProject(true)}
            disabled={!customerId}
          >
            + Add project
          </Button>
        ) : null
      }
      aria-label={`Projects ${sourceRows.length}`}
    >
      <div className="grid gap-(--space-4)">
        {sourceRows.length > 0 ? (
          sourceRows.map((project) => (
            <button
              key={project.id}
              type="button"
              className="grid border border-border bg-card p-(--space-5) text-left hover:bg-muted"
              onClick={() => setActiveProject(project)}
            >
              <span className="flex min-w-0 items-center justify-between gap-(--space-4)">
                <span className="truncate text-[length:var(--text-sm)] font-medium">
                  {project.name}
                </span>
                <StatusLabel tone={projectStatusMeta[project.status].tone}>
                  {projectStatusMeta[project.status].label}
                </StatusLabel>
              </span>
              <span className="mt-(--space-2) text-[length:var(--text-xs)] text-muted-foreground">
                {formatProjectDateRange(project)} · {project.orderCount} order{project.orderCount === 1 ? "" : "s"} · {formatPrice(project.orderValue) ?? "$0.00"} · {project.files.length} attachment{project.files.length === 1 ? "" : "s"}
              </span>
            </button>
          ))
        ) : (
          <div className="border border-dashed border-border p-(--space-10) text-center text-[length:var(--text-sm)] text-muted-foreground">
            No projects yet.
          </div>
        )}
      </div>

      {activeProject ? (
        <CustomerProjectDialog
          key={activeProject.id}
          customerId={customerId}
          project={activeProject}
          open
          readOnly={readOnly}
          saveError={error}
          onSave={onSave}
          onDelete={onDelete}
          onClose={() => setActiveProject(null)}
        />
      ) : null}
      {creatingProject ? (
        <CustomerProjectDialog
          key="new-project"
          customerId={customerId}
          project={null}
          open
          readOnly={readOnly}
          saveError={error}
          onSave={onSave}
          onDelete={onDelete}
          onClose={() => setCreatingProject(false)}
        />
      ) : null}
    </CardSection>
  );
}

function CustomerProjectDialog({
  customerId,
  project,
  open,
  readOnly,
  saveError,
  onSave,
  onDelete,
  onClose,
}: {
  customerId: string | null;
  project: CustomerProjectRow | null;
  open: boolean;
  readOnly: boolean;
  saveError: string | null;
  onSave: (row: ProjectGridRow, options?: { onSuccess?: () => void }) => void;
  onDelete: (projectId: string, options?: { onSuccess?: () => void }) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ProjectGridRow>(() =>
    project ? { ...project } : newProjectRow()
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fileUploadMutation = useMutation({
    mutationKey: cardSaveMutationKey("customer", customerId ?? "__draft__", "project-file"),
    mutationFn: ({ projectId, file }: { projectId: string; file: File }) =>
      uploadCustomerProjectFile(customerId as string, projectId, file),
    onSuccess: async (file) => {
      setDraft((current) => ({ ...current, files: [...(current.files ?? []), file] }));
      if (customerId) {
        await queryClient.invalidateQueries({ queryKey: ["customer-card", customerId] });
      }
    },
  });
  const fileDeleteMutation = useMutation({
    mutationKey: cardSaveMutationKey("customer", customerId ?? "__draft__", "project-file-delete"),
    mutationFn: (file: CustomerProjectFileRow) =>
      deleteCustomerProjectFile(customerId as string, draft.id, file.id),
    onSuccess: async (_result, file) => {
      setDraft((current) => ({
        ...current,
        files: (current.files ?? []).filter((candidate) => candidate.id !== file.id),
      }));
      if (customerId) {
        await queryClient.invalidateQueries({ queryKey: ["customer-card", customerId] });
      }
    },
  });

  const linkedOrders = draft.salesOrders ?? [];
  const files = draft.files ?? [];
  const canUploadFiles = Boolean(customerId && !draft.isNew && !readOnly);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setConfirmDelete(false);
          onClose();
        }
      }}
    >
      <DialogContent size="3xl" className="max-h-[calc(100vh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{project ? "Project" : "Add project"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-(--space-8)">
          <div className={`${styles.formRow} ${styles.formRowThree}`}>
            <CellShell label="Project name" required>
              <Input
                className={styles.underlineControl}
                value={draft.name}
                disabled={readOnly}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </CellShell>
            <CellShell label="Status">
              <Select
                value={draft.status}
                disabled={readOnly}
                onValueChange={(status: ProjectGridRow["status"]) =>
                  setDraft((current) => ({ ...current, status }))
                }
              >
                <SelectTrigger className={styles.underlineControl}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planning">Planning</SelectItem>
                  <SelectItem value="active">In Progress</SelectItem>
                  <SelectItem value="hold">On Hold</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </CellShell>
          </div>

          <div className={`${styles.formRow} ${styles.formRowThree}`}>
            <CellShell label="Start date">
              <Input
                type="date"
                className={styles.underlineControl}
                value={draft.startDate ?? ""}
                disabled={readOnly}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    startDate: event.target.value || null,
                  }))
                }
              />
            </CellShell>
            <CellShell label="Target date">
              <Input
                type="date"
                className={styles.underlineControl}
                value={draft.targetEndDate ?? ""}
                disabled={readOnly}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    targetEndDate: event.target.value || null,
                  }))
                }
              />
            </CellShell>
          </div>

          <Field>
            <FieldLabel htmlFor="customer-project-summary">Summary</FieldLabel>
            <Textarea
              id="customer-project-summary"
              value={draft.summary ?? ""}
              disabled={readOnly}
              rows={5}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  summary: event.target.value || null,
                }))
              }
            />
          </Field>

          <div className="grid gap-(--space-4)">
            <h3 className={styles.sectionHeading}>Linked sales orders</h3>
            <div className="overflow-x-auto border border-border">
              <table className="w-full text-[length:var(--text-sm)]">
                <tbody>
                  {linkedOrders.length > 0 ? (
                    linkedOrders.map((order) => (
                      <tr key={order.id} className="border-b border-border last:border-b-0">
                        <td className="p-(--space-4)">
                          <Link href={`/sales/order/${order.id}`} className="font-mono font-medium text-primary">
                            {order.orderNumber}
                          </Link>
                        </td>
                        <td className="p-(--space-4)">
                          {formatDate(order.shipDate ?? order.orderDate)}
                        </td>
                        <td className="p-(--space-4)">
                          <SalesOrderStatusBadge status={order.status} />
                        </td>
                        <td className="p-(--space-4) text-right font-mono tabular-nums">
                          {formatPrice(order.totalAmount) ?? "$0.00"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={4}
                        className="p-(--space-8) text-center text-[length:var(--text-sm)] text-muted-foreground"
                      >
                        No linked sales orders.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-(--space-4)">
            <div className="flex items-center justify-between gap-(--space-4)">
              <h3 className={styles.sectionHeading}>Attachments</h3>
              <Input
                type="file"
                className="max-w-72"
                disabled={!canUploadFiles || fileUploadMutation.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file || !customerId) return;
                  fileUploadMutation.mutate({ projectId: draft.id, file });
                }}
              />
            </div>
            <ul className="grid gap-(--space-2)">
              {draft.isNew ? (
                <li className="border border-dashed border-border p-(--space-8) text-center text-[length:var(--text-sm)] text-muted-foreground">
                  Save the project before adding attachments.
                </li>
              ) : files.length > 0 ? (
                files.map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center justify-between gap-(--space-4) border border-border p-(--space-4)"
                  >
                    <a
                      href={`/api/customers/${customerId}/projects/${draft.id}/files/${file.id}`}
                      className="min-w-0 truncate text-[length:var(--text-sm)] font-medium text-primary"
                    >
                      {file.filename}
                    </a>
                    <span className="shrink-0 text-[length:var(--text-xs)] text-muted-foreground">
                      {formatBytes(file.sizeBytes)}
                    </span>
                    {!readOnly ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => fileDeleteMutation.mutate(file)}
                        disabled={fileDeleteMutation.isPending}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </li>
                ))
              ) : (
                <li className="border border-dashed border-border p-(--space-8) text-center text-[length:var(--text-sm)] text-muted-foreground">
                  No attachments yet.
                </li>
              )}
            </ul>
            {fileUploadMutation.error ? (
              <FieldError>{(fileUploadMutation.error as Error).message}</FieldError>
            ) : null}
            {fileDeleteMutation.error ? (
              <FieldError>{(fileDeleteMutation.error as Error).message}</FieldError>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          {project && !readOnly ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
            >
              Delete project
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {!readOnly ? (
            <Button
              type="button"
              disabled={!draft.name.trim()}
              onClick={() => {
                onSave(draft, {
                  onSuccess: () => onClose(),
                });
              }}
            >
              Save changes
            </Button>
          ) : null}
          {saveError ? <FieldError>{saveError}</FieldError> : null}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This project will be removed from the customer workspace.
              {saveError ? (
                <span className="mt-(--space-2) block text-destructive">
                  {saveError}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                onDelete(draft.id, {
                  onSuccess: () => {
                    setConfirmDelete(false);
                    onClose();
                  },
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function OpenOrdersSection({
  customerId,
  rows: sourceRows,
}: {
  customerId: string | null;
  rows: OpenOrderGridRow[];
}) {
  const rows = sourceRows
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <CardSection title="Open orders" count={`· ${sourceRows.length}`}>
      <ul className="grid gap-(--space-3)">
        {rows.length > 0 ? (
          rows.map((order) => (
            <li key={order.id}>
              <Link
                href={`/sales/order/${order.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-(--space-4) border border-border p-(--space-4) hover:bg-muted"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-(--space-3)">
                    <span className="font-mono text-[length:var(--text-sm)] font-medium tabular-nums">
                      {order.orderNumber}
                    </span>
                    <SalesOrderStatusBadge status={order.status} />
                    <span className="font-mono text-[length:var(--text-xs)] text-muted-foreground tabular-nums">
                      {formatDate(order.shipDate ?? order.orderDate)}
                    </span>
                  </span>
                </span>
                <span className="font-mono text-[length:var(--text-sm)] font-medium tabular-nums">
                  {formatPrice(order.totalAmount) ?? "$0.00"}
                </span>
              </Link>
            </li>
          ))
        ) : (
          <li className="border border-dashed border-border p-(--space-10) text-center text-[length:var(--text-sm)] text-muted-foreground">
            No open orders.
          </li>
        )}
      </ul>
      {customerId ? (
        <Link
          href={`/sales/orders?customerId=${customerId}`}
          className="mt-(--space-5) inline-flex text-[length:var(--text-sm)] font-medium text-primary"
        >
          View all sales orders for this customer →
        </Link>
      ) : (
        <span className="mt-(--space-5) inline-flex text-[length:var(--text-sm)] font-medium text-muted-foreground">
          View all sales orders for this customer →
        </span>
      )}
    </CardSection>
  );
}

function CustomerAddressInput({
  id,
  target,
  value,
  sameAsShippingLabel,
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
  sameAsShippingLabel?: string;
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
        placeholder={target === "billing" ? "Billing address" : "Shipping address"}
        disabled={disabled}
        showClear={currentAddressId !== "" && currentAddressId !== sameAsShippingValue}
        className={styles.underlineControl}
      />
      <ComboboxContent className="w-[min(28rem,calc(100vw-2rem))] bg-popover text-popover-foreground">
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
                      <span className="truncate text-xs text-muted-foreground">
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

function textColumn<TData>(
  field: keyof TData & string,
  headerName: string,
  editable: boolean,
  flex = 1
): LineField<TData> {
  return {
    field,
    kind: "text",
    headerName,
    editable,
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

function normalizeCustomerDraft(draft: InsertCustomer): InsertCustomer {
  return {
    ...draft,
    name: draft.name.trim(),
  };
}

function mergeCustomerPatch(
  customer: CustomerDetailData,
  patch: PatchCustomer
): CustomerDetailData {
  return {
    ...customer,
    ...patch,
    updatedAt: new Date(),
  };
}

function applyCustomerDraftOp(
  customer: CustomerDetailData,
  op: CustomerDraftOp
): CustomerDetailData {
  if (op.type === "patch") return mergeCustomerPatch(customer, op.patch);
  if (op.type === "upsertContact") {
    const contacts = upsertById(customer.contacts, op.row);
    return { ...customer, contacts, updatedAt: new Date() };
  }
  if (op.type === "deleteContact") {
    return {
      ...customer,
      contacts: customer.contacts.filter((contact) => contact.id !== op.contactId),
      updatedAt: new Date(),
    };
  }
  if (op.type === "upsertProject") {
    const projects = upsertById(customer.projects, op.row);
    return { ...customer, projects, updatedAt: new Date() };
  }
  return {
    ...customer,
    projects: customer.projects.filter((project) => project.id !== op.projectId),
    updatedAt: new Date(),
  };
}

async function saveCustomerOps(
  customerId: string,
  draft: CustomerDetailData,
  ops: CustomerDraftOp[]
) {
  let changed = false;
  const patch = ops.reduce<PatchCustomer>(
    (next, op) => (op.type === "patch" ? { ...next, ...op.patch } : next),
    {},
  );
  if (Object.keys(patch).length > 0) {
    await patchCustomer(customerId, customerEditableSnapshot(draft));
    changed = true;
  }

  for (const op of ops) {
    if (op.type === "upsertContact") {
      if (!op.row.name.trim()) continue;
      if (op.row.isNew) {
        await createCustomerContact(customerId, contactPayload(op.row));
      } else {
        await updateCustomerContact(customerId, op.row.id, contactPayload(op.row));
      }
      changed = true;
    } else if (op.type === "deleteContact") {
      await deleteCustomerContact(customerId, op.contactId);
      changed = true;
    } else if (op.type === "upsertProject") {
      if (!op.row.name.trim()) continue;
      if (op.row.isNew) {
        await createCustomerProject(customerId, projectPayload(op.row));
      } else {
        await updateCustomerProject(customerId, op.row.id, projectPayload(op.row));
      }
      changed = true;
    } else if (op.type === "deleteProject") {
      await deleteCustomerProject(customerId, op.projectId);
      changed = true;
    }
  }

  return changed ? getCustomerCard(customerId) : null;
}

function customerToInsertInput(customer: CustomerDetailData): InsertCustomer {
  return normalizeCustomerDraft({
    name: customer.name,
    customerCategoryId: customer.customerCategoryId,
    accountState: customer.accountState,
    accountPriority: customer.accountPriority,
    email: customer.email,
    phone: customer.phone,
    billingLine1: customer.billingLine1,
    billingLine2: customer.billingLine2,
    billingCity: customer.billingCity,
    billingRegion: customer.billingRegion,
    billingPostcode: customer.billingPostcode,
    billingCountry: customer.billingCountry,
    shipLine1: customer.shipLine1,
    shipLine2: customer.shipLine2,
    shipCity: customer.shipCity,
    shipRegion: customer.shipRegion,
    shipPostcode: customer.shipPostcode,
    shipCountry: customer.shipCountry,
    notes: customer.notes,
  });
}

function customerEditableSnapshot(customer: CustomerDetailData): PatchCustomer {
  return {
    name: customer.name,
    customerCategoryId: customer.customerCategoryId,
    accountState: customer.accountState,
    accountPriority: customer.accountPriority,
    email: customer.email,
    phone: customer.phone,
    billingLine1: customer.billingLine1,
    billingLine2: customer.billingLine2,
    billingCity: customer.billingCity,
    billingRegion: customer.billingRegion,
    billingPostcode: customer.billingPostcode,
    billingCountry: customer.billingCountry,
    shipLine1: customer.shipLine1,
    shipLine2: customer.shipLine2,
    shipCity: customer.shipCity,
    shipRegion: customer.shipRegion,
    shipPostcode: customer.shipPostcode,
    shipCountry: customer.shipCountry,
    notes: customer.notes,
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

function upsertById<TRow extends { id: string }>(rows: TRow[], next: TRow) {
  return rows.some((row) => row.id === next.id)
    ? replaceRow(rows, next)
    : [...rows, next];
}

function replaceRow<TRow extends { id: string }>(rows: TRow[], next: TRow) {
  return rows.map((row) => (row.id === next.id ? next : row));
}

function formatProjectDateRange(project: CustomerProjectRow) {
  const start = project.startDate ? formatDate(project.startDate) : "No start";
  const target = project.targetEndDate ? formatDate(project.targetEndDate) : "No target";
  return `${start} -> ${target}`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function reportCustomerSaveError(error: unknown) {
  console.error("Customer save failed:", error);
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
