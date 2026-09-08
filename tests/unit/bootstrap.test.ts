import { describe, expect, it } from "vitest";

describe("project bootstrap", () => {
  it("exposes a typed package test command", async () => {
    const module = await import("../../src/types.js");
    expect(module).toHaveProperty("CONNECTOR_VERSION");
  });
});
