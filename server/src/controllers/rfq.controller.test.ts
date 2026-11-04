
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Response } from "express";

const {
  mockCustomerFindUnique,
  mockUserFindUnique,
  mockRfqFindUnique,
  mockRfqCreate,
  mockRfqFindMany,
  mockRfqCount,
  mockRfqUpdate,
  mockAuditLogCreate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockCustomerFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockRfqFindUnique: vi.fn(),
  mockRfqCreate: vi.fn(),
  mockRfqFindMany: vi.fn(),
  mockRfqCount: vi.fn(),
  mockRfqUpdate: vi.fn(),
  mockAuditLogCreate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  default: {
    customer: {
      findUnique: mockCustomerFindUnique,
    },
    user: {
      findUnique: mockUserFindUnique,
    },
    rFQ: {
      findUnique: mockRfqFindUnique,
      create: mockRfqCreate,
      findMany: mockRfqFindMany,
      count: mockRfqCount,
      update: mockRfqUpdate,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
    $transaction: mockTransaction,
  },
}));

import {
  createRFQ,
  getRFQs,
  updateRFQ,
} from "./rfq.controller.js";

const mockUserId = "user-test-001";
const mockCustomerId = "customer-test-001";
const mockRFQId = "rfq-test-001";

const mockPart = {
  partNumber: "RWS-014",
  name: "Rear Wheel Spindle",
  materialGrade: "EN8",
  grossWeightKg: 0.61,
  annualVolume: 180000,
  drawingNumber: "RWS-014",
};

const mockRFQ = {
  id: mockRFQId,
  rfqNumber: "RFQ-TEST-001",
  customerId: mockCustomerId,
  createdById: mockUserId,
  assignedToId: null,
  status: "RECEIVED",
  parts: [{ id: "part-test-001", ...mockPart }],
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
  query: Record<string, unknown> = {}
) => {
  return {
    body,
    query,
    params: {},
    user: {
      userId: mockUserId,
      role: "ADMIN",
    },
  };
};

const mockTransactionClient = {
  rFQ: {
    create: mockRfqCreate,
    update: mockRfqUpdate,
  },
  auditLog: {
    create: mockAuditLogCreate,
  },
};

describe("RFQ Controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCustomerFindUnique.mockResolvedValue({
      id: mockCustomerId,
    });

    mockUserFindUnique.mockResolvedValue({
      id: mockUserId,
      isActive: true,
      role: "ADMIN",
    });

    mockRfqFindUnique.mockResolvedValue(null);

    mockRfqCreate.mockResolvedValue(mockRFQ);
    mockRfqUpdate.mockResolvedValue(mockRFQ);

    mockAuditLogCreate.mockResolvedValue({
      id: "audit-test-001",
    });

    mockTransaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback === "function") {
        return callback(mockTransactionClient);
      }

      return Promise.all(callback as Promise<unknown>[]);
    });
  });

  // CREATE RFQ

  describe("createRFQ", () => {
    it("creates an RFQ with its parts successfully", async () => {
      mockRfqCreate.mockResolvedValue(mockRFQ);

      const req = createRequest({
        rfqNumber: "RFQ-TEST-001",
        customerId: mockCustomerId,
        parts: [mockPart],
      });

      const res = createResponse();

      await createRFQ(
        req as unknown as Parameters<typeof createRFQ>[0],
        res
      );

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockRfqCreate).toHaveBeenCalledTimes(1);
      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);

      expect(res.status).toHaveBeenCalledWith(201);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "RFQ created successfully",
        })
      );
    });

    it("rejects invalid RFQ data", async () => {
      const req = createRequest({
        rfqNumber: "A",
        customerId: "",
        parts: [],
      });

      const res = createResponse();

      await createRFQ(
        req as unknown as Parameters<typeof createRFQ>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("rejects an RFQ when the customer does not exist", async () => {
      mockCustomerFindUnique.mockResolvedValue(null);

      const req = createRequest({
        rfqNumber: "RFQ-TEST-002",
        customerId: mockCustomerId,
        parts: [mockPart],
      });

      const res = createResponse();

      await createRFQ(
        req as unknown as Parameters<typeof createRFQ>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("rejects duplicate RFQ numbers", async () => {
      mockRfqFindUnique.mockResolvedValue({
        id: mockRFQId,
      });

      const req = createRequest({
        rfqNumber: "RFQ-TEST-001",
        customerId: mockCustomerId,
        parts: [mockPart],
      });

      const res = createResponse();

      await createRFQ(
        req as unknown as Parameters<typeof createRFQ>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("rejects an invalid estimator assignment", async () => {
      mockUserFindUnique
        .mockResolvedValueOnce({
          id: mockUserId,
          isActive: true,
          role: "ADMIN",
        })
        .mockResolvedValueOnce({
          id: "sales-user-001",
          isActive: true,
          role: "SALES_HEAD",
        });

      const req = createRequest({
        rfqNumber: "RFQ-TEST-003",
        customerId: mockCustomerId,
        assignedToId: "sales-user-001",
        parts: [mockPart],
      });

      const res = createResponse();

      await createRFQ(
        req as unknown as Parameters<typeof createRFQ>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });

  // LIST RFQS

  describe("getRFQs", () => {
    it("returns paginated RFQ results", async () => {
      mockRfqFindMany.mockResolvedValue([mockRFQ]);
      mockRfqCount.mockResolvedValue(21);

      const req = createRequest({}, {
        page: "2",
        limit: "10",
      });

      const res = createResponse();

      await getRFQs(
        req as unknown as Parameters<typeof getRFQs>[0],
        res
      );

      expect(mockRfqFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        })
      );

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          count: 1,
          pagination: {
            page: 2,
            limit: 10,
            total: 21,
            totalPages: 3,
          },
        })
      );
    });

    it("rejects invalid pagination parameters", async () => {
      const req = createRequest({}, {
        page: "0",
        limit: "500",
      });

      const res = createResponse();

      await getRFQs(
        req as unknown as Parameters<typeof getRFQs>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockRfqFindMany).not.toHaveBeenCalled();
    });

    it("supports RFQ status filtering", async () => {
      mockRfqFindMany.mockResolvedValue([mockRFQ]);
      mockRfqCount.mockResolvedValue(1);

      const req = createRequest({}, {
        status: "RECEIVED",
      });

      const res = createResponse();

      await getRFQs(
        req as unknown as Parameters<typeof getRFQs>[0],
        res
      );

      expect(mockRfqFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "RECEIVED",
          }),
        })
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // UPDATE RFQ

  describe("updateRFQ", () => {
    it("requires a reason when marking an RFQ as lost", async () => {
      mockRfqFindUnique.mockResolvedValue({
        ...mockRFQ,
        status: "ESTIMATING",
        lostReason: null,
      });

      const req = {
        ...createRequest({
          status: "LOST",
        }),
        params: {
          id: mockRFQId,
        },
      };

      const res = createResponse();

      await updateRFQ(
        req as unknown as Parameters<typeof updateRFQ>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockRfqUpdate).not.toHaveBeenCalled();
    });

    it("rejects an invalid status transition", async () => {
      mockRfqFindUnique.mockResolvedValue({
        ...mockRFQ,
        status: "RECEIVED",
      });

      const req = {
        ...createRequest({
          status: "WON",
        }),
        params: {
          id: mockRFQId,
        },
      };

      const res = createResponse();

      await updateRFQ(
        req as unknown as Parameters<typeof updateRFQ>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockRfqUpdate).not.toHaveBeenCalled();
    });

    it("updates an RFQ and writes an audit log transactionally", async () => {
      mockRfqFindUnique.mockResolvedValue({
        ...mockRFQ,
        status: "RECEIVED",
      });

      mockRfqUpdate.mockResolvedValue({
        ...mockRFQ,
        status: "ESTIMATING",
      });

      const req = {
        ...createRequest({
          status: "ESTIMATING",
        }),
        params: {
          id: mockRFQId,
        },
      };

      const res = createResponse();

      await updateRFQ(
        req as unknown as Parameters<typeof updateRFQ>[0],
        res
      );

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockRfqUpdate).toHaveBeenCalledTimes(1);
      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
