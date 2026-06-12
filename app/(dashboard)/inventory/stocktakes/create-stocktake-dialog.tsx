"use client";

import { useEffect, useState } from "react";
import { LocationPickerField, useActiveLocations } from "@/components/location-select";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { apiJson } from "@/lib/client/api";
import { buildStocktakeModeName } from "./types";
import type { StocktakeCreationMode } from "@/lib/schemas/stocktakes";

const MODE_OPTIONS: Array<{
  mode: StocktakeCreationMode;
  title: string;
  description: string;
}> = [
  {
    mode: "empty",
    title: "Empty",
    description: "Start with no rows and add items as you count.",
  },
  {
    mode: "in_stock",
    title: "Items in stock",
    description: "Start with items that have physical stock on hand.",
  },
  {
    mode: "all",
    title: "All items",
    description: "Start with every active material and product.",
  },
];

export function CreateStocktakeDialog() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const createRequested = searchParams.get("create") === "1";
  const [open, setOpen] = useState(createRequested);
  const [mode, setMode] = useState<StocktakeCreationMode>("in_stock");
  const [reason, setReason] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  // Wait for the first locations fetch so a multi-location org cannot
  // submit before its picker has had a chance to render.
  const locationsPending = useActiveLocations().isPending;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (createRequested) {
      router.replace(pathname);
    }
  }, [createRequested, pathname, router]);

  const createMode = async () => {
    setPending(true);
    setError(null);
    try {
      const body = await apiJson<{ id: string }>("/api/stocktakes", {
        method: "POST",
        body: {
          name: buildStocktakeModeName(mode),
          scope: mode,
          creationMode: mode,
          notes: null,
          reason: reason.trim(),
          ...(locationId ? { locationId } : {}),
        },
        fallbackError: "Failed to create stocktake.",
      });
      router.push(`/inventory/stocktakes/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create stocktake.");
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open || createRequested}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setPending(false);
          setReason("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button aria-label="New Stocktake">
          <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
          New Stocktake
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New stocktake</DialogTitle>
        </DialogHeader>

        {error ? <FieldError>{error}</FieldError> : null}

        <RadioGroup
          value={mode}
          onValueChange={(value) => setMode(value as StocktakeCreationMode)}
        >
          {MODE_OPTIONS.map((option) => (
            <label
              key={option.mode}
              htmlFor={`stocktake-mode-${option.mode}`}
              className="flex cursor-pointer items-start gap-(--space-3)"
            >
              <RadioGroupItem
                id={`stocktake-mode-${option.mode}`}
                value={option.mode}
                className="mt-(--space-1)"
              />
              <span className="flex flex-col gap-(--space-1)">
                <span className="text-[length:var(--text-sm)] font-medium leading-none">
                  {option.title}
                </span>
                <span className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>

        <LocationPickerField value={locationId} onValueChange={setLocationId} />

        <div className="space-y-2">
          <Label htmlFor="stocktake-create-reason">
            Reason <span className="text-[var(--status-danger-ink)]">*</span>
          </Label>
          <Input
            id="stocktake-create-reason"
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            placeholder="Why is this count being made?"
          />
        </div>

        <DialogFooter>
          <Button onClick={createMode} disabled={pending || locationsPending || reason.trim() === ""}>
            {pending ? "Creating..." : "Create stocktake"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
