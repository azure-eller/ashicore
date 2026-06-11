import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { ListFrameItem } from "@/components/list-frame";
import { SurfacePanel } from "@/components/surface-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SettingsPageHeader({
  title,
  sub,
  action,
}: {
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-(--space-6)">
      <div className="flex min-w-0 flex-col gap-(--space-2)">
        <h1 className="text-[length:var(--text-lg)] leading-[var(--leading-lg)] font-semibold tracking-[var(--tracking-tight)] text-[var(--color-ink)]">
          {title}
        </h1>
        {sub ? (
          <p className="max-w-xl text-[length:var(--text-status)] leading-[var(--leading-sm)] text-[var(--color-ink-faint)]">
            {sub}
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-(--space-4)">{action}</div>
      ) : null}
    </div>
  );
}

export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <SurfacePanel as="section" padding="sm" className={cn("p-0", className)}>
      {children}
    </SurfacePanel>
  );
}

export function SettingsBlock({
  title,
  count,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ListFrameItem className={cn("px-(--space-10) py-(--space-10) sm:px-(--space-12)", className)}>
      {title || actions ? (
        <div className="mb-(--space-7) flex min-w-0 flex-wrap items-center gap-(--space-4)">
          {title ? (
            <h2 className="font-mono text-[length:var(--text-card-header)] leading-[var(--leading-xs)] font-semibold tracking-[0.09em] text-[var(--color-ink)] uppercase">
              {title}
            </h2>
          ) : null}
          {count != null ? (
            <span className="font-mono text-[length:var(--text-card-header)] leading-[var(--leading-xs)] text-[var(--color-ink-faint)]">
              · {count}
            </span>
          ) : null}
          {actions ? (
            <div className="ms-auto flex shrink-0 items-center gap-(--space-4)">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </ListFrameItem>
  );
}

export function SettingsQuietRow({
  title,
  sub,
  action,
}: {
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-(--space-6)">
      <div className="flex min-w-0 flex-col gap-(--space-1)">
        <span className="text-[length:var(--text-sm)] font-semibold text-[var(--color-ink)]">
          {title}
        </span>
        {sub ? (
          <span className="max-w-lg text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-[var(--color-ink-faint)]">
            {sub}
          </span>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function SettingsAddLink({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="mt-(--space-4) w-fit px-(--space-5) text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)]"
    >
      <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
      {children}
    </Button>
  );
}

export function SettingsFootnote({ children }: { children: ReactNode }) {
  return (
    <p className="px-(--space-2) text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-[var(--color-ink-faint)]">
      {children}
    </p>
  );
}
