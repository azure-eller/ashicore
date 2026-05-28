"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/field";
import {
  buildStocktakeModeName,
  formatCloneSkippedItemsWarning,
  type CloneStocktakeResult,
  type StocktakeListRow,
} from "../types";
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

export function CreateStocktakeClient({
  stocktakes,
}: {
  stocktakes: StocktakeListRow[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<StocktakeCreationMode>("in_stock");
  const [copyQuery, setCopyQuery] = useState("");
  const [copySourceId, setCopySourceId] = useState<string | null>(null);
  const [copyOptions, setCopyOptions] = useState(stocktakes);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: "25" });
        const query = copyQuery.trim();
        if (query) params.set("search", query);
        const response = await fetch(`/api/stocktakes?${params.toString()}`, {
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Failed to search stocktakes.");
        setCopyOptions(body as StocktakeListRow[]);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to search stocktakes.");
        }
      }
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [copyQuery]);

  const filteredStocktakes = useMemo(() => {
    const query = copyQuery.trim().toLowerCase();
    return copyOptions
      .filter((stocktake) =>
        query ? stocktake.name.toLowerCase().includes(query) : true
      )
      .slice(0, 25);
  }, [copyOptions, copyQuery]);

  const createMode = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/stocktakes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: buildStocktakeModeName(mode),
          scope: mode,
          creationMode: mode,
          notes: null,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Failed to create stocktake.");
      router.push(`/inventory/stocktakes/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create stocktake.");
    } finally {
      setPending(false);
    }
  };

  const copyStocktake = async () => {
    if (!copySourceId) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/stocktakes/${copySourceId}/clone`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Failed to copy stocktake.");
      const warning = formatCloneSkippedItemsWarning(body as CloneStocktakeResult);
      if (warning) window.alert(warning);
      router.push(`/inventory/stocktakes/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy stocktake.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-(--space-8) p-(--space-8)">
      <div>
        <h1 className="text-[length:var(--text-xl)] font-semibold">New stocktake</h1>
      </div>

      {error ? <FieldError>{error}</FieldError> : null}

      <section className="grid gap-(--space-4) md:grid-cols-3">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            className={`border p-(--space-6) text-left ${
              mode === option.mode ? "border-primary bg-muted" : "border-border bg-card"
            }`}
            onClick={() => setMode(option.mode)}
          >
            <span className="block font-medium">{option.title}</span>
            <span className="mt-(--space-3) block text-[length:var(--text-sm)] text-muted-foreground">
              {option.description}
            </span>
          </button>
        ))}
      </section>

      <div className="flex justify-end">
        <Button onClick={createMode} disabled={pending}>
          {pending ? "Creating..." : "Create stocktake"}
        </Button>
      </div>

      <section className="flex flex-col gap-(--space-4) border-t border-border pt-(--space-8)">
        <div>
          <h2 className="text-[length:var(--text-base)] font-medium">Copy existing</h2>
        </div>
        <Input
          value={copyQuery}
          onChange={(event) => setCopyQuery(event.target.value)}
          placeholder="Search stocktakes"
          aria-label="Search stocktakes to copy"
        />
        <div className="max-h-80 overflow-auto border border-border">
          {filteredStocktakes.map((stocktake) => (
            <button
              key={stocktake.id}
              type="button"
              className={`flex w-full items-center justify-between border-b border-border p-(--space-4) text-left ${
                copySourceId === stocktake.id ? "bg-muted" : "bg-card"
              }`}
              onClick={() => setCopySourceId(stocktake.id)}
            >
              <span>
                <span className="block font-medium">{stocktake.name}</span>
                <span className="text-[length:var(--text-sm)] text-muted-foreground">
                  {stocktake.itemCount} items · {stocktake.status}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <Button onClick={copyStocktake} disabled={pending || !copySourceId}>
            {pending ? "Copying..." : "Copy stocktake"}
          </Button>
        </div>
      </section>
    </main>
  );
}
