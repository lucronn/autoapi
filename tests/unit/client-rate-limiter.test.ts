import { describe, expect, it } from "vitest";
import { ClientRateLimiter } from "../../src/http/client-rate-limiter.js";

describe("ClientRateLimiter", () => {
  it("allows the configured number of requests and rejects the next one in the window", () => {
    const limiter = new ClientRateLimiter({ maxRequests: 2, windowSeconds: 60, now: () => 1_700_000_000 });

    expect(limiter.check("198.51.100.10")).toEqual({ allowed: true });
    expect(limiter.check("198.51.100.10")).toEqual({ allowed: true });
    expect(limiter.check("198.51.100.10")).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("keeps caller windows independent and expires old timestamps", () => {
    let now = 1_700_000_000;
    const limiter = new ClientRateLimiter({ maxRequests: 1, windowSeconds: 60, now: () => now });

    expect(limiter.check("198.51.100.10").allowed).toBe(true);
    expect(limiter.check("198.51.100.11").allowed).toBe(true);
    expect(limiter.check("198.51.100.10").allowed).toBe(false);
    now += 60;
    expect(limiter.check("198.51.100.10")).toEqual({ allowed: true });
  });
});
