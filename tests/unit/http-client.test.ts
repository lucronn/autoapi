import { describe, expect, it } from "vitest";
import { ConnectorError } from "../../src/errors.js";
import { HttpClient, type HttpTransport } from "../../src/http/http-client.js";

function fakeTransport(body: string, status = 200): HttpTransport {
  return async () => ({
    status,
    headers: { "content-type": "text/plain" },
    body: Buffer.from(body),
  });
}

describe("HttpClient", () => {
  it("returns status, headers, and a buffered body", async () => {
    const response = await new HttpClient(fakeTransport("ok"), { maxResponseBytes: 10 }).request({
      method: "GET",
      url: "https://sites.motor.com/m1/api/years",
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/plain");
    expect(response.body.toString()).toBe("ok");
  });

  it("rejects an upstream response over the configured byte limit", async () => {
    await expect(new HttpClient(fakeTransport("x".repeat(11)), { maxResponseBytes: 10 }).request({
      method: "GET",
      url: "https://sites.motor.com/m1/api/years",
    })).rejects.toMatchObject({ code: "upstream_response_too_large" } satisfies Partial<ConnectorError>);
  });

  it("rejects unsupported methods before transport", async () => {
    const transport = async () => {
      throw new Error("transport should not be called");
    };

    await expect(new HttpClient(transport).request({
      method: "PATCH" as "GET",
      url: "https://sites.motor.com/m1/api/years",
    })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("bounds concurrent upstream requests", async () => {
    let inFlight = 0;
    let peak = 0;
    const transport: HttpTransport = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return { status: 200, headers: {}, body: Buffer.from("ok") };
    };
    const client = new HttpClient(transport, { maxConcurrentRequests: 2 });

    await Promise.all(Array.from({ length: 8 }, () => client.request({ method: "GET", url: "https://sites.motor.com/m1/api/years" })));

    expect(peak).toBeLessThanOrEqual(2);
  });
});
