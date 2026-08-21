---
read_when:
  - Authoring or editing operator documentation (apps/www, /docs)
  - Adding a new module section, concept, how-to, or reference page to the docs
  - Building or composing the doc UI kit (mock components)
  - Continuing the Purchasing pattern into the next module (Sales, Inventory, Manufacturing, Stocktakes)
---

# Operator docs — authoring guide

How to build an operator-documentation section for **any** Ashicore module so the result is visually consistent with Purchasing and **factually correct** to the actual app. Stack: Astro Starlight, in `apps/www`, served at `/docs`. **Purchasing is the worked exemplar — clone its shape.** This guide is the durable pattern; the pages prove it.

> **The order of these sections is the order you do the work.** Accuracy research (§2) comes *before* you write a line of a page. Most defects come from skipping it.

Before you start, read the exemplar set:
`apps/www/src/content/docs/docs/purchasing/{index,create-a-purchase-order,the-po-lifecycle,purchase-order-fields}.mdx`, the kit CSS `apps/www/src/styles/starlight.css`, the widgets `apps/www/src/widgets/*.astro`, and the sidebar block in `apps/www/astro.config.mjs`.

---

## 1. The two rules that override everything

1. **Never describe UI you have not read in the codebase.** Button labels, menu items, dialog titles, field names, validation strings, status names, and the *order of steps* come from the actual frontend code — not inference, not the backend, not "how ERPs usually work," and **not the design handoff** (handoff mockups are frequently wrong about labels and access — see §2c). If you can't find it in the code, leave it out and mark `<!-- TODO: verify in app -->`. Do not guess.
2. **Never invent visual style.** Every color, font, radius, and component already exists in `starlight.css` and `src/widgets/`. Compose from them. If you think you need a new component, you almost certainly don't — find the closest existing one. A genuinely new pattern is added once to the kit (a widget + its `mk-*`/`po-*` CSS) and documented here, never as a one-off inline style on a page.

Everything below elaborates these two rules.

---

## 2. Accuracy research (do this first, per module)

Before writing, build a throwaway **fact sheet** for the module by reading the codebase. Both layers are mandatory — the backend tells you what's *true*, the UI tells you what the user *does*. The durable mechanism half of what you learn lands in the module's private doc `docs/<module>.md`; the operator-facing half drives the public pages.

### 2a. Backend / domain layer — *what is true*
- `lib/<module>/**` — queries, mutations, business rules, validation, exact error strings.
- `lib/db/schema/<module>.ts` — field names, types, defaults, enums, required-ness.
- `lib/schemas/<module>*.ts` — input validation (required fields, min/max, messages).
- `lib/inventory/kernel/**` if the module touches stock (events, lots, expected supply, costs).
- `lib/billing/**` / the gate registry — the **access gate** that protects each action (this is what the access chip on a how-to must name — see §2c).
- Capture: entity statuses + the **transition rules** between them; what each mutation writes; delete/edit guards and the *exact* error strings; computed vs. stored fields; snapshot/refresh behavior.

### 2b. UI layer — *what the user does* (the step that's easy to skip — don't)
- `app/(dashboard)/<module>/**` — routes (page URLs), the entity card component, list pages, action menus, and **dialogs/sheets** (these hold the real step-by-step flow).
- `app/(dashboard)/<module>/status-badge.tsx` (or the module's equivalent) — the **exact on-screen status labels**. Purchasing's `partial` badge reads **"Partially Received"**, not "Partial" — the docs must match.
- `components/card-page/**` — shared status controls, confirm dialogs, slide-overs, autosave behavior.
- Capture, verbatim: route paths; **button/menu labels**; dialog titles and descriptions; field labels and placeholders; table column headers; confirm-dialog copy; whether forms **autosave** or have a Save button; what is a button vs. a status-menu item vs. a slide-over.

### 2c. Reconcile — code wins over the handoff, and over the backend
- **The handoff mockup is a visual reference, not a source of truth for copy.** Verified corrections made for Purchasing, all because the mockup was wrong: access is **"Purchasing operate"** (gate `purchasing:operate`), not the mockup's "Role: Purchaser / Admin"; the status label is **"Partially Received"**, not "Partial"; bill sync is **provider-generic** (Xero *or* QuickBooks), so the title is "Sync a supplier bill," not "Sync a bill to Xero," and copy says "your accounting provider."
- Where backend capability and UI differ, **document the UI behavior** and note the divergence. (Purchasing: the API permits over-receipt with confirmation, but the web receive dialog caps each line at remaining — the docs describe the capped web flow and flag the difference.)
- Write findings to your fact sheet. **Write pages from the fact sheet, not from memory of the code.**

---

## 3. The altitude split (what goes public vs. private)

Every public page serves a human operator **and** a build-agent (docs double as test input). That forces a strict split:

- **Public pages** (`apps/www/src/content/docs/docs/<module>/`) stay operator-plain: what you see on screen, what you do, and what changes (expected supply, stock, lots, costs). **On-screen field labels and status names only.**
- **Private mechanism doc** (`docs/<module>.md`) holds schema column names, kernel event names (`purchase_receipt`, `expected_release`, `landed_cost_revaluation`), `by_value`/`by_quantity`/`not_distributed` enum tokens, `purchaseUnitName`, "Source: … schema" notes, and the invariant→test map.

Never put schema column names, DB types, or internal event names in a public page. A leak-check grep enforces this (§9). Keep the warning, lose the jargon: say "both happen together, or neither does," not "atomic"; "recalculated," not "re-derived."

---

## 4. Page set — hub and spoke

Each module is **one sidebar group** registered explicitly in `apps/www/astro.config.mjs` (never `autogenerate`). The group **hub** carries the model; **spokes** are single-purpose satellites. Page types follow Diátaxis and declare their type via the sidebar `badge` frontmatter.

- **Hub** (`index.mdx`) — the module landing page. Orients and routes. Purchasing's `index.mdx` is the template; its canonical sections:
  1. **What it is** — one operator paragraph + a `.po-meta` chip row (counts).
  2. **Statuses** — a markdown table with `<Pill>`s and `.tbl-can good/no` cells (what each status allows: edit / receive / delete).
  3. **How-tos** — a `<div class="po-cardgrid">` of `<HubCard>`s to the built how-to pages.
  4. **Concepts & reference** — a `.po-split` of `.po-rowcard` link lists to the Concept and Reference spokes.
  5. **Troubleshooting** — `.po-row` links deep-linking the relevant spoke section.
- **How-tos** — one page per *task the user performs*, in natural order (create → progress through statuses → adjacent tasks → manage related records). Procedural.
- **Concepts** — one page per *model the user must understand* (lifecycle, any costing/units/projection model, history/snapshot guarantees, any "why does it behave this way").
- **Reference** — dense field/enum lookup tables straight from the schema (operator-labelled).

**One owner per fact.** The hub carries the *model*; a reference spoke owns the *exhaustive enumeration*. Never write the same fact twice — link instead.

File slugs: kebab-case, route-shaped, matching the sidebar link (e.g. `create-a-purchase-order.mdx`, `the-po-lifecycle.mdx`). **Don't pad** — if a module has 3 real how-tos, ship 3 (see §8).

---

## 5. The three page templates

Pick by intent and copy structure from the matching Purchasing page. Every page is `.mdx`, imports only Starlight components + kit widgets, and declares its type in frontmatter.

| Template | For | Copy from | Building blocks |
|----------|-----|-----------|-----------------|
| **How-to** | A task | `create-a-purchase-order.mdx` | `<Steps>` (each step = one real click) with a `<Frame>` mock per step, `<Aside>` callouts, `.po-meta` header chips |
| **Concept** | A model | `the-po-lifecycle.mdx` | numbered `##` sections, prose, `.po-annot` effect breakdowns, markdown transition tables, optional interactive widget (`<PoLifecycle />`) |
| **Reference** | Lookup | `purchase-order-fields.mdx` | grouped markdown tables (Field / Set by / Description), `.po-enum` chips, `<Pill>`s |

Standard frontmatter (the only place page type is declared — Starlight renders the badge in the sidebar):

```yaml
---
title: Create a purchase order
description: One-sentence summary, written for an operator.
sidebar:
  order: 1
  badge:
    text: How-to        # How-to → variant: note · Concept → tip · Reference → default · Module hub → note
    variant: note
---
```

Import widgets with the **4-levels-up** path from a module page, and pull `Steps`/`Aside` from Starlight:

```mdx
import { Steps, Aside } from '@astrojs/starlight/components';
import Pill from '../../../../widgets/Pill.astro';
import Frame from '../../../../widgets/Frame.astro';
import Field from '../../../../widgets/Field.astro';
import Grid from '../../../../widgets/Grid.astro';
import Button from '../../../../widgets/Button.astro';
import Totals from '../../../../widgets/Totals.astro';
```

There is **no custom header block**. Title, type badge, breadcrumb, and "On this page" are Starlight's job (§6). The page body starts with the lede paragraph and an optional `.po-meta` chip row.

---

## 6. Shared chrome — native Starlight, don't recreate

The top bar, sidebar, active-state, breadcrumb, TOC, scroll-spy, and search are **Starlight's**, configured by data, not rebuilt:

- **To add a module's pages:** add one sidebar group to the `sidebar` array in `apps/www/astro.config.mjs` (a `label` + nested `items` for Overview / How-tos / Concepts / Reference, each `{ label, link }`). Give each page the right `sidebar.badge` in frontmatter. That's the entire nav wiring — there is no `NAV` config and no `renderChrome()` to hand-edit, and you never copy chrome HTML into a page.
- **Keep the reskin discipline (§7): no `components` overrides.** Overriding `TableOfContents`/`Sidebar` would force you to re-carry scroll-spy and active-state by hand; theme with tokens + documented classes instead.

**Deliberately not built (don't "fix" these).** The Purchasing pilot keeps Starlight's native shell, which differs from the handoff's bespoke chrome by design. These gaps are known and accepted: above-H1 eyebrow/kicker pills (we use the sidebar badge), hand-drawn breadcrumbs, the `ashicore` + `DOCS` wordmark/logo lockup, the Guides/API/Changelog top tabs, and a multi-module sidebar. The first three become reasonable once there's a brand reason; the last two only make sense after other modules ship. Re-creating them now means component overrides — out of scope.

---

## 7. Visual system — compose only from these

The look comes from **theming Starlight, never replacing it.** Reskin via `--sl-*` tokens + custom CSS in `starlight.css` (injected *after* Starlight's cascade layers, so plain selectors win without `!important`) and documented component classes. **No internal-class hacks** (they break on upgrade).

- **Tokens, never literals.** `starlight.css` defines the brand ramp (neutrals aliased onto `--sl-color-*`, one highlighter-yellow accent, `--st-success/warn/danger/info/muted` status palette tuned per light/dark, radii `--r-sm/md/lg`, `--shadow-sm/md`, fonts). **Never hardcode a color or font.** Both themes must look right — the docs default to light and the theme toggle is preserved.
- **Type:** Archivo (headings + wordmark), Hanken Grotesk (body/UI), JetBrains Mono (eyebrows, field/enum tokens, IDs, quantities, table headers, status text). Set via `--font-display/-body/-mono`.
- **Status pills:** the `<Pill>` widget (`.po-pill--not_received/partial/received` for Purchasing; `draft` is shared with other modules). Map each entity status to a semantic tone and use it **identically on every page** — not received=info, partial=warn, received=success for Purchasing. Define the module's mapping once in your fact sheet and never vary it. Pill text mirrors the app's badge (§2b).
- **Callouts:** Starlight `<Aside>`, reskinned per variant — `type="note"` (neutral info), `"tip"` (encouragement/done), `"caution"` (where this bites), `"danger"` (destructive/irreversible). Use caution/danger for guards and irreversible actions (deletes, receipts, posts), and quote the real system string in them.
- **Sizing is scaled UP, not down.** `starlight.css` sets `html { font-size: 18px }` and `--sl-content-width: 52rem` on purpose — the narrow default column was the real cause of "too small / too much empty space." Match the handoff's *proportions*, not absolute px; **never shrink type below spec** to fit.

The doc UI kit (stylized inline app mocks — **not screenshots**; the wide app UI reads cramped in the column and goes stale):

| Component | Use for |
|-----------|---------|
| `Frame` | An app window / card sheet. `<Frame title="<b>Not received</b> · PO-1045" status="not_received">`; `title` accepts inline HTML; `slot="action"` for a header affordance; `status` adds a header pill. |
| `Field` | A labelled form row. `<Field label="Supplier" required focus>Cooperativa del Huila</Field>` (`muted` for placeholder text). |
| `Grid` | An app data table. Author `<thead>`/`<tbody>` inside; `class="num"` right-aligns numerics, `mk-name`/`mk-sku` for item cells, a `<Pill>` in a status cell, `<tfoot>` for a subtotal row. |
| `Button` | A non-interactive app button. `<Button variant="primary">Send PO email</Button>` (`ghost`/`subtle`). |
| `Totals` | A label/value ledger. `<Totals rows={[{ label, value }, { label, value, grand: true }]} />` |
| `HubCard` | A how-to card on the hub grid. `<HubCard href n icon title desc />`; sits in `<div class="po-cardgrid">`; `icon` is one of the 6 built-in glyphs. |
| `Pill` | A status badge. `<Pill status="partial" />` → "Partially Received"; `label="Shipping"` overrides text but keeps the tone (for enum chips). |
| `PoLifecycle` | The interactive status explorer on the lifecycle concept page. |

Frame-body helper classes (in `starlight.css`): `.mk-pad`/`.mk-pad--top` (padded region), `.mk-rows mk-rows--2|3` (field grid), `.mk-drop` + `.mk-opt`/`.hi`/`.av`/`.sub` (dropdown/option list), `.mk-saved` ("✓ Saved" autosave chip), `.mk-cap` (mono caption under a mock), `.mk-qty` (inline quantity cell). Hub/concept classes: `.po-meta`/`.po-chip`, `.po-cardgrid`, `.po-split`, `.po-rowcard`/`.po-row`/`.po-row-t`/`.po-row-d`/`.po-row-tag`, `.po-subhead`, `.tbl-can good|no`, `.po-annot`/`.arow`/`.aidx`/`.at`/`.ad`, `.po-tok po-tok--yes|no|muted`, `.po-enum`/`.po-enums`, `.po-uikey`.

Worked step panel (from the Create how-to):

```mdx
<Frame title="<b>Additional costs</b>">
  <Grid>
    <thead><tr><th>Cost</th><th>Distribution</th><th class="num">Amount</th></tr></thead>
    <tbody>
      <tr><td><Pill status="not_received" label="Shipping" /></td><td><span class="po-enum">By value</span></td><td class="num">$480.00</td></tr>
    </tbody>
  </Grid>
  <div class="mk-pad mk-pad--top">
    <Totals rows={[{ label: "Order total", value: "$7,236.00", grand: true }]} />
  </div>
</Frame>
```

Kit rules:
- **Keep the set small.** Compose existing components; don't invent a per-page component. A real gap → add one widget + its CSS to the kit and document it here.
- Components live in `src/widgets/`, **not** `src/components/` — `apps/www/scripts/verify-import-boundary.mjs` forbids any `/components/` import path.
- **Use the demo world consistently.** Riverstone Coffee suppliers (Cooperativa del Huila, Yirgacheffe Coffee FCU) and items (Huila Green, `RVS-GRN-HUILA`) keep mocks recognizable across pages. **Worked numbers must compute** and agree across pages (a 69 kg bag × 12 = 828 kg; `$310 ÷ 69 = $4.49` landed before by-value costs).
- Mocks are illustrations — diagrammatic, not fake screenshots. No `astro:assets` image embeds in content.

---

## 8. Writing rules & content restraint

- **Tone:** precise, technical, second person, present tense. Short sentences. No marketing voice on spoke pages.
- **Use the real names.** A control is named exactly as the app labels it, wrapped in `.po-uikey` (the **status** menu, **Add material**, **Send PO email**). An enum/value is a `.po-enum` chip using its operator label (**By value**, **By quantity**, **Not distributed**) — never the schema token (`by_value`) on a public page.
- **Quote real system strings** for guards and validation inside an `<Aside>` (e.g. "You can't receive more than remaining").
- **Steps map to real clicks.** Each `<Steps>` item is one thing the user actually does, in real order. If the app does it via a status menu, the step says so (and the mock shows a `.mk-drop`), not a fictional "Submit" button.
- **Cross-link generously:** how-tos link to the concepts they rely on and the reference for fields; concepts link to the how-to that performs them. Use real `/docs/<module>/<slug>` hrefs.
- **One page per real task/model. Do not invent** spokes to fill a grid, and no filler stats or decorative figures — every table row, chip, and callout earns its place. If a section needs behavior the code doesn't support, leave a TODO for a human; don't fabricate. Placeholder links for not-yet-built pages use `href="#"`, never a fake page.

---

## 9. Definition of done (all must pass)

**Accuracy**
- [ ] Every UI label, menu item, dialog title, field name, and step is traceable to a file in the codebase (captured in the fact sheet).
- [ ] Status names + transition rules match the code exactly; no fictional statuses or buttons; pill text matches the status badge.
- [ ] Guard/validation copy quotes the real system strings; backend/UI divergences documented as the UI behavior + a note.
- [ ] Worked-example numbers compute and agree across pages.

**Structure & nav**
- [ ] Correct template; correct `sidebar.badge`; page registered in the `astro.config.mjs` sidebar group with a resolving `link`.
- [ ] No hand-copied chrome; no `components` overrides; all internal links resolve; prev/next + TOC come from Starlight.

**Visual & altitude**
- [ ] No hardcoded colors/fonts; only tokens + documented classes; no new one-off component.
- [ ] Status→pill mapping identical on every page.
- [ ] **Altitude leak-check:** grep public pages for schema column names, internal event names, enum tokens, and avoid-list jargon — must be zero.
- [ ] No `astro:assets` import in content (illustrations are kit mocks).

**Build & visual pass**
- [ ] `cd apps/www && pnpm build` is clean (also type-checks island scripts).
- [ ] `node apps/www/scripts/verify-import-boundary.mjs` and `verify-route-ownership.mjs` pass.
- [ ] Screenshot pass in **both light and dark** vs. the handoff (`docs/ui-review-checklist.md`); when Chrome MCP is unavailable, headless `@playwright/test` chromium writing PNGs works.

**Process**
- These are **doc-only changes with no code impact** — do **not** run `no-mistakes` / `axi` on them. (Reserve those for code PRs.) Note that an axi run on a docs branch will also rebase it onto fresh `origin/main` and may pull in out-of-scope files; keep each module's PR scoped to that module.

---

## 10. Procedure to add a new module (worked recipe)

Example: **Sales orders.**

1. **Research (§2).** Read `lib/sales/**`, `lib/db/schema/sales*.ts`, `lib/schemas/sales*.ts`, `app/(dashboard)/sales/**` (incl. `status-badge.tsx`), `components/card-page/**`, and the access gate. Write the fact sheet: statuses + transitions, mutation effects, guards + exact error strings, UI routes/labels/dialogs, autosave behavior, the status→pill mapping, the access-gate label. Reconcile the handoff against the code (§2c).
2. **Plan the page set (§4).** Decide the real how-tos (create, allocate, fulfil/ship, invoice), concepts (lifecycle, allocation vs. on-hand, pricing/snapshots), reference (order fields). Don't pad.
3. **Register nav (§6).** Add the Sales group to the `sidebar` array in `astro.config.mjs`; set each page's `sidebar.badge`.
4. **Build the hub** from `purchasing/index.mdx`: status table, how-to `po-cardgrid`, concept/reference `po-split`, troubleshooting.
5. **Build each spoke** from the matching template (§5), writing prose **only** from the fact sheet, using real labels (§8), composing visuals from existing kit classes (§7). Add an interactive lifecycle widget on the lifecycle concept page only if the entity is stateful (clone `PoLifecycle.astro`).
6. **Wire links:** sidebar, in-body cross-links, prev/next — all real targets.
7. **QA (§9).** Land it as a Sales-scoped docs PR.

Sequence modules purchasing-first (proven), sales last.

---

## 11. Anti-patterns (do NOT do these)

- ❌ Writing a how-to from the backend mutation alone (you'll invent buttons that don't exist).
- ❌ A "Submit"/"Save" button when the app uses a status menu / autosave.
- ❌ Trusting the handoff's copy or access labels over the code ("Partial" vs. "Partially Received"; "Purchaser / Admin" vs. "Purchasing operate"; "Sync to Xero" vs. provider-generic).
- ❌ Schema tokens or kernel event names on a public page (`by_value`, `expected_release`, `purchaseUnitName`).
- ❌ New colors via inline `oklch(...)`/gradients, a font outside the three, or shrinking type below spec.
- ❌ Inventing a feature because it seems natural; padding a module to a fixed page count.
- ❌ `components` overrides or hand-copied sidebar/topbar HTML; recreating the deferred nav chrome (§6).
- ❌ Embedding app screenshots; emoji or decorative SVG illustration.
- ❌ Running `no-mistakes`/`axi` on a doc-only change.

---

## 12. Reference

- Exemplar pages: `apps/www/src/content/docs/docs/purchasing/*.mdx`.
- Kit widgets: `apps/www/src/widgets/*.astro`; kit + theme CSS: `apps/www/src/styles/starlight.css` (`mk-*`, `po-*`, `--sl-*`, `--st-*`).
- Nav/sidebar + redirects + theme default: `apps/www/astro.config.mjs`.
- Boundary guards: `apps/www/scripts/verify-import-boundary.mjs`, `verify-route-ownership.mjs`.
- Private mechanism doc pattern: `docs/purchasing.md`.
- Decision records: `docs/brainstorms/2026-06-16-doc-ui-kit-requirements.md`, `docs/plans/2026-06-16-001-feat-purchasing-docs-reskin-restructure-plan.md`.
