---
title: Why Delete Instead of Cancel
description: The operating policy for removing mistaken records while preserving real history.
section: Design decisions
order: 420
---

## Decision

Use deletion for records that were mistakes and have no protected operational history. Preserve or block records that already created inventory, shipment, receipt, or completed production history.

## User problem

Operators need to clean up mistakes without keeping noise forever. At the same time, the system must not erase events that explain real stock movement.

## System behavior

Delete workflows should live in domain logic. They must release expected supply, demand, and allocation effects in the same transaction as the delete.

## Edge cases

A draft purchase order can be deleted. An ordered but unreceived purchase order can be deleted if expected supply is released. A received purchase order should be protected because receipt lots and ledger history exist.
