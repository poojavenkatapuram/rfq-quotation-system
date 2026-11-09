import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ historicalQuote: { findMany: vi.fn(), count: vi.fn() }, $transaction: vi.fn() }));
vi.mock("../lib/prisma.js", () => ({ default: db }));
import { getImportedQuoteHistory } from "./history.controller.js";
beforeEach(() => {
  vi.clearAllMocks(); db.historicalQuote.findMany.mockResolvedValue([]); db.historicalQuote.count.mockResolvedValue(700);
  db.$transaction.mockImplementation(async queries => Promise.all(queries));
});
function response() { const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res); return res; }
describe("synthetic imported-history search query contract", () => {
  it.each(["SYNDEMO-V1-Q-0001", "SYNDEMO-V1-RFQ-0001", "SYNTHETIC DEMO Customer 01", "SYNDEMO-V1-SHAFT-0001", "Transmission shaft", "20MnCr5"])("searches supported fields case-insensitively for %s", async search => {
    const res = response(); await getImportedQuoteHistory({ query: { search } } as any, res as any);
    const clause = { contains: search, mode: "insensitive" };
    expect(db.historicalQuote.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [
      { quotationNumber: clause }, { rfqNumber: clause }, { customerName: clause },
      { parts: { some: { OR: [{ partNumber: clause }, { partName: clause }, { materialGrade: clause }] } } },
    ] }, include: { parts: true } }));
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("paginates 700 quotation groups rather than 1400 source part lines", async () => {
    const res = response(); await getImportedQuoteHistory({ query: { page: "2", limit: "100" } } as any, res as any);
    expect(db.historicalQuote.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, take: 100 }));
    expect(res.json.mock.calls[0][0].pagination).toEqual({ page: 2, limit: 100, total: 700, totalPages: 7 });
  });
});
