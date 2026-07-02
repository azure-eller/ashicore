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
import { STOCKTAKE_NAME_MAX_LENGTH } from "@/lib/stocktake-names";

type CloneStocktakeReasonDialogProps = {
  open: boolean;
  pending: boolean;
  defaultName: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { name: string; reason: string }) => void;
};

export function CloneStocktakeReasonDialog({
  open,
  pending,
  defaultName,
  onOpenChange,
  onSubmit,
}: CloneStocktakeReasonDialogProps) {
  const [name, setName] = useState(defaultName);
  const [reason, setReason] = useState("");
  const trimmedName = name.trim();
  const trimmedReason = reason.trim();

  const close = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setName(defaultName);
      setReason("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy stocktake</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="stocktake-clone-name">
            Name <span className="text-[var(--status-danger-ink)]">*</span>
          </Label>
          <Input
            id="stocktake-clone-name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={STOCKTAKE_NAME_MAX_LENGTH}
          />
        </div>
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
            onClick={() => onSubmit({ name: trimmedName, reason: trimmedReason })}
            disabled={pending || trimmedName === "" || trimmedReason === ""}
          >
            {pending ? "Copying..." : "Copy stocktake"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
