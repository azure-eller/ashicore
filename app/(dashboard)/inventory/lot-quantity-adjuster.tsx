"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiJson } from "@/lib/client/api";
import { isNonNegativeNumberString } from "@/lib/schemas/shared";
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
    if (!isNonNegativeNumberString(trimmed)) {
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

    try {
      await apiJson<void>(`/api/items/${itemId}/lots/${lotId}/quantity`, {
        method: "PUT",
        body: { quantity: pendingValue, note: null },
        idempotencyKey: "lot-quantity-adjust",
        fallbackError: "Failed to adjust lot quantity.",
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Failed to adjust lot quantity.",
      );
      setPendingValue(null);
      setValue(quantity);
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
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
        <AlertDialogContent>
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
