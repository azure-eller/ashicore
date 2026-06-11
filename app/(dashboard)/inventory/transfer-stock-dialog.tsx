"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDataTransferHorizontalIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InventoryItemCombobox,
  type InventoryItemComboboxOption,
} from "@/components/inventory-item-combobox";
import { LocationSelect, type LocationOption } from "@/components/location-select";
import { apiJson } from "@/lib/client/api";
import { formatQuantity } from "@/lib/format";
import { isPositiveNumberString } from "@/lib/schemas/shared";
import type { ItemLocationBalance, ItemRow } from "@/lib/inventory/types";

type TransferLine = {
  key: number;
  itemId: string | null;
  quantity: string;
};

export function useActiveLocations() {
  return useQuery({
    queryKey: ["locations"],
    queryFn: () => apiJson<LocationOption[]>("/api/locations"),
    staleTime: 60_000,
  });
}

export function TransferStockDialog({
  prefillItemId,
  size,
}: {
  prefillItemId?: string;
  size?: "sm";
}) {
  const locationsQuery = useActiveLocations();
  const locations = locationsQuery.data ?? [];

  if (locations.length < 2) {
    return null;
  }

  return (
    <TransferStockDialogInner
      locations={locations}
      prefillItemId={prefillItemId}
      size={size}
    />
  );
}

function TransferStockDialogInner({
  locations,
  prefillItemId,
  size,
}: {
  locations: LocationOption[];
  prefillItemId?: string;
  size?: "sm";
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultLocationId =
    locations.find((location) => location.isDefault)?.id ?? null;
  const [fromLocationId, setFromLocationId] = useState(defaultLocationId);
  const [toLocationId, setToLocationId] = useState<string | null>(null);
  const initialLines = (): TransferLine[] => [
    { key: 0, itemId: prefillItemId ?? null, quantity: "" },
  ];
  const [lines, setLines] = useState<TransferLine[]>(initialLines);

  const itemsQuery = useQuery({
    queryKey: ["transfer-item-options"],
    queryFn: () => apiJson<ItemRow[]>("/api/items"),
    enabled: open,
    staleTime: 60_000,
  });
  const itemOptions: InventoryItemComboboxOption[] = (itemsQuery.data ?? []).map(
    (item) => ({
      id: item.id,
      name: item.name,
      displayName: item.displayName,
      sku: item.sku,
      itemType: item.itemType,
      unitName: item.unit,
    })
  );

  const canSubmit =
    fromLocationId != null &&
    toLocationId != null &&
    fromLocationId !== toLocationId &&
    lines.length > 0 &&
    lines.every(
      (line) => line.itemId != null && isPositiveNumberString(line.quantity.trim())
    );

  const updateLine = (key: number, patch: Partial<TransferLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  };

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await apiJson<{ id: string }>("/api/inventory/transfers", {
        method: "POST",
        body: {
          fromLocationId,
          toLocationId,
          lines: lines.map((line) => ({
            itemId: line.itemId,
            quantity: line.quantity.trim(),
          })),
        },
        idempotencyKey: "inventory-transfer",
        fallbackError: "Failed to transfer stock.",
      });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["item-location-balances"] });
      setOpen(false);
      setPending(false);
      setLines(initialLines());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to transfer stock.");
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setPending(false);
          setLines(initialLines());
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size={size} aria-label="Transfer stock">
          <HugeiconsIcon
            icon={ArrowDataTransferHorizontalIcon}
            data-icon="inline-start"
          />
          Transfer stock
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer stock</DialogTitle>
        </DialogHeader>

        {error ? <FieldError>{error}</FieldError> : null}

        <div className="grid grid-cols-2 gap-(--space-3)">
          <LocationSelect
            label="From"
            inputId="transfer-from-location"
            locations={locations.filter((location) => location.id !== toLocationId)}
            value={fromLocationId}
            onValueChange={setFromLocationId}
            required
          />
          <LocationSelect
            label="To"
            inputId="transfer-to-location"
            locations={locations.filter((location) => location.id !== fromLocationId)}
            value={toLocationId}
            onValueChange={setToLocationId}
            required
          />
        </div>

        <div className="flex flex-col gap-(--space-2)">
          {lines.map((line) => (
            <div key={line.key} className="flex items-start gap-(--space-2)">
              <div className="min-w-0 flex-1">
                <InventoryItemCombobox
                  options={itemOptions}
                  value={line.itemId}
                  onValueChange={(value) => updateLine(line.key, { itemId: value })}
                  placeholder="Search items..."
                  emptyMessage={itemsQuery.isPending ? "Loading..." : "No items found"}
                  showTypeBadge
                />
                {line.itemId && fromLocationId ? (
                  <LineAvailability
                    itemId={line.itemId}
                    fromLocationId={fromLocationId}
                  />
                ) : null}
              </div>
              <Input
                value={line.quantity}
                onChange={(event) =>
                  updateLine(line.key, { quantity: event.currentTarget.value })
                }
                inputMode="decimal"
                placeholder="Qty"
                aria-label="Quantity"
                className="w-[6rem]"
              />
              {lines.length > 1 ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove line"
                  onClick={() =>
                    setLines((current) =>
                      current.filter((other) => other.key !== line.key)
                    )
                  }
                >
                  <HugeiconsIcon icon={Cancel01Icon} />
                </Button>
              ) : null}
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  key: Math.max(...current.map((line) => line.key)) + 1,
                  itemId: null,
                  quantity: "",
                },
              ])
            }
          >
            Add line
          </Button>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={pending || !canSubmit}>
            {pending ? "Transferring..." : "Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LineAvailability({
  itemId,
  fromLocationId,
}: {
  itemId: string;
  fromLocationId: string;
}) {
  const balancesQuery = useQuery({
    queryKey: ["item-location-balances", itemId],
    queryFn: () =>
      apiJson<ItemLocationBalance[]>(`/api/items/${itemId}/location-balances`),
  });
  const balance = balancesQuery.data?.find(
    (row) => row.locationId === fromLocationId
  );
  if (!balance) return null;

  return (
    <p className="mt-(--space-1) text-[length:var(--text-xs)] text-[var(--color-ink-faint)]">
      On hand at {balance.locationName}: {formatQuantity(balance.onHandQty)}
    </p>
  );
}
