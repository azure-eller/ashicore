---
title: Delete Rules
description: How Ashicore should treat deletion when dependent operational history exists.
section: Reference
order: 340
---

## Purpose

Deletion should remove mistakes without erasing real operational history.

## Rules

Draft records are usually safe to delete. Submitted records may require cleanup of expected supply, demand, or allocation. Records with inventory history, shipment history, receipt history, or completed production history should be protected.

## User-facing behavior

Confirmations should name the object, explain dependent effects, and block deletion when history must be preserved.

## System behavior

Deletes must run through domain logic. They should release dependent reservations or expected projections in the same transaction as the deletion.

## Related docs

Read [Why Delete Instead of Cancel](/docs/design-decisions/why-delete-instead-of-cancel).
