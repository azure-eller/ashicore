import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function CreatePageHeader({
  eyebrow,
  title,
  badge,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  actions: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-(--space-12) flex flex-col gap-(--space-8) md:flex-row md:items-start md:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-(--space-2)">
        {eyebrow ? (
          <div className="text-[length:var(--text-xs)] leading-[var(--leading-xs)] font-semibold tracking-[var(--tracking-caps)] text-muted-foreground uppercase">
            {eyebrow}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-(--space-4)">
          <h1 className="text-[length:var(--text-xl)] leading-[var(--leading-xl)] font-semibold tracking-[var(--tracking-tight)]">
            {title}
          </h1>
          {badge}
        </div>
      </div>
      <div className="flex flex-col gap-(--space-6) sm:flex-row sm:items-center">
        {actions}
      </div>
    </div>
  );
}

export function CreatePageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[1480px] px-0 pb-(--space-24)", className)}>
      {children}
    </div>
  );
}

export function CreatePageGrid({
  children,
  sidebar,
  className,
}: {
  children: ReactNode;
  sidebar?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 items-start gap-(--space-12) 2xl:grid-cols-[minmax(0,1fr)_320px]",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-(--space-12)">{children}</div>
      {sidebar ? (
        <aside className="self-start 2xl:sticky 2xl:top-(--space-12)">
          <div className="flex flex-col gap-(--space-8)">{sidebar}</div>
        </aside>
      ) : null}
    </div>
  );
}

export function CreateSection({
  title,
  description,
  action,
  children,
  footer,
  className,
  contentClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("gap-0 border bg-card py-0 shadow-none ring-0", className)}>
      <CardHeader className="border-b bg-muted px-(--space-12) py-(--space-10)">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      {children ? (
        <CardContent className={cn("px-(--space-12) py-(--space-10)", contentClassName)}>
          {children}
        </CardContent>
      ) : null}
      {footer ? (
        <CardFooter className="border-t bg-muted px-(--space-12) py-(--space-8)">
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function CreateSidebarCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 border bg-card py-0 shadow-none ring-0", className)}>
      <CardHeader className="border-b bg-muted px-(--space-10) py-(--space-8)">
        <CardTitle className="text-[length:var(--text-sm)] leading-[var(--leading-sm)]">{title}</CardTitle>
        {description ? (
          <CardDescription className="text-[length:var(--text-xs)] leading-[var(--leading-xs)]">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="px-(--space-10) py-(--space-8)">{children}</CardContent>
      {footer ? (
        <CardFooter className="border-t bg-muted px-(--space-10) py-(--space-8)">
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function SummaryRows({
  rows,
  className,
}: {
  rows: Array<{
    label: ReactNode;
    value: ReactNode;
    valueClassName?: string;
  }>;
  className?: string;
}) {
  return (
    <div className={cn("space-y-(--space-6) text-[length:var(--text-sm)] leading-[var(--leading-sm)]", className)}>
      {rows.map((row, index) => (
        <div key={index} className="flex items-center justify-between gap-(--space-8)">
          <span className="text-muted-foreground">{row.label}</span>
          <span
            className={cn(
              "text-right font-mono font-medium tabular-nums",
              row.valueClassName
            )}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AffixedInput({
  prefix,
  suffix,
  className,
  inputClassName,
  ...props
}: React.ComponentProps<typeof Input> & {
  prefix?: ReactNode;
  suffix?: ReactNode;
  inputClassName?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      {prefix ? (
        <span className="pointer-events-none absolute top-1/2 left-(--space-6) z-10 -translate-y-1/2 text-[length:var(--text-sm)] text-muted-foreground">
          {prefix}
        </span>
      ) : null}
      <Input
        className={cn(
          "font-mono tabular-nums",
          prefix ? "pl-(--space-16)" : null,
          suffix ? "pr-(--space-24)" : null,
          inputClassName
        )}
        {...props}
      />
      {suffix ? (
        <span className="pointer-events-none absolute top-1/2 right-(--space-6) z-10 -translate-y-1/2 text-[length:var(--text-xs)] text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}
