import type { ReactNode } from "react";
import { SurfacePanel } from "@/components/surface-panel";
import type { BillingPlanIntent } from "@/lib/billing/plan-intent";
import {
  OnboardingProgress,
  onboardingStepIndex,
} from "@/components/onboarding-stepper";
import { cn } from "@/lib/utils";

type OnboardingAuthStep = "account" | "workspace";

const activeIndexByStep: Record<OnboardingAuthStep, number> = {
  account: onboardingStepIndex("Account"),
  workspace: onboardingStepIndex("Workspace"),
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
    <div className={cn("onboarding-flow-screen flex min-h-svh flex-col bg-background", className)}>
      <OnboardingProgress activeIndex={activeIndexByStep[activeStep]} plan={plan} />
      <div className="mx-auto grid w-full max-w-5xl flex-1 content-center gap-(--space-10) p-(--space-8) lg:grid-cols-[minmax(0,360px)_minmax(0,420px)] lg:justify-center lg:gap-(--space-16)">
        <aside className="grid content-center gap-(--space-6)">
          <h1 className="max-w-[14ch] text-[length:var(--text-3xl)] font-semibold leading-[var(--leading-tight)] tracking-[var(--tracking-tight)]">
            {guideTitle}
          </h1>
          {guideLines.length ? (
            <div className="grid gap-(--space-2)">
              {guideLines.map((line, index) => (
                <p
                  key={line}
                  className="onboarding-guide-line text-[length:var(--text-md)] leading-[var(--leading-md)] text-muted-foreground"
                  style={{ animationDelay: `${0.15 + index * 0.12}s` }}
                >
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </aside>

        <SurfacePanel className="grid content-start gap-(--space-6)" padding="md">
          {children}
        </SurfacePanel>
      </div>
    </div>
  );
}
