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
    <section
      id={id}
      className={cn("scroll-mt-(--space-24) border bg-card", className)}
    >
      {children}
    </section>
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
