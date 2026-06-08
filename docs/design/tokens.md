---
title: Tokens
status: living
read_when: "before adding, changing, or referencing design tokens"
owns: "the rule that app-wide runtime token values live only in app/styles/theme.css"
---

# Tokens

App-wide runtime design token values live in [app/styles/theme.css](../../app/styles/theme.css).

This file intentionally does not duplicate token values. If you need an exact color, size, radius, height, font, shadow, or duration, inspect `app/styles/theme.css`.

Docs may reference token names and describe their purpose. Docs must not restate raw token values.

Raw color literals belong only in the primitive `--paint-*` palette. Add semantic aliases or derive with `color-mix()` when a component needs a new surface, state, border, or text treatment.

When a token is missing, add it to `app/styles/theme.css`, use it in code, and update the relevant intent doc only if the meaning or usage changed.
