import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { CookieJar } from "../../src/auth/cookie-jar.js";
import type { AuthAdapter, AuthenticatedSession } from "../../src/auth/auth-adapter.js";
import { SessionManager } from "../../src/auth/session-manager.js";
import { MotorApiClient } from "../../src/motor/motor-client.js";
import type { HttpTransport } from "../../src/http/http-client.js";
import { createApp } from "../../src/server.js";

const config = loadConfig({
  MOTOR_ENTRY_URL: "https://search.ebscohost.com/login.aspx?profile=example",
  MOTOR_PROMPT_VALUE: "synthetic-prompt",
  SESSION_ENCRYPTION_KEY: "a".repeat(64),
  PUBLIC_BASE_URL: "https://connector.test",
});
const session: AuthenticatedSession = {
  source: "server",
  cookieJar: CookieJar.fromSetCookie(["SessionIdentifier=synthetic; Path=/"], 1_700_000_000),
  createdAt: 1_700_000_000,
};
const adapter: AuthAdapter = {
  authenticate: async () => session,
  validate: async () => ({ valid: true }),
};
const store = { load: async () => session, save: async () => undefined };

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

async function appWithTransport(transport: HttpTransport) {
  const motorClient = new MotorApiClient(config, transport);
  const sessionManager = new SessionManager(adapter, store, { refreshSkewSeconds: 300 });
  return createApp({ config, motorClient, sessionManager });
}

describe("public API routes", () => {
  it("returns the makes envelope through the connector", async () => {
    const responseBody = await fixture("makes-2024.json");
    const app = await appWithTransport(async () => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(responseBody) }));
    const response = await app.inject({ method: "GET", url: "/v1/api/year/2024/makes" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(JSON.parse(responseBody));
    await app.close();
  });

  it("normalizes article HTML but preserves upstream metadata", async () => {
    const responseBody = await fixture("article-component-location.json");
    const app = await appWithTransport(async () => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(responseBody) }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/api/source/GeneralMotors/vehicle/100342221/article/4481222%3A17911387?bucketName=Component%20Location%20Diagrams&articleSubtype=&searchTerm=",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().body.html).toContain("<img");
    expect(response.json().body.documentId).toBe("4481222");
    expect(response.json().connector.normalized).toBe(true);
    await app.close();
  });

  it("allows a request-scoped upstream cookie without persisting it", async () => {
    let cookie = "";
    const app = await appWithTransport(async (request) => {
      cookie = request.headers?.cookie ?? "";
      return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{"header":{},"body":[]}') };
    });
    const response = await app.inject({ method: "GET", url: "/v1/api/years", headers: { "x-upstream-cookie": "Override=synthetic" } });
    expect(response.statusCode).toBe(200);
    expect(cookie).toContain("Override=synthetic");
    await app.close();
  });

  it("serves repeated default-session reads from cache", async () => {
    let upstreamCalls = 0;
    const app = await appWithTransport(async () => {
      upstreamCalls += 1;
      return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{"header":{},"body":[]}') };
    });

    expect((await app.inject({ method: "GET", url: "/v1/api/years" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/api/years" })).statusCode).toBe(200);
    expect(upstreamCalls).toBe(1);
    await app.close();
  });

  it("rejects an over-limit caller before the upstream transport and does not allow a bulk flag", async () => {
    let upstreamCalls = 0;
    const limitedConfig = {
      ...config,
      limits: { ...config.limits, maxClientRequestsPerWindow: 1, clientRateWindowSeconds: 60 },
    };
    const app = await createApp({
      config: limitedConfig,
      motorClient: new MotorApiClient(limitedConfig, async () => {
        upstreamCalls += 1;
        return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{"header":{},"body":[]}') };
      }),
      sessionManager: new SessionManager(adapter, store, { refreshSkewSeconds: 300 }),
    });

    expect((await app.inject({ method: "GET", url: "/v1/api/years" })).statusCode).toBe(200);
    const limited = await app.inject({ method: "GET", url: "/v1/api/years" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatchObject({ code: "client_rate_limited" });
    expect(limited.headers["retry-after"]).toBeDefined();
    expect((await app.inject({ method: "GET", url: "/v1/api/years?bulk=1" })).statusCode).toBe(400);
    expect(upstreamCalls).toBe(1);
    await app.close();
  });
});
