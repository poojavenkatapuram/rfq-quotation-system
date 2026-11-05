export interface CostingInput {
  grossWeightKg: number;
  materialRatePerKg: number;
  cycleTimeMin: number;
  machineRatePerHour: number;
  setupCost: number;
  scrapPercentage: number;
  overheadAmount: number;
  packingAmount: number;
  freightAmount: number;
  profitMargin: number;
  annualVolumes: number[];
}

export interface VolumeCostingResult {
  annualVolume: number;
  setupCostPerPart: number;
  unitCost: number;
  unitSellingPrice: number;
  annualValue: number;
}

export interface CostingResult {
  materialCost: number;
  machiningCost: number;
  setupCost: number;
  scrapCost: number;
  overheadAmount: number;
  packingAmount: number;
  freightAmount: number;
  totalCost: number;
  profitMargin: number;
  volumeResults: VolumeCostingResult[];
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validateInput(input: CostingInput): void {
  const numericFields = [
    "grossWeightKg",
    "materialRatePerKg",
    "cycleTimeMin",
    "machineRatePerHour",
    "setupCost",
    "scrapPercentage",
    "overheadAmount",
    "packingAmount",
    "freightAmount",
    "profitMargin",
  ] as const;

  for (const field of numericFields) {
    const value = input[field];

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

  if (
    !Array.isArray(input.annualVolumes) ||
    input.annualVolumes.length === 0 ||
    input.annualVolumes.length > 5
  ) {
    throw new Error("Enter between one and five annual volumes");
  }

  for (const volume of input.annualVolumes) {
    if (!Number.isInteger(volume) || volume <= 0) {
      throw new Error("Annual volumes must be positive integers");
    }
  }
}

export function calculateCosting(input: CostingInput): CostingResult {
  validateInput(input);

  const materialCost =
    input.grossWeightKg * input.materialRatePerKg;

  const machiningCost =
    (input.cycleTimeMin / 60) * input.machineRatePerHour;

  const scrapCost =
    materialCost * (input.scrapPercentage / 100);

  // Recurring cost for manufacturing one finished part.
  const totalCost =
    materialCost +
    machiningCost +
    scrapCost +
    input.overheadAmount +
    input.packingAmount +
    input.freightAmount;

  // Setup is a batch-level cost, allocated over the selected volume.
  const volumeResults = [...new Set(input.annualVolumes)].map(
    (annualVolume): VolumeCostingResult => {
      const setupCostPerPart =
        input.setupCost / annualVolume;

      const unitCost =
        totalCost + setupCostPerPart;

      const unitSellingPrice =
        unitCost / (1 - input.profitMargin / 100);

      const roundedUnitSellingPrice =
        roundMoney(unitSellingPrice);

      return {
        annualVolume,
        setupCostPerPart: roundMoney(setupCostPerPart),
        unitCost: roundMoney(unitCost),
        unitSellingPrice: roundedUnitSellingPrice,
        annualValue: roundMoney(
          roundedUnitSellingPrice * annualVolume,
        ),
      };
    },
  );

  return {
    materialCost: roundMoney(materialCost),
    machiningCost: roundMoney(machiningCost),
    setupCost: roundMoney(input.setupCost),
    scrapCost: roundMoney(scrapCost),
    overheadAmount: roundMoney(input.overheadAmount),
    packingAmount: roundMoney(input.packingAmount),
    freightAmount: roundMoney(input.freightAmount),
    totalCost: roundMoney(totalCost),
    profitMargin: input.profitMargin,
    volumeResults,
  };
}
