---
read_when:
  - Adding or changing Sentry capture
  - Changing web or Android API observability
  - Investigating cross-platform request correlation
  - Building Sentry Autofix PR packets
---

# Sentry Vocabulary

This repo owns the canonical ERP Sentry vocabulary. Android mirrors this contract. Sentry Autofix PR packets must use this vocabulary plus the sanitizer rules in `docs/observability/sentry-autofix.md`.

## Shared Tags

- `error.kind`: safe class such as `postgres`, `unique_violation`, `validation`, `http_500`, `network`, or `unknown`
- `error.domain`: safe owner such as `db`, `validation`, `external_service`, `network`, `api`, or `unknown`
- `module`: ERP module when known, for example `sales`, `purchasing`, `inventory`, or `manufacturing`
- `operation`: `domain.action`, for example `sales_order.ship`, `purchase_order.list`, `xero.purchase_order.push`, `auth.sign_in`
- `source`: capture source
- `request_id`: value from `x-erp-request-id` or `x-request-id`
- `release_sha`: deployed git SHA when available
- `environment`: Sentry environment

## Source Values

- `api_handler`
- `next.on_request_error`
- `client_error_boundary`
- `global_error_boundary`
- `xero`
- `android_api`
- `android_screen`

## Web Tags

- `route`: route template or sanitized path
- `method`: HTTP method
- `runtime`: `nodejs`, `edge`, or `browser`
- `vercel_env`: Vercel environment when available

## Android Tags

- `screen`
- `api_path`
- `method`
- `http_status`
- `build_type`
- `app_version`
- `device_class`

## Contexts

Shared:

- `app_debug`
- `network`

Web:

- `db`
- `validation`
- `external_service`
- `next_render`

Android:

- `mobile`
- `api_error`

## Naming Rules

- Use `snake_case` for tag and context fields.
- Use dot notation only for top-level tag families like `error.kind` and `error.domain`.
- Strip query strings from every path.
- Prefer route templates on web when available.
- Android may use sanitized raw API paths.
- Never include request or response bodies, SQL, SQL parameters, raw DB messages, cookies, tokens, passwords, SKUs, addresses, quantities, notes, or comments.
