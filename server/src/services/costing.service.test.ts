import { describe, it, expect } from "vitest";
import { calculateCosting } from "./costing.service.js";

const validInput = {
  grossWeightKg: 0.61,
  materialRatePerKg: 85,
  cycleTimeMin: 3.2,
  machineRatePerHour: 850,
  setupCost: 600,
  annualVolumes: [1000, 5000],
  scrapPercentage: 5,
  overheadAmount: 10,
  packingAmount: 5,
  freightAmount: 8,
  profitMargin: 20,
};

describe("calculateCosting", () => {
  it("calculates material cost correctly", () => {
    const result = calculateCosting(validInput);

    expect(result.materialCost).toBe(51.85);
  });

  it("calculates machining cost correctly", () => {
    const result = calculateCosting(validInput);

    expect(result.machiningCost).toBe(45.33);
  });

  it("calculates scrap cost correctly", () => {
    const result = calculateCosting(validInput);

    expect(result.scrapCost).toBe(2.59);
  });

  it("includes overhead, packing and freight in total cost", () => {
    const result = calculateCosting(validInput);

    expect(result.totalCost).toBe(122.78);
  });

  it("calculates volume-specific selling prices and allocates setup cost", () => {
    const result = calculateCosting(validInput);

    expect(result.volumeResults).toHaveLength(2);
    expect(result.volumeResults[0].setupCostPerPart).toBe(0.6);
    expect(result.volumeResults[1].setupCostPerPart).toBe(0.12);
    expect(result.volumeResults[0].unitSellingPrice).toBeGreaterThan(
      result.volumeResults[1].unitSellingPrice
    );
  });

  it("rejects zero gross weight", () => {
    expect(() =>
      calculateCosting({ ...validInput, grossWeightKg: 0 })
    ).toThrow("grossWeightKg must be greater than zero");
  });

  it("rejects negative material rate", () => {
    expect(() =>
      calculateCosting({ ...validInput, materialRatePerKg: -10 })
    ).toThrow("materialRatePerKg cannot be negative");
  });

  it("rejects scrap percentage above 100", () => {
    expect(() =>
      calculateCosting({ ...validInput, scrapPercentage: 101 })
    ).toThrow("scrapPercentage cannot exceed 100");
  });

  it("rejects profit margin of 100 percent", () => {
    expect(() =>
      calculateCosting({ ...validInput, profitMargin: 100 })
    ).toThrow("profitMargin must be less than 100");
  });

  it("rejects non-finite input values", () => {
    expect(() =>
      calculateCosting({ ...validInput, cycleTimeMin: Infinity })
    ).toThrow("cycleTimeMin must be a valid number");
  });
});
