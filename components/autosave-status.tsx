"use client";

import { CheckmarkCircle02Icon, AlertCircleIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/lib/utils";

export type AutosaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "blocked";

const AUTOSAVE_STATUS_COPY: Record<AutosaveState, string> = {
  idle: "Changes saved",
  dirty: "Unsaved changes",
  saving: "Saving...",
  saved: "Changes saved",
  error: "Could not save",
  blocked: "Complete required fields",
};

export function AutosaveStatus({
  state,
  message,
  className,
}: {
  state: AutosaveState;
  message?: string | null;
  className?: string;
}) {
  const label = message ?? AUTOSAVE_STATUS_COPY[state];
  const icon =
    state === "saving"
      ? Loading03Icon
      : state === "error"
        ? AlertCircleIcon
        : CheckmarkCircle02Icon;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        state === "error" && "text-destructive",
        className
      )}
      aria-live="polite"
    >
      <HugeiconsIcon
        icon={icon}
        size={14}
        className={cn(state === "saving" && "animate-spin")}
        aria-hidden
      />
      <span>{label}</span>
    </div>
  );
}
