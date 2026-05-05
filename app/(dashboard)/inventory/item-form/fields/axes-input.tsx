"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AxesInputProps = {
  value: string[];
  onChange: (axes: string[]) => void;
};

export function AxesInput({ value, onChange }: AxesInputProps) {
  const [draft, setDraft] = useState("");

  function add() {
    const trimmed = draft.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="e.g. Package"
          autoComplete="off"
        />
        <Button type="button" variant="outline" onClick={add}>
          Add
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((axis) => (
            <div key={axis} className="flex items-center gap-1 rounded border px-2 py-1 text-sm">
              {axis}
              <button
                type="button"
                aria-label={`Remove ${axis}`}
                className="ml-1 text-muted-foreground hover:text-foreground"
                onClick={() => onChange(value.filter((currentAxis) => currentAxis !== axis))}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
