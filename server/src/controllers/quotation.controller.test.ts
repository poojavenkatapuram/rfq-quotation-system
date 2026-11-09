import { Prisma } from "@prisma/client";
import { isApprovedQuotationSnapshot } from "../services/quotation-snapshot.service.js";
import { Request, Response } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, txMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    routing: { findUnique: vi.fn() },
    companyProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    rFQ: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    costing: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    approval: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    quotation: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn(), createMany: vi.fn() },
  };

  return {
    txMock: tx,
    prismaMock: {
      quotation: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("../lib/prisma.js", () => ({
  default: prismaMock,
}));

import { createQuotation, submitQuotation, approveQuotation, rejectQuotation, sendQuotation, downloadQuotationPdf } from "./quotation.controller.js";

const userId = "user-123";
const rfqId = "rfq-123";
const partId = "part-123";
const costingId = "costing-123";

const validBody = {
  rfqId,
  gstPercentage: 18,
  notes: "Quotation for testing",
  paymentTerms: "30 days from invoice",
  deliveryTerms: "Delivered to Pune within 4 weeks",
  commercialTerms: "Packaging included",
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
  updatedAt: new Date("2026-11-09"),
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

const snapshotReadyQuotation = {
  rfqId,
  id: "quotation-123",
  quotationNumber: "QUO-TEST-123",
  createdAt: new Date("2026-11-05T00:00:00.000Z"),
  validUntil: new Date("2026-12-05T00:00:00.000Z"),
  paymentTerms: "30 days from invoice",
  deliveryTerms: "Delivered to Pune within 4 weeks",
  commercialTerms: "Packaging included",
  notes: "Approved commercial note",
  subtotal: 100000,
  gstPercentage: 18,
  gstAmount: 18000,
  grandTotal: 118000,
  customer: {
    name: "Company B",
    address: "Pune",
    email: "customer@example.com",
    phone: "1234567890",
    gstNumber: "TESTGST123",
  },
  rfq: { rfqNumber: "RFQ-2611-014" },
  parts: [{
    partId,
    quantity: 1000,
    unitPrice: 100,
    totalPrice: 100000,
    part: {
      partNumber: "PART-001",
      name: "Test spindle",
      description: "Rear wheel spindle",
      materialGrade: "EN8",
      revision: "R2",
    },
    costing: {
      routingRevision: 1,
      version: 3,
      totalCost: 74,
      materialRateId: "material-rate-123",
      materialRatePerKgSnapshot: 85,
      grossWeightKg: 0.47,
      scrapPercentage: 5,
      overheadAmount: 5,
      packingAmount: 2,
      freightAmount: 3,
      profitMargin: 20,
      assumptions: "Saved rates at quotation creation",
      components: [
        { type: "MATERIAL", amount: 40 },
        {
          type: "MACHINING", name: "Turning", amount: 20,
          machineRateId: "machine-rate-123", cycleTimeMin: 2,
          ratePerHourSnapshot: 600,
        },
        {
          type: "SETUP", name: "Turning setup", amount: 600,
          machineRateId: "machine-rate-123", setupTimeMinSnapshot: 60,
          ratePerHourSnapshot: 600,
        },
        { type: "SCRAP", amount: 4 },
        { type: "OVERHEAD", amount: 5 },
        { type: "PACKING", amount: 2 },
        { type: "FREIGHT", amount: 3 },
      ],
    },
  }],
};

const approvedSnapshotFixture = {
  schemaVersion: 1,
  quotationNumber: "QUO-TEST-123",
  quotationDate: "2026-11-05T00:00:00.000Z",
  validUntil: "2026-12-05T00:00:00.000Z",
  company: {
    name: "Test Manufacturer",
    address: "Chakan, Pune",
    email: "sales@example.com",
    phone: "020-12345678",
    gstNumber: "27TEST1234A1Z5",
  },
  customer: snapshotReadyQuotation.customer,
  rfqNumber: "RFQ-2611-014",
  terms: {
    paymentTerms: "30 days from invoice",
    deliveryTerms: "Delivered to Pune within 4 weeks",
    commercialTerms: "Packaging included",
    notes: "Approved commercial note",
  },
  parts: [{
    partNumber: "PART-001",
    partName: "Test spindle",
    description: "Rear wheel spindle",
    materialGrade: "EN8",
    revision: "R2",
    annualVolume: 1000,
    unitSellingPrice: 100,
    lineTotal: 100000,
    costBreakdown: {
      materialCost: 40,
      machiningCost: 20,
      setupCostPerPart: 0.6,
      scrapCost: 4,
      overheadCost: 5,
      packingCost: 2,
      freightCost: 3,
      unitCost: 74.6,
    },
    profitMarginPercentage: 20,
    costingAssumptions: "Saved rates at quotation creation",
    costingVersion: 3,
  }],
  totals: {
    subtotal: 100000,
    gstPercentage: 18,
    gstAmount: 18000,
    grandTotal: 118000,
  },
  approval: {
    status: "APPROVED",
    approvalMode: "SALES_HEAD",
    approvedAt: "2026-11-06T00:00:00.000Z",
    approverName: "Sales Head",
    approverRole: "SALES_HEAD",
  },
};

function mockResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
    send: vi.fn(),
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

beforeEach(() => {
  txMock.rFQ.findUnique.mockResolvedValue(rfqFixture);
  txMock.rFQ.updateMany.mockResolvedValue({ count: 1 });
  txMock.quotation.findMany.mockImplementation(async () => {
    const latest = txMock.quotation.updateMany.mock.calls.at(-1)?.[0]?.data?.status;
    return [{ status: latest ?? "DRAFT" }];
  });
});

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

  it("advances a received RFQ when creating a draft quotation", async () => {
    txMock.rFQ.findUnique.mockResolvedValue({ ...rfqFixture, status: "RECEIVED" });
    const res = mockResponse(); await createQuotation(mockAuthenticatedRequest(validBody) as any, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(txMock.rFQ.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ESTIMATING" }) }));
  });

  it.each([18.12345, 0.00001, 99.99999])("rejects unsupported GST precision %s before any writes", async gstPercentage => {
    const res = mockResponse(); await createQuotation(mockAuthenticatedRequest({ ...validBody, gstPercentage }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400); expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.quotation.create).not.toHaveBeenCalled();
    expect(JSON.stringify((res.json as any).mock.calls)).toContain("at most 4 decimal places");
  });
  it.each([0, 18.1234, 0.0001, 100])("creates quotations with supported GST %s using unchanged rounding", async gstPercentage => {
    const res = mockResponse(); await createQuotation(mockAuthenticatedRequest({ ...validBody, gstPercentage }) as any, res);
    expect(res.status).toHaveBeenCalledWith(201);
    const data = txMock.quotation.create.mock.calls[0][0].data;
    expect(data.gstPercentage).toBe(gstPercentage);
    expect(new Prisma.Decimal(data.gstPercentage).toDecimalPlaces(4).toNumber()).toBe(gstPercentage);
    expect(data.gstAmount).toBe(Number((data.subtotal * gstPercentage / 100).toFixed(2)));
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

    expect(createCall.data.paymentTerms).toBe("30 days from invoice");
    expect(createCall.data.deliveryTerms).toBe("Delivered to Pune within 4 weeks");
    expect(createCall.data.commercialTerms).toBe("Packaging included");
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

  it("reconciles paise-rounded line, GST, and grand totals from the saved unit price", async () => {
    txMock.costing.findFirst.mockResolvedValue({
      ...costingFixture,
      volumes: [{ annualVolume: 333333, unitPrice: 154.21 }],
    });

    const req = mockAuthenticatedRequest({
      ...validBody,
      parts: [{ partId, costingId, annualVolume: 333333 }],
    });
    const res = mockResponse();

    await createQuotation(req as any, res);

    const createCall = txMock.quotation.create.mock.calls[0][0];

    expect(createCall.data.parts.create[0]).toMatchObject({
      quantity: 333333,
      unitPrice: 154.21,
      totalPrice: 51403281.93,
    });
    expect(createCall.data.subtotal).toBe(51403281.93);
    expect(createCall.data.gstAmount).toBe(9252590.75);
    expect(createCall.data.grandTotal).toBe(60655872.68);
    expect(createCall.data.grandTotal).toBe(
      createCall.data.subtotal + createCall.data.gstAmount
    );
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
    ...snapshotReadyQuotation,
    status: "DRAFT",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    txMock.routing.findUnique.mockResolvedValue({ revision: 1, technicalReviews: [{ id: "technical-review-1", routingRevision: 1, status: "APPROVED" }] });

    txMock.quotation.findUnique.mockResolvedValue(draftQuotation);
    txMock.quotation.updateMany.mockResolvedValue({ count: 1 });

    txMock.user.findFirst.mockResolvedValue({
      id: "sales-head-123",
      role: "SALES_HEAD",
      isActive: true,
    });

    txMock.approval.create.mockResolvedValue({ id: "approval-123" });
    txMock.approval.updateMany.mockResolvedValue({ count: 1 });
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

  it("updates the RFQ when submission needs commercial approval", async () => {
    txMock.quotation.findUnique.mockResolvedValue({ ...draftQuotation, parts: [{ ...draftQuotation.parts[0], quantity: 25001, totalPrice: 2500100 }] });
    const res = mockResponse(); await submitQuotation(makeRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(txMock.rFQ.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING_APPROVAL" }) }));
  });
  it("blocks submission after the RFQ has closed", async () => {
    txMock.rFQ.findUnique.mockResolvedValue({ ...rfqFixture, status: "LOST" });
    const res = mockResponse(); await submitQuotation(makeRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(409); expect(txMock.quotation.updateMany).not.toHaveBeenCalled();
  });

  it.each([18.1234, 0.0001])("automatically approves and reconciles a stored four-decimal GST rate %s", async rate => {
    const gstAmount = Number((100000 * rate / 100).toFixed(2));
    txMock.quotation.findUnique.mockResolvedValue({ ...draftQuotation, gstPercentage: new Prisma.Decimal(rate), gstAmount, grandTotal: 100000 + gstAmount });
    const res = mockResponse(); await submitQuotation(makeRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const snapshot = txMock.quotation.updateMany.mock.calls[0][0].data.approvedSnapshot;
    expect(snapshot.totals.gstPercentage).toBe(rate); expect(isApprovedQuotationSnapshot(snapshot)).toBe(true);
  });

  it("automatically approves a quotation below ₹25 lakh", async () => {
    const req = makeRequest();
    const res = mockResponse();

    await submitQuotation(req as any, res);

    expect(txMock.user.findFirst).not.toHaveBeenCalled();
    expect(txMock.approval.create).not.toHaveBeenCalled();

    expect(txMock.quotation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: quotationId, status: "DRAFT" },
        data: expect.objectContaining({
          status: "APPROVED",
          approvedAt: expect.any(Date),
          approvedSnapshot: expect.objectContaining({
            parts: expect.any(Array),
          }),
        }),
      })
    );

    expect(txMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "QUOTATION_SUBMITTED", details: expect.objectContaining({ technicalReviews: [{ partId, routingRevision: 1, reviewId: "technical-review-1" }] }) }) }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("automatically approves a quotation exactly at ₹25 lakh", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      ...draftQuotation,
      subtotal: 2500000,
      gstAmount: 450000,
      grandTotal: 2950000,
      parts: [{
        ...draftQuotation.parts[0],
        quantity: 25000,
        totalPrice: 2500000,
      }],
    });

    const req = makeRequest();
    const res = mockResponse();

    await submitQuotation(req as any, res);

    expect(txMock.user.findFirst).not.toHaveBeenCalled();
    expect(txMock.approval.create).not.toHaveBeenCalled();
    expect(txMock.quotation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: quotationId, status: "DRAFT" },
        data: expect.objectContaining({
          status: "APPROVED",
          approvedSnapshot: expect.any(Object),
        }),
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("sends a quotation above ₹25 lakh for Sales Head approval", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      ...draftQuotation,
      parts: [{
        ...draftQuotation.parts[0],
        quantity: 25001,
        totalPrice: 2500100,
      }],
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

    expect(txMock.quotation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: quotationId, status: "DRAFT" },
        data: { status: "PENDING_APPROVAL" },
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns an error when no active Sales Head exists", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      ...draftQuotation,
      parts: [{ ...draftQuotation.parts[0], quantity: 25001, unitPrice: 100 }],
    });

    txMock.user.findFirst.mockResolvedValue(null);

    const req = makeRequest();
    const res = mockResponse();

    await submitQuotation(req as any, res);

    expect(txMock.approval.create).not.toHaveBeenCalled();
    expect(txMock.quotation.updateMany).not.toHaveBeenCalled();
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

    expect(res.status).toHaveBeenCalledWith(409);
    expect(txMock.quotation.updateMany).not.toHaveBeenCalled();
  });

  it("returns a conflict when a competing submission already changed the quotation", async () => {
    txMock.quotation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const firstResponse = mockResponse();
    await submitQuotation(makeRequest() as any, firstResponse);

    const secondResponse = mockResponse();
    await submitQuotation(makeRequest() as any, secondResponse);

    expect(firstResponse.status).toHaveBeenCalledWith(200);
    expect(secondResponse.status).toHaveBeenCalledWith(409);
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["draft", 1, []],
    ["pending", 1, [{ routingRevision: 1, status: "PENDING" }]],
    ["rejected", 1, [{ routingRevision: 1, status: "REJECTED" }]],
    ["stale approval", 2, [{ routingRevision: 1, status: "APPROVED" }]],
  ])("blocks commercial submission with %s technical review", async (_label, revision, reviews) => {
    txMock.routing.findUnique.mockResolvedValue({ revision, technicalReviews: reviews.filter(review => review.status === "APPROVED") });
    const res = mockResponse();
    await submitQuotation(makeRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(txMock.approval.create).not.toHaveBeenCalled();
    expect(txMock.quotation.updateMany).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });
  it("blocks a legacy costing without altering it", async () => {
    const draft = structuredClone(draftQuotation);
    draft.parts[0].costing.routingRevision = null as unknown as number;
    txMock.quotation.findUnique.mockResolvedValue(draft);
    const res = mockResponse();
    await submitQuotation(makeRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(txMock.quotation.updateMany).not.toHaveBeenCalled();
  });

  it("captures database company details in an automatic approval without changing financial values", async () => {
    const company = { name: "Configured Manufacturer", address: "Registered office, Pune", email: "quotes@example.com", phone: "+91 9876543210", gstNumber: "27ABCDE1234F1Z5" };
    txMock.companyProfile.findUnique.mockResolvedValueOnce({ id: 1, ...company, version: 3, updatedAt: new Date("2026-11-09") });
    const res = mockResponse();
    await submitQuotation(makeRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(txMock.quotation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvedSnapshot: expect.objectContaining({ schemaVersion: 2, company, totals: { subtotal: 100000, gstPercentage: 18, gstAmount: 18000, grandTotal: 118000 } }) }) }));
    expect(txMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ companyProfileVersion: 3, companyDetailsSource: "database" }) }) }));
  });
  it("does not freeze company details early when Sales Head approval is still pending", async () => {
    txMock.quotation.findUnique.mockResolvedValue({ ...draftQuotation, parts: [{ ...draftQuotation.parts[0], quantity: 25001, totalPrice: 2500100 }] });
    const res = mockResponse(); await submitQuotation(makeRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(txMock.companyProfile.findUnique).not.toHaveBeenCalled();
    expect(txMock.quotation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "PENDING_APPROVAL" } }));
  });

});

describe("approveQuotation", () => {
  const quotationId = "quotation-123";
  const approvalId = "approval-123";
  const salesHeadId = "sales-head-123";

  beforeEach(() => {
    vi.clearAllMocks();

    txMock.quotation.findUnique.mockResolvedValue({
      ...snapshotReadyQuotation,
      id: quotationId,
      status: "PENDING_APPROVAL",
    });

    txMock.approval.findFirst.mockResolvedValue({
      id: approvalId,
      quotationId,
      approverId: salesHeadId,
      status: "PENDING",
      approver: {
        name: "Sales Head",
        role: "SALES_HEAD",
      },
    });

    txMock.approval.updateMany.mockResolvedValue({ count: 1 });
    txMock.quotation.updateMany.mockResolvedValue({ count: 1 });
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

  it.each([18.1234, 0.0001])("Sales Head approval reconciles a stored four-decimal GST rate %s", async rate => {
    const gstAmount = Number((100000 * rate / 100).toFixed(2));
    txMock.quotation.findUnique.mockResolvedValue({ ...snapshotReadyQuotation, status: "PENDING_APPROVAL", gstPercentage: new Prisma.Decimal(rate), gstAmount, grandTotal: 100000 + gstAmount });
    const res = mockResponse(); await approveQuotation(makeRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const snapshot = txMock.quotation.updateMany.mock.calls[0][0].data.approvedSnapshot;
    expect(snapshot.totals.gstPercentage).toBe(rate); expect(isApprovedQuotationSnapshot(snapshot)).toBe(true);
  });

  it("allows the assigned Sales Head to approve a quotation", async () => {
    const req = makeRequest();
    const res = mockResponse();

    await approveQuotation(req as any, res);

    expect(txMock.approval.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          quotationId,
          approverId: salesHeadId,
          status: "PENDING",
        },
      }),
    );

    expect(txMock.approval.updateMany).toHaveBeenCalledWith({
      where: {
        id: approvalId,
        quotationId,
        approverId: salesHeadId,
        status: "PENDING",
      },
      data: expect.objectContaining({
        status: "APPROVED",
        approvedAt: expect.any(Date),
      }),
    });

    expect(txMock.quotation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: quotationId, status: "PENDING_APPROVAL" },
        data: expect.objectContaining({
          status: "APPROVED",
          approvedAt: expect.any(Date),
          approvedSnapshot: expect.objectContaining({
            approval: expect.objectContaining({
              approverName: "Sales Head",
            }),
          }),
        }),
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
    expect(txMock.approval.updateMany).not.toHaveBeenCalled();
  });

  it("returns a conflict when the assigned approval was already processed", async () => {
    txMock.approval.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: approvalId, status: "APPROVED" });

    const res = mockResponse();
    await approveQuotation(makeRequest() as any, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(txMock.approval.updateMany).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects approval when the quotation is not pending", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      id: quotationId,
      status: "DRAFT",
    });

    const req = makeRequest();
    const res = mockResponse();

    await approveQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(txMock.approval.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the quotation does not exist", async () => {
    txMock.quotation.findUnique.mockResolvedValue(null);

    const req = makeRequest();
    const res = mockResponse();

    await approveQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("allows only one of competing approval requests to record an approval", async () => {
    txMock.approval.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const firstResponse = mockResponse();
    await approveQuotation(makeRequest() as any, firstResponse);

    const secondResponse = mockResponse();
    await approveQuotation(makeRequest() as any, secondResponse);

    expect(firstResponse.status).toHaveBeenCalledWith(200);
    expect(secondResponse.status).toHaveBeenCalledWith(409);
    expect(txMock.quotation.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("prevents an approval and rejection race from recording contradictory transitions", async () => {
    txMock.approval.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const approvalResponse = mockResponse();
    await approveQuotation(makeRequest() as any, approvalResponse);

    const rejectionRequest = {
      ...makeRequest(),
      body: { comments: "Rejecting after a competing approval" },
    };
    const rejectionResponse = mockResponse();
    await rejectQuotation(rejectionRequest as any, rejectionResponse);

    expect(approvalResponse.status).toHaveBeenCalledWith(200);
    expect(rejectionResponse.status).toHaveBeenCalledWith(409);
    expect(txMock.quotation.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("rolls back the approval transition when the transactional audit write fails", async () => {
    const state = {
      quotationStatus: "PENDING_APPROVAL",
      approvalStatus: "PENDING",
      approvedSnapshot: null as unknown,
    };
    txMock.approval.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (state.approvalStatus !== where.status) return { count: 0 };
      state.approvalStatus = data.status;
      return { count: 1 };
    });
    txMock.quotation.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (state.quotationStatus !== where.status) return { count: 0 };
      state.quotationStatus = data.status;
      state.approvedSnapshot = data.approvedSnapshot;
      return { count: 1 };
    });
    txMock.auditLog.create.mockRejectedValue(new Error("Audit storage unavailable"));
    prismaMock.$transaction.mockImplementation(async (callback: any) => {
      const before = { ...state };
      try {
        return await callback(txMock);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    });

    const res = mockResponse();
    await approveQuotation(makeRequest() as any, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(state).toEqual({
      quotationStatus: "PENDING_APPROVAL",
      approvalStatus: "PENDING",
      approvedSnapshot: null,
    });
  });
  it.each(["PLANT_HEAD", "ADMIN"])("does not treat %s technical authority as commercial approval authority", async role => {
    const res = mockResponse();
    await approveQuotation(makeRequest(role) as any, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(txMock.approval.updateMany).not.toHaveBeenCalled();
  });

  it("captures current database company details at Sales Head approval time", async () => {
    const company = { name: "Company Updated Since Submission", address: "Registered office, Pune", email: null, phone: null, gstNumber: null };
    txMock.companyProfile.findUnique.mockResolvedValueOnce({ id: 1, ...company, version: 4, updatedAt: new Date("2026-11-09") });
    const res = mockResponse(); await approveQuotation(makeRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(txMock.quotation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvedSnapshot: expect.objectContaining({ company, schemaVersion: 2, totals: { subtotal: 100000, gstPercentage: 18, gstAmount: 18000, grandTotal: 118000 } }) }) }));
    expect(txMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ companyProfileVersion: 4, companyDetailsSource: "database" }) }) }));
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
      rfqId,
      quotationNumber: "QUO-TEST-123",
      status: "PENDING_APPROVAL",
    });

    txMock.approval.findFirst.mockResolvedValue({
      id: approvalId,
      quotationId,
      approverId: salesHeadId,
      status: "PENDING",
    });

    txMock.approval.updateMany.mockResolvedValue({ count: 1 });
    txMock.quotation.updateMany.mockResolvedValue({ count: 1 });
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

  it.each([["REJECTED", "ESTIMATING"], ["PENDING_APPROVAL", "PENDING_APPROVAL"]])("rejection keeps parent consistent with other quote status %s", async (otherStatus, expectedStatus) => {
    txMock.rFQ.findUnique.mockResolvedValue({ ...rfqFixture, status: "PENDING_APPROVAL" });
    txMock.quotation.findMany.mockResolvedValue([{ status: "REJECTED" }, { status: otherStatus }]);
    const res = mockResponse(); await rejectQuotation(makeRequest({ comments: "Please review costs" }) as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(txMock.rFQ.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: expectedStatus }) }));
  });

  it("allows the assigned Sales Head to reject with a reason", async () => {
    const reason = "Material cost needs further verification";

    const req = makeRequest({ comments: reason });
    const res = mockResponse();

    await rejectQuotation(req as any, res);

    expect(txMock.approval.updateMany).toHaveBeenCalledWith({
      where: {
        id: approvalId,
        quotationId,
        approverId: salesHeadId,
        status: "PENDING",
      },
      data: {
        status: "REJECTED",
        comments: reason,
      },
    });

    expect(txMock.quotation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: quotationId, status: "PENDING_APPROVAL" },
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
    expect(txMock.approval.updateMany).not.toHaveBeenCalled();
  });
});

describe("sendQuotation", () => {
  const quotationId = "quotation-123";

  beforeEach(() => {
    vi.clearAllMocks();
    txMock.routing.findUnique.mockResolvedValue({ revision: 1, technicalReviews: [{ id: "technical-review-1", routingRevision: 1, status: "APPROVED" }] });

    txMock.quotation.findUnique.mockResolvedValue({
      id: quotationId,
      quotationNumber: "QUO-TEST-123",
      status: "APPROVED",
      approvedSnapshot: approvedSnapshotFixture,
      parts: snapshotReadyQuotation.parts,
      rfqId: "rfq-123",
      rfq: {
        id: "rfq-123",
        status: "ESTIMATING",
      },
    });

    txMock.quotation.updateMany.mockResolvedValue({ count: 1 });

    txMock.rFQ.update.mockResolvedValue({
      id: "rfq-123",
      status: "QUOTATION_SENT",
    });

    txMock.auditLog.createMany.mockResolvedValue({ count: 2 });

    prismaMock.$transaction.mockImplementation(async (callback: any) =>
      callback(txMock)
    );
  });

  it("reconciles a legacy received parent only through an approved send", async () => {
    txMock.rFQ.findUnique.mockResolvedValue({ ...rfqFixture, status: "RECEIVED" });
    const res = mockResponse(); await sendQuotation({ ...mockAuthenticatedRequest({}, "SALES_HEAD"), params: { id: quotationId } } as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(txMock.rFQ.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "RECEIVED" }), data: expect.objectContaining({ status: "QUOTATION_SENT" }) }));
  });
  it("does not send successfully after an RFQ compare-and-set conflict", async () => {
    txMock.rFQ.updateMany.mockResolvedValue({ count: 0 });
    const res = mockResponse(); await sendQuotation({ ...mockAuthenticatedRequest({}, "SALES_HEAD"), params: { id: quotationId } } as any, res);
    expect(res.status).toHaveBeenCalledWith(409); expect(txMock.auditLog.createMany).not.toHaveBeenCalled();
  });

  it("sends an approved quotation and updates the RFQ status", async () => {
    const req = { ...mockAuthenticatedRequest({}, "SALES_HEAD"), params: { id: quotationId } };
    const res = mockResponse();

    await sendQuotation(req as any, res);

    expect(txMock.quotation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: quotationId, status: "APPROVED" },
        data: expect.objectContaining({ status: "SENT" }),
      })
    );

    expect(txMock.rFQ.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "rfq-123", status: "ESTIMATING", updatedAt: rfqFixture.updatedAt }),
        data: expect.objectContaining({ status: "QUOTATION_SENT" }),
      })
    );

    expect(txMock.auditLog.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            action: "QUOTATION_SENT",
            details: expect.objectContaining({
              deliveryMethod: "INTERNAL_STATUS_ONLY",
              externalMessageSent: false,
            }),
          }),
        ]),
      }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Quotation marked as sent internally; no external message was sent",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("marks a quotation sent only once when duplicate send requests compete", async () => {
    txMock.quotation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const req = { ...mockAuthenticatedRequest({}, "SALES_HEAD"), params: { id: quotationId } };

    const firstResponse = mockResponse();
    await sendQuotation(req as any, firstResponse);
    const secondResponse = mockResponse();
    await sendQuotation(req as any, secondResponse);

    expect(firstResponse.status).toHaveBeenCalledWith(200);
    expect(secondResponse.status).toHaveBeenCalledWith(409);
    expect(txMock.rFQ.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.auditLog.createMany).toHaveBeenCalledTimes(1);
  });

  it("rejects sending an approved quotation without an immutable snapshot", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      id: quotationId,
      quotationNumber: "QUO-TEST-123",
      status: "APPROVED",
      approvedSnapshot: null,
      rfqId: "rfq-123",
      rfq: { id: "rfq-123", status: "ESTIMATING" },
    });

    const req = { ...mockAuthenticatedRequest({}, "SALES_HEAD"), params: { id: quotationId } };
    const res = mockResponse();

    await sendQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("immutable approved quotation snapshot"),
      }),
    );
    expect(txMock.quotation.updateMany).not.toHaveBeenCalled();
    expect(txMock.rFQ.updateMany).not.toHaveBeenCalled();
  });

  it("rejects sending a draft quotation", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      id: quotationId,
      status: "DRAFT",
      rfqId: "rfq-123",
      rfq: { id: "rfq-123", status: "ESTIMATING" },
    });

    const req = { ...mockAuthenticatedRequest({}, "SALES_HEAD"), params: { id: quotationId } };
    const res = mockResponse();

    await sendQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(txMock.quotation.updateMany).not.toHaveBeenCalled();
  });

  it("rejects sending a quotation pending approval", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      id: quotationId,
      status: "PENDING_APPROVAL",
      rfqId: "rfq-123",
      rfq: { id: "rfq-123", status: "PENDING_APPROVAL" },
    });

    const req = { ...mockAuthenticatedRequest({}, "SALES_HEAD"), params: { id: quotationId } };
    const res = mockResponse();

    await sendQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(txMock.quotation.updateMany).not.toHaveBeenCalled();
  });

  it.each(["ESTIMATOR", "ADMIN"])(
    "rejects sending by %s",
    async (role) => {
      const req = {
        ...mockAuthenticatedRequest({}, role),
        params: { id: quotationId },
      };
      const res = mockResponse();

      await sendQuotation(req as any, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    }
  );

  it("rejects sending when the parent RFQ has closed", async () => {
    txMock.quotation.findUnique.mockResolvedValue({
      id: quotationId,
      status: "APPROVED",
      approvedSnapshot: approvedSnapshotFixture,
      parts: snapshotReadyQuotation.parts,
      rfqId: "rfq-123",
      rfq: { id: "rfq-123", status: "RECEIVED" },
    });

    txMock.rFQ.findUnique.mockResolvedValue({ ...rfqFixture, status: "LOST" });
    const req = { ...mockAuthenticatedRequest({}, "SALES_HEAD"), params: { id: quotationId } };
    const res = mockResponse();

    await sendQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(txMock.quotation.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the quotation does not exist", async () => {
    txMock.quotation.findUnique.mockResolvedValue(null);

    const req = { ...mockAuthenticatedRequest({}, "SALES_HEAD"), params: { id: quotationId } };
    const res = mockResponse();

    await sendQuotation(req as any, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(txMock.quotation.updateMany).not.toHaveBeenCalled();
  });
  it("blocks sending after routing edits even if commercial approval and its snapshot already exist", async () => {
    const originalSnapshot = structuredClone(approvedSnapshotFixture);
    txMock.routing.findUnique.mockResolvedValue({ revision: 2, technicalReviews: [{ routingRevision: 1, status: "APPROVED" }] });
    const req = { ...mockAuthenticatedRequest({}, "SALES_HEAD"), params: { id: quotationId } };
    const res = mockResponse();
    await sendQuotation(req as any, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(txMock.quotation.updateMany).not.toHaveBeenCalled();
    expect(txMock.rFQ.updateMany).not.toHaveBeenCalled();
    expect(txMock.auditLog.createMany).not.toHaveBeenCalled();
    expect(approvedSnapshotFixture).toEqual(originalSnapshot);
  });
  it("blocks stale costings even when the new routing revision has technical approval", async () => {
    txMock.routing.findUnique.mockResolvedValue({ revision: 2, technicalReviews: [{ routingRevision: 2, status: "APPROVED" }] });
    const req = { ...mockAuthenticatedRequest({}, "SALES_HEAD"), params: { id: quotationId } };
    const res = mockResponse();
    await sendQuotation(req as any, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(txMock.quotation.updateMany).not.toHaveBeenCalled();
  });

});

describe("downloadQuotationPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const pdfQuotation = {
    quotationNumber: "QUO-TEST-123",
    status: "APPROVED",
    approvedSnapshot: approvedSnapshotFixture,
    createdAt: new Date("2026-11-05"),
    validUntil: new Date("2026-12-05"),
    gstPercentage: 18,
    subtotal: 1000,
    gstAmount: 180,
    grandTotal: 1180,
    notes: "Test quotation",
    customer: {
      name: "Company B",
      address: "Pune",
      email: "customer@example.com",
      phone: "1234567890",
      gstNumber: "TESTGST123",
    },
    rfq: { rfqNumber: "RFQ-2611-014" },
    parts: [{
      quantity: 100,
      unitPrice: 10,
      totalPrice: 1000,
      part: {
        partNumber: "PART-001",
        name: "Test spindle",
        description: "Rear wheel spindle",
        materialGrade: "EN8",
      },
    }],
  };

  it("generates a PDF for an approved quotation", async () => {
    prismaMock.quotation.findUnique.mockResolvedValue(pdfQuotation);

    const req = {
      params: { id: "quotation-123" },
    } as unknown as Request;
    const res = mockResponse();

    await downloadQuotationPdf(req, res);

    expect(prismaMock.quotation.findUnique).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/pdf"
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="QUO-TEST-123.pdf"'
    );

    const pdf = (res.send as any).mock.calls[0][0] as Buffer;
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("blocks PDF generation for a draft quotation", async () => {
    prismaMock.quotation.findUnique.mockResolvedValue({
      ...pdfQuotation,
      status: "DRAFT",
    });

    const req = {
      params: { id: "quotation-123" },
    } as unknown as Request;
    const res = mockResponse();

    await downloadQuotationPdf(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.send).not.toHaveBeenCalled();
  });

  it("requires an immutable approval snapshot for an approved quotation", async () => {
    prismaMock.quotation.findUnique.mockResolvedValue({
      quotationNumber: "QUO-TEST-123",
      status: "APPROVED",
      approvedSnapshot: null,
    });

    const req = {
      params: { id: "quotation-123" },
    } as unknown as Request;
    const res = mockResponse();

    await downloadQuotationPdf(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("immutable approved quotation snapshot"),
      }),
    );
    expect(res.send).not.toHaveBeenCalled();
  });
  it("does not read company settings or rewrite an existing approved quotation when downloading its PDF", async () => {
    const original = structuredClone(approvedSnapshotFixture);
    prismaMock.quotation.findUnique.mockResolvedValue({ quotationNumber: "QUO-TEST-123", status: "APPROVED", approvedSnapshot: approvedSnapshotFixture });
    const req = { ...mockAuthenticatedRequest({}, "SALES_HEAD"), params: { id: "quotation-123" } };
    const res = mockResponse();
    await downloadQuotationPdf(req as unknown as Request, res);
    expect(txMock.companyProfile.findUnique).not.toHaveBeenCalled();
    expect(txMock.quotation.updateMany).not.toHaveBeenCalled();
    expect(approvedSnapshotFixture).toEqual(original);
    expect(res.send).toHaveBeenCalled();
  });

});
