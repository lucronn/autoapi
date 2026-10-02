import { describe, expect, it } from "vitest";
import { buildUpstreamRequest, UPSTREAM_ROUTES } from "../../src/upstream/route-registry.js";

describe("UPSTREAM route registry", () => {
  it("encodes the article id as one path segment and forwards only allowed queries", () => {
    const request = buildUpstreamRequest("article", {
      contentSource: "GeneralMotors",
      vehicleId: "100342221",
      articleId: "4481222:17911387",
      bucketName: "Component Location Diagrams",
      articleSubtype: "",
      searchTerm: "",
      ignored: "drop-me",
    }, "https://sites.motor.com");

    expect(request.url).toBe("https://sites.motor.com/m1/api/source/GeneralMotors/vehicle/100342221/article/4481222%3A17911387?bucketName=Component%20Location%20Diagrams&articleSubtype=&searchTerm=");
    expect(request.url).not.toContain("ignored");
    expect(request.method).toBe("GET");
  });

  it("rejects a content source outside the configured allowlist", () => {
    expect(() => buildUpstreamRequest("article", {
      contentSource: "UntrustedSource", vehicleId: "1", articleId: "2",
    }, "https://sites.motor.com", ["GeneralMotors"])).toThrow(/content source/i);
  });

  it("describes only read-only GET routes", () => {
    const routes = Object.values(UPSTREAM_ROUTES);
    expect(routes.every((route) => route.method === "GET")).toBe(true);
    expect(routes.some((route) => route.id === "bookmark" || route.id === "feedback")).toBe(false);
  });
});
