# Doc UI kit — requirements

Created: 2026-06-16
Status: ready for planning
Relates to: `docs/plans/2026-06-16-001-feat-purchasing-docs-reskin-restructure-plan.md` (the in-flight Purchasing reskin this modifies)

## Problem

The operator docs (Astro Starlight, `apps/www`, `/docs`) illustrate app screens with real screenshots. The app UI is wide and dense (a ~1180px card, an AG-grid list); squeezed into Starlight's ~720px content column the text goes tiny and picks up scaling/scrollbar artifacts. The result looks cramped and unprofessional, and it isn't fixable by re-shooting — it's inherent to embedding dense app UI in a narrow prose column. The Carime design handoff sidesteps this by *drawing* the UI inline as simple, theme-matched HTML mock panels that reflow to the column width and stay crisp.

## Decision

Build a small, reusable **inline doc UI kit**: token-themed Astro components, modeled directly on the handoff's mock panels (`doc-b.css` `.mock*` classes), that future agents compose to illustrate any screen. Replace embedded screenshots with these mocks.

Resolved choices:
- **Fidelity: stylized.** Looks almost exactly like the handoff's mocks — simple, flat, same colors — and therefore resembles the real app at a glance, but is explicitly *not* a pixel-perfect screenshot clone.
- **Fully inline.** No screenshots in the docs; mocks carry every illustration. The existing capture pipeline (`scripts/seed-docs-demo.ts`, `scripts/capture-docs-shots.ts`) is kept dormant in the repo (revivable), not deleted.
- **Theming: reuse existing tokens.** The kit draws only on the brand `--sl-*` / token vocabulary already mapped in `apps/www/src/styles/starlight.css` (which mirrors the handoff and the app palette). No hardcoded colors (per the CLAUDE.md design-tokens rule).
- **Documented for future agents.** The kit and how to compose it become part of the operator-docs authoring guideline, so every future concept page uses the same components the same way.

## Goals / success criteria

- A future agent can illustrate a new app screen by **composing the kit, writing no new CSS** for that page.
- The illustrations read as Ashicore (card sheet, status pills, grid-style tables) and **match the handoff's look closely**.
- The kit is **small** — a handful of components, easy to learn from the guideline.
- `apps/www` build stays green; light and dark themes both render.

## Component set

A small set, modeled on the handoff mock panels (the handoff `.mock*` CSS is the visual reference). Behaviour level only — exact props/markup are a planning decision:

- **Frame** — the app window / card sheet (`.mock` + `.mock-bar`): a bordered, rounded surface with a header bar (mono title, optional right-side action or status pill). The container for every mock.
- **Field** — a labelled form field (`.fld` + `.finput`): label, value, optional required marker, optional focused/dropdown affordance.
- **Grid** — a data table styled like the app's grid (`.mtable`): mono small-caps headers, right-aligned numeric columns, item name + SKU treatment.
- **Button** — a non-interactive button in the app's button styles (`.mbtn` primary / ghost / subtle).
- **Totals** — the totals stack (`.mtotrow`): label + value rows, with a grand-total emphasis.
- **Pill** — the status pill, already built (`apps/www/src/widgets/Pill.astro`).

Keep the set minimal; add a component only when a page genuinely needs one (compose, don't invent).

## Anatomy treatment

The "anatomy" diagram (currently a baked screenshot with numbered pins) becomes a **Frame with HTML numbered region markers** + a text legend — crisp, themeable, and editable, replacing the image entirely.

## Scope

**In scope**
- The doc UI kit components above, token-themed, in `apps/www/src/widgets/`.
- Swapping the kit into the **six Purchasing pages** already restructured this session, replacing both embedded screenshots (anatomy card → Frame-with-regions; orders list → a Grid mock).
- Documenting the kit + composition patterns in the operator-docs **authoring guideline** for future agents.
- A light **typography/density polish** toward the handfeel (mono field labels, tighter spacing) in the same pass.

**Build order:** prototype the `Frame` and rebuild the anatomy first, eyeball it against the handfeel, then build the rest of the kit.

**Out of scope**
- Pixel-perfect replication of the live app.
- Importing or reusing the real Next.js app components (boundary-forbidden; not the goal).
- Reskinning Starlight's outer shell (sidebar / top bar) — it stays native.
- Applying the kit to other modules now — they adopt it later.
- Deleting the screenshot pipeline.

## Non-goals / risks

- **Drift / "lying."** Mocks are illustrations, not the live UI, so they can fall out of step with the app. Mitigated by keeping them stylized and obviously diagrammatic, using realistic Riverstone data, and keeping the set small.

## Validation

- Prototype proof: `Frame` + the rebuilt anatomy reviewed for look before the full kit is built.
- `apps/www` build green; both themes render; verifiers (`verify-import-boundary`, `verify-route-ownership`) pass; the altitude leak-check stays clean.
- Reproducibility check: the guideline lets a fresh agent illustrate a new screen with the kit alone.

## Open questions

None blocking. The exact component API (props vs slots, how `Grid` ingests tabular data in MDX) is deferred to planning.
