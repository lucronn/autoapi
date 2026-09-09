import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

const validEnv = {
  MOTOR_ENTRY_URL: "https://search.ebscohost.com/login.aspx?profile=example",
  MOTOR_PROMPT_VALUE: "example-prompt",
  SESSION_ENCRYPTION_KEY: "a".repeat(64),
};

describe("loadConfig", () => {
  it("uses the configured institutional fallback entry and ZIP when overrides are omitted", () => {
    const config = loadConfig({ SESSION_ENCRYPTION_KEY: "a".repeat(64) });

    expect(config.upstream.entryUrl).toBe("https://search.ebscohost.com/login.aspx?authtype=ip,geo,cpid,uid&groupid=main&custid=ns145344&profile=autorepso");
    expect(config.upstream.promptValue).toBe("20234");
  });

  it("loads a server session configuration without exposing secret values", () => {
    const config = loadConfig(validEnv);

    expect(config.upstream.entryUrl).toContain("search.ebscohost.com");
    expect(config.session.encryptionKey).toHaveLength(32);
    expect(config.session.encryptionKey.toString("hex")).toBe("a".repeat(64));
    expect(config.upstream.promptValue).toBe("example-prompt");
  });

  it("rejects a non-HTTPS upstream origin", () => {
    expect(() => loadConfig({ ...validEnv, MOTOR_API_ORIGIN: "http://evil.test" })).toThrow(/HTTPS/);
  });

  it("uses safe defaults for optional limits", () => {
    const config = loadConfig(validEnv);

    expect(config.limits.requestTimeoutMs).toBe(15_000);
    expect(config.limits.maxResponseBytes).toBe(8 * 1024 * 1024);
    expect(config.session.refreshSkewSeconds).toBe(300);
  });
});
