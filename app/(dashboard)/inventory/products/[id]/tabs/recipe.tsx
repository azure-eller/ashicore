"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ActiveVariantSelect } from "@/components/card-page/active-variant-select";
import { CopyDialog } from "@/components/card-page/copy-bom-dialog";
import type { ItemCardDto } from "@/lib/api/clients/item-cards";
import styles from "@/components/card-page/card-page.module.css";

export type ProductRecipeTabProps = {
  card: ItemCardDto;
  focusItemId: string;
};

export function ProductRecipeTab({ card, focusItemId }: ProductRecipeTabProps) {
  const visibleVariants = card.variants.filter((variant) => variant.deletedAt == null);
  const [activeVariantId, setActiveVariantId] = useState<string>(
    visibleVariants.find((variant) => variant.id === focusItemId)?.id ??
      visibleVariants[0]?.id ??
      "",
  );
  const [copyToOpen, setCopyToOpen] = useState(false);
  const [copyFromOpen, setCopyFromOpen] = useState(false);

  const activeVariant =
    visibleVariants.find((variant) => variant.id === activeVariantId) ?? null;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>
        Ingredients
        <span className={styles.hint}>per 1 unit of product</span>
      </h2>
      <div className="flex flex-col gap-(--space-3) md:flex-row md:items-end md:justify-between">
        <ActiveVariantSelect
          variants={visibleVariants}
          value={activeVariantId}
          onChange={setActiveVariantId}
          hideWhenSingle={false}
        />
        <div className="flex flex-wrap items-center gap-(--space-2)">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCopyToOpen(true)}
            disabled={!activeVariant || visibleVariants.length < 2}
          >
            Copy to…
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCopyFromOpen(true)}
            disabled={!activeVariant || visibleVariants.length < 2}
          >
            Copy from…
          </Button>
          {activeVariant ? (
            <Button type="button" size="sm" asChild>
              <Link href={`/inventory/products/${activeVariant.id}/edit`}>
                Edit recipe
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="border border-border p-(--space-4) bg-muted/30">
        <p className="text-[length:var(--text-sm)] text-muted-foreground">
          Inline recipe editing on the card is a v1.1 task. For now, use{" "}
          <strong>Edit recipe</strong> to open the existing per-variant edit page.
          Recipe changes there only affect the selected variant.
        </p>
        {activeVariant ? (
          <p className="text-[length:var(--text-sm)] text-muted-foreground mt-(--space-2)">
            Selected variant: <strong>{activeVariant.displayName}</strong>
          </p>
        ) : null}
      </div>

      <CopyDialog
        open={copyToOpen}
        onOpenChange={setCopyToOpen}
        scope="bom"
        direction="to"
        activeVariant={activeVariant}
        siblings={visibleVariants}
      />
      <CopyDialog
        open={copyFromOpen}
        onOpenChange={setCopyFromOpen}
        scope="bom"
        direction="from"
        activeVariant={activeVariant}
        siblings={visibleVariants}
      />
    </section>
  );
}
