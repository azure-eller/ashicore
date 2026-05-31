import type { ElementType, ReactNode } from "react";
import { ListFrameItem } from "@/components/list-frame";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

type AttachmentListItemLayout = "inline" | "stacked";

type AttachmentListItemProps = {
  as?: ElementType;
  filename: string;
  sizeBytes: number;
  href?: string;
  leading?: ReactNode;
  actions?: ReactNode;
  layout?: AttachmentListItemLayout;
  className?: string;
};

export function AttachmentListItem({
  as,
  filename,
  sizeBytes,
  href,
  leading,
  actions,
  layout = "stacked",
  className,
}: AttachmentListItemProps) {
  const name = href ? (
    <a href={href} className="min-w-0 truncate font-medium text-primary">
      {filename}
    </a>
  ) : (
    <span className="min-w-0 truncate font-medium">{filename}</span>
  );

  return (
    <ListFrameItem
      as={as}
      className={cn("flex items-center gap-(--space-4) p-(--space-4)", className)}
    >
      {leading}
      {layout === "inline" ? (
        <>
          <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)]">
            {name}
          </span>
          <span className="shrink-0 text-[length:var(--text-xs)] text-muted-foreground">
            {formatBytes(sizeBytes)}
          </span>
        </>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[length:var(--text-sm)]">{name}</span>
          <span className="block text-[length:var(--text-xs)] text-muted-foreground">
            {formatBytes(sizeBytes)}
          </span>
        </span>
      )}
      {actions}
    </ListFrameItem>
  );
}
