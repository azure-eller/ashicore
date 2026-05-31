import type { ReactNode } from "react";
import { ListFrameItem } from "@/components/list-frame";
import { SurfacePanel } from "@/components/surface-panel";
import { cn } from "@/lib/utils";

export function SettingsPanel({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SurfacePanel
      as="section"
      id={id}
      padding="sm"
      className={cn("scroll-mt-(--space-24) p-0", className)}
    >
      {children}
    </SurfacePanel>
  );
}

export function SettingsPanelHeader({
  title,
  meta,
  action,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-(--space-6) border-b bg-muted/20 px-(--space-12) py-(--space-10) sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-[length:var(--text-xs)] leading-[var(--leading-xs)] font-semibold tracking-[var(--tracking-caps)] text-muted-foreground uppercase">
          {title}
        </h2>
        {meta ? (
          <div className="mt-(--space-1) text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-muted-foreground">
            {meta}
          </div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function SettingsPanelSection({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <ListFrameItem
      interactive={interactive}
      className={cn("px-(--space-12) py-(--space-10)", className)}
    >
      {children}
    </ListFrameItem>
  );
}

export function SettingsPanelActionRow({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action: ReactNode;
  className?: string;
}) {
  return (
    <SettingsPanelSection
      interactive
      className={cn(
        "group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-(--space-6) py-(--space-6)",
        className
      )}
    >
      {children}
      <div className="shrink-0 md:opacity-0 md:transition-opacity md:focus-within:opacity-100 md:group-hover:opacity-100">
        {action}
      </div>
    </SettingsPanelSection>
  );
}

export function SettingsRows({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}

export function SettingsKeyValueRow({
  label,
  value,
  supportingText,
  action,
  valueClassName,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  supportingText?: ReactNode;
  action?: ReactNode;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <SettingsPanelSection className={cn("py-(--space-5)", className)}>
      <div className="grid max-w-3xl gap-(--space-4) sm:grid-cols-[9rem_minmax(12rem,24rem)_auto] sm:items-center">
        <span className="text-[length:var(--text-sm)] text-muted-foreground">
          {label}
        </span>
        <div className="min-w-0">
          <div
            className={cn(
              "min-w-0 truncate text-[length:var(--text-sm)]",
              valueClassName
            )}
          >
            {value}
          </div>
          {supportingText ? (
            <div className="mt-(--space-1) min-w-0 text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-muted-foreground">
              {supportingText}
            </div>
          ) : null}
        </div>
        {action ? <div className="sm:justify-self-start">{action}</div> : null}
      </div>
    </SettingsPanelSection>
  );
}
