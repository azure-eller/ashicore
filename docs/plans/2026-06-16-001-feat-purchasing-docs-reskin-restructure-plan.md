---
title: "feat: Reskin & restructure Purchasing docs to the Carime handoff"
type: feat
date: 2026-06-16
status: ready
origin: design handoff "Marketing- Carime (3)" (docs/design_handoff_purchasing_docs/*, extracted to /tmp/carime3)
depth: deep
---

# feat: Reskin & restructure Purchasing docs to the Carime handoff

## Summary

Reskin the existing Astro Starlight docs site (`apps/www`, served at `/docs`) to match the "Marketing- Carime (3)" purchasing-docs design handoff, and restructure the Purchasing content into the handoff's hub-and-spoke shape (hub + How-to / Concept / Reference / Troubleshooting). The reskin works **only** through brand tokens (`--sl-*`) and custom CSS injected after Starlight's cascade layers — **no component overrides, no internal-class selectors** — so Starlight keeps owning the shell, sidebar, table-of-contents, scroll-spy, search, and routing. The one genuinely interactive piece (the PO lifecycle diagram) ships as a self-contained vanilla `.astro` custom-element + `<script>` island, the same pattern Starlight uses internally, with no UI framework added.

Every factual claim in the handoff was verified against the live code by four subagents. The corrections are folded into the content as it is rewritten, and the altitude split is preserved: **public pages stay operator-plain** (what you see, do, and what changes), while **schema column names and internal kernel event names stay in the private repo doc** `docs/purchasing.md`. Illustrations are inline **stylized mock components** — a small reusable doc UI kit modeled on the handoff's mock panels (`doc-b.css` `.mock*`) — not screenshots; the screenshot pipeline is kept dormant in the repo (see KTD-5, revised 2026-06-16, origin `docs/brainstorms/2026-06-16-doc-ui-kit-requirements.md`).

---

## Problem Frame

The handoff is a high-fidelity HTML/CSS/JS design for a richer Purchasing docs experience than the Starlight hub currently shipped. The user wants that look and structure **without** rebuilding the docs framework from scratch (agent-written shell code would be buggier and slower than Starlight's hardened plumbing). So the task is a disciplined **reskin + content restructure**, not a rewrite.

Two hazards the plan must actively avoid:

1. **Brittleness.** Targeting Starlight's internal DOM class names to force the look would break on a Starlight upgrade. The plan confines styling to the documented token surface and custom author CSS.
2. **Inaccuracy.** The handoff content was written against an older mental model and contains real errors (over-receipt, status label, "Xero-only" sync, invented roles, retired routes). Docs double as agent test-input, so a wrong fact is a wrong test. Each claim is corrected against verified code evidence before it is written.

---

## Scope Boundaries

**In scope**
- Reskin `apps/www` Starlight to the handoff's visual system (tokens + custom CSS), and build a small inline **doc UI kit** (`Frame`, `Field`, `Grid`, `Button`, `Totals`, plus the existing `Pill`) modeled on the handoff's mock panels.
- Restructure the Purchasing section into hub + six How-tos + six Concepts + Reference (PO fields, operator-altitude) + Troubleshooting (on the hub).
- Port the interactive PO lifecycle diagram as one Astro island, with corrected content.
- Correct every verified handoff inaccuracy in the rewritten content.
- Relocate mechanism detail (event names, schema columns, coverage map) into the private `docs/purchasing.md`.
- Replace embedded screenshots with the inline mock kit (anatomy → `Frame` with HTML numbered regions; orders list → `Grid` mock); keep the screenshot pipeline dormant (not deleted).
- Document the kit + composition in the operator-docs authoring guideline (for future agents), plus a light typography/density polish toward the handfeel.

- **Deferred to Follow-Up Work**
- Extending the reskin to other modules (Inventory, Sales, Manufacturing) — Purchasing is the proven pilot.

**Out of scope**
- The marketing site (`src/pages/*`) and its `global.css` (touched only to keep brand tokens in sync if a token value changes).
- Any change to the Next.js app, the purchasing domain code, the API, or the database. This is docs-only.
- Inventing a top-bar nav (Guides / API / Changelog) — confirmed: keep Starlight's default header.

---

## Key Technical Decisions

**KTD-1 — Reskin via tokens + custom CSS only; zero component overrides.** Starlight's `customCss` is injected *after* its cascade layers, so plain author selectors win without `!important`. The shell, sidebar, TOC, scroll-spy, and search stay native and un-overridden. Overriding `TableOfContents`/`Sidebar` would force us to re-carry their scroll-spy/active-state/persistence logic — exactly the bug surface we are avoiding. (Evidence: `node_modules/@astrojs/starlight` `style/layers.css`, `schemas/components.ts`; existing `apps/www/src/styles/starlight.css` already themes this way.)

**KTD-2 — Lifecycle diagram = vanilla `.astro` custom-element + `<script>`.** No UI framework (React/Preact/Vue/Svelte) is installed in `apps/www`. Adding one for a single diagram is net-new hydration infra. Starlight builds its own interactive components (`TableOfContents`, `Tabs`, `ThemeSelect`) as custom-element + `<script>`; we mirror that — zero added dependency, least bug surface, imported into MDX like the existing `Badge`/`LinkCard`.

**KTD-3 — Operator-altitude public content; mechanism stays private.** Per the confirmed field-depth decision, public pages use on-screen field labels and observable consequences. Schema column names (`stockUnitCost`, `purchaseToStockFactor`), internal kernel event names (`purchase_receipt`, `expected_release`, `landed_cost_revaluation`), and the invariant→test coverage map live only in `docs/purchasing.md`. A leak-check grep enforces this at validation.

**KTD-4 — One owner per fact.** The hub carries the model; the new Reference page owns the *exhaustive* operator field enumeration (the hub's current full field tables move there). The hub's Lifecycle/Statuses summary points to the Concept page, which owns the lifecycle model. No fact is written twice.

**KTD-5 — Inline doc UI kit instead of screenshots (revised 2026-06-16).** App UI is wide and dense; embedded in Starlight's ~720px column it reads cramped — inherent, not fixable by re-shooting. Instead, illustrate with a small **stylized** doc UI kit modeled on the handoff's `.mock*` panels (`doc-b.css`): token-themed Astro components that reflow to column width, theme to light/dark, and read as Ashicore without being pixel clones. Fully inline — no screenshots in the docs; `scripts/seed-docs-demo.ts` + `scripts/capture-docs-shots.ts` stay in the repo, dormant and revivable. (Origin: `docs/brainstorms/2026-06-16-doc-ui-kit-requirements.md`.)

**KTD-6 — Two component layers, both small.** (1) Reskin native components (`Aside` → callouts, `Steps` → numbered steps, frontmatter badges → page-type badges) via CSS. (2) A small bespoke **doc UI kit** in `apps/www/src/widgets/` (the `/components/` path is forbidden by `verify-import-boundary.mjs`): `Pill`, `HubCard`, `Frame`, `Field`, `Grid`, `Button`, `Totals`, and the `PoLifecycle` island. Keep the kit minimal — agents compose these, they don't invent per-page components.

---

## Verified Fact Corrections

These corrections (verified against live code) MUST be applied wherever the topic appears. Citations are repo-relative.

| # | Handoff claim | Verdict | Correct behavior (operator-facing) | Evidence |
|---|---------------|---------|-------------------------------------|----------|
| 1 | "You can't over-receive a line." | **WRONG** | Over-receipt **is** allowed when you confirm it; the order's ordered quantity is raised to match what was received and expected supply is reconciled. Without confirmation it's blocked with a warning. | `lib/purchasing/queries/receiving.ts:124-172,215-295` |
| 2 | Status pill labeled "Partial". | **WRONG** | On-screen label is **"Partially Received"** (tones: Draft neutral / Ordered info / Partially Received warning / Received success). | `app/(dashboard)/purchasing/status-badge.tsx:17-52` |
| 3 | "Xero bill sync." | **WRONG** | Accounting is **provider-generic** (Xero **or** QuickBooks). Use "send a bill to your accounting provider" / "accounting bill sync". | `lib/accounting/providers/index.ts:12-19`, `lib/accounting/constants.ts:1-13` |
| 4 | Push / email a PO to the accounting provider. | **WRONG (retired)** | Those routes return HTTP 410. The only live accounting write path is **create a supplier bill**; open POs are *imported from* accounting, not pushed. | `app/api/purchase-orders/[id]/accounting-push/route.ts`, `…/accounting-email/route.ts` |
| 5 | Billing a cancelled order is blocked. | **WRONG (not enforced)** | No cancelled-order guard exists in the bill path; do not claim it. | bill path grep — no `cancelled` match |
| 6 | "Role: Purchaser / Admin." | **WRONG** | No "Purchaser" role. Every PO action requires **`purchasing:operate`** access (owners/admins by default; members assigned in the permissions matrix). Same access for create/submit/receive/edit/delete/bill. | `lib/authz.ts`, `lib/dal/auth.ts:392-397`, `docs/auth-team.md:18-26` |
| 7 | `subtotalAmount` = "sum of line subtotals." | **WRONG** | Subtotal **already includes** shipping + all additional costs (it is the order total of lines + costs); the order total then adds tax on top. | `lib/purchasing/queries/order-write.ts:458-460`, `lib/purchasing/queries/landed-cost.ts:98` |
| 8 | "Receiving is the only way into Received; you can't set status to Received and have stock appear." | **TOO STRONG** | The status dropdown's "Received" runs a **real receive** (same domain function — commits lots, releases expected). So stock *does* appear from that path. Frame as one receive path reachable from two UI entries. | `app/api/purchase-orders/[id]/status/route.ts:48-72` |
| 9 | Set disposition "blocked" (quarantine) at receive. | **PARTLY WRONG** | Quarantine/"blocked" at receive applies to **lot-tracked items only**; lot-untracked items can only be received as available. | `lib/purchasing/queries/receiving.ts:184-197` |
| 10 | "No cancelled status." | **CORRECT** | True for operators. (`cancelledAt` column exists but is vestigial/unused for POs — note only in the private doc.) | status enum `lib/schemas/purchase-orders.ts:14-19`; grep: `cancelledAt` unwritten |
| 11 | "v1 = no taxes" (older note). | **STALE** | Tax exists. A line's tax rate defaults to the org purchase tax rate; header tax = sum of line tax only; shipping & additional costs are **not** taxed. The Create how-to may include a tax step. | `lib/purchasing/queries/order-write.ts:401-411` |

**Confirmed-as-written** (keep, with care): child `additional_cost` orders (a cost-only PO spun off to a different vendor when an additional cost is assigned to a non-PO supplier); `by_value` vs `not_distributed` landed-cost mechanics; post-receipt cost edit revalues eligible on-hand stock (event-name detail private); snapshot fields; optimistic `version`; max-scan order numbering (next is PO-708); one lot per received line at the line's landed stock-unit cost; expected supply registered on submit and released on receipt.

---

## High-Level Technical Design

### Content structure (target sidebar + page types)

```
Purchasing                                  (sidebar group — astro.config.mjs)
├─ Overview                       index.mdx                         Hub
├─ How-tos
│  ├─ Create a purchase order     create-a-purchase-order.mdx
│  ├─ Submit to your supplier     submit-to-your-supplier.mdx
│  ├─ Receive stock               receive-stock.mdx
│  ├─ Add shipping & customs      add-shipping-and-customs.mdx
│  ├─ Sync a supplier bill        sync-a-bill-to-xero.mdx
│  └─ Manage suppliers            manage-suppliers.mdx
├─ Concepts
│  ├─ The PO lifecycle            the-po-lifecycle.mdx
│  ├─ Purchase vs. stock units    purchase-vs-stock-units.mdx
│  ├─ Landed & additional costs   landed-and-additional-costs.mdx
│  ├─ Expected supply             expected-supply.mdx
│  ├─ Lots & receiving            lots-and-receiving.mdx
│  └─ Snapshots                   snapshots.mdx
└─ Reference
   └─ Purchase order fields       purchase-order-fields.mdx
Troubleshooting → lives as a hub section + deep-links into the Concept page and field reference.
```

### Reskin layering (what we touch vs. what stays native)

```
Native, UNTOUCHED:  PageFrame · Header · Sidebar · TableOfContents · scroll-spy · Search · routing · Pagination
                       ▲ reskinned only by token remap + author CSS (no overrides)
Token layer:        --sl-* remap in starlight.css            (durable, documented surface)
Author CSS layer:   .pill .ptype .mchip .reftable .callout(Aside) .steps(Steps) .cardgrid  (injected after Starlight layers → wins without !important)
Native components:   Aside, Steps, frontmatter badges  (reskinned via CSS)
Bespoke components:  Pill · HubCard · Frame · Field · Grid · Button · Totals · PoLifecycle
```

### Altitude split (where each fact lives)

```
PUBLIC  apps/www/.../purchasing/*       operator language: what you see / do / what changes
                                        on-screen field labels, status labels, consequences
PRIVATE docs/purchasing.md              schema column names, kernel event names
                                        (purchase_receipt, expected_release, landed_cost_revaluation),
                                        invariant→test coverage map, retired-route notes, child-order model
```

---

## Implementation Units

### U1. Reskin foundation — brand tokens, component CSS, `Pill` component

**Goal:** Make Starlight render the handoff's visual system without overrides.
**Dependencies:** none.
**Files:**
- `apps/www/src/styles/starlight.css` (modify) — reconcile any `--sl-*` token deltas vs. the handoff `doc-tokens.css`; add author CSS for `.pill` (4 tones), page-type badge, `.mchip` meta chips, reference-table styling on markdown tables, callout reskin (map `Aside` note/tip/caution → handoff note/tip/warn), `Steps` numbered-rail reskin, card-grid/row-card reskin.
- `apps/www/src/widgets/Pill.astro` (new) — presentational; prop `status: draft|not_received|ordered|partial|received` → on-screen label (`"Not received"` for not_received, `"Partially Received"` for partial) + tone class.
- `apps/www/src/styles/global.css` (only if a shared brand token value changes — keep marketing in sync).
**Approach:** All selectors scoped under `.sl-markdown-content` or plain author selectors; no Starlight internal-class targeting; keep `a[aria-current="page"]` (public ARIA attr) as the only attribute hook. Tones mirror `app/(dashboard)/purchasing/status-badge.tsx` so docs match the app.
**Patterns to follow:** existing `.doc-shot` / `.doc-legend` blocks in `starlight.css`; native `Badge` usage already in the hub.
**Test scenarios:** Test expectation: none — pure styling/presentational. Verified by build + screenshot review.
**Verification:** `cd apps/www && pnpm build` clean; dev-server visual pass shows pills/badges/tables/callouts/steps styled; grep confirms no internal-class selectors and no new `!important`.

### U2. PO lifecycle interactive diagram (Astro island)

**Goal:** Self-contained interactive status diagram for the Concept page.
**Dependencies:** U1 (pill tones/CSS).
**Files:** `apps/www/src/widgets/PoLifecycle.astro` (new) — `<starlight-po-lifecycle>` custom element + inline `<script>`; lifecycle styles in `starlight.css`.
**Approach:** Vanilla custom-element + `<script>` (KTD-2). A `LIFE` map drives three nodes (Not received / Partially Received / Received); clicking a node renders a detail panel: description, "Allowed here" (check/cross), and "Transitions out" (status pills). Default selection `not_received`. **Corrected content, no internal event names:** Not received → receive (part/all) or delete (releases expected); Partially Received → receive rest, received lines/order locked; Received → still editable, increasing qty/adding a line reopens to Partially Received, price/by-value cost change revalues eligible on-hand stock, can't delete or reduce below received. Respect `prefers-reduced-motion`.
**Patterns to follow:** `node_modules/@astrojs/starlight/.../TableOfContents.astro` and `Tabs.astro` custom-element + script pattern.
**Test scenarios:** Test expectation: none — presentational island. Manual interaction check: each node click swaps the panel; default `not_received` renders on load; keyboard focusable; reduced-motion honored.
**Verification:** `pnpm build` clean; browser click-through of all four nodes correct.

### U3. Doc UI kit — `Frame` + kit CSS + anatomy prototype (build first)

**Goal:** Stand up the kit's foundation and prove the look on one real page before building the rest.
**Requirements:** doc UI kit; stylized fidelity; anatomy as HTML; prototype-first build order.
**Dependencies:** U1 (tokens/CSS surface).
**Files:**
- `apps/www/src/widgets/Frame.astro` (new) — the app window/card sheet (header bar: mono title + optional right-side action/`Pill`; bordered rounded body slot), modeled on the handoff `.mock` + `.mock-bar`.
- `apps/www/src/styles/starlight.css` (modify) — the kit's component CSS (handoff `.mock*`-equivalent classes), token-themed; the anatomy numbered-region markers; a light typography/density polish (mono field labels, tighter spacing).
**Approach:** Port the handoff's `.mock*` styling onto the brand tokens already mapped in `starlight.css` — no hardcoded colors (CLAUDE.md). Rebuild the PO **anatomy** (currently a baked screenshot) as a `Frame` with HTML numbered regions + the existing `.doc-legend`. Stop here for a look-check against the handfeel before building the rest of the kit.
**Patterns to follow:** the handoff `doc-b.css` `.mock`/`.mock-bar`/`.mtable`/`.fld` recipes; the existing `Pill.astro` + token block in `starlight.css`.
**Test scenarios:** Test expectation: none — presentational. Verified by build + a visual look-check of the rebuilt anatomy in both themes.
**Verification:** `cd apps/www && pnpm build` clean; the anatomy renders as a crisp inline Frame (no image) in light and dark; reviewed for handfeel before proceeding.

### U4. Rewrite the PO hub (`purchasing/index.mdx`)

**Goal:** Hub in the handoff shape, corrected facts, one-owner discipline.
**Dependencies:** U1; links resolve once U5/U6 exist.
**Files:** `apps/www/src/content/docs/docs/purchasing/index.mdx`.
**Approach:** Sections: **What it is** (operator framing; accounting reframed to provider-generic bill, no Xero-only/push language) · **Statuses** reference table (pills, "Partially Received", yes/no cells) · **How-tos** card grid (six built pages) · **Concepts + Reference** split (links to lifecycle, units, landed cost, expected supply, lots, snapshots, fields) · **Troubleshooting** rows (Can't delete after receipt; Can't reduce below received) deep-linking the Concept page. Apply corrections #2, #3, #6, #7. No internal event names.
**Patterns to follow:** `HubCard` and `Pill` imports from `apps/www/src/widgets/`.
**Test scenarios:** Test expectation: none — content. Build + link-check (no dead anchors); screenshot renders framed.
**Verification:** `pnpm build` clean; every hub link resolves to a page built this pass; leak-check finds no schema/event names.

### U5. New Concept page — the purchase order lifecycle (`the-po-lifecycle.mdx`)

**Goal:** The lifecycle model + interactive diagram + receiving effects + transitions + delete troubleshooting, operator-altitude.
**Dependencies:** U2 (island), U1. (No images — lifecycle is text + island.)
**Files:** `apps/www/src/content/docs/docs/purchasing/the-po-lifecycle.mdx` (new).
**Approach:** Import `PoLifecycle`. Sections: **Explore each status** (island) · **What happens when you receive** (operator effects only — each received line becomes a new lot at the landed cost; lot-tracked items can be received as available or quarantined/blocked, untracked only as available; this is permanent receipt history, which is why a received order can't be deleted; expected supply for the received part is released) · **over-receipt** note (correction #1) · **Valid & invalid transitions** table (correction #8 framing) · **Why can't I delete this order?** (`#delete`). No event names (those go to U10).
**Patterns to follow:** hub `index.mdx` MDX structure; native `Aside` for callouts.
**Test scenarios:** Test expectation: none — content + embedded island. Build clean; island renders; `#delete` anchor resolves from hub/troubleshooting links.
**Verification:** `pnpm build` clean; transitions table matches corrections; leak-check clean.

### U6. New Reference page — purchase order fields, operator-altitude (`purchase-order-fields.mdx`)

**Goal:** Exhaustive operator field reference (the one-owner home for the field enumeration).
**Dependencies:** U1; U4 (hub anatomy points here).
**Files:** `apps/www/src/content/docs/docs/purchasing/purchase-order-fields.mdx` (new).
**Approach:** Operator field tables for **Order header / Order lines / Additional costs**, each row = on-screen label · Set by (you / system / derived) · plain description. **No schema column names, no DB types.** Plus a **Statuses** section (pills + meanings) and an **Accounting bill statuses** section in operator terms (manual: not billed / partly billed / billed; sync: sending / billed / failed) — framed generically (correction #3), noting bill creation is manual and never an automatic side effect of receiving (correction #4/#5; do not claim a cancelled-order block). Tax described per correction #11.
**Patterns to follow:** the field-table shape from the current hub Anatomy (which moves here).
**Test scenarios:** Test expectation: none — content. Build clean; leak-check finds zero schema column names / DB types / event names.
**Verification:** `pnpm build` clean; spot-check labels against the live card UI; leak-check clean.

### U7. Rewrite the Create how-to (`create-a-purchase-order`)

**Goal:** Procedural walkthrough in the handoff step style, inline kit mocks, corrected facts.
**Dependencies:** U1, U3, U12 (kit).
**Files:** `apps/www/src/content/docs/docs/purchasing/create-a-purchase-order.mdx`.
**Approach:** Native `Steps`: start order (auto order number) → choose supplier (snapshotted) → add lines (purchase vs stock unit, landed cost per stock unit) → additional costs (by-value lands on inventory; not-distributed only on total) → set delivery + tax; the first valid save creates a Not received order and registers expected supply. Illustrate steps with the doc UI kit (`Frame`/`Field`/`Grid`/`Button`/`Totals`) where a panel genuinely helps; no screenshots. Accounting mention (if any) = "create a supplier bill" generic, not Xero push. Include tax per correction #11. "Who can do this" = `purchasing:operate` (correction #6), not a role name.
**Patterns to follow:** native `Steps`, `Aside` tip/caution; the doc UI kit (U3/U12).
**Test scenarios:** Test expectation: none — content. Build clean; no `astro:assets` import remains; link-check clean.
**Verification:** `pnpm build` clean; rendered steps show inline mocks; corrections applied.

### U8. Build the remaining Purchasing spokes

**Goal:** Complete the operator-docs hub-and-spoke set linked from the hub.
**Dependencies:** U1, U3, U12.
**Files:** `submit-to-your-supplier.mdx`, `receive-stock.mdx`, `add-shipping-and-customs.mdx`, `sync-a-bill-to-xero.mdx`, `manage-suppliers.mdx`, `purchase-vs-stock-units.mdx`, `landed-and-additional-costs.mdx`, `expected-supply.mdx`, `lots-and-receiving.mdx`, `snapshots.mdx`.
**Approach:** Each page owns one operator need, uses only operator labels, composes the doc UI kit when an illustration helps, and links back to the hub/reference instead of repeating exhaustive facts.
**Test scenarios:** Test expectation: none — content. Build + link-check.
**Verification:** `pnpm build` clean; all hub and sidebar links resolve.

### U9. Sidebar / nav config (`astro.config.mjs`)

**Goal:** Register the new pages; keep the default header (no invented nav).
**Dependencies:** U4–U8 (pages exist).
**Files:** `apps/www/astro.config.mjs`.
**Approach:** Update the Purchasing sidebar group to: Overview; How-tos (Create, Submit, Receive, Add shipping & customs, Sync a supplier bill, Manage suppliers); Concepts (Lifecycle, Purchase vs. stock units, Landed & additional costs, Expected supply, Lots & receiving, Snapshots); Reference (Purchase order fields). Preserve the `badge`-frontmatter Diátaxis convention. **No `components` override key.** Confirm `customCss`/`head` font wiring unchanged.
**Test scenarios:** Test expectation: none — config. Build clean; sidebar shows all six entries in order; active-state + scroll-spy still native.
**Verification:** `pnpm build` clean; nav renders; `apps/www/scripts/verify-route-ownership.mjs` + `verify-import-boundary.mjs` pass on lint.

### U10. Private payload — `docs/purchasing.md` (mechanism + coverage)

**Goal:** Hold everything kept out of public per the altitude split.
**Dependencies:** none (parallel to content units).
**Files:** `docs/purchasing.md` (repo private doc).
**Approach:** Record/extend: kernel event names (`purchase_receipt`, `expected_release`, `landed_cost_revaluation`) and what triggers each; schema column names behind the operator labels; the over-receipt confirm mechanism and ordered-qty bump; the status-dropdown "Received" = real-receive nuance; the retired `accounting-push`/`accounting-email` routes (HTTP 410) and import-from-accounting direction; the child `additional_cost` order model; `cancelledAt` vestigial; the existing invariant→test coverage map (keep/refresh).
**Test scenarios:** Test expectation: none — internal doc.
**Verification:** present and accurate; this is the *only* place these names appear in the repo's docs.

### U12. Doc UI kit — remaining components (`Field`, `Grid`, `Button`, `Totals`)

**Goal:** Complete the kit so agents can compose any screen mock.
**Requirements:** the doc UI kit component set; stylized; token-themed.
**Dependencies:** U3 (`Frame` + kit CSS).
**Files:**
- `apps/www/src/widgets/Field.astro`, `Grid.astro`, `Button.astro`, `Totals.astro` (new) — modeled on handoff `.fld`/`.finput`, `.mtable`, `.mbtn`, `.mtotrow`.
- `apps/www/src/styles/starlight.css` (modify) — any shared kit CSS not already added in U3.
**Approach:** Small, composable, token-themed (no hardcoded colors). `Field` = label + value (+ optional required / dropdown affordance); `Grid` = app-grid table (mono small-caps headers, right-aligned numerics; props-vs-slot decided in implementation); `Button` = primary / ghost / subtle, non-interactive; `Totals` = label/value rows with a grand-total emphasis. Stylized, not pixel clones.
**Patterns to follow:** `Frame.astro` (U3); handoff `doc-b.css` `.fld`/`.mtable`/`.mbtn`/`.mtotrow`.
**Test scenarios:** Test expectation: none — presentational. Build clean; each renders in both themes.
**Verification:** `pnpm build` clean; a scratch compose of all five inside a `Frame` renders crisp in light + dark.

### U13. Swap the kit into the six Purchasing pages (remove both screenshots)

**Goal:** Replace every embedded screenshot with inline mocks across the built pages.
**Requirements:** fully inline; anatomy as `Frame`-with-regions; orders list as `Grid`.
**Dependencies:** U3, U12.
**Files:** `apps/www/src/content/docs/docs/purchasing/*.mdx` (modify) — no `astro:assets` `<Image>` imports/usages; use inline kit mocks instead. The screenshot pipeline scripts stay in the repo as revivable tooling.
**Approach:** Hub anatomy → `Frame` with numbered regions (from U3) + legend; hub "At a glance" → a `Grid` mock of the orders list (Riverstone rows + status `Pill`s). Create how-to → illustrate steps with `Frame`/`Field`/`Grid`/`Button`/`Totals` where a panel genuinely helps (Diátaxis: sparing). Lifecycle page stays text + island (no image needed). No `astro:assets` import remains in these files.
**Patterns to follow:** the composed kit; existing page structure.
**Test scenarios:** Test expectation: none — content. Build clean; no `<Image>`/asset import remains; leak-check clean; both themes render.
**Verification:** `pnpm build` clean; grep finds no `astro:assets` import in the purchasing content; pages render with mocks in light + dark.

### U14. Authoring guideline — document the doc UI kit + composition

**Goal:** A durable guideline so future agents compose the kit consistently on the next concept pages.
**Requirements:** "include this in our guidelines for future agents."
**Dependencies:** U3, U12 (kit exists to document).
**Files:** a new operator-docs authoring guideline doc (repo private), e.g. `docs/operator-docs-authoring-guide.md`; location confirmed in implementation.
**Approach:** Document the kit components + when to use each + a worked compose example; the inline-mocks-over-screenshots decision; the hub-and-spoke six-section skeleton; the altitude split (operator-plain public; mechanism in `docs/purchasing.md`); the one-owner rule; the token-theming rule (no hardcoded colors). A practical "how to author a concept page" guide — the long-pending authoring-guideline deliverable, seeded from the proven PO pages.
**Patterns to follow:** the finished PO pages as the worked example.
**Test scenarios:** Test expectation: none — documentation.
**Verification:** a fresh agent could author a new concept page (e.g. a sales order) from this guide + the kit alone.

### U11. Validation & altitude leak-check

**Goal:** Prove the reskin is clean, accurate, and altitude-disciplined.
**Dependencies:** all prior.
**Files:** none (validation) — may add a grep guard note to `docs/superpowers/specs/2026-06-15-docs-screenshot-pipeline-design.md` if useful.
**Approach:** Run, from `apps/www`, `pnpm build` (catches MDX/Astro/type errors); run the `verify-import-boundary` + `verify-route-ownership` verifiers; do a dev-server visual pass in **both light and dark** against `docs/ui-review-checklist.md` (no screenshots remain to regenerate); confirm **no `astro:assets` import remains** in the purchasing content (all images replaced by kit mocks); and run the **leak-check**: grep all public Purchasing pages for internal event names (`purchase_receipt`, `expected_release`, `landed_cost_revaluation`), schema column names (`stockUnitCost`, `purchaseToStockFactor`, `subtotalAmount`, …), and the avoid-list jargon — must be zero. Confirm no dead links and that every handoff correction is reflected.
**Execution note:** This is the gate; do not call the work done until the leak-check is empty and the build/lint are green.
**Test scenarios:** Build green; lint/verifiers green; leak-check returns zero matches; all internal links resolve.
**Verification:** all of the above pass; dev server left running on a reskinned page seeded with Riverstone data.

---

## Risks & Dependencies

- **Starlight upgrade brittleness.** Mitigated by KTD-1 (tokens + author CSS only; no internal-class selectors; no TOC/Sidebar override). If a future reskin *needs* structural change, prefer a typed `components` override (fails loudly at build) over CSS hacks.
- **Mock drift.** The kit is illustration, not the live UI, so it can fall out of step with the app. Mitigated by keeping it stylized/diagrammatic (clearly not a screenshot), realistic Riverstone data, and a small set.
- **Two brand-token sources.** `starlight.css` mirrors `src/styles/global.css`; a token value change must be mirrored or docs/marketing drift (U1 note).
- **Kit-before-swap ordering.** U13 composes the kit into pages — U3 (`Frame`) and U12 (rest) must land first.
- **`.md` → `.mdx` rename (U7).** Starlight route URL is extension-independent, so the sidebar link is unchanged; verify no other doc hardlinks the old path.

## System-Wide Impact

- **Mobile contract:** none. Docs-only; no API, schema, or response-shape change reaches `~/Projects/erp-android`. No mobile-impact subagent required.
- **Marketing site:** untouched except the shared-token sync caveat (U1). `disable404Route` and the `/docs` nested-routing split are preserved.
- **Testing model:** the docs site has no Playwright lane; validation is `pnpm build` + lint verifiers + the screenshot pipeline + visual review (not the Next.js fast/slow lanes).

## Sources & Research

- Design handoff: `docs/design_handoff_purchasing_docs/{README.md,Purchasing.html,po-create.html,po-lifecycle.html,po-fields.html,doc-b.js,doc-b.css,doc-tokens.css}` (extracted to `/tmp/carime3`).
- Fact verification (4 subagents, evidence cited inline in the corrections table): lifecycle/receiving — `lib/purchasing/queries/receiving.ts`, `order-write.ts`, `app/(dashboard)/purchasing/status-badge.tsx`, `app/api/purchase-orders/[id]/status/route.ts`; fields/costing — `lib/db/schema/purchasing.ts`, `lib/purchasing/queries/landed-cost.ts`, `lib/document-numbers.ts`; accounting/roles — `lib/accounting/providers/*`, `lib/db/schema/accounting.ts`, `lib/authz.ts`, `lib/dal/auth.ts`, `app/api/purchase-orders/[id]/accounting-*`.
- Starlight feasibility: `node_modules/@astrojs/starlight@0.40.0` (`schemas/components.ts`, `style/layers.css`, `style/props.css`, `TableOfContents.astro`); existing `apps/www/astro.config.mjs`, `src/styles/starlight.css`, `src/content.config.ts`; pipeline `scripts/{load/docs-demo/index.ts,seed-docs-demo.ts,capture-docs-shots.ts}`.
- Design rationale & prior decisions: `docs/superpowers/specs/2026-06-15-docs-screenshot-pipeline-design.md`.
