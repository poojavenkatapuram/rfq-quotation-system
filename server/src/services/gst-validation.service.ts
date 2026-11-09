import { Prisma } from "@prisma/client";
import { z } from "zod";

// Matches both Quotation and HistoricalQuote Decimal(8, 4) storage. Reject
// rather than round: rounding the rate after computing GST breaks reconciliation.
export const gstPercentageSchema = z.number().min(0).max(100).refine(
  value => new Prisma.Decimal(value).decimalPlaces() <= 4,
  { message: "GST percentage supports at most 4 decimal places" },
);
