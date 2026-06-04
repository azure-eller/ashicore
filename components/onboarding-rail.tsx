import type { ReactNode } from "react";

// Faint concentric topo contours behind the dark rail — echoes the marketing hero.
function RailTopo() {
  const rings = Array.from({ length: 7 }, (_, i) => (
    <ellipse
      key={i}
      cx="340"
      cy="150"
      rx={120 + i * 62}
      ry={86 + i * 46}
      fill="none"
      stroke="var(--ob-accent-2)"
      strokeWidth="1"
      opacity={0.16 - i * 0.012}
    />
  ));
  return (
    <svg
      className="ob-rail-topo"
      viewBox="0 0 520 620"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      style={{
        WebkitMaskImage: "radial-gradient(120% 90% at 75% 18%, #000 0%, transparent 70%)",
        maskImage: "radial-gradient(120% 90% at 75% 18%, #000 0%, transparent 70%)",
      }}
    >
      {rings}
    </svg>
  );
}

function RailTick() {
  return (
    <span className="ob-tick" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5L20 6" />
      </svg>
    </span>
  );
}

// The sign-up-phase split: a dark brand rail (counting the 6 actionable steps,
// Done is the payoff) beside a light form pane. Shared by the account/workspace
// auth screens and the invite step of the import flow so they read as one flow.
export function OnboardingSplit({
  step,
  total = 6,
  guideTitle,
  guideLines = [],
  children,
}: {
  step: number;
  total?: number;
  guideTitle: ReactNode;
  guideLines?: string[];
  children: ReactNode;
}) {
  return (
    <div className="ob-split">
      <aside className="ob-rail">
        <RailTopo />
        <div className="ob-rail-inner">
          <span className="ob-rail-step">
            Step {String(step).padStart(2, "0")} <b>/ {String(total).padStart(2, "0")}</b>
          </span>
          <h2 className="ob-rail-title">{guideTitle}</h2>
          {guideLines.length ? (
            <div className="ob-rail-lines">
              {guideLines.map((line) => (
                <div className="ob-rail-line ob-stagger" key={line}>
                  <RailTick />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="ob-rail-progress">
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                className={[
                  "ob-rail-seg",
                  i < step - 1 ? "is-done" : "",
                  i === step - 1 ? "is-cur" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            ))}
          </div>
        </div>
        <div className="ob-rail-foot">
          <span className="ob-ai-dot" /> ashicore sets up the rest for you
        </div>
      </aside>

      <div className="ob-formpane">
        <div className="ob-formcard">{children}</div>
      </div>
    </div>
  );
}
