import { describe, expect, it } from "vitest";
import { ResponseCache } from "../../src/http/response-cache.js";

const response = (body: string) => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: Buffer.from(body),
});

describe("ResponseCache", () => {
  it("coalesces concurrent misses and returns a cached response", async () => {
    let loads = 0;
    const cache = new ResponseCache({ maxEntries: 10, maxBytes: 1024, now: () => 1_700_000_000 });
    const load = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return response("cached");
    };

    const [first, second] = await Promise.all([
      cache.getOrSet("years:v1", 60, load),
      cache.getOrSet("years:v1", 60, load),
    ]);

    expect(loads).toBe(1);
    expect(first.body.toString()).toBe("cached");
    expect(second.body.toString()).toBe("cached");
    expect(cache.get("years:v1")?.body.toString()).toBe("cached");
  });

  it("does not cache non-success responses or entries beyond the byte limit", async () => {
    const cache = new ResponseCache({ maxEntries: 10, maxBytes: 4, now: () => 1_700_000_000 });
    cache.set("error", 60, { ...response("error"), status: 503 });
    cache.set("large", 60, response("large"));

    expect(cache.get("error")).toBeUndefined();
    expect(cache.get("large")).toBeUndefined();
  });
});
