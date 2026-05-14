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
        "mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? (
          <div className="text-xs font-medium uppercase text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {badge}
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
    <div className={cn("mx-auto w-full max-w-[1480px] px-0 pb-16", className)}>
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
        "grid grid-cols-1 items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
      {sidebar ? (
        <aside className="self-start 2xl:sticky 2xl:top-6">
          <div className="flex flex-col gap-4">{sidebar}</div>
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
    <Card className={cn("gap-0 rounded-lg border bg-card py-0 shadow-sm ring-0", className)}>
      <CardHeader className="border-b bg-muted/20 px-6 py-5">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      {children ? (
        <CardContent className={cn("px-6 py-5", contentClassName)}>
          {children}
        </CardContent>
      ) : null}
      {footer ? <CardFooter className="bg-muted/25 px-6 py-4">{footer}</CardFooter> : null}
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
    <Card className={cn("gap-0 rounded-lg border bg-card py-0 shadow-sm ring-0", className)}>
      <CardHeader className="border-b bg-muted/20 px-5 py-4">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description ? (
          <CardDescription className="text-xs">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="px-5 py-4">{children}</CardContent>
      {footer ? <CardFooter className="bg-muted/25 px-5 py-4">{footer}</CardFooter> : null}
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
    <div className={cn("space-y-3 text-sm", className)}>
      {rows.map((row, index) => (
        <div key={index} className="flex items-center justify-between gap-4">
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
        <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm text-muted-foreground">
          {prefix}
        </span>
      ) : null}
      <Input
        className={cn(
          "font-mono tabular-nums",
          prefix ? "pl-7" : null,
          suffix ? "pr-12" : null,
          inputClassName
        )}
        {...props}
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 text-xs text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}
