import type { ReactNode } from "react";
import type { BillingSelection } from "@/lib/billing/plan-intent";
import {
  OnboardingProgress,
} from "@/components/onboarding-stepper";
import { OnboardingSplit } from "@/components/onboarding-rail";
import { cn } from "@/lib/utils";

type OnboardingAuthStep = "account" | "workspace";

const railStepByStep: Record<OnboardingAuthStep, number> = {
  account: 1,
  workspace: 2,
};
const activeIndexByStep: Record<OnboardingAuthStep, number> = {
  account: 0,
  workspace: 1,
};

export function OnboardingAuthShell({
  activeStep,
  plan,
  guideTitle,
  guideLines = [],
  children,
  className,
}: {
  activeStep: OnboardingAuthStep;
  plan: BillingSelection;
  guideTitle: ReactNode;
  guideLines?: string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "onboarding-flow-screen flex min-h-svh flex-col",
        className,
      )}
    >
      <OnboardingProgress
        activeIndex={activeIndexByStep[activeStep]}
        plan={plan}
        steps={["Account", "Workspace"]}
      />
      <div className="ob-stage ob-anim-fade">
        <OnboardingSplit
          step={railStepByStep[activeStep]}
          total={2}
          guideTitle={guideTitle}
          guideLines={guideLines}
        >
          {children}
        </OnboardingSplit>
      </div>
    </div>
  );
}
