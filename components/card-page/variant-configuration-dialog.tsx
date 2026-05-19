"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import {
  EndpointNotReadyError,
  generateVariants,
  ItemCardApiError,
  previewVariantGeneration,
  updateVariantConfig,
  type GenerationPreviewDto,
  type ItemCardDto,
  type VariantConfigInput,
} from "@/lib/api/clients/item-cards";

const MAX_OPTIONS = 3;

type LocalOption = {
  id?: string;
  name: string;
  values: Array<{ id?: string; label: string }>;
};

export type VariantConfigurationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: ItemCardDto;
};

export function VariantConfigurationDialog({
  open,
  onOpenChange,
  card,
}: VariantConfigurationDialogProps) {
  // Snapshot the card into the inner component on mount so editing the form
  // doesn't fight with re-renders from background invalidations. Inner remounts
  // each time the dialog opens.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[80vh] overflow-y-auto">
        {open ? (
          <DialogBody card={card} onOpenChange={onOpenChange} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  card,
  onOpenChange,
}: {
  card: ItemCardDto;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [options, setOptions] = useState<LocalOption[]>(() =>
    seedOptionsFromCard(card),
  );

  // Lock only when an existing variant actually has option-value assignments.
  // A freshly created card has one default variant with no assignments — those
  // are safe to replace with a new option/value config (Codex's updateVariant-
  // Config check is `itemVariantValues exists`, not `items exists`). After
  // generation, any variant with assignments will trip the lock and the user
  // must delete it to change config.
  const configLocked = card.variants.some(
    (variant) => variant.deletedAt == null && variant.optionValues.length > 0,
  );
  const dirty = !configEqualsCard(options, card);
  const totalValues = options.reduce((sum, option) => sum + option.values.length, 0);
  const canPreview = options.length > 0 && options.every((option) => option.values.length > 0);

  // Preview always reads the persisted config; if local edits exist, the
  // user must save first (we sequence the calls below).
  const previewQuery = useQuery({
    queryKey: ["item-card", card.variants[0]?.id ?? card.family.id, "variants-preview"],
    queryFn: () => previewVariantGeneration(card.variants[0]?.id ?? card.family.id),
    enabled: card.variants.length > 0 && !dirty,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const focusItemId = card.variants[0]?.id;

  const saveAndGenerateMutation = useMutation({
    mutationKey: ["item-card", focusItemId ?? card.family.id, "variant-config-save-generate"],
    mutationFn: async ({ mode }: { mode: "save-only" | "generate-all" }) => {
      if (!focusItemId) {
        throw new Error("Cannot configure variants on a card with no items.");
      }

      if (dirty) {
        const payload: VariantConfigInput = {
          options: options.map((option, optionIndex) => ({
            id: option.id,
            name: option.name.trim(),
            sortOrder: optionIndex,
            values: option.values.map((value, valueIndex) => ({
              id: value.id,
              label: value.label.trim(),
              sortOrder: valueIndex,
            })),
          })),
        };
        await updateVariantConfig(focusItemId, payload);
      }

      if (mode === "save-only") return { created: [] };

      // Always re-preview after a save so we pick up freshly-inserted ids
      // and the latest "missing" set.
      const preview = await previewVariantGeneration(focusItemId);
      if (preview.blocksGenerateAll) {
        throw new ItemCardApiError(
          "Too many combinations to generate at once (over 250). Reduce option values first.",
          400,
        );
      }
      return generateVariants(focusItemId, {});
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
      onOpenChange(false);
    },
  });

  const errorMessage = saveAndGenerateMutation.error
    ? saveAndGenerateMutation.error instanceof EndpointNotReadyError
      ? "The card backend hasn’t shipped this endpoint yet."
      : (saveAndGenerateMutation.error as Error).message
    : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {card.family.itemType === "material"
            ? "Material variant configuration"
            : "Product variant configuration"}
        </DialogTitle>
        <DialogDescription>
          Define options and values. Generate variants from any missing combinations.
        </DialogDescription>
      </DialogHeader>

      {configLocked ? (
          <div className="border border-border bg-muted/40 p-(--space-3) text-[length:var(--text-sm)] text-muted-foreground">
            Configuration is locked once variants exist. Delete variants to change options or values.
          </div>
        ) : null}

        <div className="space-y-(--space-4)">
          {options.map((option, optionIndex) => (
            <OptionEditor
              key={`option-${optionIndex}`}
              option={option}
              locked={configLocked}
              onChangeName={(name) =>
                setOptions((prev) =>
                  prev.map((opt, i) => (i === optionIndex ? { ...opt, name } : opt)),
                )
              }
              onAddValue={(label) =>
                setOptions((prev) =>
                  prev.map((opt, i) =>
                    i === optionIndex
                      ? { ...opt, values: [...opt.values, { label }] }
                      : opt,
                  ),
                )
              }
              onRemoveValue={(valueIndex) =>
                setOptions((prev) =>
                  prev.map((opt, i) =>
                    i === optionIndex
                      ? {
                          ...opt,
                          values: opt.values.filter((_, vi) => vi !== valueIndex),
                        }
                      : opt,
                  ),
                )
              }
              onRemoveOption={() =>
                setOptions((prev) => prev.filter((_, i) => i !== optionIndex))
              }
            />
          ))}

          {!configLocked && options.length < MAX_OPTIONS ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setOptions((prev) => [...prev, { name: "", values: [] }])
              }
            >
              <HugeiconsIcon icon={Add01Icon} size={14} className="mr-(--space-1)" />
              Add option
            </Button>
          ) : null}
        </div>

        <PreviewPanel
          preview={previewQuery.data}
          loading={previewQuery.isFetching}
          dirty={dirty}
          canPreview={canPreview}
          totalValues={totalValues}
        />

        {errorMessage ? (
          <p className="text-[length:var(--text-sm)] text-destructive">
            {errorMessage}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saveAndGenerateMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() =>
              saveAndGenerateMutation.mutate({ mode: "generate-all" })
            }
            disabled={
              saveAndGenerateMutation.isPending ||
              !canPreview ||
              (previewQuery.data?.blocksGenerateAll ?? false)
            }
          >
            {saveAndGenerateMutation.isPending
              ? "Generating…"
              : `Generate ${card.family.itemType === "material" ? "material" : "product"} variants`}
          </Button>
        </DialogFooter>
    </>
  );
}

type OptionEditorProps = {
  option: LocalOption;
  locked: boolean;
  onChangeName: (name: string) => void;
  onAddValue: (label: string) => void;
  onRemoveValue: (valueIndex: number) => void;
  onRemoveOption: () => void;
};

function OptionEditor({
  option,
  locked,
  onChangeName,
  onAddValue,
  onRemoveValue,
  onRemoveOption,
}: OptionEditorProps) {
  const [valueDraft, setValueDraft] = useState("");

  const commitValue = () => {
    const trimmed = valueDraft.trim();
    if (!trimmed) return;
    if (option.values.some((value) => value.label.toLowerCase() === trimmed.toLowerCase())) {
      setValueDraft("");
      return;
    }
    onAddValue(trimmed);
    setValueDraft("");
  };

  return (
    <div className="border border-border p-(--space-3) space-y-(--space-3)">
      <Field>
        <FieldLabel>Option name</FieldLabel>
        <div className="flex items-center gap-(--space-2)">
          <Input
            value={option.name}
            onChange={(event) => onChangeName(event.target.value)}
            placeholder="e.g. Package, Size, Blend"
            disabled={locked}
          />
          {!locked ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onRemoveOption}
              aria-label="Remove option"
            >
              <HugeiconsIcon icon={Delete02Icon} size={16} />
            </Button>
          ) : null}
        </div>
      </Field>

      <div>
        <div className="text-[length:var(--text-xs)] text-muted-foreground mb-(--space-2)">
          Values
        </div>
        <div className="flex flex-wrap gap-(--space-2)">
          {option.values.map((value, valueIndex) => (
            <span
              key={`${valueIndex}-${value.label}`}
              className="inline-flex items-center gap-(--space-1) border border-border px-(--space-2) py-(--space-1) text-[length:var(--text-sm)]"
            >
              {value.label}
              {!locked ? (
                <button
                  type="button"
                  onClick={() => onRemoveValue(valueIndex)}
                  aria-label={`Remove value ${value.label}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={12} />
                </button>
              ) : null}
            </span>
          ))}
        </div>
        {!locked ? (
          <div className="flex items-center gap-(--space-2) mt-(--space-2)">
            <Input
              value={valueDraft}
              onChange={(event) => setValueDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  commitValue();
                }
              }}
              onBlur={commitValue}
              placeholder="e.g. 1cf bag, 2cf bag"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

type PreviewPanelProps = {
  preview: GenerationPreviewDto | undefined;
  loading: boolean;
  dirty: boolean;
  canPreview: boolean;
  totalValues: number;
};

function PreviewPanel({ preview, loading, dirty, canPreview, totalValues }: PreviewPanelProps) {
  if (!canPreview) {
    return (
      <p className="text-[length:var(--text-sm)] text-muted-foreground">
        Add at least one option with at least one value to enable generation.
      </p>
    );
  }
  if (dirty) {
    return (
      <p className="text-[length:var(--text-sm)] text-muted-foreground">
        Save the configuration to see exact combination counts. (Local values:{" "}
        {totalValues})
      </p>
    );
  }
  if (loading || !preview) {
    return (
      <p className="text-[length:var(--text-sm)] text-muted-foreground">
        Computing combinations…
      </p>
    );
  }
  return (
    <div className="space-y-(--space-2) text-[length:var(--text-sm)]">
      <div className="flex justify-between">
        <span>Potential combinations</span>
        <span className="font-medium">{preview.potentialCount}</span>
      </div>
      <div className="flex justify-between">
        <span>Already existing</span>
        <span className="font-medium">{preview.existingCount}</span>
      </div>
      <div className="flex justify-between">
        <span>Missing</span>
        <span
          className="font-medium"
          style={{
            color: preview.blocksGenerateAll
              ? "var(--color-danger)"
              : preview.warnOver100
              ? "var(--color-warning)"
              : undefined,
          }}
        >
          {preview.missingCount}
        </span>
      </div>
      {preview.blocksGenerateAll ? (
        <p style={{ color: "var(--color-danger)" }}>
          Too many combinations to generate at once (over 250). Reduce option values first.
        </p>
      ) : preview.warnOver100 ? (
        <p style={{ color: "var(--color-warning)" }}>
          Over 100 missing combinations. Consider trimming values before generating.
        </p>
      ) : null}
    </div>
  );
}

function seedOptionsFromCard(card: ItemCardDto): LocalOption[] {
  return card.options
    .filter((option) => option.disabledAt == null)
    .map((option) => ({
      id: option.id,
      name: option.name,
      values: option.values
        .filter((value) => value.disabledAt == null)
        .map((value) => ({ id: value.id, label: value.label })),
    }));
}

function configEqualsCard(local: LocalOption[], card: ItemCardDto): boolean {
  const remote = seedOptionsFromCard(card);
  if (local.length !== remote.length) return false;
  for (let i = 0; i < local.length; i++) {
    if (local[i].name.trim() !== remote[i].name) return false;
    if (local[i].values.length !== remote[i].values.length) return false;
    for (let j = 0; j < local[i].values.length; j++) {
      if (local[i].values[j].label.trim() !== remote[i].values[j].label) return false;
    }
  }
  return true;
}
