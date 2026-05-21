"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import {
  copyVariantConfigFrom,
  EndpointNotReadyError,
  generateVariants,
  ItemCardApiError,
  previewVariantGeneration,
  updateVariantConfig,
  type GenerationPreviewDto,
  type ItemCardDto,
  type VariantConfigInput,
} from "@/lib/api/clients/item-cards";
import { cardSaveMutationKey } from "./card-save-status";
import styles from "./card-page.module.css";

const MAX_OPTIONS = 3;

type VariantConfigSourceRow = {
  id: string;
  familyId: string | null;
  familyName: string | null;
  displayName: string;
  itemType: string;
};

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
      <DialogContent size="lg" className="max-h-[80vh] overflow-y-auto p-0">
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
  const [copyOpen, setCopyOpen] = useState(false);
  const [sourceItemId, setSourceItemId] = useState("");
  const dirty = !configEqualsCard(options, card);
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

  const sourcesQuery = useQuery({
    queryKey: ["item-card", card.family.itemType, "variant-config-sources"],
    queryFn: async () => {
      const response = await fetch(`/api/items?itemType=${card.family.itemType}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Failed to load item cards.");
      }
      return body as VariantConfigSourceRow[];
    },
    enabled: copyOpen,
  });

  const sourceCards = useMemo(() => {
    const byFamily = new Map<string, VariantConfigSourceRow>();
    for (const item of sourcesQuery.data ?? []) {
      const familyId = item.familyId;
      if (!familyId || familyId === card.family.id || byFamily.has(familyId)) continue;
      byFamily.set(familyId, item);
    }
    return Array.from(byFamily.values());
  }, [card.family.id, sourcesQuery.data]);

  const saveAndGenerateMutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", focusItemId ?? card.family.id, "variant-config-save-generate"),
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

  const copyMutation = useMutation({
    mutationKey: cardSaveMutationKey("item-card", focusItemId ?? card.family.id, "variant-config-copy"),
    mutationFn: async () => {
      if (!focusItemId || !sourceItemId) {
        throw new Error("Choose a card to copy from.");
      }
      return copyVariantConfigFrom(focusItemId, { sourceItemId });
    },
    onSuccess: (nextCard) => {
      setOptions(seedOptionsFromCard(nextCard));
      setCopyOpen(false);
      setSourceItemId("");
      void queryClient.invalidateQueries({ queryKey: ["item-card"] });
    },
  });

  const errorMessage = saveAndGenerateMutation.error
    ? saveAndGenerateMutation.error instanceof EndpointNotReadyError
      ? "The card backend hasn’t shipped this endpoint yet."
      : (saveAndGenerateMutation.error as Error).message
    : null;

  return (
    <>
      <DialogHeader className="flex flex-row items-center justify-between gap-(--space-4) border-b border-border px-(--space-6) py-(--space-5)">
        <DialogTitle>
          {card.family.itemType === "material"
            ? "Material variant configuration"
            : "Product variant configuration"}
        </DialogTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!focusItemId}
          onClick={() => setCopyOpen((current) => !current)}
        >
          <HugeiconsIcon icon={Copy01Icon} size={14} className="mr-(--space-1)" />
          Copy variant config from
        </Button>
      </DialogHeader>

      <div className="space-y-(--space-5) px-(--space-6) py-(--space-5)">
        {copyOpen ? (
          <div className="grid gap-(--space-3) border border-border p-(--space-3)">
            <div className="grid gap-(--space-2) md:grid-cols-[1fr_auto]">
              <Select value={sourceItemId} onValueChange={setSourceItemId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      sourcesQuery.isLoading
                        ? "Loading cards..."
                        : sourceCards.length === 0
                          ? "No other configured cards"
                          : "Select card"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {sourceCards.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.familyName ?? item.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                onClick={() => copyMutation.mutate()}
                disabled={!sourceItemId || copyMutation.isPending}
              >
                {copyMutation.isPending ? "Copying..." : "Copy"}
              </Button>
            </div>
            {copyMutation.error || sourcesQuery.error ? (
              <p className="text-[length:var(--text-sm)] text-destructive">
                {(
                  (copyMutation.error ?? sourcesQuery.error) as Error
                ).message}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-(--space-3)">
          {options.map((option, optionIndex) => (
            <OptionEditor
              key={`option-${optionIndex}`}
              option={option}
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

          {options.length < MAX_OPTIONS ? (
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
          options={options}
          preview={previewQuery.data}
          loading={previewQuery.isFetching}
          dirty={dirty}
          canPreview={canPreview}
        />

        {errorMessage ? (
          <p className="text-[length:var(--text-sm)] text-destructive">
            {errorMessage}
          </p>
        ) : null}
      </div>

        <DialogFooter className="border-t border-border px-(--space-6) py-(--space-4)">
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
  onChangeName: (name: string) => void;
  onAddValue: (label: string) => void;
  onRemoveValue: (valueIndex: number) => void;
  onRemoveOption: () => void;
};

function OptionEditor({
  option,
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
    <div className={styles.variantOptionRow}>
      <div className={styles.variantOptionName}>
        <label className={styles.variantConfigLabel}>Variant option</label>
        <Input
          value={option.name}
          onChange={(event) => onChangeName(event.target.value)}
          placeholder="e.g. size"
        />
      </div>

      <div className={styles.variantOptionValues}>
        <label className={styles.variantConfigLabel}>
          Option values, separated by commas
        </label>
        <div className={styles.chipInput}>
          {option.values.map((value, valueIndex) => (
            <span
              key={`${valueIndex}-${value.label}`}
              className={styles.chip}
            >
              {value.label}
              <button
                type="button"
                onClick={() => onRemoveValue(valueIndex)}
                aria-label={`Remove value ${value.label}`}
                className={styles.x}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={10} />
              </button>
            </span>
          ))}
          <input
            value={valueDraft}
            onChange={(event) => setValueDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                commitValue();
              }
            }}
            onBlur={commitValue}
            placeholder="Add value..."
          />
        </div>
      </div>

      <div className={styles.variantOptionAction}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onRemoveOption}
          aria-label="Remove option"
        >
          <HugeiconsIcon icon={Delete02Icon} size={15} />
        </Button>
      </div>
    </div>
  );
}

type PreviewPanelProps = {
  options: LocalOption[];
  preview: GenerationPreviewDto | undefined;
  loading: boolean;
  dirty: boolean;
  canPreview: boolean;
};

function PreviewPanel({
  options,
  preview,
  loading,
  dirty,
  canPreview,
}: PreviewPanelProps) {
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
        Generating will create {getLocalCombinationCount(options)} variants — one per
        combination of {formatOptionNames(options)}. Existing variants with matching keys keep
        their data.
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
  const optionNames = formatOptionNames(options);
  return (
    <div className="text-[length:var(--text-sm)] text-muted-foreground">
      Generating will create {preview.potentialCount} variants — one per combination of{" "}
      {optionNames}. Existing variants with matching keys keep their data.
      {preview.blocksGenerateAll ? (
        <p className="mt-(--space-2)" style={{ color: "var(--color-danger)" }}>
          Too many combinations to generate at once (over 250). Reduce option values first.
        </p>
      ) : preview.warnOver100 ? (
        <p className="mt-(--space-2)" style={{ color: "var(--color-warning)" }}>
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

function getLocalCombinationCount(options: LocalOption[]) {
  return options.reduce((total, option) => total * Math.max(option.values.length, 1), 1);
}

function formatOptionNames(options: LocalOption[]) {
  return (
    options
      .map((option) => option.name.trim())
      .filter(Boolean)
      .join(" × ") || "the configured options"
  );
}
