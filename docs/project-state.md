# Project State Handoff

**Last updated:** 2026-09-08
**Repository:** `/Users/dull/Documents/ChatGPT/autoapi`
**Branch:** `master`
**HEAD:** no commits at initial state
**Status:** Architecture foundation being established; implementation has not started.

## Objective

Build a read-only connector that calls the same MOTOR `/m1/api/*` JSON service used by the Auto Repair Source frontend. The connector must provide Swagger/OpenAPI, preserve upstream response envelopes, normalize content HTML for frontend rendering, rewrite embedded assets/links through connector routes, and use a durable server-side upstream session by default with optional request-scoped session override.

## Confirmed decisions

- Connector endpoints are unauthenticated by explicit user direction.
- Upstream access defaults to a server-side institutional session.
- Server session state is persisted encrypted at rest and refreshed only from explicit expiry or an invalid-session signal; no arbitrary periodic re-login.
- Optional user-provided upstream sessions are request-scoped and never persisted.
- Direct HTTP is primary. Browser automation is fallback-only for browser-required challenges.
- The connector calls MOTOR API routes directly; it does not process or scrape the frontend.
- Public API is read-only. No bookmark, feedback, history, account, or logout routes.
- Primary stack decision: TypeScript, Fastify, Undici, OpenAPI, and deterministic HTML parsing/normalization.

## Live investigation evidence

- Canonical entry: `search.ebscohost.com/login.aspx` with the institution/profile parameters supplied by the user.
- Direct login page is a client-rendered EBSCO prompt with a serialized initial state.
- Observed submit endpoint: `login.ebsco.com/api/login/v1/prompted/next-step`.
- Direct HTTP login returned `view: "authorized"` using the configured ZIP prompt during the live probe.
- Callback followed successfully into `sites.motor.com/m1/`.
- Authenticated `GET /m1/api/years` returned HTTP 200 JSON with an envelope and 43 years.
- Authenticated `GET /m1/api/year/2024/makes` is supported by the MOTOR frontend bundle and is the first catalog contract test target.
- Example article route supplied by the user is a first normalization contract target.
- Measured one-run timings: login page/redirect 0.95 s, prompt submit 0.25 s, callback 0.83 s, warm API 0.11–0.21 s.
- Session cookies observed in the direct probe had no expiry timestamp; invalid-session probing is therefore required.

## Sensitive-state rule

No live authorization URL, JWT, cookie value, serialized auth state, or runtime secret belongs in this file, Git, logs, fixtures, or final reports. Any temporary probe artifacts were scoped to temporary directories and removed after use.

## Required artifacts before implementation

- [x] Architecture/spec: `docs/superpowers/specs/2026-09-08-motor-api-connector-design.md`
- [x] Documentation rules: `docs/documentation-rules.md`
- [x] Agent-agnostic handoff: `docs/project-state.md`
- [ ] Implementation plan: `docs/superpowers/plans/2026-09-08-motor-api-connector.md`

## Next actions

1. Review and approve the architecture spec.
2. Write the detailed TDD implementation plan and commit it.
3. Scaffold configuration, HTTP adapter, session persistence, route registry, normalizer, asset proxy, OpenAPI, and tests in red-green cycles.
4. Run unit/integration verification, then an explicitly opt-in live smoke test.

## Known repository notes

- The repository started empty and had no existing application conventions.
- `AGENTS.md` references `RTK.md`, but no `AGENTS.md` or `RTK.md` was present in the initial working tree.
- No remote push or external repository mutation is authorized by this state file.
