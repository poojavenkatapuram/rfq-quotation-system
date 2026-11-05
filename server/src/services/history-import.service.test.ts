import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseHistoricalQuotes } from "./history-import.service.js";

async function makeWorkbook(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Quotes");
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("parseHistoricalQuotes", () => {
  it("groups multiple parts belonging to one quotation", async () => {
    const buffer = await makeWorkbook([
      ["Quotation Number", "Customer Name", "Part Name", "Quantity"],
      ["OLD-001", "Company B", "Spindle", 1000],
      ["OLD-001", "Company B", "Gear", 500],
    ]);

    const result = await parseHistoricalQuotes(buffer);

    expect(result.errors).toHaveLength(0);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].parts).toHaveLength(2);
    expect(result.records[0].sourceRows).toEqual([2, 3]);
  });
});

  it("rejects a workbook with missing required columns", async () => {
    const buffer = await makeWorkbook([
      ["Quotation Number", "Part Name"],
      ["OLD-001", "Spindle"],
    ]);

    await expect(parseHistoricalQuotes(buffer)).rejects.toThrow(
      "Missing required columns"
    );
  });

  it("reports invalid quantities while preserving valid quotations", async () => {
    const buffer = await makeWorkbook([
      ["Quotation Number", "Customer Name", "Part Name", "Quantity"],
      ["OLD-001", "Company B", "Spindle", "invalid"],
      ["OLD-002", "Company C", "Gear", 500],
    ]);

    const result = await parseHistoricalQuotes(buffer);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].quotationNumber).toBe("OLD-002");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(2);
  });

  it("detects inconsistent quotation-level totals", async () => {
    const buffer = await makeWorkbook([
      ["Quotation Number", "Customer Name", "Part Name", "Grand Total"],
      ["OLD-001", "Company B", "Spindle", 1000],
      ["OLD-001", "Company B", "Gear", 2000],
    ]);

    const result = await parseHistoricalQuotes(buffer);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].parts).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(3);
  });

describe("Excel date handling", () => {
  it("converts numeric Excel serial dates into JavaScript dates", async () => {
    const buffer = await makeWorkbook([
      ["Quotation Number", "Customer Name", "Part Name", "Quote Date"],
      ["OLD-DATE-001", "Company B", "Spindle", 46023],
    ]);

    const result = await parseHistoricalQuotes(buffer);

    expect(result.errors).toHaveLength(0);
    expect(result.records[0].quoteDate).toBeInstanceOf(Date);
    expect(result.records[0].quoteDate?.toISOString()).toBe(
      new Date(Date.UTC(1899, 11, 30) + 46023 * 86400000).toISOString()
    );
  });
});
