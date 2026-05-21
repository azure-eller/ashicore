---
description: Use when the user asks what to make each day, asks for a production schedule, or asks whether shipments will be missed using Ashicore production data.
---

# Production Schedule

Call the Ashicore MCP tool `get_production_planning_context` before answering.

Return a concise daily schedule:

1. Show what to make each day.
2. Format it as a clear schedule.
3. Explicitly call out any shipments that will be missed.
4. For each miss, state what would need to happen on what day to avoid it.

Use the Ashicore data for sales shipments, open manufacturing orders, product counts, lot ages, and BOM requirements.

If capacity is needed and the user has not provided it, say that capacity is missing instead of inventing it.
