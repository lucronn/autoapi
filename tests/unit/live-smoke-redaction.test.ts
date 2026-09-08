import { describe, expect, it } from "vitest";
import { formatSmokeResult } from "../../scripts/live-smoke.js";

describe("live smoke redaction", () => {
  it("never prints runtime auth material in smoke output", () => {
    const output = formatSmokeResult({
      route: "callback",
      url: "https://example.test/callback?code=synthetic",
      cookies: "SessionIdentifier=secret",
      status: 200,
      durationMs: 12,
      responseShape: "authorized",
    });
    expect(output).not.toContain("synthetic");
    expect(output).not.toContain("secret");
    expect(output).toContain("[REDACTED]");
  });
});
