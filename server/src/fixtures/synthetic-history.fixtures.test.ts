import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { syntheticHistoryRows, syntheticHistoryWorkbook, SYNTHETIC_HISTORY_HEADERS } from "./synthetic-history.fixtures.js";
import { parseHistoricalQuotes } from "../services/history-import.service.js";

let buffer: Buffer;
beforeAll(async () => { buffer = await syntheticHistoryWorkbook(); });
describe("synthetic 1400-row historical workbook", () => {
  it("reproduces the delivered workbook byte for byte", async () => {
    const delivered = await readFile(path.resolve(__dirname, "../../../demo-data/SYNTHETIC-DEMO-history-1400.xlsx"));
    expect(buffer.equals(delivered)).toBe(true);
    expect((await syntheticHistoryWorkbook()).equals(buffer)).toBe(true);
    expect(syntheticHistoryRows()).toEqual(syntheticHistoryRows());
  });
  it("has exactly 1400 source lines, 700 consistent groups, and 1400 distinct part IDs", async () => {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any);
    expect(workbook.worksheets[0]!.rowCount).toBe(1401);
    expect(workbook.worksheets[0]!.getRow(1).values).toEqual([undefined, ...SYNTHETIC_HISTORY_HEADERS]);
    expect(workbook.worksheets[1]!.name).toContain("SYNTHETIC");
    const parsed = await parseHistoricalQuotes(buffer);
    expect(parsed.errors).toEqual([]); expect(parsed.records).toHaveLength(700);
    const sources = parsed.records.flatMap(record => record.sourceRows);
    expect(sources).toEqual(Array.from({ length: 1400 }, (_, index) => index + 2));
    expect(new Set(parsed.records.flatMap(record => record.parts.map(part => part.partNumber))).size).toBe(1400);
    for (const record of parsed.records) {
      expect(record.parts).toHaveLength(2); expect(record.status).toBe("SYNTHETIC_DEMO");
      expect(record.customerName).toMatch(/^SYNTHETIC DEMO Customer \d{2}$/);
      expect(record.notes).toContain("SYNTHETIC DEMO DATA; INR");
      expect(record.quoteDate!.getTime()).toBeGreaterThanOrEqual(Date.UTC(2022, 0, 1));
      expect(record.quoteDate!.getTime()).toBeLessThan(Date.UTC(2026, 0, 1));
      expect(record.validUntil!.getTime() - record.quoteDate!.getTime()).toBe(30 * 86400000);
      const subtotal = record.parts.reduce((sum, part) => {
        expect(part.partName).toContain("SYNTHETIC DEMO");
        expect(["EN8", "C45", "20MnCr5"]).toContain(part.materialGrade);
        expect(part.quantity).toBeGreaterThanOrEqual(3000); expect(part.quantity).toBeLessThanOrEqual(120000);
        expect(part.unitPrice).toBeGreaterThan(50); expect(part.unitPrice).toBeLessThan(1500);
        expect(part.totalPrice).toBe(Number((part.unitPrice! * part.quantity!).toFixed(2)));
        return sum + part.totalPrice!;
      }, 0);
      expect(record.subtotal).toBe(Number(subtotal.toFixed(2)));
      expect(record.gstAmount).toBe(Number((subtotal * 0.18).toFixed(2)));
      expect(record.grandTotal).toBe(Number((subtotal + record.gstAmount!).toFixed(2)));
    }
  });
  it("reports precise invalid rows and inconsistent group headers without discarding valid lines", async () => {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0]!;
    sheet.getCell("J2").value = 0; sheet.getCell("D4").value = "not-a-date";
    sheet.getCell("N6").value = 18.12345; sheet.getCell("M9").value = 1;
    const parsed = await parseHistoricalQuotes(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(parsed.errors.map(error => error.row)).toEqual([2, 4, 6, 9]);
    expect(parsed.errors[0]!.message).toContain("quantity"); expect(parsed.errors[1]!.message).toContain("Invalid quote date");
    expect(parsed.errors[2]!.message).toContain("4 decimal places"); expect(parsed.errors[3]!.message).toContain("Quotation-level values differ");
    expect(parsed.records.flatMap(record => record.sourceRows)).toHaveLength(1396);
  });
  it("keeps Excel native, ISO and numeric serial dates consistent", async () => {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0]!; const expected = syntheticHistoryRows()[0]![3] as Date;
    sheet.getCell("D2").value = expected.toISOString(); sheet.getCell("D3").value = (expected.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
    sheet.getCell("D3").numFmt = "0";
    const parsed = await parseHistoricalQuotes(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(parsed.errors).toEqual([]); expect(parsed.records[0]!.quoteDate).toEqual(expected);
  });
  it("documents existing importer behavior: repeated identical part lines are retained within one workbook", async () => {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0]!; sheet.addRow(sheet.getRow(2).values);
    const parsed = await parseHistoricalQuotes(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(parsed.errors).toEqual([]); expect(parsed.records).toHaveLength(700);
    expect(parsed.records[0]!.parts).toHaveLength(3); expect(parsed.records[0]!.sourceRows).toEqual([2, 3, 1402]);
  });
});
