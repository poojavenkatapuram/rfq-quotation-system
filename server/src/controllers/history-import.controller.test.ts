import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  historicalQuote: { findUnique: vi.fn() }, quotation: { findUnique: vi.fn() }, $transaction: vi.fn(),
  create: vi.fn(), audit: vi.fn(),
}));
vi.mock("../lib/prisma.js", () => ({ default: db }));
import { importHistoricalQuotes } from "./history-import.controller.js";
import { syntheticHistoryWorkbook } from "../fixtures/synthetic-history.fixtures.js";

const records = new Map<string, any>();
function response() { const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res); return res; }
let buffer: Buffer;
beforeEach(async () => {
  vi.clearAllMocks(); records.clear(); buffer = await syntheticHistoryWorkbook();
  db.historicalQuote.findUnique.mockImplementation(async ({ where }) => records.get(where.quotationNumber_customerName.quotationNumber));
  db.quotation.findUnique.mockResolvedValue(null); db.audit.mockResolvedValue({});
  db.$transaction.mockImplementation(async callback => {
    let pending: any;
    db.create.mockImplementation(async ({ data }) => { pending = { id: data.quotationNumber, ...data }; return pending; });
    const result = await callback({ historicalQuote: { create: db.create }, auditLog: { create: db.audit } });
    if (pending) records.set(pending.quotationNumber, pending);
    return result;
  });
});
const request = (role = "ADMIN") => ({ user: { userId: "synthetic-actor", role }, file: { buffer, originalname: "SYNTHETIC-DEMO-history-1400.xlsx" } });
describe("historical importer persistence contract (mock database, real workbook parser)", () => {
  it("imports 1400 source parts as 700 quotations and skips exact re-imports without overwrites", async () => {
    const first = response(); await importHistoricalQuotes(request() as any, first as any);
    expect(first.json.mock.calls[0][0].summary).toEqual({ totalValidQuotations: 700, imported: 700, skipped: 0, invalidRows: 0 });
    expect(records.size).toBe(700); expect([...records.values()].flatMap(record => record.parts.create)).toHaveLength(1400);
    for (const [index, record] of [...records.values()].entries()) {
      expect(record.notes).toContain("SYNTHETIC DEMO DATA"); expect(record.sourceFile).toContain("SYNTHETIC-DEMO");
      for (const part of record.parts.create) expect(part.costingSnapshot).toEqual({ source: "LEGACY_EXCEL_IMPORT", originalRows: [index * 2 + 2, index * 2 + 3] });
      expect(record.approvedSnapshot).toBeUndefined();
    }
    const before = structuredClone([...records]);
    const second = response(); await importHistoricalQuotes(request() as any, second as any);
    expect(second.json.mock.calls[0][0].summary).toEqual({ totalValidQuotations: 700, imported: 0, skipped: 700, invalidRows: 0 });
    expect([...records]).toEqual(before); expect(db.create).toHaveBeenCalledTimes(700); expect(db.audit).toHaveBeenCalledTimes(700);
  });
  it("skips colliding live quotation identifiers", async () => {
    db.quotation.findUnique.mockImplementation(async ({ where }) => where.quotationNumber === "SYNDEMO-V1-Q-0001" ? { id: "existing-live" } : null);
    const res = response(); await importHistoricalQuotes(request("ESTIMATOR") as any, res as any);
    expect(res.json.mock.calls[0][0].summary).toMatchObject({ imported: 699, skipped: 1 });
    expect(res.json.mock.calls[0][0].skipped[0].reason).toContain("live records");
    expect(records.has("SYNDEMO-V1-Q-0001")).toBe(false);
  });
  it.each(["SALES_HEAD", "PLANT_HEAD"])("blocks %s import writes", async role => {
    const res = response(); await importHistoricalQuotes(request(role) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    const res = response(); await importHistoricalQuotes({ ...request(), user: undefined } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(401); expect(db.$transaction).not.toHaveBeenCalled();
  });
});
