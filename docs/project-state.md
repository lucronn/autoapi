# Project State Handoff

**Last updated:** 2026-09-08
**Repository:** `/Users/dull/Documents/ChatGPT/autoapi`
**Branch:** `codex/motor-api-connector`
**Last verified code HEAD:** `8d80754b575092b2e9b83d2b6906ba9eb3edee7a` (`fix: make package entrypoint runnable`)
**Status:** Implementation and local verification are complete in the isolated worktree. No remote state was changed. Documentation and smoke tooling are included; the live smoke is configuration-blocked in this environment.

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

- [x] Architecture/spec: `docs/superpowers/specs/2026-09-08-motor-api-connector-design.md` (commit `87977e7`)
- [x] Documentation rules: `docs/documentation-rules.md` (commit `5dd4f4c`)
- [x] Agent-agnostic handoff: `docs/project-state.md` (commit `5dd4f4c`)
- [x] Implementation plan: `docs/superpowers/plans/2026-09-08-motor-api-connector.md`

## Implemented slices

- Direct HTTP EBSCO prompted-login adapter with allowlisted redirects and cookie capture.
- AES-256-GCM encrypted server session file with atomic writes and single-flight refresh.
- Explicit read-only MOTOR route registry and direct client for catalog, vehicle, article, labor, maintenance, parts, graphic, asset, XML, and user-settings resources.
- Deterministic HTML normalization: `<mtr-image>` to `<img>`, `<eplink>` to connector article links, `<emph>` to `<em>`, safe attributes, and safe `src`/`href`/`srcset`/CSS URL rewriting.
- HMAC-signed expiring asset references and an asset proxy with content-type/size/header controls.
- Unauthenticated Fastify routes under `/v1/api/*`, `/v1/assets/*`, `/healthz`, `/readyz`, `/docs`, and `/openapi.json`.
- Request-scoped `x-upstream-cookie` override supported without persistence; server-side session remains the default.
- Opt-in redacted live smoke command in `scripts/live-smoke.ts`.

## Local verification evidence

Run from `/Users/dull/Documents/ChatGPT/autoapi/.worktrees/motor-api-connector`:

- `npm test` — exit 0; 19 test files, 45 tests passed.
- `npm run build` — exit 0; TypeScript emitted successfully.
- `npm run lint` — exit 0; strict TypeScript check passed.
- `git diff --check` — exit 0; no whitespace errors.
- `LIVE_SMOKE=1 npm run live-smoke` — exit 1 as expected with sanitized `configuration_error`; no runtime credentials were available in this environment and no secret material was printed.

The supplied makes envelope and article envelope are covered by sanitized fixtures and returned through the Fastify connector integration tests. The live connector boundary remains opt-in and depends on the operator's authorized runtime configuration; no live secret or session material is committed. The earlier direct HTTP investigation established the provider flow, but this checkout's live smoke was not allowed to invent or recover missing runtime configuration.

## Next actions

1. Copy `.env.example` into a runtime secret store and provide an authorized EBSCO/MOTOR entry URL, prompt value, and encryption key.
2. Run `LIVE_SMOKE=1 npm run live-smoke` only when live verification is desired; record only its sanitized route/status/shape/timing output.
3. Deploy behind the trusted-network boundary described in the README; do not expose the unauthenticated connector directly to the public Internet.

## Known repository notes

- The repository started empty and had no existing application conventions.
- `AGENTS.md` references `RTK.md`, but no `AGENTS.md` or `RTK.md` was present in the initial working tree.
- No remote push or external repository mutation is authorized by this state file.
