"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
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
import { AttachmentListItem } from "@/components/attachment-list";
import { AddressBookFields } from "@/components/address-book-fields";
import { EmptyState } from "@/components/empty-state";
import { FileDropzone } from "@/components/file-dropzone";
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
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FieldError } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import {
  StatusBadge,
  type StatusBadgeConfig,
} from "@/components/status-badge";
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
import {
  CardField,
  CardSelectField,
  CardTextField,
} from "@/components/card-page/card-field";
import {
  CardFormRow,
  ReadOnlyFieldValue,
  underlineControlClass,
} from "@/components/card-page/form-cell";
import { CommitInput } from "@/components/card-page/commit-input";
import { NotesField } from "@/components/card-page/notes-field";
import { ListFrameItem } from "@/components/list-frame";
import { SurfacePanel } from "@/components/surface-panel";
import {
  FramedTable,
  FramedTableCell,
  FramedTableRow,
  TableFrame,
} from "@/components/table-frame";
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
  createCustomerProjectNote,
  createCustomerProject,
  deleteCustomer,
  deleteCustomerContact,
  deleteCustomerProjectFile,
  deleteCustomerProjectNote,
  deleteCustomerProject,
  getCustomerCard,
  patchCustomer,
  uploadCustomerProjectFile,
  updateAddressEntry,
  updateCustomerContact,
  updateCustomerProject,
} from "@/lib/api/clients/customers";
import { makeUniqueAddressLabel } from "@/lib/address-label";
import { useDraftSaveEngine } from "@/lib/hooks/use-draft-save-engine";
import { reflectPersistedCardUrlWithoutNavigation } from "@/lib/routing/reflect-card-url";
import type { AddressEntry } from "@/lib/dal/addresses";
import {
  addressEntryToAddressOption,
  type AddressEntryOption,
} from "@/lib/address-entry-options";
import {
  addressKey,
  emptyAddressFields,
  formatAddressInline,
  formatDate,
  formatPrice,
  isAddressBlank,
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
type CustomerAddressOption = AddressEntryOption;
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
  StatusBadgeConfig<ProjectGridRow["status"]>[ProjectGridRow["status"]]
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
      const option = addressEntryToAddressOption(entry);
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
      const normalized = address ? normalizeAddressFields(address) : emptyAddressFields();
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
      const label = makeUniqueAddressLabel(
        values,
        addressBook.map((address) => address.label),
      );
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
  const billingSameAsShipping = isAddressBlank(billingAddress);
  const addressOptions = useMemo(
    () =>
      addressBook
        .map(addressEntryToAddressOption)
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
          <CardFormRow columns="three">
            <CardField
              label="Customer name"
              htmlFor="customer-name"
              required
              invalid={isDraft && !display.name.trim()}
            >
              <CommitInput
                id="customer-name"
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
            </CardField>
            <CardField label="Email" htmlFor="customer-email">
              <CommitInput
                id="customer-email"
                label="Email"
                type="email"
                value={display.email ?? ""}
                disabled={readOnly}
                onCommit={(email) => commitCustomerPatch({ email })}
              />
            </CardField>
            <CardField label="Phone" htmlFor="customer-phone">
              <CommitInput
                id="customer-phone"
                label="Phone"
                value={display.phone ?? ""}
                disabled={readOnly}
                onCommit={(phone) => commitCustomerPatch({ phone })}
              />
            </CardField>
            <CardField label="Shipping address" htmlFor="customer-shipping-address">
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
            </CardField>
            <CardField label="Billing address" htmlFor="customer-billing-address">
              <CustomerAddressInput
                id="customer-billing-address"
                target="billing"
                value={billingSameAsShipping ? null : billingAddress}
                sameAsShippingLabel={formatAddressInline(shippingAddress)}
                options={addressOptions}
                sameAsShipping
                disabled={readOnly}
                onChange={(address) => applyCustomerAddress("billing", address)}
                onAddNew={() => openAddressDialog("billing")}
                onEdit={(option) => openEditAddressDialog("billing", option)}
              />
            </CardField>
            <CardField label="Customer since">
              <ReadOnlyFieldValue>
                {display.createdAt ? formatDate(toDateOnlyString(display.createdAt)) : "-"}
              </ReadOnlyFieldValue>
            </CardField>
          </CardFormRow>
        </CardSection>

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

        <OpenOrdersSection
          customerId={currentCustomerId}
          rows={openOrders}
        />

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
            onCommit={(notes) => commitCustomerPatch({ notes })}
          />
        </CardSection>
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
            <AddressBookFields
              control={addressForm.control}
              addressNames={addressFieldNames}
              idPrefix="customer-address"
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
      aria-label={`Projects ${sourceRows.length}`}
    >
      <div className="grid gap-(--space-4)">
        {sourceRows.length > 0 ? (
          sourceRows.map((project) => (
            <SurfacePanel
              as="button"
              key={project.id}
              type="button"
              interactive
              className="grid p-(--space-5) text-left"
              onClick={() => setActiveProject(project)}
            >
              <span className="flex min-w-0 items-center justify-between gap-(--space-4)">
                <span className="truncate text-[length:var(--text-sm)] font-medium">
                  {project.name}
                </span>
                <StatusBadge status={project.status} config={projectStatusMeta} />
              </span>
              <span className="mt-(--space-2) text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                {formatProjectDateRange(project)} · {project.orderCount} order{project.orderCount === 1 ? "" : "s"} · {formatPrice(project.orderValue) ?? "$0.00"} · {project.files.length} attachment{project.files.length === 1 ? "" : "s"}
              </span>
            </SurfacePanel>
          ))
        ) : (
          <EmptyState>No projects yet.</EmptyState>
        )}
      </div>

      {!readOnly ? (
        <button
          type="button"
          className={styles.addRow}
          onClick={() => setCreatingProject(true)}
          disabled={!customerId}
        >
          + Add project
        </button>
      ) : null}

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
  const [noteDraft, setNoteDraft] = useState("");

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
  const noteCreateMutation = useMutation({
    mutationKey: cardSaveMutationKey("customer", customerId ?? "__draft__", "project-note-create"),
    mutationFn: ({ projectId, body }: { projectId: string; body: string }) =>
      createCustomerProjectNote(customerId as string, projectId, { body }),
    onSuccess: async (note) => {
      setDraft((current) => ({
        ...current,
        notes: [note, ...(current.notes ?? [])],
      }));
      setNoteDraft("");
      if (customerId) {
        await queryClient.invalidateQueries({ queryKey: ["customer-card", customerId] });
      }
    },
  });
  const noteDeleteMutation = useMutation({
    mutationKey: cardSaveMutationKey("customer", customerId ?? "__draft__", "project-note-delete"),
    mutationFn: (noteId: string) =>
      deleteCustomerProjectNote(customerId as string, draft.id, noteId),
    onSuccess: async (_result, noteId) => {
      setDraft((current) => ({
        ...current,
        notes: (current.notes ?? []).filter((note) => note.id !== noteId),
      }));
      if (customerId) {
        await queryClient.invalidateQueries({ queryKey: ["customer-card", customerId] });
      }
    },
  });

  const linkedOrders = draft.salesOrders ?? [];
  const files = draft.files ?? [];
  const notes = draft.notes ?? [];
  const canUploadFiles = Boolean(customerId && !draft.isNew && !readOnly);
  const canAddNotes = Boolean(customerId && !draft.isNew && !readOnly);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function uploadFirstFile(filesToUpload: FileList | null) {
    const file = filesToUpload?.[0];
    if (!file || !customerId) return;
    fileUploadMutation.mutate({ projectId: draft.id, file });
  }

  function submitNote() {
    const body = noteDraft.trim();
    if (!body || !canAddNotes) return;
    noteCreateMutation.mutate({ projectId: draft.id, body });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setConfirmDelete(false);
          onClose();
        }
      }}
    >
      <SheetContent
        side="right"
        className="gap-0 overflow-hidden p-0 data-[side=right]:w-[min(560px,94vw)] data-[side=right]:sm:max-w-[min(560px,94vw)]"
      >
        <SheetHeader>
          <SheetTitle>{project ? "Project" : "Add project"}</SheetTitle>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 gap-(--space-8) overflow-y-auto p-(--space-8)">
          {project ? (
            <div
              className={styles.summaryGrid}
              style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
            >
              <div className={styles.summaryTile}>
                <p className={styles.eyebrow}>Orders</p>
                <span className={styles.val}>{project.orderCount}</span>
              </div>
              <div className={styles.summaryTile}>
                <p className={styles.eyebrow}>Open value</p>
                <span className={styles.val}>
                  {formatPrice(project.orderValue) ?? "$0.00"}
                </span>
              </div>
              <div className={styles.summaryTile}>
                <p className={styles.eyebrow}>Created</p>
                <span className={styles.val}>
                  {formatDate(toDateOnlyString(project.createdAt))}
                </span>
              </div>
            </div>
          ) : null}

          <CardFormRow columns="three">
            <CardTextField
              label="Project name"
              value={draft.name}
              required
              disabled={readOnly}
              controlStyle="dialog"
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
            <CardSelectField
              label="Status"
              value={draft.status}
              disabled={readOnly}
              controlStyle="dialog"
              onValueChange={(status) =>
                setDraft((current) => ({ ...current, status: status as ProjectGridRow["status"] }))
              }
              options={[
                { value: "planning", label: "Planning" },
                { value: "active", label: "In Progress" },
                { value: "hold", label: "On Hold" },
                { value: "done", label: "Done" },
              ]}
            />
          </CardFormRow>

          <CardFormRow columns="three">
            <CardField label="Start date" controlStyle="dialog">
              <DatePicker
                value={draft.startDate ?? ""}
                disabled={readOnly}
                placeholder="Start date"
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    startDate: value || null,
                  }))
                }
              />
            </CardField>
            <CardField label="Target date" controlStyle="dialog">
              <DatePicker
                value={draft.targetEndDate ?? ""}
                disabled={readOnly}
                placeholder="Target date"
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    targetEndDate: value || null,
                  }))
                }
              />
            </CardField>
          </CardFormRow>

          <CardField
            label="Summary"
            htmlFor="customer-project-summary"
            controlStyle="dialog"
          >
            <Textarea
              id="customer-project-summary"
              value={draft.summary ?? ""}
              disabled={readOnly}
              rows={5}
              className="text-[length:var(--text-md)] leading-[var(--leading-md)]"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  summary: event.target.value || null,
                }))
              }
            />
          </CardField>

          <div className="grid gap-(--space-4)">
            <h3 className={styles.sectionHeading}>Notes</h3>
            <ul className="grid gap-(--space-3)">
              {notes.length > 0 ? (
                notes.map((note) => (
                  <li
                    key={note.id}
                    className="rounded-(--radius-md) border border-[var(--color-line)] bg-[var(--color-surface)] p-(--space-5)"
                  >
                    <div className="flex items-start justify-between gap-(--space-4)">
                      <div className="min-w-0">
                        <p className="text-[length:var(--text-sm)] leading-[var(--leading-md)] text-[var(--color-ink)]">
                          {note.body}
                        </p>
                        <p className="mt-(--space-2) font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
                          {note.createdByName || "Team member"} · {formatDate(toDateOnlyString(note.createdAt))}
                        </p>
                      </div>
                      {!readOnly ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => noteDeleteMutation.mutate(note.id)}
                          disabled={noteDeleteMutation.isPending}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))
              ) : (
                <EmptyState as="li" density="compact">
                  {draft.isNew
                    ? "Save the project before adding notes."
                    : "No notes yet."}
                </EmptyState>
              )}
            </ul>
            {!readOnly ? (
              <div className="grid gap-(--space-3)">
                <Textarea
                  value={noteDraft}
                  disabled={!canAddNotes || noteCreateMutation.isPending}
                  rows={3}
                  placeholder={
                    draft.isNew
                      ? "Save the project before adding notes."
                      : "Add a project note..."
                  }
                  className="text-[length:var(--text-md)] leading-[var(--leading-md)]"
                  onChange={(event) => setNoteDraft(event.target.value)}
                />
                <div className="flex items-center justify-end gap-(--space-4)">
                  {noteCreateMutation.error ? (
                    <FieldError>
                      {(noteCreateMutation.error as Error).message}
                    </FieldError>
                  ) : null}
                  {noteDeleteMutation.error ? (
                    <FieldError>
                      {(noteDeleteMutation.error as Error).message}
                    </FieldError>
                  ) : null}
                  <Button
                    type="button"
                    disabled={
                      !canAddNotes ||
                      !noteDraft.trim() ||
                      noteCreateMutation.isPending
                    }
                    onClick={submitNote}
                  >
                    {noteCreateMutation.isPending ? "Adding..." : "Add note"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid gap-(--space-4)">
            <h3 className={styles.sectionHeading}>Linked sales orders</h3>
            <TableFrame>
              <FramedTable>
                <tbody>
                  {linkedOrders.length > 0 ? (
                    linkedOrders.map((order) => (
                      <FramedTableRow key={order.id}>
                        <FramedTableCell className="p-(--space-4)">
                          <Link href={`/sales/order/${order.id}`} className="font-mono font-medium text-[var(--color-accent-ink)]">
                            {order.orderNumber}
                          </Link>
                        </FramedTableCell>
                        <FramedTableCell className="p-(--space-4)">
                          {formatDate(order.shipDate ?? order.orderDate)}
                        </FramedTableCell>
                        <FramedTableCell className="p-(--space-4)">
                          <SalesOrderStatusBadge status={order.status} />
                        </FramedTableCell>
                        <FramedTableCell align="right" numeric className="p-(--space-4)">
                          {formatPrice(order.totalAmount) ?? "$0.00"}
                        </FramedTableCell>
                      </FramedTableRow>
                    ))
                  ) : (
                    <tr>
                      <FramedTableCell
                        colSpan={4}
                        align="center"
                        muted
                        className="p-(--space-8)"
                      >
                        No linked sales orders.
                      </FramedTableCell>
                    </tr>
                  )}
                </tbody>
              </FramedTable>
            </TableFrame>
          </div>

          <div className="grid gap-(--space-4)">
            <div className="grid gap-(--space-4)">
              <h3 className={styles.sectionHeading}>Attachments</h3>
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                disabled={!canUploadFiles || fileUploadMutation.isPending}
                onChange={(event) => {
                  uploadFirstFile(event.target.files);
                  event.target.value = "";
                }}
              />
              <FileDropzone
                label={fileUploadMutation.isPending ? "Uploading..." : "Upload attachment"}
                disabled={!canUploadFiles || fileUploadMutation.isPending}
                onBrowse={() => fileInputRef.current?.click()}
                onFiles={uploadFirstFile}
              />
            </div>
            <ul className="grid gap-(--space-2)">
              {draft.isNew ? (
                <EmptyState as="li" density="compact">
                  Save the project before adding attachments.
                </EmptyState>
              ) : files.length > 0 ? (
                files.map((file) => (
                  <AttachmentListItem
                    as="li"
                    key={file.id}
                    filename={file.filename}
                    sizeBytes={file.sizeBytes}
                    href={`/api/customers/${customerId}/projects/${draft.id}/files/${file.id}`}
                    layout="inline"
                    actions={!readOnly ? (
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
                  />
                ))
              ) : (
                <EmptyState as="li" density="compact">No attachments yet.</EmptyState>
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

        <SheetFooter className="flex-row items-center justify-end gap-(--space-4)">
          {project && !readOnly ? (
            <Button
              type="button"
              variant="destructive"
              className="mr-auto"
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
              {project ? "Save changes" : "Add project"}
            </Button>
          ) : null}
          {saveError ? <FieldError>{saveError}</FieldError> : null}
        </SheetFooter>
      </SheetContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This project will be removed from the customer workspace.
              {saveError ? (
                <span className="mt-(--space-2) block text-[var(--status-danger-ink)]">
                  {saveError}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
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
    </Sheet>
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
              <ListFrameItem
                as={Link}
                href={`/sales/order/${order.id}`}
                interactive
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-(--space-4) p-(--space-4)"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-(--space-3)">
                    <span className="font-mono text-[length:var(--text-sm)] font-medium tabular-nums">
                      {order.orderNumber}
                    </span>
                    <SalesOrderStatusBadge status={order.status} />
                    <span className="font-mono text-[length:var(--text-xs)] text-[var(--color-ink-faint)] tabular-nums">
                      {formatDate(order.shipDate ?? order.orderDate)}
                    </span>
                  </span>
                </span>
                <span className="font-mono text-[length:var(--text-sm)] font-medium tabular-nums">
                  {formatPrice(order.totalAmount) ?? "$0.00"}
                </span>
              </ListFrameItem>
            </li>
          ))
        ) : (
          <EmptyState as="li">No open orders.</EmptyState>
        )}
      </ul>
      {customerId ? (
        <Link
          href={`/sales/orders?customerId=${customerId}`}
          className="mt-(--space-5) inline-flex text-[length:var(--text-sm)] font-medium text-[var(--color-accent-ink)]"
        >
          View all sales orders for this customer →
        </Link>
      ) : (
        <span className="mt-(--space-5) inline-flex text-[length:var(--text-sm)] font-medium text-[var(--color-ink-faint)]">
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
        placeholder={target === "billing" ? "Billing address" : "Shipping address"}
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
    notes: [],
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

function reportCustomerSaveError(error: unknown) {
  console.error("Customer save failed:", error);
}

export function addressEntryLabel(address: AddressEntry) {
  return formatAddressInline(address) || address.label;
}

function getCustomerBillingAddress(customer: CustomerDetailData): CustomerAddressFields {
  return normalizeAddressFields({
    line1: customer.billingLine1,
    line2: customer.billingLine2,
    city: customer.billingCity,
    region: customer.billingRegion,
    postcode: customer.billingPostcode,
    country: customer.billingCountry,
  });
}

function getCustomerShippingAddress(customer: CustomerDetailData): CustomerAddressFields {
  return normalizeAddressFields({
    line1: customer.shipLine1,
    line2: customer.shipLine2,
    city: customer.shipCity,
    region: customer.shipRegion,
    postcode: customer.shipPostcode,
    country: customer.shipCountry,
  });
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
