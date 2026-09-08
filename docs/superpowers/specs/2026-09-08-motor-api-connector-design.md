# MOTOR API Connector Design

**Status:** Proposed
**Date:** 2026-09-08
**Scope:** Read-only connector for the authenticated MOTOR Auto Repair Source API

## Goal

Provide a low-latency, read-only HTTP API that connects to the same JSON service used by the MOTOR Auto Repair Source frontend. The connector must forward MOTOR response envelopes faithfully, normalize only content payloads that need frontend rendering, and keep upstream authentication server-side by default.

## Non-goals

- Reimplementing or scraping the MOTOR Angular frontend.
- Rendering or executing the MOTOR frontend bundle.
- Creating bookmarks, feedback, repair history, user accounts, or other write operations.
- Bypassing EBSCO/MOTOR authorization, rate limits, geo restrictions, or entitlement checks.
- Persisting caller-provided upstream sessions.

## Evidence from the current upstream

The canonical EBSCOhost entry flow redirects to an EBSCO OIDC dispatcher. The ZIP prompt is handled by a direct JSON request to the prompted-login edge endpoint. A live probe completed the flow with a cookie jar, followed the callback into `sites.motor.com/m1/`, and received HTTP 200 JSON from `GET /m1/api/years`.

Measured single-run baseline from the local environment:

| Operation | Observed duration |
| --- | ---: |
| Initial login page and redirect chain | 0.95 s |
| ZIP prompt submission | 0.25 s |
| Auth callback | 0.83 s |
| Warm `GET /m1/api/years` | 0.11–0.21 s |

The baseline is directional, not a production SLO. The direct HTTP path is the primary design because it avoids browser startup and page rendering. A browser is an opt-in fallback only for a future browser-only challenge.

The observed MOTOR frontend calls same-origin JSON resources under `/m1/api/`. The initial API surface includes:

- `/api/years`
- `/api/year/{year}/makes`
- `/api/year/{year}/make/{make}/models`
- `/api/vin/{vin}/vehicle`
- `/api/source/{contentSource}/vehicles`
- `/api/source/{contentSource}/{vehicleId}/motorvehicles`
- `/api/source/{contentSource}/{vehicleId}/name`
- `/api/source/{contentSource}/vehicle/{vehicleId}/articles/v2`
- `/api/source/{contentSource}/vehicle/{vehicleId}/article/{articleId}`
- `/api/source/{contentSource}/vehicle/{vehicleId}/article/{articleId}/title`
- `/api/source/{contentSource}/vehicle/{vehicleId}/labor/{articleId}`
- `/api/source/{contentSource}/vehicle/{vehicleId}/maintenanceSchedules/frequency`
- `/api/source/{contentSource}/vehicle/{vehicleId}/maintenanceSchedules/intervals`
- `/api/source/{contentSource}/vehicle/{vehicleId}/maintenanceSchedules/indicators`
- `/api/source/{contentSource}/vehicle/{vehicleId}/parts`
- `/api/source/{contentSource}/graphic/{id}`
- `/api/asset/{handleId}`
- `/api/source/{contentSource}/xml/{articleId}`
- `/api/ui/usersettings`

MOTOR responses use an envelope such as `{ "header": {...}, "body": ... }`. The connector preserves this shape and adds normalized content only where the route contract requests it.

## Architecture

### 1. Public connector service

Use a TypeScript Fastify service with Undici-backed HTTP connection pooling. The service exposes read-only `/v1/*` routes and generated OpenAPI documentation. Connector authentication is intentionally disabled per the current request; deployment guidance must clearly state that the service belongs behind a trusted network boundary because an unauthenticated content proxy is not suitable for direct public exposure.

Every public route maps to one allowlisted upstream route. Arbitrary upstream URLs, methods, headers, hosts, and request bodies are rejected. Only the explicitly supported query parameters are forwarded.

### 2. Upstream HTTP authentication adapter

`HttpAuthAdapter` performs the observed flow:

1. GET the configured EBSCOhost entry URL with a cookie jar.
2. Parse the login page's serialized state without logging it.
3. POST the provider's prompted-login JSON action with the configured server-side prompt value.
4. Follow the returned callback URI using the same cookie jar.
5. Validate the authenticated MOTOR session with a small read-only API probe.

The adapter is provider-specific internally but exposes a provider-neutral interface to the rest of the service. The entry URL, prompt value, customer/profile identifiers, and optional provider parameters are runtime configuration only.

### 3. Durable server-side session

The default server-side session is persisted as encrypted application data on a mounted runtime volume. The encryption key is supplied through runtime configuration and never stored in the repository. The persisted record contains only what is required to restore the upstream cookie jar and session metadata.

The upstream cookies observed in the probe were session cookies without an expiry timestamp. The session manager therefore follows this exact policy:

- honor explicit upstream expiry when available;
- otherwise reuse the persisted session until the validation probe or a request returns an authenticated 401/403/invalid-session signal;
- refresh immediately on that signal under a single-flight lock;
- do not perform arbitrary periodic re-logins;
- do not log cookie values, authorization codes, prompt values, or serialized auth state.

An optional request-scoped session override may be supplied through a documented header. It is parsed in memory, is never persisted, and is always redacted from logs and error details.

### 4. MOTOR API adapter

`MotorApiAdapter` owns the exact upstream route templates, path encoding, query allowlists, status mapping, and request/response envelope handling. It does not call Angular services or depend on frontend bundle implementation. Adding a supported upstream endpoint requires an explicit route definition and contract test.

The adapter must preserve the upstream `header` and `body` values. It may add connector metadata under a namespaced field only when the route contract documents it; it must never silently rename or drop upstream fields.

### 5. Content normalizer and asset proxy

Normalization is applied to MOTOR content fields, principally `body.html`, after the upstream response is received. The normalizer:

- decodes HTML entities exactly once;
- maps known MOTOR tags to normal HTML, including `<mtr-image>` to `<img>`;
- preserves safe, meaningful attributes such as `alt`, `width`, and `height`;
- converts known EBSCO-style link tags to `<a>` elements with connector URLs;
- replaces unknown custom elements with a normal `<span>` for inline content or `<div>` for block content, preserving child content and safe global attributes while dropping unknown attributes;
- rewrites relative, protected, and embedded image URLs to connector asset routes;
- rewrites `src`, `href`, `srcset`, and CSS `url(...)` references only when the target host/path is allowlisted;
- preserves original normalized text and document structure;
- returns machine-readable `links` and `resources` metadata alongside normalized HTML.

For example, an upstream `<mtr-image id="4481151" ...>` becomes an ordinary `<img src="{publicBaseUrl}/v1/assets/motor/source/GeneralMotors/4481151" ...>`. The asset route reuses the server session, validates its signed opaque reference, streams the upstream bytes, preserves the upstream media type, and applies bounded size/time limits.

Raw upstream HTML remains available through an explicit `raw=true` query option or an explicitly documented raw field. Normalization must never make a caller guess whether a value was altered.

### 6. OpenAPI and operational endpoints

The service publishes:

- `/docs` for Swagger UI;
- `/openapi.json` for the generated OpenAPI document;
- `/healthz` for process health;
- `/readyz` for session readiness and upstream reachability without exposing secrets.

The OpenAPI description must identify read-only behavior, response envelopes, normalized content, error codes, asset behavior, and the fact that connector endpoints have no built-in authentication.

## Proposed public routes

Routes use `/v1` and retain the upstream conceptual path so consumers can map requests predictably:

- `GET /v1/api/years`
- `GET /v1/api/year/{year}/makes`
- `GET /v1/api/year/{year}/make/{make}/models`
- `GET /v1/api/vin/{vin}/vehicle`
- `GET /v1/api/source/{contentSource}/vehicles`
- `GET /v1/api/source/{contentSource}/{vehicleId}/motorvehicles`
- `GET /v1/api/source/{contentSource}/{vehicleId}/name`
- `GET /v1/api/source/{contentSource}/vehicle/{vehicleId}/articles/v2`
- `GET /v1/api/source/{contentSource}/vehicle/{vehicleId}/article/{articleId}`
- `GET /v1/api/source/{contentSource}/vehicle/{vehicleId}/article/{articleId}/title`
- `GET /v1/api/source/{contentSource}/vehicle/{vehicleId}/labor/{articleId}`
- `GET /v1/api/source/{contentSource}/vehicle/{vehicleId}/maintenanceSchedules/frequency`
- `GET /v1/api/source/{contentSource}/vehicle/{vehicleId}/maintenanceSchedules/intervals`
- `GET /v1/api/source/{contentSource}/vehicle/{vehicleId}/maintenanceSchedules/indicators`
- `GET /v1/api/source/{contentSource}/vehicle/{vehicleId}/parts`
- `GET /v1/api/source/{contentSource}/graphic/{id}`
- `GET /v1/api/asset/{handleId}`
- `GET /v1/api/source/{contentSource}/xml/{articleId}`
- `GET /v1/assets/{reference}` for normalized image/resource references

Write-capable upstream routes such as bookmarks, feedback, and logout are intentionally not exposed.

## Error handling

Errors use a stable connector envelope with `code`, `message`, `requestId`, and optional `upstreamStatus`. Secret-bearing upstream bodies and headers are excluded. Upstream 401/403 responses trigger one locked session refresh and one retry for idempotent GETs; a second failure returns a deterministic `upstream_auth_failed` error. Timeouts, body limits, invalid route parameters, blocked hosts, and malformed HTML each have distinct codes.

## Latency and resilience decisions

- Reuse one connection-pooled HTTP client per upstream origin.
- Reuse the durable cookie jar across requests and process restarts.
- Use one shared session refresh promise to prevent login storms.
- Do not refresh healthy session cookies on a timer.
- Cache immutable or slow-changing catalog responses with short configurable TTLs, while never caching protected HTML or expiring asset URLs beyond their safe lifetime.
- Stream asset bytes rather than buffering large images/PDFs in application memory.
- Bound concurrency per upstream origin and fail fast when the session is known invalid.
- Keep normalization linear in document size and avoid a browser DOM.

## Testing strategy

- Unit tests for route allowlists, parameter encoding, envelope preservation, error mapping, HTML normalization, custom-tag conversion, URL rewriting, signature validation, and redaction.
- Contract tests using sanitized fixtures for the provided makes response and component-location HTML response.
- Integration tests with an in-process fake upstream covering login, cookie persistence, expiry/401 refresh, single-flight refresh, and asset streaming.
- Optional live smoke test, enabled only with runtime credentials and never in default CI, covering the canonical login flow, `/api/years`, `/api/year/2024/makes`, and one article retrieval.
- OpenAPI snapshot/validation test to ensure every route is documented and no write endpoint is accidentally exposed.

## Risks and boundaries

- The prompted-login edge endpoint is an observed provider implementation detail, not a guaranteed public API. Keep it behind an adapter with fixture tests and a browser fallback feature flag.
- The MOTOR JSON API may change route templates or HTML tags. Contract tests and structured upstream error reporting make drift visible.
- Unauthenticated connector routes can be abused. Deployment must use network controls, rate limits, request size limits, and an explicit warning in the README.
- Content is subscription-controlled and may be copyrighted. The connector must only relay content available through the authorized upstream session and must not claim ownership of it.

## Acceptance criteria

1. A fresh process can authenticate through direct HTTP, persist the encrypted server session, and reuse it after restart.
2. A healthy server session is not re-authenticated on each request or on an arbitrary timer.
3. The example makes route returns the upstream envelope and make objects.
4. The example article route returns the upstream metadata and frontend-ready normalized HTML.
5. MOTOR custom image tags render as ordinary HTML image tags pointing at connector asset routes.
6. Embedded URLs/images are rewritten only to safe connector routes or explicitly allowed external destinations.
7. No frontend bundle is executed or scraped by the request path.
8. Swagger UI and OpenAPI JSON document all read-only routes.
9. Tests cover auth persistence, refresh-on-invalid, one retry, content normalization, proxying, and secret redaction.
