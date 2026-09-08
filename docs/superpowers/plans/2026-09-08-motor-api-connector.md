# MOTOR API Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only, direct-HTTP connector that authenticates to the EBSCO/MOTOR service, forwards MOTOR `/m1/api/*` JSON resources, and returns frontend-ready normalized content with proxied assets.

**Architecture:** A Fastify TypeScript service uses a pooled Undici client and a durable encrypted cookie jar. A route registry maps public `/v1/api/*` routes to allowlisted MOTOR endpoints. A content normalizer transforms only returned HTML fields; no frontend JavaScript or DOM is processed.

**Tech Stack:** Node.js 22+, TypeScript 5+, Fastify 5, Undici, Zod, Cheerio/parse5, Vitest, `@fastify/swagger`, `@fastify/swagger-ui`, and Node `crypto`.

**Spec:** `docs/superpowers/specs/2026-09-08-motor-api-connector-design.md`

## Global Constraints

- Connector endpoints remain unauthenticated and read-only.
- The default upstream session is server-side, encrypted at rest, and refreshed only on explicit expiry or invalid-session signals.
- Optional request-scoped upstream sessions are never persisted.
- Direct HTTP is the primary authentication and data path; browser automation is not part of the default runtime.
- Only allowlisted MOTOR paths, methods, headers, and query parameters may be forwarded.
- The upstream response envelope `{ header, body }` is preserved.
- Frontend bundles are never executed, scraped, or required at request time.
- No real URLs containing authorization state, cookies, credentials, JWTs, or runtime keys may enter Git.
- Every production behavior is implemented after a failing test has been observed.
- Do not push to GitHub or mutate remote state.

---

## File map

Create the following focused units:

- `package.json`, `tsconfig.json`, `vitest.config.ts`: project tooling and scripts.
- `.env.example`, `.gitignore`: runtime configuration documentation and secret exclusions.
- `src/config.ts`: validated runtime configuration.
- `src/types.ts`: provider-neutral connector types and response envelopes.
- `src/errors.ts`: stable connector errors and Fastify error serialization.
- `src/http/http-client.ts`: pooled HTTP client wrapper and safe response handling.
- `src/auth/cookie-jar.ts`: serializable cookie jar with expiry metadata.
- `src/auth/auth-adapter.ts`: provider-neutral authentication interface.
- `src/auth/ebsco-http-auth-adapter.ts`: direct EBSCO prompted-login flow.
- `src/auth/session-store.ts`: encrypted file persistence.
- `src/auth/session-manager.ts`: load/validate/refresh/single-flight behavior.
- `src/motor/route-registry.ts`: exact upstream path templates and query allowlists.
- `src/motor/motor-client.ts`: allowlisted direct MOTOR requests.
- `src/content/html-normalizer.ts`: deterministic HTML and custom-tag conversion.
- `src/content/url-rewriter.ts`: safe asset/link rewriting and resource metadata.
- `src/assets/asset-reference.ts`: signed opaque asset references.
- `src/assets/asset-proxy.ts`: upstream asset streaming.
- `src/routes/api-routes.ts`: public read-only API routes.
- `src/routes/asset-routes.ts`: normalized asset routes.
- `src/routes/health-routes.ts`: health/readiness routes.
- `src/openapi.ts`, `src/server.ts`: OpenAPI registration and application assembly.
- `tests/fixtures/makes-2024.json`, `tests/fixtures/article-component-location.json`: sanitized contract fixtures.
- `tests/helpers/fakes.ts`: deterministic fake transport, session, and app harness helpers shared by unit/integration tests.
- `tests/unit/**`, `tests/integration/**`: TDD coverage.
- `scripts/live-smoke.ts`: explicitly opt-in live verification.
- `README.md`: setup, API usage, deployment boundary, and live-test instructions.

---

### Task 1: Bootstrap the TypeScript service and repository rules

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/index.ts`
- Test: `tests/unit/bootstrap.test.ts`

**Interfaces:**
- Produces `createApp()` from `src/server.ts` in a later task and a runnable `npm test`/`npm run build` toolchain.

- [ ] **Step 1: Write the failing bootstrap test**

```ts
import { describe, expect, it } from "vitest";

describe("project bootstrap", () => {
  it("exposes a typed package test command", async () => {
    const module = await import("../../src/types.js");
    expect(module).toHaveProperty("CONNECTOR_VERSION");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the missing module**

Run: `npm test -- tests/unit/bootstrap.test.ts`

Expected: FAIL because the TypeScript source module and package scripts do not exist yet.

- [ ] **Step 3: Add the minimum project files and versioned scripts**

`package.json` must define:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc -p tsconfig.json --noEmit",
    "live-smoke": "tsx scripts/live-smoke.ts"
  }
}
```

Use Node 22-compatible versions of Fastify, Undici, Zod, Cheerio, `@fastify/swagger`, `@fastify/swagger-ui`, Vitest, TypeScript, and `tsx`. Configure `tsconfig.json` with strict mode, NodeNext module resolution, declaration output, `src` root, and `dist` output.

`src/types.ts` must export:

```ts
export const CONNECTOR_VERSION = "0.1.0" as const;
```

`.gitignore` must exclude `node_modules/`, `dist/`, `.env`, `.env.*` except `.env.example`, `data/`, `*.enc`, browser profiles, coverage, and live smoke captures.

- [ ] **Step 4: Run the focused test and type check**

Run: `npm test -- tests/unit/bootstrap.test.ts && npm run lint`

Expected: PASS with one test and zero TypeScript errors.

- [ ] **Step 5: Commit the bootstrap**

```bash
git add package.json tsconfig.json vitest.config.ts .env.example .gitignore src/index.ts src/types.ts tests/unit/bootstrap.test.ts
git diff --cached --name-only
git commit -m "build: bootstrap motor connector service"
```

### Task 2: Add validated configuration and stable errors

**Files:**
- Create: `src/config.ts`
- Create: `src/errors.ts`
- Test: `tests/unit/config.test.ts`
- Test: `tests/unit/errors.test.ts`

**Interfaces:**
- Produces `loadConfig(env?: NodeJS.ProcessEnv): Config`.
- Produces `ConnectorError` with `code`, `status`, `message`, and optional `upstreamStatus`.

- [ ] **Step 1: Write failing configuration tests**

```ts
it("rejects missing upstream entry configuration", () => {
  expect(() => loadConfig({})).toThrow(/MOTOR_ENTRY_URL/);
});

it("loads a server session configuration without exposing secret values", () => {
  const config = loadConfig({
    MOTOR_ENTRY_URL: "https://search.ebscohost.com/login.aspx?profile=example",
    MOTOR_PROMPT_VALUE: "example-prompt",
    SESSION_ENCRYPTION_KEY: "a".repeat(64),
  });
  expect(config.upstream.entryUrl).toContain("search.ebscohost.com");
  expect(config.session.encryptionKey).toHaveLength(32);
});
```

- [ ] **Step 2: Run tests to verify the expected missing-module/validation failures**

Run: `npm test -- tests/unit/config.test.ts tests/unit/errors.test.ts`

Expected: FAIL because `loadConfig` and `ConnectorError` do not exist.

- [ ] **Step 3: Implement configuration and errors**

`Config` must include:

```ts
type Config = {
  host: string;
  port: number;
  publicBaseUrl?: string;
  upstream: {
    entryUrl: string;
    promptValue: string;
    apiOrigin: string;
    loginOrigin: string;
    allowedContentSources: string[];
  };
  session: {
    filePath: string;
    encryptionKey: Buffer;
    refreshSkewSeconds: number;
    validationPath: string;
  };
  limits: {
    requestTimeoutMs: number;
    maxResponseBytes: number;
    maxAssetBytes: number;
    maxConcurrentUpstream: number;
  };
};
```

Validate HTTPS origins, integer limits, non-empty prompt, 32-byte key decoded from hex, and reject secrets in the entry URL except the provider-generated runtime URL stored in configuration. Copy `.env.example` values as synthetic examples only.

`ConnectorError` must serialize to `{ error: { code, message, requestId, upstreamStatus? } }` and redact nested upstream headers/bodies.

- [ ] **Step 4: Run tests and type check**

Run: `npm test -- tests/unit/config.test.ts tests/unit/errors.test.ts && npm run lint`

Expected: PASS with all focused tests green and zero type errors.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/errors.ts tests/unit/config.test.ts tests/unit/errors.test.ts .env.example
git diff --cached --name-only
git commit -m "feat: add connector configuration and errors"
```

### Task 3: Implement the pooled HTTP client and serializable cookie jar

**Files:**
- Create: `src/http/http-client.ts`
- Create: `src/auth/cookie-jar.ts`
- Create: `tests/helpers/fakes.ts`
- Test: `tests/unit/cookie-jar.test.ts`
- Test: `tests/unit/http-client.test.ts`

**Interfaces:**
- Produces `CookieJar.fromSetCookie(headers, now): CookieJar`.
- Produces `CookieJar.toHeader(now): string` and `CookieJar.serialize(): SerializedCookieJar`.
- Produces `CookieJar.deserialize(value): CookieJar`.
- Produces `HttpClient.request<T>(request): Promise<HttpResponse<T>>`.
- `tests/helpers/fakes.ts` exports `fakeResponse({status,body}): HttpResponse<string>`, `fakeTransport(...responses): HttpTransport`, and `readStream(stream): Promise<Buffer>`.
- `tests/helpers/fakes.ts` also exports `sessionWithFixtureCookies(): AuthenticatedSession`, `createLifecycleHarness(options?): Promise<LifecycleHarness>`, `years200(): HttpResponse<string>`, and `unauthorized401(): HttpResponse<string>` for integration scenarios.

- [ ] **Step 1: Write failing cookie and HTTP tests**

```ts
it("drops expired cookies and serializes session cookies without inventing expiry", () => {
  const jar = CookieJar.fromSetCookie([
    "SessionIdentifier=abc; Path=/; Secure; HttpOnly",
    "Old=gone; Max-Age=0; Path=/",
  ], 1_700_000_000);
  expect(jar.toHeader(1_700_000_000)).toBe("SessionIdentifier=abc");
  expect(jar.serialize().cookies[0].expiresAt).toBeUndefined();
});

it("rejects an upstream response over the configured byte limit", async () => {
  const upstream = fakeResponse({ status: 200, body: "x".repeat(11) });
  await expect(new HttpClient(fakeTransport(upstream), { maxResponseBytes: 10 }).request({
    method: "GET", url: "https://sites.motor.com/m1/api/years"
  })).rejects.toMatchObject({ code: "upstream_response_too_large" });
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/unit/cookie-jar.test.ts tests/unit/http-client.test.ts`

Expected: FAIL because the client and cookie jar are missing.

- [ ] **Step 3: Implement the minimal client and cookie jar**

Use one Undici `Agent` per upstream origin with keep-alive and bounded connections. The client must support GET/POST for the login adapter but expose no arbitrary public forwarding. It must enforce HTTPS origin allowlists, timeout, maximum bytes, and response content type capture. `CookieJar` must parse `Set-Cookie` attributes, domain/path matching, `Secure`, `HttpOnly`, `Max-Age`, and `Expires`, and serialize only names/values internally; never include raw values in errors or logs.

- [ ] **Step 4: Run focused tests and type check**

Run: `npm test -- tests/unit/cookie-jar.test.ts tests/unit/http-client.test.ts && npm run lint`

Expected: PASS with all focused tests green and zero type errors.

- [ ] **Step 5: Commit**

```bash
git add src/http/http-client.ts src/auth/cookie-jar.ts tests/unit/cookie-jar.test.ts tests/unit/http-client.test.ts
git diff --cached --name-only
git commit -m "feat: add pooled upstream client and cookie jar"
```

### Task 4: Implement direct EBSCO HTTP authentication

**Files:**
- Create: `src/auth/auth-adapter.ts`
- Create: `src/auth/ebsco-http-auth-adapter.ts`
- Test: `tests/unit/ebsco-http-auth-adapter.test.ts`
- Create: `tests/fixtures/ebsco-login-page.html`
- Create: `tests/fixtures/ebsco-auth-authorized.json`

**Interfaces:**
- Produces `AuthAdapter.authenticate(): Promise<AuthenticatedSession>`.
- Produces `AuthAdapter.validate(session): Promise<ValidationResult>`.
- `AuthenticatedSession` includes `cookieJar`, `createdAt`, `expiresAt?`, and `source`.

- [ ] **Step 1: Write failing adapter tests**

```ts
it("follows the prompted login state without a browser", async () => {
  const transport = fakeSequence([
    fixtureResponse("ebsco-login-page.html", 200),
    fixtureResponse("ebsco-auth-authorized.json", 200),
    fixtureResponse("motor-landing.html", 200),
  ]);
  const session = await new EbscoHttpAuthAdapter(testConfig, transport).authenticate();
  expect(session.cookieJar.toHeader(Date.now())).toContain("SessionIdentifier=");
  expect(transport.requests.map(r => r.url)).toEqual([
    testConfig.upstream.entryUrl,
    "https://login.ebsco.com/api/login/v1/prompted/next-step",
    "https://search.ebscohost.com/webauth/PromptedCallback.aspx?code=fixture-code",
  ]);
});

it("reports invalid when the read-only MOTOR probe returns 401", async () => {
  const result = await adapter.validate(sessionWithFixtureCookies(), fakeResponse({status:401, body:""}));
  expect(result).toEqual({ valid: false, reason: "unauthorized" });
});
```

- [ ] **Step 2: Run focused tests and verify the expected failure**

Run: `npm test -- tests/unit/ebsco-http-auth-adapter.test.ts`

Expected: FAIL because the adapter and fixtures do not exist.

- [ ] **Step 3: Implement the direct HTTP flow**

The adapter must:

1. GET the configured entry URL while capturing redirects and cookies.
2. Parse only the `__NEXT_DATA__` login state required to build the structured action/context payload.
3. POST to the prompted-login endpoint with `Content-Type: application/json`, `Accept: application/json`, the configured prompt value, and a redacted transport log.
4. Require `view === "authorized"` and a callback URI from the JSON response.
5. Follow the callback with the same cookie jar.
6. Validate with `GET {apiOrigin}/m1/api/years`.

The parser must fail closed for missing state, unexpected origins, missing redirect, or non-authorized views. It must never use arbitrary redirect hosts. Fixtures must contain synthetic state and synthetic cookie values only. Add a browser fallback interface but throw `browser_fallback_unconfigured` if invoked; do not add Playwright to the default dependencies.

- [ ] **Step 4: Run focused tests and type check**

Run: `npm test -- tests/unit/ebsco-http-auth-adapter.test.ts && npm run lint`

Expected: PASS with the login sequence, failure modes, and redaction assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/auth/auth-adapter.ts src/auth/ebsco-http-auth-adapter.ts tests/unit/ebsco-http-auth-adapter.test.ts tests/fixtures/ebsco-login-page.html tests/fixtures/ebsco-auth-authorized.json
git diff --cached --name-only
git commit -m "feat: authenticate MOTOR through direct HTTP"
```

### Task 5: Add encrypted session persistence and refresh single-flight

**Files:**
- Create: `src/auth/session-store.ts`
- Create: `src/auth/session-manager.ts`
- Test: `tests/unit/session-store.test.ts`
- Test: `tests/unit/session-manager.test.ts`

**Interfaces:**
- Produces `EncryptedSessionStore.load(): Promise<AuthenticatedSession | undefined>`.
- Produces `EncryptedSessionStore.save(session): Promise<void>`.
- Produces `SessionManager.getSession(): Promise<AuthenticatedSession>`.
- Produces `SessionManager.withSession(request): Promise<T>`.

- [ ] **Step 1: Write failing encryption and refresh tests**

```ts
it("persists encrypted session state without plaintext cookie values", async () => {
  await store.save(sessionWithCookie("SessionIdentifier", "synthetic-secret"));
  const bytes = await readFile(testPath);
  expect(bytes.toString()).not.toContain("synthetic-secret");
  await expect(store.load()).resolves.toMatchObject({ source: "server" });
});

it("refreshes once after a 401 and retries the idempotent request", async () => {
  const adapter = fakeAuthAdapter();
  const client = fakeClient([401, 200]);
  const manager = new SessionManager(adapter, store, client, config);
  await expect(manager.withSession(s => client.requestWithSession(s, request))).resolves.toMatchObject({status:200});
  expect(adapter.authenticate).toHaveBeenCalledTimes(1);
});

it("shares one refresh promise across concurrent invalid requests", async () => {
  const requestFn = (session: AuthenticatedSession) => client.requestWithSession(session, request);
  await Promise.all([manager.withSession(requestFn), manager.withSession(requestFn), manager.withSession(requestFn)]);
  expect(adapter.authenticate).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/unit/session-store.test.ts tests/unit/session-manager.test.ts`

Expected: FAIL because persistence and manager modules are missing.

- [ ] **Step 3: Implement AES-GCM persistence and session manager**

Encrypt serialized session JSON with AES-256-GCM using a random 12-byte IV and authenticated tag. Store `{version, iv, tag, ciphertext}` as JSON with mode `0600`, create the parent directory if needed, and atomically replace the file through a same-directory temporary file. Never write the encryption key into the file. Reject malformed/version-mismatched records.

`SessionManager` must load a valid stored session, honor explicit expiry with the configured skew, validate lazily when no expiry exists, and use one shared refresh promise. Only GET requests may be retried automatically. Request-scoped cookie overrides must bypass persistence and refresh only in memory.

- [ ] **Step 4: Run focused tests and type check**

Run: `npm test -- tests/unit/session-store.test.ts tests/unit/session-manager.test.ts && npm run lint`

Expected: PASS, including plaintext absence, file permissions, expiry behavior, 401 retry, and single-flight refresh.

- [ ] **Step 5: Commit**

```bash
git add src/auth/session-store.ts src/auth/session-manager.ts tests/unit/session-store.test.ts tests/unit/session-manager.test.ts
git diff --cached --name-only
git commit -m "feat: persist and refresh upstream sessions securely"
```

### Task 6: Add the MOTOR route registry and direct API client

**Files:**
- Create: `src/motor/route-registry.ts`
- Create: `src/motor/motor-client.ts`
- Test: `tests/unit/route-registry.test.ts`
- Test: `tests/unit/motor-client.test.ts`
- Create: `tests/fixtures/makes-2024.json`
- Create: `tests/fixtures/article-component-location.json`

**Interfaces:**
- Produces `MOTOR_ROUTES` with explicit route IDs, methods, templates, query allowlists, and response kind.
- Produces `MotorApiClient.execute(routeId, params, session): Promise<UpstreamEnvelope<unknown>>`.

- [ ] **Step 1: Write failing registry/client tests**

```ts
it("encodes the article id as one path segment and forwards only allowed queries", () => {
  const request = buildMotorRequest("article", {
    contentSource: "GeneralMotors", vehicleId: "100342221", articleId: "4481222:17911387",
    bucketName: "Component Location Diagrams", articleSubtype: "", searchTerm: "",
    ignored: "drop-me"
  });
  expect(request.url).toBe("https://sites.motor.com/m1/api/source/GeneralMotors/vehicle/100342221/article/4481222%3A17911387?bucketName=Component%20Location%20Diagrams&articleSubtype=&searchTerm=");
  expect(request.url).not.toContain("ignored");
});

it("preserves the upstream envelope and body array", async () => {
  const result = await client.execute("makes", {year: 2024}, session);
  expect(result.header.statusCode).toBe(200);
  expect(result.body).toEqual(expect.arrayContaining([{makeId: 2, makeName: "Porsche"}]));
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/unit/route-registry.test.ts tests/unit/motor-client.test.ts`

Expected: FAIL because the route registry and client do not exist.

- [ ] **Step 3: Implement route registry and client**

Register all read-only routes from the spec, including years, makes, models, VIN, vehicles, motor vehicles, vehicle name, article search, article detail/title, labor, maintenance frequency/interval/indicators, parts, graphics, assets, XML, and user settings. Do not register bookmarks, feedback, or logout.

Path values must be encoded per segment, query values through `URLSearchParams`, and content source values restricted to configured allowlisted values. Preserve upstream JSON exactly. The client must add `Accept: application/json` for JSON routes and `Accept: text/plain` for XML/text routes, attach the session cookie header, and return upstream status/header/body without logging secret-bearing headers.

- [ ] **Step 4: Run focused tests and type check**

Run: `npm test -- tests/unit/route-registry.test.ts tests/unit/motor-client.test.ts && npm run lint`

Expected: PASS with all route templates, query filtering, method restrictions, and fixture envelope assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/motor/route-registry.ts src/motor/motor-client.ts tests/unit/route-registry.test.ts tests/unit/motor-client.test.ts tests/fixtures/makes-2024.json tests/fixtures/article-component-location.json
git diff --cached --name-only
git commit -m "feat: map the MOTOR JSON API surface"
```

### Task 7: Implement deterministic HTML normalization and URL rewriting

**Files:**
- Create: `src/content/html-normalizer.ts`
- Create: `src/content/url-rewriter.ts`
- Test: `tests/unit/html-normalizer.test.ts`
- Test: `tests/unit/url-rewriter.test.ts`

**Interfaces:**
- Produces `normalizeHtml(html, context): NormalizedHtml`.
- Produces `rewriteResources(html, context): { html, links, resources }`.

- [ ] **Step 1: Write failing normalization tests**

```ts
it("converts MOTOR image tags to ordinary images", () => {
  const result = normalizeHtml("<div><mtr-image id='4481151' height='514' width='580' alt='Diagram'></mtr-image></div>", context);
  expect(result.html).toContain('<img src="https://connector.test/v1/assets/motor/source/GeneralMotors/4481151"');
  expect(result.html).toContain('alt="Diagram"');
  expect(result.html).toContain('height="514"');
});

it("maps embedded link and emphasis tags without executing content", () => {
  const result = normalizeHtml('<p><eplink linkfield="AN" linkkey="4481222">Open</eplink> <emph>bold-ish</emph></p>', context);
  expect(result.html).toContain('<a href="https://connector.test/v1/api/source/GeneralMotors/vehicle/100342221/article/4481222">Open</a>');
  expect(result.html).toContain("<em>bold-ish</em>");
  expect(result.html).not.toContain("eplink");
});

it("maps unknown custom elements to normal span/div elements", () => {
  expect(normalizeHtml("<mystery data-x='drop'><b>text</b></mystery>", context).html).toBe("<span><b>text</b></span>");
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/unit/html-normalizer.test.ts tests/unit/url-rewriter.test.ts`

Expected: FAIL because the normalizer and URL rewriter do not exist.

- [ ] **Step 3: Implement safe, linear normalization**

Parse HTML as a fragment with Cheerio/parse5, decode entities once, preserve text/structure, and serialize deterministically. Map:

- `mtr-image` → `img` with signed connector asset reference from `id`.
- `emph` → `em`.
- `eplink` → `a` with connector article route built from the current content source, vehicle, `linkkey`, and safe `linkfield` metadata.
- Unknown inline custom elements → `span`; unknown block custom elements → `div`.

Allow only safe global/presentation attributes (`id`, `class`, `title`, `alt`, `width`, `height`, `role`, `aria-*`, `data-*` where explicitly safe). Drop event handlers, dangerous URL schemes, inline scripts, and unknown provider attributes. Preserve table semantics and whitespace-sensitive text.

`url-rewriter.ts` must process `src`, `href`, `srcset`, and CSS `url(...)` values. Same-origin relative MOTOR assets become signed connector asset references. Allowlisted external HTTPS URLs remain external and are recorded in `links/resources`; all other schemes/hosts are removed or replaced with inert text. Never fetch resources during normalization.

- [ ] **Step 4: Run focused tests and type check**

Run: `npm test -- tests/unit/html-normalizer.test.ts tests/unit/url-rewriter.test.ts && npm run lint`

Expected: PASS with exact normalized HTML, link metadata, custom-tag removal, URL safety, and injection tests green.

- [ ] **Step 5: Commit**

```bash
git add src/content/html-normalizer.ts src/content/url-rewriter.ts tests/unit/html-normalizer.test.ts tests/unit/url-rewriter.test.ts
git diff --cached --name-only
git commit -m "feat: normalize MOTOR content for frontend rendering"
```

### Task 8: Implement signed asset references and streaming proxy

**Files:**
- Create: `src/assets/asset-reference.ts`
- Create: `src/assets/asset-proxy.ts`
- Test: `tests/unit/asset-reference.test.ts`
- Test: `tests/integration/asset-proxy.test.ts`

**Interfaces:**
- Produces `createAssetReference(target, secret, now): string`.
- Produces `verifyAssetReference(reference, secret, now): AssetTarget`.
- Produces `AssetProxy.stream(reference, session): Promise<StreamedAsset>`.

- [ ] **Step 1: Write failing signing and streaming tests**

```ts
it("rejects a tampered or expired asset reference", () => {
  const ref = createAssetReference({source: "GeneralMotors", id: "4481151"}, secret, 1_700_000_000);
  expect(() => verifyAssetReference(ref.slice(0, -1) + "x", secret, 1_700_000_001)).toThrow(/invalid_asset_reference/);
  expect(() => verifyAssetReference(ref, secret, 1_700_000_601)).toThrow(/expired_asset_reference/);
});

it("streams the upstream bytes and preserves content type", async () => {
  const asset = await proxy.stream(validReference, session);
  expect(asset.contentType).toBe("image/svg+xml");
  await expect(readStream(asset.body)).resolves.toEqual(Buffer.from("<svg/>"));
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/unit/asset-reference.test.ts tests/integration/asset-proxy.test.ts`

Expected: FAIL because asset signing and streaming are missing.

- [ ] **Step 3: Implement HMAC references and proxy**

Encode a compact payload containing target kind, allowlisted content source/path identifiers, issued-at, and expiry, then append an HMAC-SHA256 signature. Use constant-time signature comparison and reject malformed, expired, or disallowed targets. Do not sign arbitrary URLs.

The proxy maps only supported MOTOR asset/graphic routes, reuses the server or request-scoped session, streams bytes with a max size, and forwards only safe `Content-Type`, `Content-Length` when known, `ETag`, and cache headers. Do not cache protected bytes unless explicitly configured. Do not buffer the whole response.

- [ ] **Step 4: Run focused tests and type check**

Run: `npm test -- tests/unit/asset-reference.test.ts tests/integration/asset-proxy.test.ts && npm run lint`

Expected: PASS with tamper/expiry/host tests and streamed content assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/assets/asset-reference.ts src/assets/asset-proxy.ts tests/unit/asset-reference.test.ts tests/integration/asset-proxy.test.ts
git diff --cached --name-only
git commit -m "feat: proxy MOTOR assets through signed references"
```

### Task 9: Assemble public API routes, normalization modes, and OpenAPI

**Files:**
- Create: `src/routes/api-routes.ts`
- Create: `src/routes/asset-routes.ts`
- Create: `src/routes/health-routes.ts`
- Create: `src/openapi.ts`
- Create: `src/server.ts`
- Modify: `src/index.ts`
- Test: `tests/integration/api-routes.test.ts`
- Test: `tests/integration/openapi.test.ts`

**Interfaces:**
- Produces `createApp(deps): FastifyInstance`.
- Produces public routes under `/v1/api/*`, `/v1/assets/*`, `/healthz`, `/readyz`, `/docs`, and `/openapi.json`.

- [ ] **Step 1: Write failing route and OpenAPI tests**

```ts
it("returns the makes envelope through the connector", async () => {
  const response = await app.inject({ method: "GET", url: "/v1/api/year/2024/makes" });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual(JSON.parse(fixture("makes-2024.json")));
});

it("normalizes article HTML but preserves upstream metadata", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/v1/api/source/GeneralMotors/vehicle/100342221/article/4481222%3A17911387?bucketName=Component%20Location%20Diagrams&articleSubtype=&searchTerm="
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().body.html).toContain("<img");
  expect(response.json().body.documentId).toBe("4481222");
});

it("documents every public route and no write methods", async () => {
  const document = (await app.inject("/openapi.json")).json();
  expect(Object.keys(document.paths)).toContain("/v1/api/year/{year}/makes");
  expect(JSON.stringify(document.paths)).not.toMatch(/POST|PUT|PATCH|DELETE/);
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/integration/api-routes.test.ts tests/integration/openapi.test.ts`

Expected: FAIL because the Fastify app and public routes are missing.

- [ ] **Step 3: Implement the app and route registration**

Register every read-only route in the spec. Keep public paths prefixed `/v1/api` and pass only declared parameters to `MotorApiClient`. Support `raw=true` for HTML-bearing routes; default responses include the preserved upstream envelope with a documented normalized body. Add namespaced `connector` metadata only when normalization occurs, including `normalized`, `links`, and `resources`.

Register `@fastify/swagger` with OpenAPI 3.0 schemas, response examples based on sanitized fixtures, security omitted from connector routes, and descriptions that clearly state the trusted-network deployment boundary. Register Swagger UI at `/docs` and the raw document at `/openapi.json`.

`/healthz` must only report process health. `/readyz` may perform or use a cached read-only validation status but must never return cookie/token details.

- [ ] **Step 4: Run focused tests, build, and type check**

Run: `npm test -- tests/integration/api-routes.test.ts tests/integration/openapi.test.ts && npm run build && npm run lint`

Expected: PASS, generated OpenAPI contains all read-only routes, the two example routes return expected envelopes/content, and the build has zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api-routes.ts src/routes/asset-routes.ts src/routes/health-routes.ts src/openapi.ts src/server.ts src/index.ts tests/integration/api-routes.test.ts tests/integration/openapi.test.ts
git diff --cached --name-only
git commit -m "feat: expose the read-only MOTOR connector API"
```

### Task 10: Add integration coverage for persistence, overrides, failures, and security

**Files:**
- Create: `tests/integration/session-lifecycle.test.ts`
- Create: `tests/integration/security-boundaries.test.ts`
- Modify: `src/routes/api-routes.ts` if coverage identifies a defect
- Modify: `src/routes/asset-routes.ts` if coverage identifies a defect
- Modify: `docs/project-state.md`

**Interfaces:**
- Validates the complete in-process lifecycle with a fake upstream and synthetic fixtures.

- [ ] **Step 1: Write failing end-to-end lifecycle tests**

Use the fake harness exported by `tests/helpers/fakes.ts` and write these concrete cases:

```ts
it("loads the encrypted server session after a process restart", async () => {
  const first = await createLifecycleHarness();
  await first.store.save(first.session);
  const second = await createLifecycleHarness({ sessionPath: first.sessionPath });
  await expect(second.app.inject({ method: "GET", url: "/v1/api/years" })).resolves.toMatchObject({ statusCode: 200 });
  expect(second.adapter.authenticate).not.toHaveBeenCalled();
});

it("does not authenticate again while a persisted session validates", async () => {
  const harness = await createLifecycleHarness({ upstreamResponses: [years200(), years200()] });
  await harness.app.inject({ method: "GET", url: "/v1/api/years" });
  await harness.app.inject({ method: "GET", url: "/v1/api/years" });
  expect(harness.adapter.authenticate).toHaveBeenCalledTimes(1);
});

it("refreshes only after an upstream unauthorized signal", async () => {
  const harness = await createLifecycleHarness({ upstreamResponses: [unauthorized401(), years200()] });
  await expect(harness.app.inject({ method: "GET", url: "/v1/api/years" })).resolves.toMatchObject({ statusCode: 200 });
  expect(harness.adapter.authenticate).toHaveBeenCalledTimes(1);
});

it("does not persist an override cookie", async () => {
  const harness = await createLifecycleHarness();
  await harness.app.inject({ method: "GET", url: "/v1/api/years", headers: { "x-upstream-cookie": "Override=synthetic" } });
  expect(await harness.store.load()).toEqual(undefined);
});

it("rejects arbitrary upstream URLs and dangerous schemes", async () => {
  const harness = await createLifecycleHarness();
  await expect(harness.motorClient.executeRaw("http://127.0.0.1/metadata")).rejects.toMatchObject({ code: "blocked_upstream_target" });
});

it("redacts cookies, auth state, prompt values, and authorization codes from logs", async () => {
  const harness = await createLifecycleHarness({ captureLogs: true });
  await harness.app.inject({ method: "GET", url: "/v1/api/years" });
  expect(harness.logs.join("\\n")).not.toMatch(/synthetic-cookie|synthetic-code|synthetic-prompt/);
});
```

- [ ] **Step 2: Run the tests and verify they fail where the integrated behavior is absent**

Run: `npm test -- tests/integration/session-lifecycle.test.ts tests/integration/security-boundaries.test.ts`

Expected: FAIL because the integrated harness and lifecycle guarantees are not wired together; fix production code rather than weakening assertions.

- [ ] **Step 3: Implement the smallest integration corrections**

Ensure every upstream 401/403 is mapped to the one refresh/retry path for GETs, content normalization is not applied to catalog arrays or raw mode, request IDs are stable per request, and all logs use structured redaction. Ensure all public route handlers reject non-GET methods and unsupported query keys.

- [ ] **Step 4: Run the complete local verification suite**

Run: `npm test && npm run build && npm run lint && git diff --check`

Expected: all tests pass, build/type checks exit 0, and no whitespace errors are reported.

- [ ] **Step 5: Update the handoff and commit**

Update `docs/project-state.md` with the exact test/build commands, pass counts, commit SHA, and any still-unverified live boundary. Stage only the explicit source/test/docs paths, inspect the cached name list, and commit:

```bash
git add src tests docs/project-state.md
git diff --cached --name-only
git commit -m "test: verify connector lifecycle and security boundaries"
```

### Task 11: Add opt-in live smoke verification and complete documentation

**Files:**
- Create: `scripts/live-smoke.ts`
- Create: `README.md`
- Modify: `docs/project-state.md`
- Test: `tests/unit/live-smoke-redaction.test.ts`

**Interfaces:**
- Produces a live smoke command that exits nonzero on auth/API failure and prints only sanitized status/shape/timing evidence.

- [ ] **Step 1: Write the failing redaction test**

```ts
it("never prints runtime auth material in smoke output", () => {
  const output = formatSmokeResult({url:"https://example.test/callback?code=synthetic", cookies:"SessionIdentifier=secret"});
  expect(output).not.toContain("synthetic");
  expect(output).not.toContain("secret");
  expect(output).toContain("[REDACTED]");
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm test -- tests/unit/live-smoke-redaction.test.ts`

Expected: FAIL because the smoke formatter does not exist.

- [ ] **Step 3: Implement live smoke and README**

`scripts/live-smoke.ts` must require `LIVE_SMOKE=1`, load runtime env, authenticate directly over HTTP, call `/m1/api/years`, `/m1/api/year/2024/makes`, and one configured article target, and print route/status/duration/response-shape summaries only. It must exit nonzero on any unexpected status, malformed envelope, or normalization failure. It must not write session files inside the repository.

README must document installation, environment variables, startup, route examples, OpenAPI, raw versus normalized responses, asset behavior, session persistence/refresh, trusted-network deployment, and the exact live smoke command. State that users must supply their own authorized upstream account/access and that the connector does not bypass entitlement controls.

- [ ] **Step 4: Run complete verification and the opt-in live smoke test**

Run: `npm test && npm run build && npm run lint && LIVE_SMOKE=1 npm run live-smoke`

Expected: local tests/build/lint pass; live smoke either prints sanitized successful evidence for all configured routes or exits nonzero with a concrete sanitized upstream error. Do not infer success from a missing credential/configuration.

- [ ] **Step 5: Update state, inspect diff, and commit**

Record exact live evidence in `docs/project-state.md` without cookies or authorization URLs. Then:

```bash
git add README.md scripts/live-smoke.ts tests/unit/live-smoke-redaction.test.ts docs/project-state.md
git diff --cached --name-only
git diff --cached --check
git commit -m "docs: document and smoke test MOTOR connector"
```

---

## Final verification checklist

- [ ] `npm test` passes with the full test count recorded.
- [ ] `npm run build` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `git diff --check` exits 0.
- [ ] The two supplied response shapes are verified through the connector.
- [ ] Persisted session survives process restart and contains no plaintext cookie values.
- [ ] Healthy sessions are not refreshed on arbitrary timers.
- [ ] Invalid sessions refresh once and retry idempotent GETs.
- [ ] Optional override sessions are not persisted.
- [ ] All supported MOTOR JSON routes are present in OpenAPI.
- [ ] No write endpoint is exposed.
- [ ] HTML custom tags and embedded images/links normalize into frontend-renderable HTML.
- [ ] Asset proxy signs and streams only allowlisted upstream targets.
- [ ] Logs and live smoke output contain no auth material.
- [ ] No frontend bundle is executed by the connector.
- [ ] Worktree is clean and no remote mutation occurred.
