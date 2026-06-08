---
title: Design Documentation
status: living
read_when: "before changing shared UI, design tokens, or page-level layout"
owns: "the map for design documentation and the anti-drift rules"
---

# Design Documentation

The design docs exist to explain intent. Code owns values.

## Rules

1. **Code owns values; docs own intent.** App-wide token values live in [app/styles/theme.css](../../app/styles/theme.css). Docs may name tokens and explain when to use them, but must not restate their raw values.
2. **Separate by time-scale.** Living reference stays here. Decisions are append-only ADRs. Completed handoffs and prototypes live in [archive](./archive/).
3. **Name by stable concern.** Living files use topic names, not numeric prefixes. ADRs are numbered because they are immutable records.

## Living Docs

| File | Owns |
|---|---|
| [foundations.md](./foundations.md) | Design philosophy: density, color semantics, typography roles, corners, motion |
| [tokens.md](./tokens.md) | The token source-of-truth rule and how to inspect runtime tokens |
| [components.md](./components.md) | Reusable UI primitives and when to use them |
| [patterns.md](./patterns.md) | Forms, tables, cards, dialogs, status, empty/loading states |

## Decision Log

Design decisions that explain why the system changed live in [decisions](./decisions/). Do not rewrite an ADR after the fact; add a new one.
