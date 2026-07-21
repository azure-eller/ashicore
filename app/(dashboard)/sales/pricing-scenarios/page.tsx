import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ListFrame, ListFrameItem } from "@/components/list-frame";
import { formatDate, toDateOnlyString } from "@/lib/format";
import { listPricingScenarios } from "@/lib/dal/pricing-scenarios";

export default async function PricingScenariosPage() {
  const scenarios = await listPricingScenarios();

  return (
    <div className="mx-auto w-full max-w-3xl px-(--space-8) py-(--space-10)">
      <div className="mb-(--space-8) flex items-center justify-between gap-(--space-4)">
        <div>
          <h1 className="text-[length:var(--text-xl)] font-semibold">
            Pricing scenarios
          </h1>
          <p className="text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
            Model costs and sell prices from live recipe data, then commit
            revisions to keep a pricing history.
          </p>
        </div>
        <Button asChild>
          <Link href="/sales/pricing-scenarios/new">
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            New scenario
          </Link>
        </Button>
      </div>

      {scenarios.length === 0 ? (
        <EmptyState>
          No scenarios yet. Create one to model product costs and recommended
          sell prices.
        </EmptyState>
      ) : (
        <ListFrame>
          {scenarios.map((scenario) => (
            <ListFrameItem key={scenario.id} interactive>
              <Link
                href={`/sales/pricing-scenarios/${scenario.id}`}
                className="flex items-center justify-between gap-(--space-4) px-(--space-6) py-(--space-5)"
              >
                <span className="min-w-0 truncate font-medium">
                  {scenario.name}
                </span>
                <span className="flex shrink-0 items-center gap-(--space-6) text-[length:var(--text-sm)] text-[var(--color-ink-muted)]">
                  <span>
                    {scenario.latestRevisionNumber != null
                      ? `Rev ${scenario.latestRevisionNumber}`
                      : "No revisions"}
                  </span>
                  <span>{formatDate(toDateOnlyString(scenario.updatedAt))}</span>
                </span>
              </Link>
            </ListFrameItem>
          ))}
        </ListFrame>
      )}
    </div>
  );
}
