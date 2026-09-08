# Project Documentation Rules

These rules are agent-agnostic. Any contributor or automated worker must follow them when changing this repository.

## Source of truth

- Architecture and scope: `docs/superpowers/specs/2026-09-08-motor-api-connector-design.md`.
- Implementation sequence: `docs/superpowers/plans/2026-09-08-motor-api-connector.md`.
- Current handoff state: `docs/project-state.md`.
- Public API contract: generated OpenAPI plus the route definitions in source; if they disagree, update the source and regenerate OpenAPI.
- Runtime configuration: `.env.example` and configuration schema; never commit real values.

## Writing requirements

- Describe observable behavior, interfaces, and verification evidence.
- Use provider-neutral terms in shared interfaces; keep EBSCO/MOTOR details inside the upstream adapter documentation.
- Record a decision once in the architecture spec and link to it instead of duplicating conflicting copies.
- Every new public route must document method, path parameters, query parameters, response envelope, normalization behavior, upstream error mapping, and an example with secrets removed.
- Every behavior change must update the relevant tests and the project state file's next-action/evidence section.
- Use ISO dates (`YYYY-MM-DD`) and UTC timestamps for machine-readable state.
- Keep examples deterministic and sanitized. Do not paste real cookies, authorization codes, JWTs, session files, prompt values, trace IDs, or private URLs containing them.

## Security and privacy

- Credentials, session cookies, authorization codes, API keys, and runtime encryption keys belong only in the runtime secret store.
- Do not log or document raw request headers, cookie jars, auth URLs, redirect query strings, or serialized login state.
- Redact sensitive values as `[REDACTED]` in test output and reports.
- Never add `.env`, session stores, browser profiles, or generated captures to Git.
- Live smoke-test evidence may record status, route, duration, response shape, and sanitized counts; it must not record content beyond what is required to prove the route works.

## Change discipline

- Make the smallest change that satisfies the current spec.
- Preserve unrelated working-tree changes.
- Before committing, inspect `git diff --cached --name-only` and ensure only intended files are staged.
- Never use `git add -A` for delivery.
- Regenerate generated OpenAPI artifacts after route changes and inspect the diff.
- Do not push to GitHub or mutate remote state unless the user explicitly authorizes it in the current turn.

## Verification reporting

Every completed work item must state:

1. The exact command run.
2. The exit status and relevant pass/fail counts.
3. The artifact or runtime behavior verified.
4. Any unverified boundary, such as a live-only upstream dependency.

Do not describe a test as passing based on code inspection or a previous run. Do not describe a live upstream route as available based only on a frontend bundle; use a real response or label it unverified.

## Handoff updates

Update `docs/project-state.md` at meaningful boundaries:

- after architecture decisions;
- after each implementation slice;
- after verification;
- when blocked by upstream access, missing credentials, or a user decision.
The state file must remain useful to an agent with no conversation history. Prefer concise facts, exact paths, commands, and next actions over narrative.
