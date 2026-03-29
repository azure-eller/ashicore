import Link from "next/link";
import type { ComponentProps } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  ChartUpIcon,
  Layers01Icon,
  PackageIcon,
  ShoppingBag02Icon,
  Store04Icon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { canReadModule, type ModuleKey } from "@/lib/authz";
import { getAuthedMemberContext } from "@/lib/dal/auth";
import { cn } from "@/lib/utils";
import { OperationsHeader } from "./operations-header";
import { OperationsRiskChart } from "./operations-risk-chart";

type DashboardIcon = ComponentProps<typeof HugeiconsIcon>["icon"];

type DashboardSignal = {
  title: string;
  description: string;
  href: string;
  module: ModuleKey;
  tone: string;
  icon: DashboardIcon;
};

type ActionBucket = {
  title: string;
  description: string;
  href: string;
  cta: string;
  module: ModuleKey;
  status: string;
  icon: DashboardIcon;
};

const exceptionSignals: DashboardSignal[] = [
  {
    title: "Orders At Risk",
    description:
      "Confirmed customer orders likely to miss promise dates if supply or production does not recover.",
    href: "/sales/orders",
    module: "sales",
    tone: "Delivery risk",
    icon: ShoppingBag02Icon,
  },
  {
    title: "Shortage Risk",
    description:
      "Materials and products below target that are most likely to threaten commitments in the next 14 days.",
    href: "/inventory/materials",
    module: "inventory",
    tone: "Supply risk",
    icon: PackageIcon,
  },
  {
    title: "Late Purchase Orders",
    description:
      "Inbound supply that should already be on site or needs supplier follow-up before it blocks work.",
    href: "/purchasing/orders",
    module: "purchasing",
    tone: "Inbound pressure",
    icon: Store04Icon,
  },
  {
    title: "MOs Due Soon / Overdue",
    description:
      "Released manufacturing orders approaching due dates or already slipping against expected completion.",
    href: "/manufacturing/orders",
    module: "manufacturing",
    tone: "Production pressure",
    icon: Layers01Icon,
  },
];

const actionBuckets: ActionBucket[] = [
  {
    title: "Buy",
    description:
      "Monitor materials likely to cause missed commitments and decide what needs buying next.",
    href: "/inventory/materials",
    cta: "Review materials",
    module: "purchasing",
    status: "Live shortage counts land here once exception queries are wired.",
    icon: Store04Icon,
  },
  {
    title: "Make",
    description:
      "Keep released work moving and prioritize orders that can start now or need intervention.",
    href: "/manufacturing/orders",
    cta: "Review production",
    module: "manufacturing",
    status: "Ready-to-start and due-soon manufacturing signals will appear here next.",
    icon: Layers01Icon,
  },
  {
    title: "Receive",
    description:
      "Track inbound supply delaying production or shipment and clear receiving work quickly.",
    href: "/purchasing/orders",
    cta: "Review purchase orders",
    module: "purchasing",
    status: "Receiving pressure will summarize late and due-now inbound orders here.",
    icon: Store04Icon,
  },
  {
    title: "Fulfill",
    description:
      "Stay ahead of customer commitments that need picking, confirmation, or escalation.",
    href: "/sales/orders",
    cta: "Review sales orders",
    module: "sales",
    status: "At-risk fulfillment counts will surface here once order exceptions are live.",
    icon: ShoppingBag02Icon,
  },
  {
    title: "Count",
    description:
      "Resolve inventory uncertainty before it undermines planning, production, or promise dates.",
    href: "/inventory/stocktakes",
    cta: "Review stocktakes",
    module: "inventory",
    status: "Active counting work and reconciliation pressure will surface here next.",
    icon: PackageIcon,
  },
];

export default async function OperationsPage() {
  const context = await getAuthedMemberContext();

  const visibleSignals = exceptionSignals.filter((signal) =>
    canReadModule(context.role, signal.module)
  );
  const visibleBuckets = actionBuckets.filter((bucket) =>
    canReadModule(context.role, bucket.module)
  );

  return (
    <>
      <OperationsHeader />
      <div className="flex flex-1 flex-col gap-6 p-4 pt-0 md:p-6 md:pt-0">
        <section className="grid gap-3 border-b border-border/60 py-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-2">
              <Badge variant="outline">Operations command view</Badge>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                See what could derail the next 14 days.
              </h1>
              <p className="text-base text-muted-foreground">
                Keep customer promises, inbound supply, inventory pressure, and production timing
                in the same owner-oriented view.
              </p>
            </div>
            <div className="max-w-sm rounded-xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
              Prioritize exceptions that can block shipments, starve production, or force last
              minute purchasing decisions.
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {visibleSignals.map((signal) => (
            <Link key={signal.title} href={signal.href} className="group block focus-visible:outline-hidden">
              <Card
                size="sm"
                className="h-full border border-border/60 bg-card/95 transition-colors group-hover:border-border group-focus-visible:ring-2 group-focus-visible:ring-ring/50"
              >
                <CardHeader className="gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="outline" className="shrink-0">
                      {signal.tone}
                    </Badge>
                    <div className="flex size-9 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground">
                      <HugeiconsIcon icon={signal.icon} strokeWidth={1.8} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <CardTitle>{signal.title}</CardTitle>
                    <CardDescription>{signal.description}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="pt-1">
                  <p className="text-sm text-muted-foreground">
                    Live counts land here when exception queries are wired. For now, open the
                    existing queue to review the work manually.
                  </p>
                </CardContent>
                <CardFooter className="justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">Open queue</span>
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    strokeWidth={1.8}
                    className="text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </CardFooter>
              </Card>
            </Link>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {visibleBuckets.map((bucket) => (
            <Card
              key={bucket.title}
              className={cn(
                "h-full border border-border/60 bg-card/95",
                visibleBuckets.length % 3 === 2 &&
                  visibleBuckets.indexOf(bucket) === visibleBuckets.length - 1 &&
                  "xl:col-span-1"
              )}
            >
              <CardHeader className="gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground">
                    <HugeiconsIcon icon={bucket.icon} strokeWidth={1.8} />
                  </div>
                  <Badge variant="secondary">Action bucket</Badge>
                </div>
                <div className="space-y-1">
                  <CardTitle>{bucket.title}</CardTitle>
                  <CardDescription>{bucket.description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-1">
                <p className="text-sm text-muted-foreground">{bucket.status}</p>
              </CardContent>
              <CardFooter className="justify-between gap-3">
                <Button asChild variant="outline">
                  <Link href={bucket.href}>{bucket.cta}</Link>
                </Button>
                <span className="text-xs text-muted-foreground">Mini count coming next</span>
              </CardFooter>
            </Card>
          ))}
        </section>

        <section>
          <Card className="border border-border/60 bg-card/95">
            <CardHeader className="gap-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="flex size-8 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground">
                      <HugeiconsIcon icon={ChartUpIcon} strokeWidth={1.8} />
                    </div>
                    <Badge variant="outline">Risk trend</Badge>
                  </div>
                  <CardTitle>Operational risk trend</CardTitle>
                  <CardDescription>
                    Track whether operational pressure is accumulating or burning down across the
                    next 14 days.
                  </CardDescription>
                </div>
                <div className="max-w-sm text-sm text-muted-foreground">
                  Keep the chart explanatory, not decorative. It should answer whether delivery,
                  supply, and production risk is getting better or worse.
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <OperationsRiskChart />
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}
