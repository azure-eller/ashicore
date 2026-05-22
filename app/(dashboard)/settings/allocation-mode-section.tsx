"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { apiJson } from "@/lib/client/api";
import type { AllocationMode } from "@/lib/schemas/organization";
import { SettingsPanel, SettingsPanelHeader } from "./settings-panel";

type AllocationModeData = { allocationMode: AllocationMode };

export function AllocationModeSection({
  initialMode,
}: {
  initialMode: AllocationMode;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["organization-allocation-mode"],
    queryFn: () => apiJson<AllocationModeData>("/api/organization/settings"),
    initialData: { allocationMode: initialMode } satisfies AllocationModeData,
  });
  const mode = data.allocationMode;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (allocationMode: AllocationMode) =>
      apiJson<AllocationModeData>("/api/organization/settings", {
        method: "PATCH",
        body: { allocationMode },
        fallbackError: "Failed to update allocation mode.",
      }),
    onMutate: () => setError(null),
    onSuccess: (next) => {
      queryClient.setQueryData(["organization-allocation-mode"], next);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Failed to update allocation mode."
      );
    },
  });

  function handleToggle(checked: boolean) {
    if (checked) {
      setConfirmOpen(true);
      return;
    }
    saveMutation.mutate("manual");
  }

  return (
    <SettingsPanel id="allocation">
      <SettingsPanelHeader
        title="Allocation"
        meta="Choose how stock is committed to demand."
      />

      <div className="divide-y">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-(--space-6) px-(--space-12) py-(--space-8)">
          <div className="min-w-0">
            <div className="text-[length:var(--text-sm)] font-medium text-foreground">
              Demand queue mode
            </div>
            <p className="mt-(--space-1) text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-muted-foreground">
              {mode === "demand_queue"
                ? "Coverage is computed automatically by demand priority. Manufacturing demand claims component stock before sales. Manual allocation is disabled."
                : "Manual mode: stock is committed by explicitly allocating lots to demand. Turn on demand queue to compute coverage by priority instead."}
            </p>
          </div>
          <Switch
            checked={mode === "demand_queue"}
            disabled={saveMutation.isPending}
            onCheckedChange={handleToggle}
            aria-label="Enable demand queue allocation mode"
          />
        </div>
        {error ? (
          <div className="px-(--space-12) py-(--space-4) text-[length:var(--text-sm)] text-destructive">
            {error}
          </div>
        ) : null}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to demand queue mode?</AlertDialogTitle>
            <AlertDialogDescription>
              Switching to demand queue mode will release all active manual
              allocations and related sales-line reservations. Historical
              cancelled/consumed allocation records are preserved for audit, but
              they will not be restored if you switch back to manual mode.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                saveMutation.mutate("demand_queue");
              }}
            >
              Switch and release allocations
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPanel>
  );
}
