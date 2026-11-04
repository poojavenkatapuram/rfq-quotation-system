import { Request, Response } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, txMock } = vi.hoisted(() => {
  const tx = {
    rFQ: { findUnique: vi.fn(), update: vi.fn() },
    costing: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    approval: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    quotation: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn(), createMany: vi.fn() },
  };

  return {
    txMock: tx,
    prismaMock: {
      $transaction: vi.fn(),
    },
  };
});

vi.mock("../lib/prisma.js", () => ({
  default: prismaMock,
}));

import { createQuotation, submitQuotation, approveQuotation, rejectQuotation, sendQuotation } from "./quotation.controller.js";

const userId = "user-123";
const rfqId = "rfq-123";
const partId = "part-123";
const costingId = "costing-123";

const validBody = {
  rfqId,
  gstPercentage: 18,
  notes: "Quotation for testing",
  parts: [
    {
      partId,
      costingId,
      annualVolume: 1000,
    },
  ],
};

const rfqFixture = {
  id: rfqId,
  rfqNumber: "RFQ-2611-014",
  customerId: "customer-123",
  status: "ESTIMATING",
  customer: { id: "customer-123", name: "Company B" },
  parts: [{ id: partId }],
};

const costingFixture = {
  id: costingId,
  partId,
  volumes: [
    {
      annualVolume: 1000,
      unitPrice: 153.47,
    },
  ],
};

const quotationFixture = {
  id: "quotation-123",
  quotationNumber: "QUO-TEST-123",
  status: "DRAFT",
  subtotal: 153470,
  gstAmount: 27624.6,
  grandTotal: 181094.6,
};

function mockResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };

  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);

  return res as unknown as Response;
}

function mockAuthenticatedRequest(
  body: unknown = validBody,
  role = "ESTIMATOR"
) {
  return {
    body,
    user: { userId, role },
  } as unknown as Request;
}

describe("createQuotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    txMock.rFQ.findUnique.mockResolvedValue(rfqFixture);
    txMock.costing.findFirst.mockResolvedValue(costingFixture);
    txMock.quotation.create.mockResolvedValue(quotationFixture);
    txMock.auditLog.create.mockResolvedValue({ id: "audit-123" });

    prismaMock.$transaction.mockImplementation(async (callback: any) => {
      return callback(txMock);
    });
  });

  it("rejects unauthenticated requests", async () => {
    const req = {
      body: validBody,
      user: undefined,
    } as unknown as Request;

    const res = mockResponse();

    await createQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects users without quotation creation permission", async () => {
    const req = mockAuthenticatedRequest(validBody, "SALES_HEAD");
    const res = mockResponse();

    await createQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid quotation input", async () => {
    const req = mockAuthenticatedRequest({
      ...validBody,
      gstPercentage: 150,
    });

    const res = mockResponse();

    await createQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the RFQ does not exist", async () => {
    txMock.rFQ.findUnique.mockResolvedValue(null);

    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(txMock.quotation.create).not.toHaveBeenCalled();
  });

  it("rejects a part that does not belong to the RFQ", async () => {
    const req = mockAuthenticatedRequest({
      ...validBody,
      parts: [
        {
          partId: "different-part",
          costingId,
          annualVolume: 1000,
        },
      ],
    });

    const res = mockResponse();

    await createQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(txMock.quotation.create).not.toHaveBeenCalled();
  });

  it("rejects when no saved costing exists for the selected volume", async () => {
    txMock.costing.findFirst.mockResolvedValue({
      ...costingFixture,
      volumes: [],
    });

    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(txMock.quotation.create).not.toHaveBeenCalled();
  });

  it("creates a quotation using the saved costing price", async () => {
    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createQuotation(req as any, res);

    expect(txMock.rFQ.findUnique).toHaveBeenCalled();
    expect(txMock.costing.findFirst).toHaveBeenCalled();
    expect(txMock.quotation.create).toHaveBeenCalledTimes(1);
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);

    const createCall = txMock.quotation.create.mock.calls[0][0];

    expect(createCall.data.rfqId).toBe(rfqId);
    expect(createCall.data.customerId).toBe("customer-123");
    expect(createCall.data.createdById).toBe(userId);
    expect(createCall.data.status).toBe("DRAFT");

    expect(createCall.data.subtotal).toBe(153470);
    expect(createCall.data.gstAmount).toBe(27624.6);
    expect(createCall.data.grandTotal).toBe(181094.6);

    expect(createCall.data.parts.create[0]).toMatchObject({
      partId,
      costingId,
      quantity: 1000,
      unitPrice: 153.47,
      totalPrice: 153470,
    });

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects duplicate parts in the same quotation", async () => {
    const req = mockAuthenticatedRequest({
      ...validBody,
      parts: [
        { partId, costingId, annualVolume: 1000 },
        { partId, costingId, annualVolume: 5000 },
      ],
    });

    const res = mockResponse();

    await createQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(txMock.quotation.create).not.toHaveBeenCalled();
  });
});

describe("submitQuotation", () => {
  const quotationId = "quotation-123";

  const draftQuotation = {
    id: quotationId,
    quotationNumber: "QUO-TEST-123",
    status: "DRAFT",
    parts: [
      {
        quantity: 1000,
        unitPrice: 100,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    txMock.quotation.findUnique.mockResolvedValue(draftQuotation);
    txMock.quotation.update.mockImplementation(async (args: any) => ({
      ...draftQuotation,
      status: args.data.status,
    }));

    txMock.user.findFirst.mockResolvedValue({
      id: "sales-head-123",
      role: "SALES_HEAD",
      isActive: true,
    });

    txMock.approval.create.mockResolvedValue({ id: "approval-123" });
    txMock.auditLog.create.mockResolvedValue({ id: "audit-123" });

    prismaMock.$transaction.mockImplementation(async (callback: any) => {
      return callback(txMock);
    });
  });

  const makeRequest = (role = "ESTIMATOR") =>
    ({
      params: { id: quotationId },
      user: { userId, role },
    }) as unknown as Request;

  it("automatically approves a quotation below ₹25 lakh", async () => {
    const req = makeRequest();
    const res = mockResponse();

    await submitQuotation(req as any, res);

    expect(txMock.user.findFirst).not.toHaveBeenCalled();
    expect(txMock.approval.create).not.toHaveBeenCalled();

    expect(txMock.quotation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: quotationId },
        data: { status: "APPROVED" },
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("automatically approves a quotation exactly at ₹25 lakh", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      ...draftQuotation,
      parts: [{ quantity: 25000, unitPrice: 100 }],
    });

    const req = makeRequest();
    const res = mockResponse();

    await submitQuotation(req as any, res);

    expect(txMock.user.findFirst).not.toHaveBeenCalled();
    expect(txMock.approval.create).not.toHaveBeenCalled();
    expect(txMock.quotation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "APPROVED" },
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("sends a quotation above ₹25 lakh for Sales Head approval", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      ...draftQuotation,
      parts: [{ quantity: 25001, unitPrice: 100 }],
    });

    const req = makeRequest();
    const res = mockResponse();

    await submitQuotation(req as any, res);

    expect(txMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: "SALES_HEAD", isActive: true },
      })
    );

    expect(txMock.approval.create).toHaveBeenCalledWith({
      data: {
        quotationId,
        approverId: "sales-head-123",
        status: "PENDING",
      },
    });

    expect(txMock.quotation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "PENDING_APPROVAL" },
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns an error when no active Sales Head exists", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      ...draftQuotation,
      parts: [{ quantity: 25001, unitPrice: 100 }],
    });

    txMock.user.findFirst.mockResolvedValue(null);

    const req = makeRequest();
    const res = mockResponse();

    await submitQuotation(req as any, res);

    expect(txMock.approval.create).not.toHaveBeenCalled();
    expect(txMock.quotation.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("rejects submission by a Sales Head", async () => {
    const req = makeRequest("SALES_HEAD");
    const res = mockResponse();

    await submitQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a quotation that is not in draft status", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      ...draftQuotation,
      status: "APPROVED",
    });

    const req = makeRequest();
    const res = mockResponse();

    await submitQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(txMock.quotation.update).not.toHaveBeenCalled();
  });
});

describe("approveQuotation", () => {
  const quotationId = "quotation-123";
  const approvalId = "approval-123";
  const salesHeadId = "sales-head-123";

  beforeEach(() => {
    vi.clearAllMocks();

    txMock.quotation.findUnique.mockResolvedValue({
      id: quotationId,
      quotationNumber: "QUO-TEST-123",
      status: "PENDING_APPROVAL",
    });

    txMock.approval.findFirst.mockResolvedValue({
      id: approvalId,
      quotationId,
      approverId: salesHeadId,
      status: "PENDING",
    });

    txMock.approval.update.mockResolvedValue({
      id: approvalId,
      status: "APPROVED",
    });

    txMock.quotation.update.mockResolvedValue({
      id: quotationId,
      status: "APPROVED",
    });

    txMock.auditLog.create.mockResolvedValue({ id: "audit-123" });

    prismaMock.$transaction.mockImplementation(async (callback: any) => {
      return callback(txMock);
    });
  });

  const makeRequest = (role = "SALES_HEAD", currentUserId = salesHeadId) =>
    ({
      params: { id: quotationId },
      user: { userId: currentUserId, role },
    }) as unknown as Request;

  it("allows the assigned Sales Head to approve a quotation", async () => {
    const req = makeRequest();
    const res = mockResponse();

    await approveQuotation(req as any, res);

    expect(txMock.approval.findFirst).toHaveBeenCalledWith({
      where: {
        quotationId,
        approverId: salesHeadId,
        status: "PENDING",
      },
    });

    expect(txMock.approval.update).toHaveBeenCalledWith({
      where: { id: approvalId },
      data: expect.objectContaining({
        status: "APPROVED",
        approvedAt: expect.any(Date),
      }),
    });

    expect(txMock.quotation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: quotationId },
        data: { status: "APPROVED" },
      })
    );

    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rejects approval attempts by an estimator", async () => {
    const req = makeRequest("ESTIMATOR", userId);
    const res = mockResponse();

    await approveQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects approval by a Sales Head who is not assigned", async () => {
    txMock.approval.findFirst.mockResolvedValue(null);

    const req = makeRequest("SALES_HEAD", "another-sales-head");
    const res = mockResponse();

    await approveQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(txMock.approval.update).not.toHaveBeenCalled();
  });

  it("rejects approval when the quotation is not pending", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      id: quotationId,
      status: "DRAFT",
    });

    const req = makeRequest();
    const res = mockResponse();

    await approveQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(txMock.approval.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the quotation does not exist", async () => {
    txMock.quotation.findUnique.mockResolvedValue(null);

    const req = makeRequest();
    const res = mockResponse();

    await approveQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("rejectQuotation", () => {
  const quotationId = "quotation-123";
  const approvalId = "approval-123";
  const salesHeadId = "sales-head-123";

  beforeEach(() => {
    vi.clearAllMocks();

    txMock.quotation.findUnique.mockResolvedValue({
      id: quotationId,
      quotationNumber: "QUO-TEST-123",
      status: "PENDING_APPROVAL",
    });

    txMock.approval.findFirst.mockResolvedValue({
      id: approvalId,
      quotationId,
      approverId: salesHeadId,
      status: "PENDING",
    });

    txMock.approval.update.mockResolvedValue({
      id: approvalId,
      status: "REJECTED",
    });

    txMock.quotation.update.mockResolvedValue({
      id: quotationId,
      status: "REJECTED",
    });

    txMock.auditLog.create.mockResolvedValue({ id: "audit-123" });

    prismaMock.$transaction.mockImplementation(async (callback: any) => {
      return callback(txMock);
    });
  });

  const makeRequest = (
    body: unknown,
    role = "SALES_HEAD",
    currentUserId = salesHeadId
  ) =>
    ({
      params: { id: quotationId },
      body,
      user: { userId: currentUserId, role },
    }) as unknown as Request;

  it("allows the assigned Sales Head to reject with a reason", async () => {
    const reason = "Material cost needs further verification";

    const req = makeRequest({ comments: reason });
    const res = mockResponse();

    await rejectQuotation(req as any, res);

    expect(txMock.approval.update).toHaveBeenCalledWith({
      where: { id: approvalId },
      data: {
        status: "REJECTED",
        comments: reason,
      },
    });

    expect(txMock.quotation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: quotationId },
        data: { status: "REJECTED" },
      })
    );

    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rejects a request without a valid rejection reason", async () => {
    const req = makeRequest({ comments: "No" });
    const res = mockResponse();

    await rejectQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects rejection attempts by an estimator", async () => {
    const req = makeRequest(
      { comments: "Please review the costing" },
      "ESTIMATOR",
      userId
    );

    const res = mockResponse();

    await rejectQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a Sales Head who is not assigned", async () => {
    txMock.approval.findFirst.mockResolvedValue(null);

    const req = makeRequest(
      { comments: "Please review the costing" },
      "SALES_HEAD",
      "another-sales-head"
    );

    const res = mockResponse();

    await rejectQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(txMock.approval.update).not.toHaveBeenCalled();
  });
});

describe("sendQuotation", () => {
  const quotationId = "quotation-123";

  beforeEach(() => {
    vi.clearAllMocks();

    txMock.quotation.findUnique.mockResolvedValue({
      id: quotationId,
      quotationNumber: "QUO-TEST-123",
      status: "APPROVED",
      rfqId: "rfq-123",
      rfq: {
        id: "rfq-123",
        status: "ESTIMATING",
      },
    });

    txMock.quotation.update.mockResolvedValue({
      id: quotationId,
      status: "SENT",
    });

    txMock.rFQ.update.mockResolvedValue({
      id: "rfq-123",
      status: "QUOTATION_SENT",
    });

    txMock.auditLog.createMany.mockResolvedValue({ count: 2 });

    prismaMock.$transaction.mockImplementation(async (callback: any) =>
      callback(txMock)
    );
  });

  it("sends an approved quotation and updates the RFQ status", async () => {
    const req = { ...mockAuthenticatedRequest({}, "ESTIMATOR"), params: { id: quotationId } };
    const res = mockResponse();

    await sendQuotation(req as any, res);

    expect(txMock.quotation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: quotationId },
        data: expect.objectContaining({ status: "SENT" }),
      })
    );

    expect(txMock.rFQ.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rfq-123" },
        data: expect.objectContaining({ status: "QUOTATION_SENT" }),
      })
    );

    expect(txMock.auditLog.createMany).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rejects sending a draft quotation", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      id: quotationId,
      status: "DRAFT",
      rfqId: "rfq-123",
      rfq: { id: "rfq-123", status: "ESTIMATING" },
    });

    const req = { ...mockAuthenticatedRequest({}, "ESTIMATOR"), params: { id: quotationId } };
    const res = mockResponse();

    await sendQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(txMock.quotation.update).not.toHaveBeenCalled();
  });

  it("rejects sending a quotation pending approval", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      id: quotationId,
      status: "PENDING_APPROVAL",
      rfqId: "rfq-123",
      rfq: { id: "rfq-123", status: "PENDING_APPROVAL" },
    });

    const req = { ...mockAuthenticatedRequest({}, "ESTIMATOR"), params: { id: quotationId } };
    const res = mockResponse();

    await sendQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(txMock.quotation.update).not.toHaveBeenCalled();
  });

  it("rejects sending by a Sales Head", async () => {
    const req = { ...mockAuthenticatedRequest({}, "SALES_HEAD"), params: { id: quotationId } };
    const res = mockResponse();

    await sendQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects sending when the RFQ is not in an eligible status", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      id: quotationId,
      status: "APPROVED",
      rfqId: "rfq-123",
      rfq: { id: "rfq-123", status: "RECEIVED" },
    });

    const req = { ...mockAuthenticatedRequest({}, "ESTIMATOR"), params: { id: quotationId } };
    const res = mockResponse();

    await sendQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(txMock.quotation.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the quotation does not exist", async () => {
    txMock.quotation.findUnique.mockResolvedValue(null);

    const req = { ...mockAuthenticatedRequest({}, "ESTIMATOR"), params: { id: quotationId } };
    const res = mockResponse();

    await sendQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(txMock.quotation.update).not.toHaveBeenCalled();
  });
});
