---
title: Tokens
status: living
read_when: "before adding, changing, or referencing design tokens"
owns: "the rule that runtime token values live only in app/globals.css"
---

# Tokens

Runtime design token values live in [app/globals.css](../../app/globals.css).

This file intentionally does not duplicate token values. If you need an exact color, size, radius, height, font, shadow, or duration, inspect `app/globals.css`.

Docs may reference token names and describe their purpose. Docs must not restate raw token values.

When a token is missing, add it to `app/globals.css`, use it in code, and update the relevant intent doc only if the meaning or usage changed.
