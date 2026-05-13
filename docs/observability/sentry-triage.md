---
read_when:
  - Investigating Sentry production errors
  - Correlating Android and web failures
  - Preparing an agent production-error brief
---

# Sentry Triage

Start with `request_id`. API responses expose both `x-erp-request-id` and `x-request-id`; Android records the same value on API observations.

## API 500s

1. Filter Sentry by `request_id`.
2. Compare the Android event (`source=android_api`) with the web event (`source=api_handler`).
3. Use web `error.domain` and contexts for root cause. Android must not infer server DB, Xero, or validation causes.
4. Check `route`, `method`, `operation`, and `module`.
5. Use Vercel runtime logs with the same request ID for timings and cold-start evidence.

## Next Render Errors

`source=next.on_request_error` events should include:

- `next_render.route_path`
- `next_render.route_type`
- `next_render.router_kind`
- `next_render.render_source`
- `next_render.digest`

Error-boundary events use `client_error_boundary` or `global_error_boundary` and include `digest` when Next provides it.

## Sensitive Data Rules

Do not paste secrets, raw request bodies, response bodies, SQL, customer notes, comments, addresses, SKUs, or quantities into Sentry comments or PRs. If an investigation needs a business object, link to the internal record by ID or reproduce locally with sanitized data.
