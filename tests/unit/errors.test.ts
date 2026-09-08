import { describe, expect, it } from "vitest";
import { ConnectorError, serializeError } from "../../src/errors.js";

describe("connector errors", () => {
  it("serializes a stable error envelope", () => {
    const error = new ConnectorError("upstream_auth_failed", "Upstream authentication failed", 502, 401);
    expect(serializeError(error, "req-123")).toEqual({
      error: {
        code: "upstream_auth_failed",
        message: "Upstream authentication failed",
        requestId: "req-123",
        upstreamStatus: 401,
      },
    });
  });

  it("does not serialize secret-bearing details", () => {
    const error = new ConnectorError("upstream_error", "failed", 502, 500, {
      cookie: "SessionIdentifier=secret",
      authRequest: "synthetic-auth-request",
    });

    const serialized = JSON.stringify(serializeError(error, "req-123"));
    expect(serialized).not.toContain("SessionIdentifier");
    expect(serialized).not.toContain("synthetic-auth-request");
  });
});
