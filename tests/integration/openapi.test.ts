import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createApp } from "../../src/server.js";

const config = loadConfig({
  MOTOR_ENTRY_URL: "https://search.ebscohost.com/login.aspx?profile=example",
  MOTOR_PROMPT_VALUE: "synthetic-prompt",
  SESSION_ENCRYPTION_KEY: "a".repeat(64),
  PUBLIC_BASE_URL: "https://connector.test",
});

describe("OpenAPI", () => {
  it("documents public routes without write methods", async () => {
    const app = await createApp({ config });
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    const document = response.json();
    expect(response.statusCode).toBe(200);
    expect(Object.keys(document.paths)).toContain("/v1/api/year/{year}/makes");
    expect(JSON.stringify(document.paths)).not.toMatch(/POST|PUT|PATCH|DELETE/);
    await app.close();
  });
});
