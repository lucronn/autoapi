import { describe, expect, it, vi } from "vitest";
import { CookieJar } from "../../src/auth/cookie-jar.js";
import type { AuthAdapter, AuthenticatedSession } from "../../src/auth/auth-adapter.js";
import { SessionManager } from "../../src/auth/session-manager.js";

const makeSession = (expiresAt?: number): AuthenticatedSession => ({
  source: "server",
  cookieJar: CookieJar.fromSetCookie(["SessionIdentifier=synthetic; Path=/"], 1_700_000_000),
  createdAt: 1_700_000_000,
  ...(expiresAt === undefined ? {} : { expiresAt }),
});

function fakeStore(initial?: AuthenticatedSession) {
  let saved = initial;
  return {
    load: vi.fn(async () => saved),
    save: vi.fn(async (value: AuthenticatedSession) => { saved = value; }),
  };
}

describe("SessionManager", () => {
  it("loads a persisted session and validates it once after startup", async () => {
    const store = fakeStore(makeSession());
    const adapter: AuthAdapter = { authenticate: vi.fn(), validate: vi.fn(async () => ({ valid: true as const })) };
    const manager = new SessionManager(adapter, store, { refreshSkewSeconds: 300 });

    await expect(manager.getSession()).resolves.toMatchObject({ source: "server" });
    await expect(manager.getSession()).resolves.toMatchObject({ source: "server" });
    expect(adapter.validate).toHaveBeenCalledTimes(1);
    expect(adapter.authenticate).not.toHaveBeenCalled();
  });

  it("refreshes a near-expiry session before use", async () => {
    const refreshed = makeSession(1_700_001_000);
    const adapter: AuthAdapter = { authenticate: vi.fn(async () => refreshed), validate: vi.fn(async () => ({ valid: true as const })) };
    const manager = new SessionManager(adapter, fakeStore(makeSession(1_700_000_200)), { refreshSkewSeconds: 300, now: () => 1_700_000_000 });

    await expect(manager.getSession()).resolves.toMatchObject({ source: "server", expiresAt: refreshed.expiresAt });
    expect(adapter.authenticate).toHaveBeenCalledTimes(1);
  });

  it("refreshes once after a 401 and retries the idempotent operation", async () => {
    const adapter: AuthAdapter = { authenticate: vi.fn(async () => makeSession()), validate: vi.fn(async () => ({ valid: true as const })) };
    const manager = new SessionManager(adapter, fakeStore(makeSession()), { refreshSkewSeconds: 300 });
    let attempts = 0;

    await expect(manager.withSession(async () => ({ status: ++attempts === 1 ? 401 : 200 }))).resolves.toEqual({ status: 200 });
    expect(attempts).toBe(2);
    expect(adapter.authenticate).toHaveBeenCalledTimes(1);
  });

  it("shares one refresh promise across concurrent requests", async () => {
    let resolveAuth: ((session: AuthenticatedSession) => void) | undefined;
    const refreshed = new Promise<AuthenticatedSession>((resolve) => { resolveAuth = resolve; });
    const adapter: AuthAdapter = { authenticate: vi.fn(() => refreshed), validate: vi.fn(async () => ({ valid: true as const })) };
    const manager = new SessionManager(adapter, fakeStore(makeSession()), { refreshSkewSeconds: 300 });
    const operation = async () => ({ status: 401 });

    const results = Promise.all([manager.withSession(operation), manager.withSession(operation), manager.withSession(operation)]);
    resolveAuth?.(makeSession());
    await expect(results).resolves.toHaveLength(3);
    expect(adapter.authenticate).toHaveBeenCalledTimes(1);
  });
});
