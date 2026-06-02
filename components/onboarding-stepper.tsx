import type { BillingPlanIntent } from "@/lib/billing/plan-intent";
import { cn } from "@/lib/utils";

function planLabel(plan: BillingPlanIntent) {
  return plan === "paid" ? "Paid · $199/mo" : "Free · 30 SKUs";
}

// One continuous progress model for the whole onboarding journey — shared by the
// signed-out account/workspace screens and the authed import flow so they read as
// a single calm flow rather than two. "Extract" folds under Import (a transient state).
export const ONBOARDING_STEPS = [
  "Account",
  "Workspace",
  "Invite",
  "Import",
  "Review",
  "Connect",
  "Done",
] as const;

export type OnboardingStepLabel = (typeof ONBOARDING_STEPS)[number];

export function onboardingStepIndex(label: OnboardingStepLabel) {
  return ONBOARDING_STEPS.indexOf(label);
}

// Calm, centered progress bar — the same chrome on every onboarding screen, in the
// quiet language of the first flow (no app shell, no top nav) until the user enters
// the app. Wide screens get labelled segments; narrow screens get a "Step N of N".
export function OnboardingProgress({
  activeIndex,
  plan,
}: {
  activeIndex: number;
  plan?: BillingPlanIntent;
}) {
  return (
    <div className="flex items-center justify-center gap-(--space-4) px-(--space-8) py-(--space-6)">
      <div className="hidden items-center gap-(--space-3) lg:flex">
        {ONBOARDING_STEPS.map((label, index) => (
          <span key={label} className="flex items-center gap-(--space-2)">
            <span
              className={cn(
                "h-(--space-2) w-6 border",
                index <= activeIndex ? "border-primary bg-primary" : "border-border bg-muted",
              )}
              aria-hidden
            />
            <span
              className={cn(
                "text-[length:var(--text-xs)] font-medium uppercase tracking-[var(--tracking-wide)]",
                index === activeIndex ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </span>
        ))}
      </div>
      <span className="text-[length:var(--text-xs)] font-semibold uppercase tracking-[var(--tracking-wide)] text-muted-foreground lg:hidden">
        Step {activeIndex + 1} of {ONBOARDING_STEPS.length}
      </span>
      {plan ? (
        <span className="border bg-card px-(--space-3) py-(--space-1) text-[length:var(--text-xs)] font-medium text-muted-foreground">
          {planLabel(plan)}
        </span>
      ) : null}
    </div>
  );
}
