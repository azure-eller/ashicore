"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { MoreVerticalIcon, PencilEdit02Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type DetailPageMenuItem = {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

type Props = {
  /** Primary, stage-advancing action. Typically the only button with a label. */
  children?: ReactNode;
  /** When provided, renders a pencil icon link to the edit route. */
  editHref?: string;
  /** Secondary actions. Destructive entries are styled destructive and placed last. */
  menu?: DetailPageMenuItem[];
};

export function DetailPageActions({ children, editHref, menu }: Props) {
  const menuItems = menu ?? [];
  const orderedMenu = [
    ...menuItems.filter((item) => !item.destructive),
    ...menuItems.filter((item) => item.destructive),
  ];

  return (
    <div className="flex items-center gap-2">
      {children}
      {editHref ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" asChild>
              <Link href={editHref} aria-label="Edit">
                <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Edit</TooltipContent>
        </Tooltip>
      ) : null}
      {orderedMenu.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More actions">
              <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="bg-[var(--color-surface)] text-[var(--color-ink)]"
          >
            {orderedMenu.map((item) => (
              <DropdownMenuItem
                key={item.label}
                disabled={item.disabled}
                variant={item.destructive ? "destructive" : undefined}
                onSelect={() => item.onSelect()}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
