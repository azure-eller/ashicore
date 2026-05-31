"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Clock01Icon,
  CheckmarkCircle02Icon,
  Download01Icon,
  Undo03Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CardSection } from "@/components/card-page/card-page";
import { ActiveVariantSelect } from "@/components/card-page/active-variant-select";
import { CopyDialog } from "@/components/card-page/copy-bom-dialog";
import { cardSaveMutationKey } from "@/components/card-page/card-save-status";
import {
  BomEditor,
  toBomRevisionPayloadRows,
  type BomPayloadRow,
} from "@/app/(dashboard)/inventory/bom-editor";
import { saveBomRevision, type ItemCardDto } from "@/lib/api/clients/item-cards";
import {
  BomRevisionHistorySheet,
  type BomRevisionHistoryEntry,
} from "./bom-revision-history-sheet";
import styles from "@/components/card-page/card-page.module.css";

type AvailableComponent = {
  id: string;
  name: string;
  displayName: string;
  itemType: string;
  unit: string;
};

export type ProductRecipeTabProps = {
  card: ItemCardDto;
  focusItemId: string;
  initialBomRows: BomPayloadRow[];
  initialBomRevisionId: string | null;
  initialOutputQuantity: string;
  initialRecipeBasis: "unit" | "batch";
  initialExpectedBatchYield: string | null;
  bomRevisions: BomRevisionHistoryEntry[];
  availableComponents: AvailableComponent[];
  canViewBom: boolean;
  canEditProduct: boolean;
};

export function ProductRecipeTab({
  card,
  focusItemId,
  initialBomRows,
  initialBomRevisionId,
  initialOutputQuantity,
  initialRecipeBasis,
  initialExpectedBatchYield,
  bomRevisions,
  availableComponents,
  canViewBom,
  canEditProduct,
}: ProductRecipeTabProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const visibleVariants = card.variants.filter((variant) => variant.deletedAt == null);
  const activeVariant =
    visibleVariants.find((variant) => variant.id === focusItemId) ?? visibleVariants[0];

  const [rows, setRows] = useState<BomPayloadRow[]>(initialBomRows);
  const [recipeBasis, setRecipeBasis] = useState<"unit" | "batch">(
    initialRecipeBasis,
  );
  const [expectedBatchYield, setExpectedBatchYield] = useState(
    initialExpectedBatchYield ?? initialOutputQuantity,
  );
  const [dirty, setDirty] = useState(false);
  const [copyToOpen, setCopyToOpen] = useState(false);
  const [copyFromOpen, setCopyFromOpen] = useState(false);
  const [revisionHistoryOpen, setRevisionHistoryOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const editorResetKey = `${focusItemId}:${initialBomRevisionId ?? "none"}`;
  const outputUnitName = card.family.unitName ?? "unit";

  const saveMutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", focusItemId, "bom-revision"),
    mutationFn: (note: string | null) =>
      saveBomRevision(focusItemId, {
        recipeBasis,
        expectedBatchYield: recipeBasis === "batch" ? expectedBatchYield : null,
        outputQuantity: recipeBasis === "batch" ? expectedBatchYield : "1",
        bom: toBomRevisionPayloadRows(rows),
        note,
      }),
    onSuccess: () => {
      setDirty(false);
      setRevisionNote("");
      setSaveDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
      router.refresh();
    },
  });

  useEffect(() => {
    if (!dirty) return;

    const message = "You have unsaved recipe changes. Discard them and leave?";
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target && link.target !== "_self") return;
      if (link.href === window.location.href) return;

      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;

      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [dirty]);

  if (!canViewBom) {
    return (
      <CardSection aria-label="Locked recipe">
        <p className={styles.helper}>
          This recipe is locked. Inventory or manufacturing admin access is required
          to view or edit recipe details.
        </p>
      </CardSection>
    );
  }

  const handleVariantChange = (nextVariantId: string) => {
    if (nextVariantId === focusItemId) return;
    if (dirty) {
      const confirmed = window.confirm(
        "You have unsaved recipe changes. Discard them and switch variants?",
      );
      if (!confirmed) return;
    }
    const segment = card.family.itemType === "material" ? "materials" : "products";
    router.push(`/inventory/${segment}/${nextVariantId}/recipe`);
  };

  const handleRowsChange = (next: BomPayloadRow[]) => {
    if (!canEditProduct || !activeVariant) return;
    setRows(next);
    setDirty(true);
  };

  return (
    <CardSection title="Recipe / Bill of Materials">
      <div className="grid gap-(--space-4) lg:grid-cols-[minmax(280px,420px)_minmax(0,1fr)] lg:items-end">
        <ActiveVariantSelect
          variants={visibleVariants}
          value={focusItemId}
          onChange={handleVariantChange}
          hideWhenSingle={false}
        />
        <div className="flex items-center gap-(--space-2) lg:h-(--height-input-md)">
          <Checkbox
            id="recipe-basis-batch"
            checked={recipeBasis === "batch"}
            disabled={!canEditProduct}
            onCheckedChange={(checked) => {
              if (!canEditProduct) return;
              setRecipeBasis(checked === true ? "batch" : "unit");
              setDirty(true);
            }}
          />
          <Label htmlFor="recipe-basis-batch" className="whitespace-nowrap">
            This product is produced in batches
          </Label>
        </div>
      </div>

      <p className={styles.helper} style={{ marginTop: "var(--space-2)" }}>
        {activeVariant ? (
          <>
            Any changes made here only affect <strong>{activeVariant.displayName}</strong>.
          </>
        ) : (
          "No variants yet. Recipe editing will be available after the first variant exists."
        )}
      </p>

      {recipeBasis === "batch" ? (
        <div className="mt-(--space-3) w-full max-w-xs space-y-(--space-1)">
          <Label htmlFor="expected-output-per-batch">Output per batch</Label>
          <div className="flex h-(--height-input-md) items-center border border-input bg-background">
            <Input
              id="expected-output-per-batch"
              aria-label="Output per batch"
              inputMode="decimal"
              value={expectedBatchYield}
              onChange={(event) => {
                setExpectedBatchYield(event.target.value);
                setDirty(true);
              }}
              disabled={!canEditProduct}
              className="h-full border-0 shadow-none focus-visible:ring-0"
            />
            <span className="border-l border-border px-(--space-3) text-[length:var(--text-sm)] text-muted-foreground">
              {outputUnitName}
            </span>
          </div>
        </div>
      ) : null}

      <div className="mt-(--space-6) mb-(--space-2) flex flex-wrap items-center justify-end gap-(--space-1)">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="px-(--space-4)"
          disabled={bomRevisions.length === 0}
          onClick={() => setRevisionHistoryOpen(true)}
        >
          <HugeiconsIcon icon={Clock01Icon} data-icon="inline-start" />
          Recipe history
        </Button>
        {canEditProduct ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="px-(--space-4)"
              disabled={!activeVariant || visibleVariants.length < 2}
              onClick={() => setCopyToOpen(true)}
            >
              <HugeiconsIcon icon={Upload01Icon} data-icon="inline-start" />
              Copy to…
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="px-(--space-4)"
              disabled={!activeVariant || visibleVariants.length < 2}
              onClick={() => setCopyFromOpen(true)}
            >
              <HugeiconsIcon icon={Download01Icon} data-icon="inline-start" />
              Copy from…
            </Button>
            {dirty ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="px-(--space-4)"
                disabled={saveMutation.isPending}
                onClick={() => {
                  setRows(initialBomRows);
                  setRecipeBasis(initialRecipeBasis);
                  setExpectedBatchYield(initialExpectedBatchYield ?? initialOutputQuantity);
                  setDirty(false);
                }}
              >
                <HugeiconsIcon icon={Undo03Icon} data-icon="inline-start" />
                Discard
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="px-(--space-4)"
              disabled={!activeVariant || !dirty || saveMutation.isPending}
              onClick={() => setSaveDialogOpen(true)}
            >
              <HugeiconsIcon icon={CheckmarkCircle02Icon} data-icon="inline-start" />
              Save recipe
            </Button>
          </>
        ) : null}
      </div>

      <BomEditor
        key={editorResetKey}
        initialRows={initialBomRows}
        availableComponents={availableComponents}
        quantityHeader={
          recipeBasis === "batch" ? "Quantity per batch" : "Quantity per unit"
        }
        onRowsChange={handleRowsChange}
        error={saveMutation.error}
      />

      <div className={styles.totals}>
        <span className={styles.lab}>Total cost</span>
        <span>
          <span className={styles.val}>
            {activeVariant?.ingredientsCost == null
              ? "—"
              : Number(activeVariant.ingredientsCost).toFixed(5)}
          </span>
          <span className={styles.ccy}>USD</span>
        </span>
      </div>

      {activeVariant ? (
        <>
          <BomRevisionHistorySheet
            open={revisionHistoryOpen}
            onOpenChange={setRevisionHistoryOpen}
            productName={activeVariant.displayName}
            revisions={bomRevisions}
          />
          <CopyDialog
            open={copyToOpen}
            onOpenChange={setCopyToOpen}
            cardItemId={focusItemId}
            scope="bom"
            direction="to"
            activeVariant={activeVariant}
            siblings={visibleVariants}
          />
          <CopyDialog
            open={copyFromOpen}
            onOpenChange={setCopyFromOpen}
            cardItemId={focusItemId}
            scope="bom"
            direction="from"
            activeVariant={activeVariant}
            siblings={visibleVariants}
          />
          <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
            <DialogContent size="md">
              <DialogHeader>
                <DialogTitle>Save recipe</DialogTitle>
                <DialogDescription>
                  Add an optional note for recipe history.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-(--space-2)">
                <Label htmlFor="recipe-revision-note">Revision note</Label>
                <Textarea
                  id="recipe-revision-note"
                  value={revisionNote}
                  onChange={(event) => setRevisionNote(event.target.value)}
                  placeholder="What changed?"
                  rows={4}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSaveDialogOpen(false)}
                  disabled={saveMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate(revisionNote.trim() || null)}
                >
                  {saveMutation.isPending ? "Saving…" : "Save recipe"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </CardSection>
  );
}
