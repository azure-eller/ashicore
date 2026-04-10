"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useReadability } from "@/app/readability-provider";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import {
  READABILITY_OPTIONS,
  type ReadabilityOption,
} from "@/lib/schemas/account";
import { cn } from "@/lib/utils";

const readabilityCopy: Record<
  ReadabilityOption,
  { label: string; description: string }
> = {
  default: {
    label: "Default",
    description: "Keep the standard text size and spacing across the app.",
  },
  large: {
    label: "Medium",
    description: "Use the current larger scale with roomier rows in data-heavy views.",
  },
  "x-large": {
    label: "Large",
    description: "Use the biggest preset with the most generous spacing everywhere.",
  },
};

export function AppearanceSection() {
  const { readability, setReadability } = useReadability();
  const [selectedReadability, setSelectedReadability] =
    useState<ReadabilityOption>(readability);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedReadability(readability);
  }, [readability]);

  const hasChanges = selectedReadability !== readability;

  const mutation = useMutation({
    mutationFn: async (nextReadability: ReadabilityOption) => {
      const response = await fetch("/api/account/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readability: nextReadability }),
      });
      const body = (await response.json().catch(() => null)) as
        | { readability?: ReadabilityOption; error?: string }
        | null;

      if (!response.ok || !body?.readability) {
        throw new Error(body?.error ?? "Failed to update readability.");
      }

      return body.readability;
    },
    onMutate: () => {
      setSubmitError(null);
      setSubmitSuccess(null);
    },
    onSuccess: (nextReadability) => {
      setReadability(nextReadability);
      setSelectedReadability(nextReadability);
      setSubmitSuccess("Readability updated.");
    },
    onError: (error) => {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to update readability."
      );
    },
  });

  return (
    <section id="appearance" className="rounded-xl border bg-background p-6">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Appearance</h2>
          <p className="text-sm text-muted-foreground">
            Adjust readability across the app. Higher presets increase text
            size and open up spacing, especially in dense tables.
          </p>
        </div>

        <div
          className="grid gap-3 md:grid-cols-3"
          aria-label="Readability presets"
        >
          {READABILITY_OPTIONS.map((option) => {
            const preset = readabilityCopy[option];
            const isSelected = selectedReadability === option;

            return (
              <button
                key={option}
                type="button"
                onClick={() => setSelectedReadability(option)}
                disabled={mutation.isPending}
                aria-pressed={isSelected}
                className={cn(
                  "rounded-xl border px-4 py-4 text-left transition-colors",
                  isSelected
                    ? "border-ring bg-accent text-accent-foreground"
                    : "border-border bg-card text-card-foreground hover:bg-accent/50",
                  mutation.isPending && "cursor-not-allowed opacity-50"
                )}
              >
                <div className="flex flex-col gap-2">
                  <span className="font-medium">{preset.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {preset.description}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-h-5 flex-col gap-1">
            {submitError ? <FieldError>{submitError}</FieldError> : null}
            {submitSuccess ? (
              <p className="text-sm text-foreground">{submitSuccess}</p>
            ) : null}
          </div>

          <Button
            type="button"
            variant={hasChanges ? "default" : "outline"}
            disabled={mutation.isPending || !hasChanges}
            onClick={() => mutation.mutate(selectedReadability)}
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </section>
  );
}
