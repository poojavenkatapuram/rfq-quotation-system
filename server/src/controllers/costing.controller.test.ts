
import { Request, Response } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, txMock } = vi.hoisted(() => {
  const tx = {
    part: { findUnique: vi.fn() },
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
    operations: [
      {
        sequence: 1,
        operationName: "Turning",
        cycleTimeMin: 3.2,
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
  totalCost: 122.78,
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

    txMock.part.findUnique.mockResolvedValue(partFixture);
    txMock.costing.findFirst.mockResolvedValue(null);
    txMock.costing.create.mockResolvedValue(savedCostingFixture);
    txMock.auditLog.create.mockResolvedValue({ id: "audit-123" });

    prismaMock.$transaction.mockImplementation(async (callback: any) => {
      return callback(txMock);
    });
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
    expect(createCall.data.createdById).toBe(userId);
    expect(createCall.data.idempotencyKey).toBe(idempotencyKey);
    expect(createCall.data.version).toBe(1);
    expect(createCall.data.components.create).toHaveLength(6);
    expect(createCall.data.volumes.create).toHaveLength(2);

    const machiningComponent = createCall.data.components.create.find(
      (component: any) => component.type === "MACHINING"
    );

    expect(machiningComponent.machineRateId).toBe(machineRateId);
    expect(machiningComponent.cycleTimeMin).toBe(3.2);
    expect(machiningComponent.ratePerHourSnapshot).toBe(850);
  });

  it("increments the costing version", async () => {
    txMock.costing.findFirst.mockResolvedValue({ version: 3 });

    const req = mockAuthenticatedRequest();
    const res = mockResponse();

    await createCosting(req as any, res);

    const createCall = txMock.costing.create.mock.calls[0][0];

    expect(createCall.data.version).toBe(4);
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
