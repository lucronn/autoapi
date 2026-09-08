import { describe, expect, it } from "vitest";
import { createAssetReference, verifyAssetReference } from "../../src/assets/asset-reference.js";

const secret = Buffer.from("asset-reference-test-secret");

describe("asset references", () => {
  it("rejects a tampered or expired asset reference", () => {
    const reference = createAssetReference({ kind: "source", source: "GeneralMotors", id: "4481151" }, secret, 1_700_000_000);
    expect(() => verifyAssetReference(`${reference.slice(0, -1)}x`, secret, 1_700_000_001)).toThrow(/invalid_asset_reference/);
    expect(() => verifyAssetReference(reference, secret, 1_700_000_601)).toThrow(/expired_asset_reference/);
  });

  it("round-trips a valid opaque reference", () => {
    const reference = createAssetReference({ kind: "asset", id: "a/b" }, secret, 1_700_000_000);
    expect(verifyAssetReference(reference, secret, 1_700_000_001)).toMatchObject({ kind: "asset", id: "a/b" });
  });
});
