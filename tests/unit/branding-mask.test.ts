import { describe, expect, it } from "vitest";
import { maskProviderBranding, maskProviderContent } from "../../src/content/branding-mask.js";

describe("provider branding mask", () => {
  it("replaces standalone provider branding without changing compound source names", () => {
    expect(maskProviderBranding("MOTOR Motor motor vehicle GeneralMotors")).toBe("Autodbone Autodbone Autodbone vehicle GeneralMotors");
  });

  it("masks textual body fields while preserving URL fields", () => {
    const result = maskProviderContent({
      label: "MOTOR procedure",
      html: '<p>MOTOR</p><img src="https://sites.motor.com/m1/api/x">',
      url: "https://sites.motor.com/m1/api/x",
    });

    expect(result).toEqual({
      label: "Autodbone procedure",
      html: '<p>Autodbone</p><img src="https://sites.motor.com/m1/api/x">',
      url: "https://sites.motor.com/m1/api/x",
    });
  });
});
