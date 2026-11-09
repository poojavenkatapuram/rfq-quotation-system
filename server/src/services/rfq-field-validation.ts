// Extraction units are evidence, never assumptions. No unit conversion is done here.
export const numericRfqFields = ["grossWeightKg", "netWeightKg", "annualVolume", "cycleTimeMinutes"] as const;
export type NumericRfqField = typeof numericRfqFields[number];

export function isNumericRfqField(field: string): field is NumericRfqField {
  return (numericRfqFields as readonly string[]).includes(field);
}

export function normalizeReviewedNumber(field: NumericRfqField, value: string): string | undefined {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/.test(value.trim())) return;
  const number = Number(value.replace(/,/g, ""));
  const max = field === "annualVolume" ? 1_000_000_000 : 1_000_000;
  if (!Number.isFinite(number) || number <= 0 || number > max ||
    (field === "annualVolume" && !Number.isSafeInteger(number))) return;
  return String(number);
}

export function numericValueFromEvidence(field: NumericRfqField, evidence: string): string | undefined {
  const number = "([0-9][0-9,]*(?:\\.[0-9]+)?)";
  const label = field === "grossWeightKg" ? "gross\\s*(?:weight|wt)" :
    field === "netWeightKg" ? "net\\s*(?:weight|wt)" :
    field === "annualVolume" ? "(?:annual\\s*(?:volume|quantity|qty)|yearly\\s*(?:quantity|qty)|qty\\s*/\\s*year)" :
    "cycle\\s*time";
  const unit = field.endsWith("WeightKg") ? "(?:kg|kgs|kilograms?)" : "(?:min|mins|minutes?)";
  const separator = "\\s*[:=-]?\\s*";
  const patterns = field === "annualVolume" ? [
    new RegExp("^" + label + separator + number + "\\s*(?:pcs?|pieces?|units?|nos?)?\\s*$", "i"),
  ] : [
    new RegExp("^" + label + "\\s*\\(?" + unit + "\\)?" + separator + number + "\\s*(?:" + unit + ")?\\s*$", "i"),
    new RegExp("^" + label + separator + number + "\\s*" + unit + "\\s*$", "i"),
  ];
  const values = new Set<string>();
  for (const line of evidence.replace(/_/g, " ").split(/\r?\n/)) {
    for (const pattern of patterns) {
      const match = line.trim().match(pattern);
      const value = match?.[1] && normalizeReviewedNumber(field, match[1]);
      if (value) values.add(value);
    }
  }
  return values.size === 1 ? [...values][0] : undefined;
}
