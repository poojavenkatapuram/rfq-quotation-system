import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    quotation: { findMany: vi.fn(), count: vi.fn() },
    costing: { findMany: vi.fn(), count: vi.fn() },
    historicalQuote: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../lib/prisma.js", () => ({
  default: prismaMock,
}));

import {
  getQuotationHistory,
  getCostingHistory,
  getImportedQuoteHistory,
} from "./history.controller.js";

function mockResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response;
}

function mockRequest(query: Record<string, unknown> = {}) {
  return { query } as unknown as Request;
}

describe("History controllers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      async (queries: Promise<unknown>[]) => Promise.all(queries)
    );
    prismaMock.quotation.findMany.mockResolvedValue([]);
    prismaMock.quotation.count.mockResolvedValue(0);
    prismaMock.costing.findMany.mockResolvedValue([]);
    prismaMock.costing.count.mockResolvedValue(0);
    prismaMock.historicalQuote.findMany.mockResolvedValue([]);
    prismaMock.historicalQuote.count.mockResolvedValue(0);
  });

  it("returns paginated quotation history", async () => {
    const records = [{ id: "quote-1", quotationNumber: "QUO-001" }];
    prismaMock.quotation.findMany.mockResolvedValue(records);
    prismaMock.quotation.count.mockResolvedValue(1);

    const res = mockResponse();
    await getQuotationHistory(mockRequest({ page: "1", limit: "10" }), res);

    expect(prismaMock.quotation.findMany).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        pagination: expect.objectContaining({ total: 1, totalPages: 1 }),
        data: records,
      })
    );
  });

  it("rejects invalid quotation history filters", async () => {
    const res = mockResponse();
    await getQuotationHistory(mockRequest({ page: "0" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.quotation.findMany).not.toHaveBeenCalled();
  });

  it("returns costing version history", async () => {
    const records = [{ id: "costing-1", version: 2 }];
    prismaMock.costing.findMany.mockResolvedValue(records);
    prismaMock.costing.count.mockResolvedValue(1);

    const res = mockResponse();
    await getCostingHistory(mockRequest({ search: "EN8" }), res);

    expect(prismaMock.costing.findMany).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: records })
    );
  });

  it("returns imported legacy quotation history", async () => {
    const records = [{ id: "legacy-1", quotationNumber: "OLD-001" }];
    prismaMock.historicalQuote.findMany.mockResolvedValue(records);
    prismaMock.historicalQuote.count.mockResolvedValue(1);

    const res = mockResponse();
    await getImportedQuoteHistory(mockRequest({ search: "Company B" }), res);

    expect(prismaMock.historicalQuote.findMany).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: records })
    );
  });

  it("returns 500 when quotation history retrieval fails", async () => {
    prismaMock.quotation.findMany.mockRejectedValue(new Error("Database error"));

    const res = mockResponse();
    await getQuotationHistory(mockRequest(), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
