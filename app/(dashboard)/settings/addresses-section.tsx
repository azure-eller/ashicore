"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, Location01Icon } from "@hugeicons/core-free-icons";
import { AddressBookFields } from "@/components/address-book-fields";
import {
  FramedTable,
  FramedTableBody,
  FramedTableCell,
  FramedTableHead,
  FramedTableHeaderCell,
  FramedTableRow,
  TableFrame,
} from "@/components/table-frame";
import {
  SettingsAddLink,
  SettingsBlock,
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { apiJson } from "@/lib/client/api";
import { DEFAULT_COUNTRY } from "@/lib/address-options";
import type { AddressEntry } from "@/lib/dal/addresses";
import { createAddressEntrySchema } from "@/lib/schemas/addresses";
import type { z } from "zod";

type AddressBookRow = Omit<AddressEntry, "createdAt" | "updatedAt">;
type AddressDialogValues = z.input<typeof createAddressEntrySchema>;

const EMPTY_FORM: AddressDialogValues = {
  label: "",
  contactName: null,
  contactPhone: null,
  line1: null,
  line2: null,
  city: null,
  region: null,
  postcode: null,
  country: DEFAULT_COUNTRY,
  deliveryInstructions: null,
  notes: null,
};

function composedAddress(row: AddressBookRow) {
  const locality = [row.region, row.postcode].filter(Boolean).join(" ");
  return [row.line1, row.line2, row.city, locality].filter(Boolean).join(", ");
}

function toFormValues(row: AddressBookRow): AddressDialogValues {
  return {
    label: row.label,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    postcode: row.postcode,
    country: row.country,
    deliveryInstructions: row.deliveryInstructions,
    notes: row.notes,
  };
}

function AddressDialog({
  row,
  onClose,
  onSaved,
}: {
  row: AddressBookRow | null;
  onClose: () => void;
  onSaved: (entry: AddressEntry) => void;
}) {
  const form = useForm<AddressDialogValues>({
    resolver: zodResolver(createAddressEntrySchema),
    defaultValues: row ? toFormValues(row) : EMPTY_FORM,
  });

  const saveMutation = useMutation({
    mutationFn: (values: AddressDialogValues) =>
      apiJson<AddressEntry>(row ? `/api/addresses/${row.id}` : "/api/addresses", {
        method: row ? "PUT" : "POST",
        body: createAddressEntrySchema.parse(values),
        fallbackError: "Failed to save address.",
      }),
    onSuccess: (entry) => {
      onSaved(entry);
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>{row ? "Edit address" : "Add address"}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-(--space-8)"
          onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
        >
          <AddressBookFields
            control={form.control}
            idPrefix="settings-address"
            labelName="label"
            contactNameName="contactName"
            contactPhoneName="contactPhone"
            addressNames={{
              line1: "line1",
              line2: "line2",
              city: "city",
              region: "region",
              postcode: "postcode",
              country: "country",
            }}
            notesName="deliveryInstructions"
            notesLabel="Delivery instructions"
          />

          {saveMutation.error ? (
            <FieldError>{saveMutation.error.message}</FieldError>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save address"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddressesSection({ initialData }: { initialData: AddressBookRow[] }) {
  const [addresses, setAddresses] = useState(initialData);
  const [dialog, setDialog] = useState<{ row: AddressBookRow | null } | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (row: AddressBookRow) =>
      apiJson<{ success: boolean }>(`/api/addresses/${row.id}`, {
        method: "DELETE",
        fallbackError: "Failed to delete address.",
      }),
    onSuccess: (_result, row) => {
      setAddresses((current) => current.filter((entry) => entry.id !== row.id));
    },
  });

  const handleSaved = (entry: AddressEntry) => {
    setAddresses((current) => {
      const next = current.filter((row) => row.id !== entry.id);
      next.push(entry);
      return next.sort((a, b) => a.label.localeCompare(b.label));
    });
  };

  return (
    <div className="flex flex-col gap-(--space-8)">
      <SettingsPageHeader
        title="Addresses"
        sub="Your locations — used as ship-from and deliver-to addresses on sales and purchase orders."
      />

      <SettingsCard>
        <SettingsBlock title="Locations" count={addresses.length}>
          {deleteMutation.error ? (
            <div className="mb-(--space-6)">
              <FieldError>{deleteMutation.error.message}</FieldError>
            </div>
          ) : null}

          {addresses.length > 0 ? (
            <TableFrame>
              <FramedTable>
                <FramedTableHead>
                  <tr>
                    <FramedTableHeaderCell className="w-40">
                      Label
                    </FramedTableHeaderCell>
                    <FramedTableHeaderCell>Address</FramedTableHeaderCell>
                    <FramedTableHeaderCell className="w-44">
                      Contact
                    </FramedTableHeaderCell>
                    <FramedTableHeaderCell className="w-12" />
                  </tr>
                </FramedTableHead>
                <FramedTableBody>
                  {addresses.map((row) => (
                    <FramedTableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => setDialog({ row })}
                    >
                      <FramedTableCell strong>{row.label}</FramedTableCell>
                      <FramedTableCell className="whitespace-normal">
                        {composedAddress(row) || (
                          <span className="text-[var(--color-ink-faint)]">—</span>
                        )}
                      </FramedTableCell>
                      <FramedTableCell muted>{row.contactName ?? "—"}</FramedTableCell>
                      <FramedTableCell align="right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${row.label}`}
                          disabled={deleteMutation.isPending}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteMutation.mutate(row);
                          }}
                          className="text-[var(--color-ink-faint)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--status-danger-ink)]"
                        >
                          <HugeiconsIcon icon={Delete02Icon} />
                        </Button>
                      </FramedTableCell>
                    </FramedTableRow>
                  ))}
                </FramedTableBody>
              </FramedTable>
            </TableFrame>
          ) : (
            <div className="flex flex-col items-center justify-center gap-(--space-4) py-(--space-12) text-center text-[var(--color-ink-faint)]">
              <HugeiconsIcon icon={Location01Icon} size={20} aria-hidden />
              <span className="text-[length:var(--text-status)]">
                No addresses yet.
              </span>
            </div>
          )}

          <SettingsAddLink onClick={() => setDialog({ row: null })}>
            Add address
          </SettingsAddLink>
        </SettingsBlock>
      </SettingsCard>

      {dialog ? (
        <AddressDialog
          key={dialog.row?.id ?? "new"}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}
