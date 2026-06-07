"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CloneStocktakeReasonDialogProps = {
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
};

export function CloneStocktakeReasonDialog({
  open,
  pending,
  onOpenChange,
  onSubmit,
}: CloneStocktakeReasonDialogProps) {
  const [reason, setReason] = useState("");
  const trimmedReason = reason.trim();

  const close = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) setReason("");
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy stocktake</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="stocktake-clone-reason">
            Reason <span className="text-[var(--status-danger-ink)]">*</span>
          </Label>
          <Input
            id="stocktake-clone-reason"
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            placeholder="Why is this count being made?"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(trimmedReason)}
            disabled={pending || trimmedReason === ""}
          >
            {pending ? "Copying..." : "Copy stocktake"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
