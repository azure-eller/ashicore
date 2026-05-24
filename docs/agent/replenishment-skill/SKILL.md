---
name: replenishment
description: Use Ashicore MCP replenishment facts to decide which purchased materials may need replenishing and explain purchase-unit quantities.
---

# Ashicore Replenishment

Use the Ashicore MCP tool when the user asks what materials to replenish, what
to buy, what may run out, or why a purchased material does or does not need
ordering.

## Workflow

1. First call `get_replenishment_context` with `view="summary"`.
2. Check `truncated`. If it is true, tell the user the summary did not include
   every candidate item before giving a broad conclusion.
3. Use the summary facts to identify a small number of items worth inspecting.
4. Call `get_replenishment_context` with `view="detail"` for those items only.
5. Do not request detail for every item unless the user asks for an exhaustive
   audit.

## Reasoning Rules

- Base recommendations on available stock, recent usage, known required demand,
  incoming purchases, lead time, and purchase-unit conversion.
- Usage and required quantities are stocking-unit quantities.
- Incoming and recommended purchases should be explained in purchase units with
  stocking-unit equivalents.
- Safety stock is intentionally absent. Do not ask for it or infer it.
- Do not use hidden urgency, priority, risk score, days of cover, stockout date,
  or recommendation-label fields.
- Do not claim to create, edit, submit, approve, or receive purchase orders.

## Answer Shape

When recommending replenishment, answer with:

- item
- why it needs attention
- what is already coming
- suggested purchase quantity in purchase units and stocking-unit equivalent
- uncertainty or missing setup, especially unknown lead time or missing unit
  conversion

When an item is low but not used recently, say that plainly and avoid
recommending a purchase unless known required demand or lead-time risk supports
it.
