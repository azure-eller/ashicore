"use client";

import { useMutation } from "@tanstack/react-query";
import { useReadability } from "@/app/readability-provider";
import { READABILITY_OPTIONS, type ReadabilityOption } from "@/lib/schemas/account";
import { cn } from "@/lib/utils";

const LABEL: Record<ReadabilityOption, string> = {
  default: "Default",
  large: "Medium",
  "x-large": "Large",
};

export function ReadabilitySegmented() {
  const { readability, setReadability } = useReadability();

  const mutation = useMutation({
    mutationFn: async (next: ReadabilityOption) => {
      const previous = readability;
      setReadability(next);

      const response = await fetch("/api/account/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readability: next }),
      });

      if (!response.ok) {
        setReadability(previous);
        throw new Error("Failed to update text size.");
      }
    },
  });

  return (
    <div
      role="radiogroup"
      aria-label="Text size"
      className="flex overflow-hidden rounded-md border"
    >
      {READABILITY_OPTIONS.map((option) => {
        const isActive = readability === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => {
              if (!isActive && !mutation.isPending) {
                mutation.mutate(option);
              }
            }}
            disabled={mutation.isPending}
            className={cn(
              "flex-1 border-r px-2 py-1 text-xs transition-colors last:border-r-0",
              isActive
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            {LABEL[option]}
          </button>
        );
      })}
    </div>
  );
}
