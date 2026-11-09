import { describe, expect, it } from "vitest";
import { normalizeReviewedNumber, numericValueFromEvidence } from "./rfq-field-validation.js";

describe("RFQ numeric evidence", () => {
  it.each(["Weight: 2 kg", "Net Weight: 2 kg", "Gross weight: 2", "Gross weight: 200 g", "Gross weight: 2 lb",
    "Gross weight kg: 200 g", "Gross weight: 2 kg approximately", "Gross weight: -2 kg", "Gross weight: 1,2 kg"])(
    "does not turn ambiguous/incompatible weight into gross kg: %s", (text) => {
      expect(numericValueFromEvidence("grossWeightKg", text)).toBeUndefined();
    });
  it.each(["Quantity: 1200", "Monthly quantity: 1200", "Annual volume: 12.5", "Annual volume: 12-15", "Annual volume: 1,2"])(
    "does not infer annual demand: %s", (text) => {
      expect(numericValueFromEvidence("annualVolume", text)).toBeUndefined();
    });
  it("retains explicit units, gross/net distinction and valid Indian grouping", () => {
    expect(numericValueFromEvidence("grossWeightKg", "Gross_Weight_Kg: 1.48")).toBe("1.48");
    expect(numericValueFromEvidence("grossWeightKg", "Gross weight: 1.48 kg")).toBe("1.48");
    expect(numericValueFromEvidence("netWeightKg", "Net weight: 1.25 kg")).toBe("1.25");
    expect(numericValueFromEvidence("annualVolume", "Annual volume: 1,20,000 pcs")).toBe("120000");
    expect(numericValueFromEvidence("cycleTimeMinutes", "Cycle time: 30 seconds")).toBeUndefined();
  });
  it("binds a number to its own label and rejects conflicting evidence", () => {
    expect(numericValueFromEvidence("grossWeightKg", "Gross weight: 200 g\nNet weight: 200 kg")).toBeUndefined();
    expect(numericValueFromEvidence("grossWeightKg", "Gross weight: 1 kg\nGross weight: 2 kg")).toBeUndefined();
  });
  it("requires positive finite bounded review values and integral annual volumes", () => {
    for (const value of ["NaN", "Infinity", "-1", "0", "1e4", "1,2", "1200kg", "10000000000000"]) {
      expect(normalizeReviewedNumber("grossWeightKg", value)).toBeUndefined();
    }
    expect(normalizeReviewedNumber("annualVolume", "1.5")).toBeUndefined();
    expect(normalizeReviewedNumber("annualVolume", "12,000")).toBe("12000");
  });
});
