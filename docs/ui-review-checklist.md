# UI Review Checklist

Use this for UI-affecting changes after the normal scratch-first test has driven
the behavior. This is a development-time review loop, not a permanent Playwright
lane and not a CI gate.

## Theme Source Of Truth

Before judging pixels, resolve the current theme from:

- `app/globals.css`
- `docs/design/README.md`
- `docs/design/foundations.md`
- `docs/design/tokens.md`
- `CLAUDE.md`

Do not bake hex values, radius values, or palette names into this checklist.
Judge invariant rules instead: semantic color tokens, shared spacing/sizing/type
tokens, tokenized radii, and HugeIcons only.

## Capture Rules

- Run against the Paonia review session from `pnpm sandbox` or `pnpm review`.
  Dense data exposes overflow, wrapping, and empty-state mistakes better than
  the generated `test-org`.
- Capture viewport tiles or focused elements. Do not use one tall `fullPage`
  screenshot for review; downscaling makes body text unreadable.
- Use `1568px` as the default long edge. Use up to `2576px` only for fine detail
  such as dense tables, small badges, and contrast checks.
- Capture at a desktop width around `1440px` and a narrow width around `768px`
  when the touched surface can wrap or overflow.
- Keep a normal sweep to roughly six images. More is fine only when the changed
  surface has distinct states worth inspecting.

## States To Shoot

- Default populated state with realistic Paonia data.
- Empty state, when the changed surface can be empty.
- Loading and error states, when the changed surface has custom handling.
- Narrow viewport and long-string cases.
- Zero, negative, partial, late, disabled, or read-only states when they are
  natural for the domain surface.
- Dark mode only when the changed components use new color/surface treatment or
  changed token usage.

## Review Rubric

- Layout: no overlapping controls, clipped text, unexpected horizontal scroll,
  unstable row heights, or cards nested inside cards.
- Density: operational pages stay compact and scan-friendly; hero-scale type is
  not used inside dashboards, cards, tables, dialogs, or sidebars.
- Tables and grids: headers, numeric columns, empty rows, sticky areas, selected
  rows, and overflow behave coherently.
- Forms: labels, errors, disabled fields, focus rings, popovers, and validation
  messages remain aligned and readable.
- Actions: destructive, disabled, primary, and secondary actions are visually
  distinct without relying on hardcoded colors.
- Tokens: colors use semantic classes/tokens; spacing, sizing, type, and radii
  use app tokens from `app/globals.css`.
- Icons: HugeIcons only.
- Ignore data-dependent noise such as current dates, relative times, and Paonia
  ordering unless the change directly touched that behavior.

## Scratch Template

Create a throwaway spec in `test/e2e/scratch/`, run it with
`pnpm test:scratch`, read the generated PNGs in `.tmp/ui-shots/`, fix issues,
rerun the shots, then delete the scratch spec before the PR.

```ts
import { expect, reviewTest as test } from "../fixtures";
import { captureForReview } from "../../helpers/evidence-screenshots";

test("ui review: changed surface", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sales/orders");
  await expect(page.getByText("Sales Orders").first()).toBeVisible();

  const desktopShots = await captureForReview(page, "sales-orders-desktop");
  console.log("UI review shots:", desktopShots.join("\n"));

  await page.setViewportSize({ width: 768, height: 900 });
  const narrowShots = await captureForReview(page, "sales-orders-narrow");
  console.log("UI review shots:", narrowShots.join("\n"));
});
```

For focused surfaces:

```ts
const dialog = page.getByRole("dialog");
console.log(
  "UI review shots:",
  (await captureForReview(page, "edit-dialog", { mode: "element", locator: dialog }))
    .join("\n")
);
```
