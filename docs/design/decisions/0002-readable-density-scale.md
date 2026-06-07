---
title: Readable Density Scale
status: adr
read_when: "when evaluating table, toolbar, input, or nav density"
owns: "the decision to favor readable density over the original compact prototype scale"
date: 2026-06-07
---

# 0002 · Readable Density Scale

## Decision

The ERP uses readable dense sizing from `app/globals.css`, not the original compact prototype scale.

## Context

The original redesign prototypes optimized aggressively for row count. Real order, manufacturing, inventory, and customer data proved harder to scan at that compact scale. The implementation was scaled up for readability while preserving operational density.

## Consequences

- New pages should use the current height and type tokens.
- Archived prototypes are not valid sources for exact density.
- If a workflow needs a denser or roomier mode, add a shared token or variant rather than local page overrides.
