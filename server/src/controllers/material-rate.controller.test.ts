
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Response } from "express";

const {
  mockFindMany,
  mockFindUnique,
  mockCreate,
  mockUpdate,
  mockAuditLogCreate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockFindUnique: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockAuditLogCreate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  default: {
    materialRate: {
      findMany: mockFindMany,
      findUnique: mockFindUnique,
    },
    $transaction: mockTransaction,
  },
}));

import {
  getMaterialRates,
  createMaterialRate,
  deactivateMaterialRate,
} from "./material-rate.controller.js";

const userId = "user-test-001";
const rateId = "material-rate-test-001";

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
  query: Record<string, unknown> = {},
  params: Record<string, string> = {}
) => ({
  body,
  query,
  params,
  user: {
    userId,
    role: "ADMIN",
  },
});

const sampleRate = {
  id: rateId,
  materialCode: "EN8",
  materialName: "Carbon Steel",
  grade: "EN8",
  ratePerKg: 85,
  currency: "INR",
  effectiveFrom: new Date("2026-01-01"),
  effectiveTo: null,
  isActive: true,
};

const transactionClient = {
  materialRate: {
    findMany: mockFindMany,
    findUnique: mockFindUnique,
    create: mockCreate,
    update: mockUpdate,
  },
  auditLog: {
    create: mockAuditLogCreate,
  },
};

describe("Material Rate Controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockTransaction.mockImplementation(async (callback) =>
      callback(transactionClient)
    );

    mockFindMany.mockResolvedValue([]);
    mockCreate.mockResolvedValue(sampleRate);
    mockUpdate.mockResolvedValue({
      ...sampleRate,
      isActive: false,
    });
    mockAuditLogCreate.mockResolvedValue({});
  });

  describe("getMaterialRates", () => {
    it("should return all material rates", async () => {
      mockFindMany.mockResolvedValue([sampleRate]);

      const req = createRequest();
      const res = createResponse();

      await getMaterialRates(
        req as unknown as Parameters<typeof getMaterialRates>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          count: 1,
          data: [sampleRate],
        })
      );
    });

    it("should reject invalid query filters", async () => {
      const req = createRequest({}, { isActive: "invalid" });
      const res = createResponse();

      await getMaterialRates(
        req as unknown as Parameters<typeof getMaterialRates>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockFindMany).not.toHaveBeenCalled();
    });
  });

  describe("createMaterialRate", () => {
    it("should create a material rate and audit log", async () => {
      const req = createRequest({
        materialCode: "EN8",
        materialName: "Carbon Steel",
        grade: "EN8",
        ratePerKg: 85,
        currency: "INR",
        effectiveFrom: "2026-01-01",
      });

      const res = createResponse();

      await createMaterialRate(
        req as unknown as Parameters<typeof createMaterialRate>[0],
        res
      );

      expect(mockCreate).toHaveBeenCalled();
      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: userId,
            action: "MATERIAL_RATE_CREATED",
            entityType: "MaterialRate",
          }),
        })
      );

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should reject a non-positive material rate", async () => {
      const req = createRequest({
        materialCode: "EN8",
        materialName: "Carbon Steel",
        grade: "EN8",
        ratePerKg: 0,
        effectiveFrom: "2026-01-01",
      });

      const res = createResponse();

      await createMaterialRate(
        req as unknown as Parameters<typeof createMaterialRate>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should reject overlapping effective periods", async () => {
      mockFindMany.mockResolvedValue([
        {
          ...sampleRate,
          effectiveFrom: new Date("2026-01-01"),
          effectiveTo: null,
          isActive: false,
        },
      ]);

      const req = createRequest({
        materialCode: "EN8",
        materialName: "Carbon Steel",
        grade: "EN8",
        ratePerKg: 90,
        effectiveFrom: "2026-02-01",
      });

      const res = createResponse();

      await createMaterialRate(
        req as unknown as Parameters<typeof createMaterialRate>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockCreate).not.toHaveBeenCalled();
    });
    it("should reject a finite-period revision that overlaps an open-ended rate", async () => {
      mockFindMany.mockResolvedValue([
        {
          ...sampleRate,
          effectiveFrom: new Date("2026-01-01"),
          effectiveTo: null,
          isActive: true,
        },
      ]);

      const req = createRequest({
        materialCode: "EN8",
        materialName: "Carbon Steel",
        grade: "EN8",
        ratePerKg: 90,
        effectiveFrom: "2027-01-01",
        effectiveTo: "2027-06-01",
      });

      const res = createResponse();

      await createMaterialRate(
        req as unknown as Parameters<typeof createMaterialRate>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should preserve the previous rate as active until the future revision date", async () => {
      mockFindMany.mockResolvedValue([
        {
          ...sampleRate,
          effectiveFrom: new Date("2026-01-01"),
          effectiveTo: null,
          isActive: true,
        },
      ]);

      const revisionDate = "2027-01-01";

      const req = createRequest({
        materialCode: "EN8",
        materialName: "Carbon Steel",
        grade: "EN8",
        ratePerKg: 90,
        effectiveFrom: revisionDate,
      });

      const res = createResponse();

      await createMaterialRate(
        req as unknown as Parameters<typeof createMaterialRate>[0],
        res
      );

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: rateId },
        data: {
          effectiveTo: new Date(revisionDate),
        },
      });

      expect(mockCreate).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe("deactivateMaterialRate", () => {
    it("should deactivate an existing material rate", async () => {
      mockFindUnique.mockResolvedValue({
        ...sampleRate,
        effectiveFrom: new Date("2025-01-01"),
      });

      const req = createRequest({}, {}, { id: rateId });
      const res = createResponse();

      await deactivateMaterialRate(
        req as unknown as Parameters<typeof deactivateMaterialRate>[0],
        res
      );

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockAuditLogCreate).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 404 when the rate does not exist", async () => {
      mockFindUnique.mockResolvedValue(null);

      const req = createRequest({}, {}, { id: rateId });
      const res = createResponse();

      await deactivateMaterialRate(
        req as unknown as Parameters<typeof deactivateMaterialRate>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
