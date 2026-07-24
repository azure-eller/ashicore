import { redirect } from "next/navigation";
import {
  getPricingScenarioDetail,
  getPricingScenarioProductOptions,
} from "@/lib/dal/pricing-scenarios";
import { getOverheadDefaultPercent } from "@/lib/dal/overhead-settings";
import type { PricingScenarioDetailData } from "@/lib/api/clients/pricing-scenarios";
import { PricingScenarioCard } from "./scenario-card";

export default async function PricingScenarioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const isNew = id === "new";
  const [detail, productOptions, overheadDefaultPercent] = await Promise.all([
    isNew ? null : getPricingScenarioDetail(id),
    getPricingScenarioProductOptions(),
    getOverheadDefaultPercent(),
  ]);

  if (!isNew && !detail) {
    redirect("/sales/pricing-scenarios");
  }

  return (
    <PricingScenarioCard
      initialScenarioId={isNew ? null : id}
      initialDetail={detail as unknown as PricingScenarioDetailData | null}
      productOptions={productOptions}
      overheadDefaultPercent={overheadDefaultPercent}
    />
  );
}
