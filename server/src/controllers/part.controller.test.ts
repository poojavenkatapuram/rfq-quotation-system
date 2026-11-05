import { beforeEach, describe, expect, it, vi } from "vitest";
import { Response } from "express";

const {
  mockPartFindUnique,
  mockMaterialRateFindUnique,
  mockPartUpdate,
  mockAuditLogCreate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockPartFindUnique: vi.fn(),
  mockMaterialRateFindUnique: vi.fn(),
  mockPartUpdate: vi.fn(),
  mockAuditLogCreate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  default: {
    $transaction: mockTransaction,
  },
}));

import { assignMaterialRateToPart } from "./part.controller.js";

const userId = "user-test-001";
const partId = "part-test-001";
const materialRateId = "material-rate-test-001";

const sampleMaterialRate = {
  id: materialRateId,
  materialCode: "EN8",
  materialName: "EN8 Steel",
  grade: "EN8",
  ratePerKg: 85,
  currency: "INR",
  isActive: true,
  effectiveFrom: new Date("2026-01-01"),
  effectiveTo: null,
};

const samplePart = {
  id: partId,
  name: "Rear Wheel Spindle",
  materialGrade: "EN8",
  materialRateId: null,
};

const updatedPart = {
  ...samplePart,
  materialRateId,
  materialRate: sampleMaterialRate,
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
    update: mockPartUpdate,
  },
  materialRate: {
    findUnique: mockMaterialRateFindUnique,
  },
  auditLog: {
    create: mockAuditLogCreate,
  },
};

const validBody = {
  materialRateId,
};

describe("Part Controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockTransaction.mockImplementation(async (callback) =>
      callback(transactionClient),
    );

    mockPartFindUnique.mockResolvedValue(samplePart);
    mockMaterialRateFindUnique.mockResolvedValue(sampleMaterialRate);
    mockPartUpdate.mockResolvedValue(updatedPart);
    mockAuditLogCreate.mockResolvedValue({});
  });

  describe("assignMaterialRateToPart", () => {
    it("assigns a material rate successfully and records an audit log", async () => {
      const req = createRequest(validBody, { partId });
      const res = createResponse();

      await assignMaterialRateToPart(
        req as unknown as Parameters<typeof assignMaterialRateToPart>[0],
        res,
      );

      expect(mockPartFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: partId },
        }),
      );

      expect(mockMaterialRateFindUnique).toHaveBeenCalledWith({
        where: { id: materialRateId },
      });

      expect(mockPartUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: partId },
          data: { materialRateId },
        }),
      );

      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: userId,
            action: "PART_MATERIAL_RATE_ASSIGNED",
            entityType: "Part",
            entityId: partId,
          }),
        }),
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("rejects an invalid request body", async () => {
      const req = createRequest({}, { partId });
      const res = createResponse();

      await assignMaterialRateToPart(
        req as unknown as Parameters<typeof assignMaterialRateToPart>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("returns 404 when the part does not exist", async () => {
      mockPartFindUnique.mockResolvedValue(null);

      const req = createRequest(validBody, { partId });
      const res = createResponse();

      await assignMaterialRateToPart(
        req as unknown as Parameters<typeof assignMaterialRateToPart>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPartUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 when the material rate does not exist", async () => {
      mockMaterialRateFindUnique.mockResolvedValue(null);

      const req = createRequest(validBody, { partId });
      const res = createResponse();

      await assignMaterialRateToPart(
        req as unknown as Parameters<typeof assignMaterialRateToPart>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPartUpdate).not.toHaveBeenCalled();
    });

    it("rejects an inactive material rate", async () => {
      mockMaterialRateFindUnique.mockResolvedValue({
        ...sampleMaterialRate,
        isActive: false,
      });

      const req = createRequest(validBody, { partId });
      const res = createResponse();

      await assignMaterialRateToPart(
        req as unknown as Parameters<typeof assignMaterialRateToPart>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockPartUpdate).not.toHaveBeenCalled();
    });

    it("rejects a future-effective material rate", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);

      mockMaterialRateFindUnique.mockResolvedValue({
        ...sampleMaterialRate,
        effectiveFrom: futureDate,
      });

      const req = createRequest(validBody, { partId });
      const res = createResponse();

      await assignMaterialRateToPart(
        req as unknown as Parameters<typeof assignMaterialRateToPart>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockPartUpdate).not.toHaveBeenCalled();
    });

    it("rejects an expired material rate", async () => {
      mockMaterialRateFindUnique.mockResolvedValue({
        ...sampleMaterialRate,
        effectiveTo: new Date("2026-01-02"),
      });

      const req = createRequest(validBody, { partId });
      const res = createResponse();

      await assignMaterialRateToPart(
        req as unknown as Parameters<typeof assignMaterialRateToPart>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockPartUpdate).not.toHaveBeenCalled();
    });

    it("rejects a material grade mismatch", async () => {
      mockMaterialRateFindUnique.mockResolvedValue({
        ...sampleMaterialRate,
        grade: "40Cr4",
      });

      const req = createRequest(validBody, { partId });
      const res = createResponse();

      await assignMaterialRateToPart(
        req as unknown as Parameters<typeof assignMaterialRateToPart>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPartUpdate).not.toHaveBeenCalled();
    });

    it("rejects assignment when the part has no material grade", async () => {
      mockPartFindUnique.mockResolvedValue({
        ...samplePart,
        materialGrade: null,
      });

      const req = createRequest(validBody, { partId });
      const res = createResponse();

      await assignMaterialRateToPart(
        req as unknown as Parameters<typeof assignMaterialRateToPart>[0],
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPartUpdate).not.toHaveBeenCalled();
    });
  });
});
