import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { gstPercentageSchema } from "./gst-validation.service.js";
describe("GST storage precision", () => {
  it.each([0, 5, 18, 18.1, 18.12, 18.123, 18.1234, 0.0001, 99.9999, 100])("accepts %s without database rate rounding", value => {
    expect(gstPercentageSchema.parse(value)).toBe(value);
    expect(new Prisma.Decimal(value).toDecimalPlaces(4).toNumber()).toBe(value);
  });
  it.each([18.12345, 0.00001, 99.99999, 18.000000000000004, -1, 100.0001, NaN, Infinity, "18.1234", null])("rejects unsupported GST %s", value => {
    expect(gstPercentageSchema.safeParse(value).success).toBe(false);
  });
});
