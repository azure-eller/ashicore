---
title: Token Grid
status: adr
read_when: "when adding or changing a spacing, height, leading, or type token, or when reading a design handoff"
owns: "the 4px token grid, the perceptible-type-step rule, and the rule that handoff pixel values are literal"
date: 2026-08-01
---

# 0003 · Token Grid

## Decision

Spacing, height, and leading tokens sit on a 4px grid. 2px and 6px are the only spacing sub-steps, reserved for hairlines and tight insets. Type sizes stay at least 8% apart.

Design handoff pixel values are literal 1:1 measurements for a 1440px screen. They are never multiplied by a correction factor.

`pnpm verify:design-grid` enforces all of this inside `pnpm lint`.

## Context

Handoff bundles are previewed in a small pane, so their renders look zoomed out. This was read as "authored on a small canvas," and the June 2026 redesign scaled `--space` by 1.25x and `--text` by 1.18x to compensate. The handoff READMEs actually state the opposite in their opening section: the values are literal, the preview is scaled, and shrinking or growing them to match the thumbnail is the known failure mode.

A later pass judged the result too large and pulled type back by 0.82x, but left spacing at 1.25x. The net effect on type was about 1.02x — two roundings on top of each other, and an asymmetry between type and space.

That left the foundation off-grid:

- 11 of 17 height tokens missed the 4px grid, so chips, buttons, inputs and rows never shared a horizontal rhythm.
- Spacing carried rounding scars: 11 and 12 both existed, 15 and 16 both existed, 33 instead of 32, 41 instead of 40.
- The type scale held 14 values, 7 of them between 13px and 16px. A 3.7% step is invisible as hierarchy but still breaks alignment, so size changes read as inconsistency.
- Leading ran 17/21/23/27/31/37, off the vertical rhythm.

The visible symptom was an app that read as unfinished: things that should line up sat a pixel apart, and nothing felt deliberate.

This ADR does not reverse [0002](0002-readable-density-scale.md). The overall scale stays roomier than the prototypes; no token moved more than 2px. What changes is the premise: 0002's context attributes the scale-up to a "small-canvas handoff," and that premise is wrong. Readable density is still the decision; small-canvas correction was never a valid reason for it.

## Consequences

- New tokens must land on the grid; `pnpm lint` fails otherwise.
- Components take sizes from tokens, not literals, so they inherit the rhythm. A literal that is not on the grid is a bug even when it looks fine in isolation.
- Adding a type size means checking it clears 8% from both neighbours. If it does not, reuse the neighbour.
- When a handoff and the app disagree on a value, map by role and ratio, not by rescaling the whole system.
