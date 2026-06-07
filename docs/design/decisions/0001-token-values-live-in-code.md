---
title: Token Values Live In Code
status: adr
read_when: "when deciding where to document or change design token values"
owns: "the decision that app/globals.css owns runtime token values"
date: 2026-06-07
---

# 0001 · Token Values Live In Code

## Decision

Runtime token values live in `app/globals.css`. Living docs may reference token names and explain intent, but they do not duplicate raw values.

## Context

The previous design-system folder mixed handoff specs, generated token artifacts, prototype files, and migration plans. Several docs repeated values that had since changed in code.

## Consequences

- Agents inspect `app/globals.css` for exact values.
- Docs explain when and why to use tokens.
- Generated token docs can be added later, but hand-maintained token dumps should not return.
