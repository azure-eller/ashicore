"use client";

import { useRouter } from "next/navigation";
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
import { formatDate } from "@/lib/format";
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
  /** True for the /new draft page — shows "Not saved" instead of save status. */
  isDraft?: boolean;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  saveStatus?: CardSaveStatus | "draft";
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
  isDraft,
  createdAt,
  updatedAt,
  saveStatus,
  onDelete,
  deleteDisabledReason,
}: CardPageHeaderProps) {
  const router = useRouter();
  const status = useCardSaveStatus(itemId);

  const placeholderName = isDraft && !name.trim()
    ? `New ${typeLabel.toLowerCase()}`
    : name;
  const metaDates = formatMetaDates(createdAt, updatedAt);

  return (
    <header className={styles.header}>
      <div className={styles.headerIdentity}>
        <div className={styles.eyebrow}>
          {typeLabel}
          {category ? ` · ${category}` : ""}
        </div>
        <h1 className={styles.title}>{placeholderName}</h1>
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
          {metaDates ? (
            <>
              <span className={styles.metaDot} />
              <span>{metaDates}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className={styles.headerRight}>
        <SaveStatusIndicator status={saveStatus ?? (isDraft ? "draft" : status.status)} />
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
            {itemId ? (
              <>
                <DropdownMenuItem
                  onSelect={() =>
                    router.push(
                      typeLabel === "Product"
                        ? `/inventory/products/${itemId}/edit`
                        : `/inventory/materials/${itemId}/edit`,
                    )
                  }
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => router.push(`/inventory/ledger?itemId=${itemId}`)}
                >
                  View inventory activity
                </DropdownMenuItem>
              </>
            ) : null}
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
          onClick={() => router.push(fallbackHref)}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </button>
      </div>
    </header>
  );
}

function formatMetaDates(
  createdAt: Date | string | null | undefined,
  updatedAt: Date | string | null | undefined,
) {
  if (!createdAt && !updatedAt) return null;
  const createdDate = createdAt ? formatDate(toDateOnly(createdAt)) : null;
  const relativeEdit = updatedAt ? formatRelativeTime(updatedAt) : null;
  return [
    createdDate ? `Created ${createdDate}` : null,
    relativeEdit ? `last edit ${relativeEdit}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function toDateOnly(value: Date | string) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatRelativeTime(value: Date | string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

function SaveStatusIndicator({
  status,
}: {
  status: CardSaveStatus | "draft";
}) {
  if (status === "draft") {
    return (
      <span className={styles.failedPill}>
        <span className={styles.pillSquare} /> Not saved
      </span>
    );
  }
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
