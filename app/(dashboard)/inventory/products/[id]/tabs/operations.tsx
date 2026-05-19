"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ActiveVariantSelect } from "@/components/card-page/active-variant-select";
import { CopyDialog } from "@/components/card-page/copy-bom-dialog";
import type { ItemCardDto } from "@/lib/api/clients/item-cards";
import styles from "@/components/card-page/card-page.module.css";

export type ProductOperationsTabProps = {
  card: ItemCardDto;
  focusItemId: string;
};

export function ProductOperationsTab({ card, focusItemId }: ProductOperationsTabProps) {
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
      <h2 className={styles.sectionHeading}>Operation steps</h2>
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
        </div>
      </div>

      <div className="border border-border p-(--space-4) bg-muted/30">
        <p className="text-[length:var(--text-sm)] text-muted-foreground">
          Production operations live on each variant&rsquo;s BOM revision
          (operation name, resource, crew size, planned minutes; cost flows
          into estimated unit cost / margin). Inline editing on the card is a
          v1.1 task — view-only for now.
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
        scope="operations"
        direction="to"
        activeVariant={activeVariant}
        siblings={visibleVariants}
      />
      <CopyDialog
        open={copyFromOpen}
        onOpenChange={setCopyFromOpen}
        scope="operations"
        direction="from"
        activeVariant={activeVariant}
        siblings={visibleVariants}
      />
    </section>
  );
}
