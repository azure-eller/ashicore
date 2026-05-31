import { ListFrameItem } from "@/components/list-frame";
import { SurfacePanel } from "@/components/surface-panel";
import { cn } from "@/lib/utils";

export function SettingsPanel({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
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
  title: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
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
  children: React.ReactNode;
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
  children: React.ReactNode;
  action: React.ReactNode;
  className?: string;
}) {
  return (
    <SettingsPanelSection
      interactive
      className={cn(
        "group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-(--space-6) py-(--space-6)",
        className,
      )}
    >
      {children}
      <div className="shrink-0 md:opacity-0 md:transition-opacity md:focus-within:opacity-100 md:group-hover:opacity-100">
        {action}
      </div>
    </SettingsPanelSection>
  );
}
