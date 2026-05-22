---
title: Integrations
description: Connect external systems without making them the source of operational inventory truth.
section: Admin
order: 520
---

## Purpose

Integrations should reduce duplicate entry and keep accounting or connected systems informed. They should not bypass Ashicore's inventory rules.

## Accounting

Accounting systems own financial reporting, tax, invoices, bills, and payment workflows. Ashicore owns operational inventory, production, receiving, allocation, and fulfillment.

## Setup guidance

Connect accounting after items, suppliers, customers, and document rules are clean. Review unmatched import rows before creating new records. Keep provider item codes as external metadata unless the business intentionally uses the same code as the Ashicore SKU.

## Troubleshooting

For failed syncs, record the provider, document number, organization, time, and error message.
