
import { Request, Response } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, txMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    part: { findUnique: vi.fn() },
    rFQ: { findUnique: vi.fn(), updateMany: vi.fn() },
    quotation: { findMany: vi.fn() },
    costing: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };

  return {
    txMock: tx,
    prismaMock: {
      $transaction: vi.fn(),
      part: { findUnique: vi.fn() },
      costing: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
    },
  };
});

vi.mock("../lib/prisma.js", () => ({
  default: prismaMock,
}));

import {
  createCosting,
  getCostingsByPart,
} from "./costing.controller.js";

const userId = "user-123";
const partId = "part-123";
const materialRateId = "material-rate-123";
const machineRateId = "machine-rate-123";

const idempotencyKey = "550e8400-e29b-41d4-a716-446655440000";

const validBody = {
  partId,
  scrapPercentage: 5,
  overheadAmount: 10,
  packingAmount: 5,
  freightAmount: 8,
  profitMargin: 20,
  annualVolumes: [1000, 5000],
};

const effectiveDate = new Date("2026-01-01T00:00:00.000Z");

const partFixture = {
  id: partId,
  rfqId: "rfq-123",
  grossWeightKg: 0.61,
  materialRate: {
    id: materialRateId,
    ratePerKg: 85,
    currency: "INR",
    isActive: true,
    effectiveFrom: effectiveDate,
    effectiveTo: null,
  },
  routing: {
    revision: 1,
    technicalReviews: [],
    operations: [
      {
        sequence: 1,
        operationName: "Turning",
        cycleTimeMin: 3.2,
        setupTimeMin: 10,
        machineRate: {
          id: machineRateId,
          machineCode: "CNC-01",
          ratePerHour: 850,
          currency: "INR",
          isActive: true,
          effectiveFrom: effectiveDate,
          effectiveTo: null,
        },
      },
    ],
  },
};

const savedCostingFixture = {
  id: "costing-123",
  partId,
  version: 1,
  totalCost: 122.77,
  idempotencyKey,
  components: [],
  volumes: [],
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

function mockAuthenticatedRequest(body: unknown = validBody) {
  return {
    body,
    user: { userId, role: "ESTIMATOR" },
    get: vi.fn().mockReturnValue(idempotencyKey),
  } as unknown as Request;
}

describe("createCosting", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.costing.findUnique.mockResolvedValue(null);

    txMock.rFQ.findUnique.mockResolvedValue({ id: "rfq-123", status: "ESTIMATING", updatedAt: new Date("2026-11-09") });
    txMock.rFQ.updateMany.mockResolvedValue({ count: 1 });
    txMock.quotation.findMany.mockResolvedValue([]);
    txMock.part.findUnique.mockResolvedValue(partFixture);
    txMock.costing.findFirst.mockResolvedValue(null);
    txMock.costing.create.mockResolvedValue(savedCostingFixture);
    txMock.auditLog.create.mockResolvedValue({ id: "audit-123" });

    prismaMock.$transaction.mockImplementation(async (callback: any) => {
      return callback(txMock);
    });
  });

  it("advances a received RFQ when a draft costing is saved", async () => {
    txMock.rFQ.findUnique.mockResolvedValue({ id: "rfq-123", status: "RECEIVED", updatedAt: new Date("2026-11-09") });
    const res = mockResponse(); await createCosting(mockAuthenticatedRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(txMock.rFQ.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ESTIMATING" }) }));
    expect(txMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "RFQ_STATUS_SYNCHRONIZED" }) }));
  });
  it.each(["WON", "LOST"])("blocks new costings on a %s RFQ", async status => {
    txMock.rFQ.findUnique.mockResolvedValue({ id: "rfq-123", status, updatedAt: new Date("2026-11-09") });
    const res = mockResponse(); await createCosting(mockAuthenticatedRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(409); expect(txMock.costing.create).not.toHaveBeenCalled();
  });
  it("does not report success if the RFQ compare-and-set fails", async () => {
    txMock.rFQ.updateMany.mockResolvedValue({ count: 0 });
    const res = mockResponse(); await createCosting(mockAuthenticatedRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(409); expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects invalid request data", async () => {
    const req = mockAuthenticatedRequest({
      ...validBody,
      profitMargin: 100,
    });

    const res = mockResponse();

    await createCosting(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(txMock.part.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a request without an idempotency key", async () => {
    const req = {
      body: validBody,
      user: { userId, role: "ESTIMATOR" },
      get: vi.fn().mockReturnValue(undefined),
    };

    const res = mockResponse();

    await createCosting(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("returns an existing costing for a duplicate request", async () => {
    prismaMock.costing.findUnique.mockResolvedValue(
      savedCostingFixture
    );

    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createCosting(req as any, res);

    expect(prismaMock.costing.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey },
      include: {
        components: true,
        volumes: true,
      },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.costing.create).not.toHaveBeenCalled();
  });

  it("returns 404 when the part does not exist", async () => {
    txMock.part.findUnique.mockResolvedValue(null);

    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createCosting(req as any, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("rejects a part without gross weight", async () => {
    txMock.part.findUnique.mockResolvedValue({
      ...partFixture,
      grossWeightKg: null,
    });

    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createCosting(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects a part without a material rate", async () => {
    txMock.part.findUnique.mockResolvedValue({
      ...partFixture,
      materialRate: null,
    });

    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createCosting(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects a legacy material rate that is not in INR", async () => {
    txMock.part.findUnique.mockResolvedValue({
      ...partFixture,
      materialRate: {
        ...partFixture.materialRate,
        currency: "USD",
      },
    });

    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createCosting(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "The linked material rate must use INR currency",
      })
    );
    expect(txMock.costing.create).not.toHaveBeenCalled();
  });

  it("rejects a part without routing operations", async () => {
    txMock.part.findUnique.mockResolvedValue({
      ...partFixture,
      routing: { operations: [] },
    });

    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createCosting(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects an operation without a machine rate", async () => {
    txMock.part.findUnique.mockResolvedValue({
      ...partFixture,
      routing: {
        operations: [
          {
            ...partFixture.routing.operations[0],
            machineRate: null,
          },
        ],
      },
    });

    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createCosting(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects a legacy machine rate that is not in INR", async () => {
    txMock.part.findUnique.mockResolvedValue({
      ...partFixture,
      routing: {
        operations: [
          {
            ...partFixture.routing.operations[0],
            machineRate: {
              ...partFixture.routing.operations[0].machineRate,
              currency: "EUR",
            },
          },
        ],
      },
    });

    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createCosting(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "All linked machine rates must use INR currency",
      })
    );
    expect(txMock.costing.create).not.toHaveBeenCalled();
  });

  it("creates costing, components, volumes and audit log", async () => {
    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createCosting(req as any, res);

    expect(txMock.costing.create).toHaveBeenCalledTimes(1);
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);

    const createCall = txMock.costing.create.mock.calls[0][0];

    expect(createCall.data.partId).toBe(partId);
    expect(createCall.data.materialRateId).toBe(materialRateId);
    expect(createCall.data.materialRatePerKgSnapshot).toBe(85);
    expect(createCall.data.createdById).toBe(userId);
    expect(createCall.data.idempotencyKey).toBe(idempotencyKey);
    expect(createCall.data.version).toBe(1);
    expect(createCall.data.components.create).toHaveLength(7);
    expect(createCall.data.volumes.create).toHaveLength(2);

    const machiningComponent = createCall.data.components.create.find(
      (component: any) => component.type === "MACHINING"
    );

    expect(machiningComponent.machineRateId).toBe(machineRateId);
    expect(machiningComponent.cycleTimeMin).toBe(3.2);
    expect(machiningComponent.ratePerHourSnapshot).toBe(850);

    const setupComponent = createCall.data.components.create.find(
      (component: any) => component.type === "SETUP"
    );

    expect(setupComponent.amount).toBeCloseTo(141.67, 2);
    expect(setupComponent.setupTimeMinSnapshot).toBe(10);
    expect(setupComponent.ratePerHourSnapshot).toBe(850);

    expect(createCall.data.volumes.create[0].unitPrice).toBeGreaterThan(
      createCall.data.volumes.create[1].unitPrice
    );
    expect(createCall.data.volumes.create[0].totalCost).toBe(
      createCall.data.volumes.create[0].unitPrice * 1000
    );
  });

  it("reconciles rounded components across multiple operations and setup allocation", async () => {
    txMock.part.findUnique.mockResolvedValue({
      ...partFixture,
      routing: {
        operations: [
          ...partFixture.routing.operations,
          {
            sequence: 2,
            operationName: "Inspection",
            cycleTimeMin: 2.5,
            setupTimeMin: 5,
            machineRate: {
              id: "machine-rate-456",
              machineCode: "CMM-01",
              ratePerHour: 620,
              currency: "INR",
              isActive: true,
              effectiveFrom: effectiveDate,
              effectiveTo: null,
            },
          },
        ],
      },
    });

    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createCosting(req as any, res);

    const createCall = txMock.costing.create.mock.calls[0][0];
    const components = createCall.data.components.create;
    const recurringComponentPaise = components
      .filter((component: any) => component.type !== "SETUP")
      .reduce(
        (total: number, component: any) =>
          total + Math.round(component.amount * 100),
        0
      );

    expect(components.filter((component: any) => component.type === "MACHINING"))
      .toMatchObject([
        { amount: 45.33 },
        { amount: 25.83 },
      ]);
    expect(components.filter((component: any) => component.type === "SETUP"))
      .toMatchObject([
        { amount: 141.67 },
        { amount: 51.67 },
      ]);
    expect(recurringComponentPaise).toBe(14860);
    expect(createCall.data.totalCost).toBe(recurringComponentPaise / 100);
    expect(createCall.data.volumes.create).toMatchObject([
      {
        annualVolume: 1000,
        unitPrice: 185.99,
        totalCost: 185990,
      },
      {
        annualVolume: 5000,
        unitPrice: 185.8,
        totalCost: 929000,
      },
    ]);
  });

  it("increments the costing version", async () => {
    txMock.costing.findFirst.mockResolvedValue({ version: 3 });

    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createCosting(req as any, res);

    const createCall = txMock.costing.create.mock.calls[0][0];

    expect(createCall.data.version).toBe(4);
  });
  it("allows draft costing before technical approval and records the saved routing revision", async () => {
    const res = mockResponse();
    await createCosting(mockAuthenticatedRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(txMock.costing.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ routingRevision: 1, routingTechnicalReviewId: null }) }));
    expect(txMock.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(txMock.part.findUnique.mock.invocationCallOrder[0]);
  });
  it("links a costing only to the approval of its current routing revision", async () => {
    txMock.part.findUnique.mockResolvedValue({ ...partFixture, routing: { ...partFixture.routing, revision: 2, technicalReviews: [{ id: "old", routingRevision: 1 }, { id: "current", routingRevision: 2 }] } });
    const res = mockResponse();
    await createCosting(mockAuthenticatedRequest() as any, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(txMock.costing.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ routingRevision: 2, routingTechnicalReviewId: "current" }) }));
  });

});

describe("getCostingsByPart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the part does not exist", async () => {
    prismaMock.part.findUnique.mockResolvedValue(null);

    const req = {
      params: { partId },
    } as unknown as Request;

    const res = mockResponse();

    await getCostingsByPart(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns costing history for an existing part", async () => {
    prismaMock.part.findUnique.mockResolvedValue({ id: partId });

    prismaMock.costing.findMany.mockResolvedValue([
      savedCostingFixture,
    ]);

    const req = {
      params: { partId },
    } as unknown as Request;

    const res = mockResponse();

    await getCostingsByPart(req, res);

    expect(prismaMock.costing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { partId },
        orderBy: { version: "desc" },
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
