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
    machineRate: {
      findMany: mockFindMany,
      findUnique: mockFindUnique,
    },
    $transaction: mockTransaction,
  },
}));

import {
  getMachineRates,
  createMachineRate,
  deactivateMachineRate,
} from "./machine-rate.controller.js";

const userId = "user-test-001";
const rateId = "machine-rate-test-001";

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
  machineCode: "CNC-01",
  machineName: "CNC Turning Machine",
  ratePerHour: 850,
  currency: "INR",
  effectiveFrom: new Date("2026-01-01"),
  effectiveTo: null,
  isActive: true,
};

const transactionClient = {
  machineRate: {
    findMany: mockFindMany,
    findUnique: mockFindUnique,
    create: mockCreate,
    update: mockUpdate,
  },
  auditLog: {
    create: mockAuditLogCreate,
  },
};

describe("Machine Rate Controller", () => {
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

  describe("getMachineRates", () => {
    it("should return all machine rates", async () => {
      mockFindMany.mockResolvedValue([sampleRate]);

      const req = createRequest();
      const res = createResponse();

      await getMachineRates(
        req as unknown as Parameters<typeof getMachineRates>[0],
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

      await getMachineRates(
        req as unknown as Parameters<typeof getMachineRates>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockFindMany).not.toHaveBeenCalled();
    });
  });

  describe("createMachineRate", () => {
    it("should create a machine rate and audit log", async () => {
      const req = createRequest({
        machineCode: "CNC-01",
        machineName: "CNC Turning Machine",
        ratePerHour: 850,
        currency: "INR",
        effectiveFrom: "2026-01-01",
      });

      const res = createResponse();

      await createMachineRate(
        req as unknown as Parameters<typeof createMachineRate>[0],
        res
      );

      expect(mockCreate).toHaveBeenCalled();
      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: userId,
            action: "MACHINE_RATE_CREATED",
            entityType: "MachineRate",
          }),
        })
      );

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it.each(["inr", "InR"])(
      "should normalize %s to INR",
      async (currency) => {
        const req = createRequest({
          machineCode: "CNC-01",
          machineName: "CNC Turning Machine",
          ratePerHour: 850,
          currency,
          effectiveFrom: "2026-01-01",
        });
        const res = createResponse();

        await createMachineRate(
          req as unknown as Parameters<typeof createMachineRate>[0],
          res
        );

        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ currency: "INR" }),
          })
        );
        expect(res.status).toHaveBeenCalledWith(201);
      }
    );

    it.each(["USD", "EUR", "US", "INR1"])(
      "should reject unsupported currency %s",
      async (currency) => {
        const req = createRequest({
          machineCode: "CNC-01",
          machineName: "CNC Turning Machine",
          ratePerHour: 850,
          currency,
          effectiveFrom: "2026-01-01",
        });
        const res = createResponse();

        await createMachineRate(
          req as unknown as Parameters<typeof createMachineRate>[0],
          res
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockTransaction).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
      }
    );

    it("should normalize machine codes to uppercase", async () => {
      const req = createRequest({
        machineCode: "cnc-01",
        machineName: "CNC Turning Machine",
        ratePerHour: 850,
        effectiveFrom: "2026-01-01",
      });

      const res = createResponse();

      await createMachineRate(
        req as unknown as Parameters<typeof createMachineRate>[0],
        res
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            machineCode: "CNC-01",
          }),
        })
      );

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should reject a non-positive machine rate", async () => {
      const req = createRequest({
        machineCode: "CNC-01",
        machineName: "CNC Turning Machine",
        ratePerHour: 0,
        effectiveFrom: "2026-01-01",
      });

      const res = createResponse();

      await createMachineRate(
        req as unknown as Parameters<typeof createMachineRate>[0],
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
        machineCode: "CNC-01",
        machineName: "CNC Turning Machine",
        ratePerHour: 900,
        effectiveFrom: "2026-02-01",
      });

      const res = createResponse();

      await createMachineRate(
        req as unknown as Parameters<typeof createMachineRate>[0],
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
        machineCode: "CNC-01",
        machineName: "CNC Turning Machine",
        ratePerHour: 900,
        effectiveFrom: "2027-01-01",
        effectiveTo: "2027-06-01",
      });

      const res = createResponse();

      await createMachineRate(
        req as unknown as Parameters<typeof createMachineRate>[0],
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
        machineCode: "CNC-01",
        machineName: "CNC Turning Machine",
        ratePerHour: 900,
        effectiveFrom: revisionDate,
      });

      const res = createResponse();

      await createMachineRate(
        req as unknown as Parameters<typeof createMachineRate>[0],
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

  describe("deactivateMachineRate", () => {
    it("should deactivate an existing machine rate", async () => {
      mockFindUnique.mockResolvedValue({
        ...sampleRate,
        effectiveFrom: new Date("2025-01-01"),
      });

      const req = createRequest({}, {}, { id: rateId });
      const res = createResponse();

      await deactivateMachineRate(
        req as unknown as Parameters<typeof deactivateMachineRate>[0],
        res
      );

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockAuditLogCreate).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 404 when the machine rate does not exist", async () => {
      mockFindUnique.mockResolvedValue(null);

      const req = createRequest({}, {}, { id: rateId });
      const res = createResponse();

      await deactivateMachineRate(
        req as unknown as Parameters<typeof deactivateMachineRate>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
