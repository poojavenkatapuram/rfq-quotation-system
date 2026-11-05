import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";

const {
  mockRFQCount,
  mockRFQGroupBy,
  mockQuotationCount,
  mockQuotationGroupBy,
  mockApprovalCount,
  mockAuditLogFindMany,
  mockRFQFindMany,
} = vi.hoisted(() => ({
  mockRFQCount: vi.fn(),
  mockRFQGroupBy: vi.fn(),
  mockQuotationCount: vi.fn(),
  mockQuotationGroupBy: vi.fn(),
  mockApprovalCount: vi.fn(),
  mockAuditLogFindMany: vi.fn(),
  mockRFQFindMany: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  default: {
    rFQ: {
      count: mockRFQCount,
      groupBy: mockRFQGroupBy,
      findMany: mockRFQFindMany,
    },
    quotation: {
      count: mockQuotationCount,
      groupBy: mockQuotationGroupBy,
    },
    approval: {
      count: mockApprovalCount,
    },
    auditLog: {
      findMany: mockAuditLogFindMany,
    },
  },
}));

import { getDashboardSummary } from "./dashboard.controller.js";

const createResponse = () => {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;

  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  (res.json as ReturnType<typeof vi.fn>).mockReturnValue(res);

  return res;
};

const rfqStatusCounts = [
  { status: "RECEIVED", _count: { _all: 3 } },
  { status: "ESTIMATING", _count: { _all: 4 } },
  { status: "PENDING_APPROVAL", _count: { _all: 2 } },
  { status: "QUOTATION_SENT", _count: { _all: 1 } },
  { status: "WON", _count: { _all: 2 } },
  { status: "LOST", _count: { _all: 1 } },
];

const quotationStatusCounts = [
  { status: "DRAFT", _count: { _all: 2 } },
  { status: "PENDING_APPROVAL", _count: { _all: 3 } },
  { status: "APPROVED", _count: { _all: 1 } },
  { status: "SENT", _count: { _all: 4 } },
  { status: "REJECTED", _count: { _all: 2 } },
  { status: "WON", _count: { _all: 1 } },
  { status: "LOST", _count: { _all: 1 } },
];

describe("Dashboard Controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockRFQCount.mockResolvedValue(13);
    mockRFQGroupBy.mockResolvedValue(rfqStatusCounts);
    mockQuotationCount.mockResolvedValue(14);
    mockQuotationGroupBy.mockResolvedValue(quotationStatusCounts);
    mockApprovalCount.mockResolvedValue(3);
    mockAuditLogFindMany.mockResolvedValue([
      {
        id: "audit-1",
        action: "RFQ_CREATED",
        actor: { name: "Administrator" },
      },
    ]);
    mockRFQFindMany
      .mockResolvedValueOnce([
        {
          id: "rfq-deadline-1",
          dueDate: new Date("2026-11-10"),
          customer: { name: "Company B" },
          assignedTo: { name: "Estimator One" },
          parts: [{ name: "Rear Wheel Spindle" }],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "rfq-recent-1",
          rfqNumber: "RFQ-2611-014",
          customer: { name: "Company B" },
          assignedTo: { name: "Estimator One" },
          parts: [
            {
              name: "Rear Wheel Spindle",
              materialGrade: "EN8",
            },
          ],
        },
      ]);
  });

  it("returns dashboard metrics and status counts", async () => {
    const res = createResponse();

    await getDashboardSummary({} as never, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          metrics: {
            totalRFQs: 13,
            activeRFQs: 10,
            totalQuotations: 14,
            activeQuotations: 10,
            pendingApprovals: 3,
            wonRFQs: 2,
          },
          rfqStatusCounts: {
            RECEIVED: 3,
            ESTIMATING: 4,
            PENDING_APPROVAL: 2,
            QUOTATION_SENT: 1,
            WON: 2,
            LOST: 1,
          },
        }),
      }),
    );
  });

  it("includes SENT quotations in the active quotation count", async () => {
    const res = createResponse();

    await getDashboardSummary({} as never, res);

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(response.data.metrics.activeQuotations).toBe(10);
    expect(response.data.quotationStatusCounts.SENT).toBe(4);
  });

  it("retrieves recent activity, upcoming deadlines and recent RFQs", async () => {
    const res = createResponse();

    await getDashboardSummary({} as never, res);

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 8,
        orderBy: { createdAt: "desc" },
      }),
    );

    expect(mockRFQFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          dueDate: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        }),
        take: 6,
        orderBy: { dueDate: "asc" },
      }),
    );

    expect(mockRFQFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        take: 5,
        orderBy: { createdAt: "desc" },
      }),
    );

    const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(response.data.recentActivity).toHaveLength(1);
    expect(response.data.upcomingDeadlines).toHaveLength(1);
    expect(response.data.recentRFQs).toHaveLength(1);
  });

  it("returns a server error when a database query fails", async () => {
    mockRFQCount.mockRejectedValue(new Error("Database unavailable"));

    const res = createResponse();

    await getDashboardSummary({} as never, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Unable to retrieve dashboard summary",
    });
  });
});
