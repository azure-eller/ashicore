import type { ReactNode } from "react";
import type { BillingPlanIntent } from "@/lib/billing/plan-intent";
import {
  OnboardingProgress,
  onboardingStepIndex,
} from "@/components/onboarding-stepper";
import { OnboardingSplit } from "@/components/onboarding-rail";
import { cn } from "@/lib/utils";

type OnboardingAuthStep = "account" | "workspace" | "invite";

// The rail counts the 6 actionable steps; Done is the payoff and isn't shown here.
const railStepByStep: Record<OnboardingAuthStep, number> = {
  account: 1,
  workspace: 2,
  invite: 3,
};
const activeIndexByStep: Record<OnboardingAuthStep, number> = {
  account: onboardingStepIndex("Account"),
  workspace: onboardingStepIndex("Workspace"),
  invite: onboardingStepIndex("Invite"),
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
  plan: BillingPlanIntent;
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
      <OnboardingProgress activeIndex={activeIndexByStep[activeStep]} plan={plan} />
      <div className="ob-stage ob-anim-fade">
        <OnboardingSplit step={railStepByStep[activeStep]} guideTitle={guideTitle} guideLines={guideLines}>
          {children}
        </OnboardingSplit>
      </div>
    </div>
  );
}
