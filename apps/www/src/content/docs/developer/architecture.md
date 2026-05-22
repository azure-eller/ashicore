---
title: Developer Architecture
description: Internal implementation boundaries for pages, API routes, domain logic, DAL, and database access.
section: Developer
order: 610
---

## Purpose

Developer docs preserve rules that keep the ERP maintainable as workflows deepen.

## Layer model

Pages and components render UI and call API routes. API routes validate input and call domain or DAL functions. Domain logic owns business rules. DAL code accesses the database through authenticated organization context. Database schema and migrations enforce persistence constraints.

## Hard boundary

Pages, components, and API routes should not import the database directly. Mutations should go through API routes and domain logic, not server actions or ad hoc DB writes.

## Inventory boundary

Stock, lots, costs, commitments, expected supply, dispositions, and allocations must use canonical inventory paths. Direct quantity mutation is not an acceptable shortcut.

## Related docs

Read [Inventory Invariants](/docs/developer/invariants) and [Testing](/docs/developer/testing).
