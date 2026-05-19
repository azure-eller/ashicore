"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  MoreVerticalIcon,
  PrinterIcon,
} from "@hugeicons/core-free-icons";
import { useSmartBack } from "@/lib/hooks/use-smart-back";
import { useCardSaveStatus, type CardSaveStatus } from "./use-card-save-status";
import styles from "./card-page.module.css";

export type CardPageHeaderProps = {
  itemId: string;
  typeLabel: "Product" | "Material";
  name: string;
  category: string | null;
  variantCount: number;
  skuGroup?: string | null;
  /** Where to navigate when ✕ is clicked and there's no in-app history. */
  fallbackHref: string;
  onDelete?: () => void;
  deleteDisabledReason?: string;
};

export function CardPageHeader({
  itemId,
  typeLabel,
  name,
  category,
  variantCount,
  skuGroup,
  fallbackHref,
  onDelete,
  deleteDisabledReason,
}: CardPageHeaderProps) {
  const status = useCardSaveStatus(itemId);
  const handleClose = useSmartBack(fallbackHref);

  return (
    <header className={styles.header}>
      <div className={styles.headerIdentity}>
        <div className={styles.eyebrow}>
          {typeLabel}
          {category ? ` · ${category}` : ""}
        </div>
        <h1 className={styles.title}>{name}</h1>
        <div className={styles.meta}>
          {skuGroup ? (
            <>
              <span className={styles.mono}>SKU group · {skuGroup}</span>
              <span className={styles.metaDot} />
            </>
          ) : null}
          <span>
            {variantCount} {variantCount === 1 ? "variant" : "variants"}
          </span>
        </div>
      </div>
      <div className={styles.headerRight}>
        <SaveStatusIndicator status={status.status} />
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="Print"
          title="Print"
          onClick={() => window.print()}
        >
          <HugeiconsIcon icon={PrinterIcon} size={14} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="More actions"
            >
              <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onDelete ? (
              <DropdownMenuItem
                onSelect={() => {
                  if (deleteDisabledReason) return;
                  onDelete();
                }}
                disabled={Boolean(deleteDisabledReason)}
                title={deleteDisabledReason}
              >
                {`Delete ${typeLabel.toLowerCase()}`}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="Close"
          onClick={handleClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </button>
      </div>
    </header>
  );
}

function SaveStatusIndicator({ status }: { status: CardSaveStatus }) {
  if (status === "saving") {
    return (
      <span className={styles.savingPill}>
        <span className={styles.pillSquare} /> Saving…
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className={styles.failedPill}>
        <span className={styles.pillSquare} /> Save failed
      </span>
    );
  }
  return (
    <span className={styles.savedPill}>
      <span className={styles.pillSquare} /> All changes saved
    </span>
  );
}
