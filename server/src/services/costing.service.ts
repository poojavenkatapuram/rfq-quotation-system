export interface CostingInput {
  grossWeightKg: number;
  materialRatePerKg: number;
  cycleTimeMin: number;
  machineRatePerHour: number;
  scrapPercentage: number;
  overheadAmount: number;
  packingAmount: number;
  freightAmount: number;
  profitMargin: number;
}

export interface CostingResult {
  materialCost: number;
  machiningCost: number;
  scrapCost: number;
  overheadAmount: number;
  packingAmount: number;
  freightAmount: number;
  totalCost: number;
  profitMargin: number;
  unitSellingPrice: number;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validateInput(input: CostingInput): void {
  const values = Object.entries(input);

  for (const [field, value] of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${field} must be a valid number`);
    }

    if (value < 0) {
      throw new Error(`${field} cannot be negative`);
    }
  }

  if (input.grossWeightKg <= 0) {
    throw new Error("grossWeightKg must be greater than zero");
  }

  if (input.materialRatePerKg <= 0) {
    throw new Error("materialRatePerKg must be greater than zero");
  }

  if (input.cycleTimeMin <= 0) {
    throw new Error("cycleTimeMin must be greater than zero");
  }

  if (input.machineRatePerHour <= 0) {
    throw new Error("machineRatePerHour must be greater than zero");
  }

  if (input.scrapPercentage > 100) {
    throw new Error("scrapPercentage cannot exceed 100");
  }

  if (input.profitMargin >= 100) {
    throw new Error("profitMargin must be less than 100");
  }
}

export function calculateCosting(input: CostingInput): CostingResult {
  validateInput(input);

  const materialCost = input.grossWeightKg * input.materialRatePerKg;

  const machiningCost =
    (input.cycleTimeMin / 60) * input.machineRatePerHour;

  const scrapCost = materialCost * (input.scrapPercentage / 100);

  const totalCost =
    materialCost +
    machiningCost +
    scrapCost +
    input.overheadAmount +
    input.packingAmount +
    input.freightAmount;

  const unitSellingPrice =
    totalCost / (1 - input.profitMargin / 100);

  return {
    materialCost: roundMoney(materialCost),
    machiningCost: roundMoney(machiningCost),
    scrapCost: roundMoney(scrapCost),
    overheadAmount: roundMoney(input.overheadAmount),
    packingAmount: roundMoney(input.packingAmount),
    freightAmount: roundMoney(input.freightAmount),
    totalCost: roundMoney(totalCost),
    profitMargin: input.profitMargin,
    unitSellingPrice: roundMoney(unitSellingPrice),
  };
}
