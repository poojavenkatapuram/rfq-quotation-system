import { beforeEach, describe, expect, it, vi } from "vitest";
import { Response } from "express";

const {
  mockPartFindUnique,
  mockMachineRateFindMany,
  mockRoutingFindUnique,
  mockRoutingUpsert,
  mockAuditLogCreate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockPartFindUnique: vi.fn(),
  mockMachineRateFindMany: vi.fn(),
  mockRoutingFindUnique: vi.fn(),
  mockRoutingUpsert: vi.fn(),
  mockAuditLogCreate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  default: {
    routing: {
      findUnique: mockRoutingFindUnique,
    },
    $transaction: mockTransaction,
  },
}));

import {
  getRoutingByPart,
  saveRouting,
} from "./routing.controller.js";

const userId = "user-test-001";
const partId = "part-test-001";
const machineRateId = "machine-rate-test-001";

const sampleMachineRate = {
  id: machineRateId,
  machineCode: "CNC-01",
  machineName: "CNC Turning Machine",
  ratePerHour: 850,
  currency: "INR",
  isActive: true,
  effectiveFrom: new Date("2026-01-01"),
  effectiveTo: null,
};

const sampleRouting = {
  id: "routing-test-001",
  partId,
  name: "Standard machining",
  operations: [
    {
      id: "operation-test-001",
      sequence: 1,
      operationName: "Turning",
      machineRateId,
      cycleTimeMin: 3.2,
      setupTimeMin: 0,
      machineRate: sampleMachineRate,
    },
  ],
};

const createResponse = () => {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;

  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  (res.json as ReturnType<typeof vi.fn>).mockReturnValue(res);

  return res;
};

const createRequest = (
  body: Record<string, unknown> = {},
  params: Record<string, string> = {},
) => ({
  body,
  params,
  user: {
    userId,
    role: "ESTIMATOR",
  },
});

const transactionClient = {
  part: {
    findUnique: mockPartFindUnique,
  },
  machineRate: {
    findMany: mockMachineRateFindMany,
  },
  routing: {
    upsert: mockRoutingUpsert,
  },
  auditLog: {
    create: mockAuditLogCreate,
  },
};

const validBody = {
  name: "Standard machining",
  operations: [
    {
      sequence: 1,
      operationName: "Turning",
      machineRateId,
      cycleTimeMin: 3.2,
      setupTimeMin: 0,
    },
  ],
};

describe("Routing Controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockTransaction.mockImplementation(async (callback) =>
      callback(transactionClient),
    );

    mockPartFindUnique.mockResolvedValue({
      id: partId,
      name: "Rear Wheel Spindle",
    });

    mockMachineRateFindMany.mockResolvedValue([
      sampleMachineRate,
    ]);

    mockRoutingUpsert.mockResolvedValue(sampleRouting);
    mockAuditLogCreate.mockResolvedValue({});
    mockRoutingFindUnique.mockResolvedValue(sampleRouting);
  });

  describe("getRoutingByPart", () => {
    it("returns routing with its operations", async () => {
      const req = createRequest({}, { partId });
      const res = createResponse();

      await getRoutingByPart(
        req as unknown as Parameters<typeof getRoutingByPart>[0],
        res,
      );

      expect(mockRoutingFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { partId },
        }),
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("returns 404 when routing does not exist", async () => {
      mockRoutingFindUnique.mockResolvedValue(null);

      const req = createRequest({}, { partId });
      const res = createResponse();

      await getRoutingByPart(
        req as unknown as Parameters<typeof getRoutingByPart>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("saveRouting", () => {
    it("creates routing and writes an audit log", async () => {
      const req = createRequest(validBody, { partId });
      const res = createResponse();

      await saveRouting(
        req as unknown as Parameters<typeof saveRouting>[0],
        res,
      );

      expect(mockRoutingUpsert).toHaveBeenCalled();
      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: userId,
            action: "ROUTING_SAVED",
            entityType: "Routing",
          }),
        }),
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("rejects invalid routing data", async () => {
      const req = createRequest(
        { operations: [] },
        { partId },
      );
      const res = createResponse();

      await saveRouting(
        req as unknown as Parameters<typeof saveRouting>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("rejects a part that does not exist", async () => {
      mockPartFindUnique.mockResolvedValue(null);

      const req = createRequest(validBody, { partId });
      const res = createResponse();

      await saveRouting(
        req as unknown as Parameters<typeof saveRouting>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("rejects a nonexistent machine rate", async () => {
      mockMachineRateFindMany.mockResolvedValue([]);

      const req = createRequest(validBody, { partId });
      const res = createResponse();

      await saveRouting(
        req as unknown as Parameters<typeof saveRouting>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockRoutingUpsert).not.toHaveBeenCalled();
    });

    it("rejects an inactive machine rate", async () => {
      mockMachineRateFindMany.mockResolvedValue([
        {
          ...sampleMachineRate,
          isActive: false,
        },
      ]);

      const req = createRequest(validBody, { partId });
      const res = createResponse();

      await saveRouting(
        req as unknown as Parameters<typeof saveRouting>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockRoutingUpsert).not.toHaveBeenCalled();
    });

    it("rejects duplicate operation sequence numbers", async () => {
      const req = createRequest(
        {
          operations: [
            ...validBody.operations,
            {
              sequence: 1,
              operationName: "Drilling",
              machineRateId,
              cycleTimeMin: 2,
            },
          ],
        },
        { partId },
      );

      const res = createResponse();

      await saveRouting(
        req as unknown as Parameters<typeof saveRouting>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });
});
