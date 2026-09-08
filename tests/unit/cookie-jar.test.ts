import { describe, expect, it } from "vitest";
import { CookieJar } from "../../src/auth/cookie-jar.js";

describe("CookieJar", () => {
  it("drops expired cookies and serializes session cookies without inventing expiry", () => {
    const jar = CookieJar.fromSetCookie([
      "SessionIdentifier=abc; Path=/; Secure; HttpOnly",
      "Old=gone; Max-Age=0; Path=/",
    ], 1_700_000_000);

    expect(jar.toHeader(1_700_000_000)).toBe("SessionIdentifier=abc");
    expect(jar.serialize().cookies[0].expiresAt).toBeUndefined();
  });

  it("honors max-age and expiry during serialization", () => {
    const jar = CookieJar.fromSetCookie([
      "Short=lived; Max-Age=60; Path=/",
      "Expired=past; Expires=Tue, 01 Jan 2019 00:00:00 GMT; Path=/",
    ], 1_700_000_000);

    expect(jar.toHeader(1_700_000_059)).toContain("Short=lived");
    expect(jar.toHeader(1_700_000_061)).toBe("");
  });

  it("round-trips serialized cookie state", () => {
    const jar = CookieJar.fromSetCookie(["SessionIdentifier=abc; Path=/"], 1_700_000_000);
    const restored = CookieJar.deserialize(jar.serialize());

    expect(restored.toHeader(1_700_000_000)).toBe("SessionIdentifier=abc");
  });
});
