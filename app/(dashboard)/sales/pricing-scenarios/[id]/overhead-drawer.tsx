"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { OverheadSettingsData } from "@/lib/dal/overhead-settings";
import { OverheadWorksheet } from "./overhead-worksheet";

/**
 * The overhead worksheet as a drawer, opened from a scenario's Overhead field.
 * The rate is org-wide, so it's edited here in context of where it's used rather
 * than on a page of its own. `onSaved` lets the field adopt the new default the
 * moment it's saved.
 */
export function OverheadDrawer({
  open,
  onOpenChange,
  settings,
  defaultPeriod,
  canOperate,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: OverheadSettingsData;
  defaultPeriod: { periodStart: string; periodEnd: string };
  canOperate: boolean;
  onSaved: (settings: OverheadSettingsData) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 overflow-hidden p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[min(52rem,94vw)]"
      >
        <SheetHeader>
          <SheetTitle>Overhead from Xero</SheetTitle>
          <SheetDescription>
            One company-wide rate, derived from your Profit &amp; Loss and shared by
            every scenario. Overhead rate = operating overhead ÷ revenue.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-(--space-8)">
          <OverheadWorksheet
            initialSettings={settings}
            defaultPeriod={defaultPeriod}
            canOperate={canOperate}
            onSaved={onSaved}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
