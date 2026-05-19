"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { createItemCard } from "@/lib/api/clients/item-cards";
import type { ItemType } from "@/app/(dashboard)/inventory/types";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import styles from "./card-page.module.css";

export type NewCardPageProps = {
  itemType: ItemType;
  defaultUnitId: string;
  unitOptions: Array<{ id: string; name: string; size: string; uom: string }>;
};

/**
 * Katana-style empty card: one page = create + edit + detail. Renders the
 * usual card chrome with a name input (autofocused). On first blur with a
 * non-empty name, POSTs to `/api/item-cards` and replaces the URL with the
 * new id under `?view=card` so the rest of the editing flow takes over.
 *
 * Required fields are name (user-typed) + unit (defaults to "Each"). Unit
 * is editable after creation now that `itemCardUpdateSchema` accepts it.
 */
export function NewCardPage({ itemType, defaultUnitId, unitOptions }: NewCardPageProps) {
  const router = useRouter();
  const handleClose = useSmartBack(`/inventory/${itemType === "material" ? "materials" : "products"}`);
  const typeLabel = itemType === "material" ? "Material" : "Product";
  const segment = itemType === "material" ? "materials" : "products";

  const [name, setName] = useState("");
  const [unitId, setUnitId] = useState(defaultUnitId);

  const createMutation = useMutation({
    mutationFn: () =>
      createItemCard({
        itemType,
        name: name.trim(),
        unitDefinitionId: unitId,
      }),
    onSuccess: (result) => {
      router.replace(`/inventory/${segment}/${result.id}?view=card`);
    },
  });

  const handleCommit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (createMutation.isPending || createMutation.isSuccess) return;
    createMutation.mutate();
  };

  const errorMessage = createMutation.error
    ? (createMutation.error as Error).message
    : null;

  return (
    <div className={styles.sheet}>
      <header className={styles.header}>
        <div className={styles.headerIdentity}>
          <div className={styles.eyebrow}>{typeLabel}</div>
          <h1 className={styles.title}>
            {name.trim() || `New ${typeLabel.toLowerCase()}`}
          </h1>
          <div className={styles.meta}>
            <span>Draft</span>
          </div>
        </div>
        <div className={styles.headerRight}>
          {createMutation.isPending ? (
            <span className={styles.savingPill}>
              <span className={styles.pillSquare} /> Creating…
            </span>
          ) : (
            <span className={styles.savedPill}>
              <span className={styles.pillSquare} /> Type a name to begin
            </span>
          )}
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Close"
            onClick={handleClose}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <section className={styles.section}>
          <div
            className="grid md:grid-cols-2"
            style={{ rowGap: 24, columnGap: 36 }}
          >
            <Field data-invalid={createMutation.isError || undefined}>
              <FieldLabel>
                {typeLabel} name <span style={{ color: "var(--color-danger)" }}>*</span>
              </FieldLabel>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={handleCommit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleCommit();
                  }
                }}
                disabled={createMutation.isPending || createMutation.isSuccess}
                placeholder={`E.g. ${itemType === "material" ? "Peat Moss" : "Bomb 50/50"}`}
                className={styles.inp}
                aria-invalid={createMutation.isError || undefined}
              />
            </Field>

            <Field>
              <FieldLabel>Unit of measure</FieldLabel>
              <Select
                value={unitId}
                onValueChange={setUnitId}
                disabled={createMutation.isPending || createMutation.isSuccess}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a unit" />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.name} ({unit.size} {unit.uom})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className={styles.helper}>
                You can change the unit later from this same page.
              </p>
            </Field>
          </div>

          {errorMessage ? (
            <FieldError>{errorMessage}</FieldError>
          ) : null}

          {createMutation.isPending || createMutation.isSuccess ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginTop: "var(--space-3)",
                color: "var(--color-muted)",
                fontSize: 11.5,
              }}
            >
              <Spinner className="size-3" /> Creating card…
            </div>
          ) : (
            <p className={styles.helper} style={{ marginTop: "var(--space-3)" }}>
              Press <kbd>Tab</kbd> or click out of the name field to create the card.
              Variants, recipe, and the rest unlock once the card exists.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
