"use client";

import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Loading03Icon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import type { CardSaveState } from "./card-save-status";
import { CardSaveStatusIndicator } from "./card-save-status";
import { cn } from "@/lib/utils";
import styles from "./card-page.module.css";

export type CardHeaderAction = {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  tooltip?: string | null;
  destructive?: boolean;
};

export type CardHeaderIconAction = {
  label: string;
  icon: ComponentProps<typeof HugeiconsIcon>["icon"];
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string | null;
  status?: "idle" | "pending" | "success" | "failed";
};

export type CardPageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** Static status badge rendered next to the title. */
  statusBadge?: ReactNode;
  /** Interactive order-status control rendered in the top-right cluster. */
  statusControl?: ReactNode;
  /** Additional compact workflow controls rendered in the top-right cluster. */
  workflowControls?: ReactNode;
  saveState?: CardSaveState | null;
  saveMessage?: string | null;
  primaryAction?: CardHeaderAction;
  iconActions?: CardHeaderIconAction[];
  menuActions?: CardHeaderAction[];
  showPrint?: boolean;
  printDisabled?: boolean;
  onClose?: () => void;
  fallbackHref?: string;
};

function getTooltipText(tooltip: string | null | undefined, label: string) {
  const value = tooltip?.trim();
  return value && value !== label ? value : null;
}

export function CardPageHeader({
  eyebrow,
  title,
  meta,
  statusBadge,
  statusControl,
  workflowControls,
  saveState,
  saveMessage,
  primaryAction,
  iconActions = [],
  menuActions = [],
  showPrint = true,
  printDisabled,
  onClose,
  fallbackHref,
}: CardPageHeaderProps) {
  const router = useRouter();
  const printAction: CardHeaderAction | null = showPrint
    ? {
        label: "Print",
        onClick: () => window.print(),
        disabled: printDisabled,
      }
    : null;
  const actionableMenuActions = menuActions.filter((action) => action.href || action.onClick);
  const visibleMenuActions = [
    ...actionableMenuActions.filter((action) => !action.destructive),
    ...(printAction ? [printAction] : []),
    ...actionableMenuActions.filter((action) => action.destructive),
  ];

  const handleClose = () => {
    if (onClose) {
      onClose();
      return;
    }
    if (fallbackHref) router.push(fallbackHref);
  };

  return (
    <header className={styles.header}>
      <div className={styles.headerIdentity}>
        {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {statusBadge}
        </div>
        {meta ? <div className={styles.meta}>{meta}</div> : null}
      </div>
      <div className={styles.headerRight}>
        {saveState ? (
          <CardSaveStatusIndicator state={saveState} message={saveMessage} />
        ) : null}
        {statusControl}
        {workflowControls}
        {primaryAction ? <HeaderActionButton action={primaryAction} /> : null}
        {iconActions.map((action) => (
          <IconActionButton key={action.label} action={action} />
        ))}
        {visibleMenuActions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={styles.iconBtn} aria-label="More actions">
                <HugeiconsIcon icon={MoreVerticalIcon} size={18} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {visibleMenuActions.map((action, index) => (
                <MenuActionItem key={`${action.label}-${index}`} action={action} />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {onClose || fallbackHref ? (
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Close"
            onClick={handleClose}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={18} />
          </button>
        ) : null}
      </div>
    </header>
  );
}

function HeaderActionButton({ action }: { action: CardHeaderAction }) {
  const button = action.href ? (
    <Button
      type="button"
      size="sm"
      disabled={action.disabled}
      variant={action.destructive ? "destructive" : "default"}
      asChild={!action.disabled}
    >
      {action.disabled ? (
        action.label
      ) : (
        <Link href={action.href} prefetch={false}>
          {action.label}
        </Link>
      )}
    </Button>
  ) : (
    <Button
      type="button"
      size="sm"
      onClick={action.onClick}
      disabled={action.disabled}
      variant={action.destructive ? "destructive" : "default"}
    >
      {action.label}
    </Button>
  );

  if (!action.tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{action.tooltip}</TooltipContent>
    </Tooltip>
  );
}

function IconActionButton({ action }: { action: CardHeaderIconAction }) {
  const tooltip = getTooltipText(action.tooltip, action.label);
  const button = (
    <button
      type="button"
      className={styles.iconBtn}
      aria-label={action.label}
      onClick={action.onClick}
      disabled={action.disabled}
    >
      <HugeiconsIcon icon={action.icon} size={18} />
      {action.status && action.status !== "idle" ? (
        <span
          className={cn(
            styles.iconStatusBadge,
            action.status === "success" && styles.iconStatusSuccess,
            action.status === "failed" && styles.iconStatusFailed,
            action.status === "pending" && styles.iconStatusPending,
          )}
          aria-hidden="true"
        >
          <HugeiconsIcon
            icon={
              action.status === "success"
                ? CheckmarkCircle02Icon
                : action.status === "failed"
                  ? CancelCircleIcon
                  : Loading03Icon
            }
            size={14}
            className={action.status === "pending" ? "animate-spin" : undefined}
          />
        </span>
      ) : null}
    </button>
  );

  if (!tooltip) return button;
  const trigger = action.disabled ? (
    <span
      role="button"
      aria-disabled="true"
      tabIndex={0}
      aria-label={action.label}
      className="inline-flex"
    >
      {button}
    </span>
  ) : (
    button
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function MenuActionItem({ action }: { action: CardHeaderAction }) {
  const tooltip = getTooltipText(action.tooltip, action.label);

  if (action.destructive) {
    return (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={action.disabled}
          onSelect={() => {
            if (!action.disabled) action.onClick?.();
          }}
        >
          {action.label}
        </DropdownMenuItem>
      </>
    );
  }

  if (action.href) {
    return (
      <DropdownMenuItem asChild disabled={action.disabled}>
        <Link href={action.href} prefetch={false}>
          {action.label}
        </Link>
      </DropdownMenuItem>
    );
  }

  const item = (
    <DropdownMenuItem
      aria-disabled={action.disabled || undefined}
      className={
        action.disabled && tooltip ? "cursor-not-allowed opacity-50" : undefined
      }
      disabled={action.disabled && !tooltip}
      onSelect={(event) => {
        if (action.disabled) {
          event.preventDefault();
          return;
        }
        action.onClick?.();
      }}
    >
      {action.label}
    </DropdownMenuItem>
  );

  if (!tooltip) return item;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{item}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
