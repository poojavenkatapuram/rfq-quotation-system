import { beforeEach, describe, expect, it, vi } from "vitest";
import { Response } from "express";

const {
  mockPartFindMany,
  mockPartFindUnique,
  mockMachineRateFindMany,
  mockRoutingFindUnique,
  mockRoutingUpsert,
  mockAuditLogCreate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockPartFindMany: vi.fn(),
  mockPartFindUnique: vi.fn(),
  mockMachineRateFindMany: vi.fn(),
  mockRoutingFindUnique: vi.fn(),
  mockRoutingUpsert: vi.fn(),
  mockAuditLogCreate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  default: {
    part: { findUnique: mockPartFindUnique, findMany: mockPartFindMany },
    routing: {
      findUnique: mockRoutingFindUnique,
    },
    auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: mockTransaction,
  },
}));

import {
  getHistoricalRoutingRecommendations,
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
  revision: 1,
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
  $executeRaw: vi.fn().mockResolvedValue(1),
  part: {
    findUnique: mockPartFindUnique,
  },
  machineRate: {
    findMany: mockMachineRateFindMany,
  },
  routing: {
    findUnique: mockRoutingFindUnique,
    upsert: mockRoutingUpsert,
  },
  auditLog: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: mockAuditLogCreate,
  },
};

const validBody = {
  expectedRevision: 1,
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
  describe("routing revisions", () => {
    it("requires a revision token to prevent silent overwrites", async () => {
      const { expectedRevision: _revision, ...body } = validBody;
      const res = createResponse();
      await saveRouting(createRequest(body, { partId }) as never, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockTransaction).not.toHaveBeenCalled();
    });
    it("increments every saved edit and audits previous and current revisions", async () => {
      mockRoutingUpsert.mockResolvedValue({ ...sampleRouting, revision: 2 });
      const res = createResponse();
      await saveRouting(createRequest(validBody, { partId }) as never, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockRoutingUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ revision: { increment: 1 } }) }));
      expect(mockAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ previousRevision: 1, revision: 2, operations: [expect.objectContaining({ setupTimeMin: 0 })] }) }) }));
    });
    it("rejects a stale editor without overwriting routing or review history", async () => {
      mockRoutingFindUnique.mockResolvedValue({ ...sampleRouting, revision: 2 });
      const res = createResponse();
      await saveRouting(createRequest(validBody, { partId }) as never, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockRoutingUpsert).not.toHaveBeenCalled();
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });
    it("denies commercial users even when the controller is called directly", async () => {
      const req = createRequest(validBody, { partId }); req.user.role = "SALES_HEAD";
      const res = createResponse();
      await saveRouting(req as never, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockRoutingUpsert).not.toHaveBeenCalled();
    });
    it("preserves recommendation evidence across subsequent manual edits", async () => {
      const provenance = { sourcePartId: "historical", sourceRoutingRevision: 1, operations: [{ operationName: "Original turning" }] };
      transactionClient.auditLog.findFirst.mockResolvedValueOnce({ details: { recommendationSource: provenance } });
      const res = createResponse();
      await saveRouting(createRequest(validBody, { partId }) as never, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ recommendationSource: provenance }) }) }));
    });
    it("persists server-verified source operations and recomputed matching factors", async () => {
      mockPartFindUnique.mockResolvedValueOnce({ id: partId, rfqId: "target-rfq", createdAt: new Date("2026-11-09"), name: "Spindle", materialGrade: "EN8", grossWeightKg: 1 });
      mockPartFindUnique.mockResolvedValueOnce({ id: "source", rfqId: "source-rfq", createdAt: new Date("2026-11-01"), name: "Spindle", partNumber: "OLD-1", materialGrade: "EN8", grossWeightKg: 1, rfq: { rfqNumber: "OLD-RFQ" }, routing: { revision: 3, operations: sampleRouting.operations } });
      const res = createResponse();
      await saveRouting(createRequest({ ...validBody, recommendationSource: { sourcePartId: "source", sourceRoutingRevision: 3 } }, { partId }) as never, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ recommendationSource: expect.objectContaining({ sourcePartId: "source", sourceRoutingRevision: 3, similarityScore: 100, operations: [expect.objectContaining({ cycleTimeMin: 3.2 })] }) }) }) }));
    });
    it("rejects recommendation provenance when the source revision changed", async () => {
      mockPartFindUnique.mockResolvedValueOnce({ id: partId, rfqId: "target", createdAt: new Date("2026-11-09"), name: "Spindle" });
      mockPartFindUnique.mockResolvedValueOnce({ id: "source", rfqId: "other", createdAt: new Date("2026-11-01"), routing: { revision: 4, operations: sampleRouting.operations } });
      const res = createResponse();
      await saveRouting(createRequest({ ...validBody, recommendationSource: { sourcePartId: "source", sourceRoutingRevision: 3 } }, { partId }) as never, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockRoutingUpsert).not.toHaveBeenCalled();
    });
  });

  it("allows only one of two editors with the same revision to save", async () => {
    let current = structuredClone(sampleRouting);
    let queue = Promise.resolve();
    mockRoutingFindUnique.mockImplementation(async () => current);
    mockRoutingUpsert.mockImplementation(async () => { current = { ...current, revision: current.revision + 1 }; return current; });
    mockTransaction.mockImplementation(callback => {
      const result = queue.then(() => callback(transactionClient));
      queue = result.then(() => undefined, () => undefined);
      return result;
    });
    const first = createResponse(), second = createResponse();
    await Promise.all([
      saveRouting(createRequest(validBody, { partId }) as never, first),
      saveRouting(createRequest(validBody, { partId }) as never, second),
    ]);
    expect((first.status as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(200);
    expect((second.status as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(409);
    expect(mockRoutingUpsert).toHaveBeenCalledTimes(1);
    expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
  });

  describe("recommendation endpoint", () => {
    beforeEach(() => {
      mockPartFindUnique.mockResolvedValue({ id: partId, rfqId: "target-rfq", createdAt: new Date("2026-11-09"), name: "Spindle", materialGrade: "EN8", grossWeightKg: 1 });
      mockPartFindMany.mockResolvedValue([]);
    });
    it("queries only older source parts in other RFQs", async () => {
      const res = createResponse();
      await getHistoricalRoutingRecommendations(createRequest({}, { partId }) as never, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockPartFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { not: partId }, rfqId: { not: "target-rfq" }, createdAt: { lt: new Date("2026-11-09") }, routing: { isNot: null } } }));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recommendations: [] }) }));
    });
    it("returns source revision and saved operations instead of generating history", async () => {
      mockPartFindMany.mockResolvedValue([{ id: "source", name: "Spindle", partNumber: "OLD-1", materialGrade: "EN8", grossWeightKg: 1, rfq: { rfqNumber: "OLD-RFQ" }, routing: { ...sampleRouting, revision: 3 } }]);
      const res = createResponse();
      await getHistoricalRoutingRecommendations(createRequest({}, { partId }) as never, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recommendations: [expect.objectContaining({ sourcePartId: "source", sourceRoutingRevision: 3, similarityScore: 100, operations: [expect.objectContaining({ cycleTimeMin: 3.2 })] })] }) }));
    });
    it("returns 404 for a missing target", async () => {
      mockPartFindUnique.mockResolvedValue(null);
      const res = createResponse();
      await getHistoricalRoutingRecommendations(createRequest({}, { partId }) as never, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPartFindMany).not.toHaveBeenCalled();
    });
  });

});
