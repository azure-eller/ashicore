import { Fragment } from "react";
import {
  billingSelectionLookupKey,
  type BillingSelection,
} from "@/lib/billing/plan-intent";
import { getBillingOffer } from "@/lib/billing/types";

function planParts(plan: BillingSelection) {
  const lookupKey = billingSelectionLookupKey(plan);
  if (!lookupKey) {
    return { tier: "Free", detail: "Unlimited SKUs" };
  }
  const offer = getBillingOffer(lookupKey);
  return {
    tier: offer?.name ?? "Paid",
    detail: offer ? `$${offer.monthlyUsd}/mo` : "Paid",
  };
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

// ashicore logo mark — dark rounded square with three highlighter bars.
// A brand glyph (not a UI icon), so it stays inline SVG and reads the scoped tokens.
function LogoMark() {
  return (
    <span className="ob-mark" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" style={{ width: "100%", height: "100%" }}>
        <rect width="24" height="24" rx="7" fill="var(--ob-ink)" />
        <rect x="5" y="6.4" width="14" height="2.4" rx="1.2" fill="var(--ob-accent)" />
        <rect x="5" y="10.8" width="14" height="2.4" rx="1.2" fill="var(--ob-on-ground-soft)" />
        <rect x="5" y="15.2" width="14" height="2.4" rx="1.2" fill="var(--ob-accent-2)" />
      </svg>
    </span>
  );
}

function StepCheck() {
  return (
    <svg
      className="ob-step-check"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12l5 5L20 6" />
    </svg>
  );
}

// Persistent top bar: brand + numbered-circle stepper + plan badge + help.
// The same chrome on every onboarding screen across both route groups. When the
// caller passes `onNavigate` + `isNavigable`, reachable steps become clickable so
// you can jump back (and forward to already-visited steps); steps you can't reach
// yet — or earlier-phase prerequisites like Account — stay inert.
export function OnboardingProgress({
  activeIndex,
  plan,
  onNavigate,
  isNavigable,
}: {
  activeIndex: number;
  plan?: BillingSelection;
  onNavigate?: (index: number) => void;
  isNavigable?: (index: number) => boolean;
}) {
  const planText = plan ? planParts(plan) : null;
  const canClick = (index: number) =>
    Boolean(onNavigate) && index !== activeIndex && (isNavigable?.(index) ?? false);
  return (
    <header className="ob-topbar">
      <span className="ob-brand">
        <LogoMark /> ashicore
      </span>
      <nav className="ob-stepper" aria-label="Onboarding progress">
        {ONBOARDING_STEPS.map((label, index) => {
          const state =
            index < activeIndex ? "is-done" : index === activeIndex ? "is-cur" : "";
          const inner = (
            <>
              <span className="ob-step-num">
                {index < activeIndex ? <StepCheck /> : index + 1}
              </span>
              <span className="ob-step-lbl">{label}</span>
            </>
          );
          return (
            <Fragment key={label}>
              <span className={`ob-step ${state}`.trim()}>
                {canClick(index) ? (
                  <button
                    type="button"
                    className="ob-step-btn ob-step-btn--link"
                    onClick={() => onNavigate?.(index)}
                  >
                    {inner}
                  </button>
                ) : (
                  <span
                    className="ob-step-btn"
                    aria-current={index === activeIndex ? "step" : undefined}
                  >
                    {inner}
                  </span>
                )}
              </span>
              {index < ONBOARDING_STEPS.length - 1 ? (
                <span className={`ob-step-line ${index < activeIndex ? "is-done" : ""}`.trim()} />
              ) : null}
            </Fragment>
          );
        })}
      </nav>
      <span className="ob-topbar-spacer" />
      {planText ? (
        <span className="ob-plan">
          <b>{planText.tier}</b> · {planText.detail}
        </span>
      ) : null}
      <span className="ob-help" aria-hidden>
        ?
      </span>
    </header>
  );
}
