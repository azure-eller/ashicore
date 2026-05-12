"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createIdempotencyHeaders } from "@/lib/api/idempotency-client";
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
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function LotQuantityAdjuster({
  itemId,
  lotId,
  lotNumber,
  quantity,
}: {
  itemId: string;
  lotId: string;
  lotNumber: string;
  quantity: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(quantity);
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const requestConfirm = () => {
    const trimmed = value.trim();
    if (trimmed === quantity) return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Quantity must be 0 or greater.");
      return;
    }
    setError(null);
    setPendingValue(trimmed);
  };

  const submit = async () => {
    if (pendingValue == null) return;
    setIsSaving(true);
    setError(null);

    const response = await fetch(`/api/items/${itemId}/lots/${lotId}/quantity`, {
      method: "PUT",
      headers: createIdempotencyHeaders("lot-quantity-adjust", {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ quantity: pendingValue, note: null }),
    });
    const body = await response.json().catch(() => null);

    setIsSaving(false);
    if (!response.ok) {
      setError(body?.error ?? "Failed to adjust lot quantity.");
      setPendingValue(null);
      setValue(quantity);
      return;
    }

    setPendingValue(null);
    router.refresh();
  };

  return (
    <>
      <div className="ml-auto max-w-28">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={requestConfirm}
          inputMode="decimal"
          className="h-8 text-right font-mono"
          aria-label={`Adjust ${lotNumber} quantity`}
        />
        {error ? <FieldError className="mt-1 text-left">{error}</FieldError> : null}
      </div>

      <AlertDialog
        open={pendingValue != null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingValue(null);
            setValue(quantity);
          }
        }}
      >
        <AlertDialogContent className="bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Adjust this lot?</AlertDialogTitle>
            <AlertDialogDescription>
              This writes a manual inventory adjustment for lot {lotNumber}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void submit();
              }}
              disabled={isSaving}
            >
              {isSaving ? "Adjusting..." : "Adjust Lot"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
