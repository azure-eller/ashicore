---
title: Planned vs. Unplanned Demand
description: Why Ashicore separates draft intent from real operational demand and supply.
section: Concepts
order: 130
---

## User problem

Operators need planning visibility without polluting the live stock picture. A draft order is useful, but it should not be treated the same as confirmed customer demand or released production.

## Mental model

Draft records are intent. Ordered purchase orders, released manufacturing orders, allocated sales orders, receipts, completions, and shipments are operational facts.

## User workflow

Use drafts to prepare work. Submit, order, release, receive, complete, allocate, or ship only when the team is ready for that record to affect planning or inventory.

## System behavior

Ashicore uses document status to decide when a record contributes to expected supply, demand, commitments, and history. This prevents early drafts from creating false availability or false shortages.

## Examples

A draft purchase order does not increase expected supply. An ordered purchase order does. A draft manufacturing order is a plan. A released manufacturing order can create expected finished output. A sales order can show demand before shipment, but on-hand stock changes only when stock physically leaves.
