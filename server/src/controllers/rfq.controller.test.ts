
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Response } from "express";

const {
  mockCustomerFindUnique,
  mockUserFindUnique,
  mockUserFindMany,
  mockRfqUpdateMany,
  mockRfqFindUnique,
  mockRfqCreate,
  mockRfqFindMany,
  mockRfqCount,
  mockRfqUpdate,
  mockAuditLogCreate,
  mockExtractionJobFindMany,
  mockExtractionJobUpdateMany,
  mockAttachmentUpdateMany,
  mockTransaction,
} = vi.hoisted(() => ({
  mockCustomerFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserFindMany: vi.fn(),
  mockRfqUpdateMany: vi.fn(),
  mockRfqFindUnique: vi.fn(),
  mockRfqCreate: vi.fn(),
  mockRfqFindMany: vi.fn(),
  mockRfqCount: vi.fn(),
  mockRfqUpdate: vi.fn(),
  mockAuditLogCreate: vi.fn(),
  mockExtractionJobFindMany: vi.fn(),
  mockExtractionJobUpdateMany: vi.fn(),
  mockAttachmentUpdateMany: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  default: {
    customer: {
      findUnique: mockCustomerFindUnique,
    },
    user: {
      findUnique: mockUserFindUnique,
      findMany: mockUserFindMany,
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
  getRFQAssignees,
  getRFQById,
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
  updatedAt: new Date("2026-11-09T00:00:00.000Z"),
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
  query: Record<string, unknown> = {},
  role = "ADMIN"
) => {
  return {
    body,
    query,
    params: {},
    user: {
      userId: mockUserId,
      role,
    },
  };
};

const mockTransactionClient = {
  $executeRaw: vi.fn().mockResolvedValue(1),
  user: { findUnique: mockUserFindUnique },
  rFQ: {
    findUnique: mockRfqFindUnique,
    updateMany: mockRfqUpdateMany,
    create: mockRfqCreate,
    update: mockRfqUpdate,
  },
  attachment: {
    updateMany: mockAttachmentUpdateMany,
  },
  extractionJob: {
    findMany: mockExtractionJobFindMany,
    updateMany: mockExtractionJobUpdateMany,
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

    mockRfqUpdateMany.mockResolvedValue({ count: 1 });
    mockUserFindMany.mockResolvedValue([{ id: "estimator-1", name: "Estimator" }]);
    mockRfqCreate.mockResolvedValue(mockRFQ);
    mockRfqUpdate.mockResolvedValue(mockRFQ);

    mockAuditLogCreate.mockResolvedValue({
      id: "audit-test-001",
    });
    mockExtractionJobFindMany.mockResolvedValue([]);
    mockAttachmentUpdateMany.mockResolvedValue({ count: 0 });
    mockExtractionJobUpdateMany.mockResolvedValue({ count: 0 });

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

    it.each(["SALES_HEAD", "PLANT_HEAD"])(
      "rejects RFQ creation by %s",
      async (role) => {
        const req = createRequest(
          {
            rfqNumber: "RFQ-TEST-ROLE",
            customerId: mockCustomerId,
            parts: [mockPart],
          },
          {},
          role
        );
        const res = createResponse();

        await createRFQ(
          req as unknown as Parameters<typeof createRFQ>[0],
          res
        );

        expect(res.status).toHaveBeenCalledWith(403);
        expect(mockTransaction).not.toHaveBeenCalled();
        expect(mockCustomerFindUnique).not.toHaveBeenCalled();
      }
    );

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

  describe("owner permissions and stale updates", () => {
    const request = (body: Record<string, unknown>, role = "ADMIN") => ({
      ...createRequest({ expectedUpdatedAt: mockRFQ.updatedAt.toISOString(), ...body }, {}, role),
      params: { id: mockRFQId },
    });
    it.each(["ADMIN", "ESTIMATOR"])("allows %s to list active estimator names only", async role => {
      const res = createResponse();
      await getRFQAssignees(createRequest({}, {}, role) as never, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockUserFindMany).toHaveBeenCalledWith({ where: { role: "ESTIMATOR", isActive: true }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    });
    it.each(["SALES_HEAD", "PLANT_HEAD"])("blocks %s from owner lookup and reassignment", async role => {
      const res = createResponse();
      await getRFQAssignees(createRequest({}, {}, role) as never, res);
      expect(res.status).toHaveBeenCalledWith(403);
      await updateRFQ(request({ assignedToId: "estimator-1" }, role) as never, res);
      expect(res.status).toHaveBeenLastCalledWith(403);
      expect(mockRfqUpdateMany).not.toHaveBeenCalled();
      expect(mockUserFindMany).not.toHaveBeenCalled();
    });
    it.each(["ADMIN", "ESTIMATOR"])("allows %s to assign an active estimator transactionally", async role => {
      mockRfqFindUnique.mockResolvedValue(mockRFQ);
      mockUserFindUnique.mockResolvedValue({ id: "estimator-1", role: "ESTIMATOR", isActive: true });
      const res = createResponse();
      await updateRFQ(request({ assignedToId: "estimator-1" }, role) as never, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockRfqUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: mockRFQId, status: mockRFQ.status, updatedAt: mockRFQ.updatedAt }, data: expect.objectContaining({ assignedToId: "estimator-1" }) }));
      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
    });
    it.each([null, { role: "SALES_HEAD", isActive: true }, { role: "ESTIMATOR", isActive: false }])("rejects invalid assignee %j", async owner => {
      mockRfqFindUnique.mockResolvedValue(mockRFQ); mockUserFindUnique.mockResolvedValue(owner);
      const res = createResponse(); await updateRFQ(request({ assignedToId: "other" }) as never, res);
      expect(res.status).toHaveBeenCalledWith(400); expect(mockRfqUpdateMany).not.toHaveBeenCalled();
    });
    it("allows clearing an owner without a user lookup", async () => {
      mockRfqFindUnique.mockResolvedValue(mockRFQ);
      const res = createResponse(); await updateRFQ(request({ assignedToId: null }) as never, res);
      expect(res.status).toHaveBeenCalledWith(200); expect(mockUserFindUnique).not.toHaveBeenCalled();
    });
    it.each(["QUOTATION_SENT", "PENDING_APPROVAL"])("rejects manually setting workflow status %s", async status => {
      const res = createResponse(); await updateRFQ(request({ status }) as never, res);
      expect(res.status).toHaveBeenCalledWith(403); expect(mockTransaction).not.toHaveBeenCalled();
    });
    it("requires a stale-update token", async () => {
      const res = createResponse(); await updateRFQ(request({ assignedToId: null, expectedUpdatedAt: undefined }) as never, res);
      expect(res.status).toHaveBeenCalledWith(400); expect(mockTransaction).not.toHaveBeenCalled();
    });
    it("rejects an old browser token without writing", async () => {
      mockRfqFindUnique.mockResolvedValue({ ...mockRFQ, updatedAt: new Date(mockRFQ.updatedAt.getTime() + 1) });
      const res = createResponse(); await updateRFQ(request({ assignedToId: null }) as never, res);
      expect(res.status).toHaveBeenCalledWith(409); expect(mockRfqUpdateMany).not.toHaveBeenCalled(); expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });
    it("rejects a lost compare-and-set race without auditing success", async () => {
      mockRfqFindUnique.mockResolvedValue(mockRFQ); mockRfqUpdateMany.mockResolvedValue({ count: 0 });
      const res = createResponse(); await updateRFQ(request({ assignedToId: null }) as never, res);
      expect(res.status).toHaveBeenCalledWith(409); expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });
  });

  describe("updateRFQ", () => {
    it("requires a reason when marking an RFQ as lost", async () => {
      mockRfqFindUnique.mockResolvedValue({
        ...mockRFQ,
        status: "ESTIMATING",
        lostReason: null,
      });

      const req = {
        ...createRequest({ expectedUpdatedAt: mockRFQ.updatedAt.toISOString(),
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
      expect(mockRfqUpdateMany).not.toHaveBeenCalled();
    });

    it("rejects an invalid status transition", async () => {
      mockRfqFindUnique.mockResolvedValue({
        ...mockRFQ,
        status: "RECEIVED",
      });

      const req = {
        ...createRequest({ expectedUpdatedAt: mockRFQ.updatedAt.toISOString(),
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
      expect(mockRfqUpdateMany).not.toHaveBeenCalled();
    });

    it("updates an RFQ and writes an audit log transactionally", async () => {
      mockRfqFindUnique.mockResolvedValue({
        ...mockRFQ,
        status: "RECEIVED",
      });

      mockRfqFindUnique.mockResolvedValueOnce({ ...mockRFQ, status: "RECEIVED" }).mockResolvedValue({
        ...mockRFQ,
        status: "ESTIMATING",
      });

      const req = {
        ...createRequest({ expectedUpdatedAt: mockRFQ.updatedAt.toISOString(),
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
      expect(mockRfqUpdateMany).toHaveBeenCalledTimes(1);
      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("allows a Sales Head to mark a sent RFQ as won", async () => {
      mockRfqFindUnique.mockResolvedValue({
        ...mockRFQ,
        status: "QUOTATION_SENT",
      });
      mockRfqUpdate.mockResolvedValue({
        ...mockRFQ,
        status: "WON",
      });

      const req = {
        ...createRequest({ expectedUpdatedAt: mockRFQ.updatedAt.toISOString(), status: "WON" }, {}, "SALES_HEAD"),
        params: { id: mockRFQId },
      };
      const res = createResponse();

      await updateRFQ(
        req as unknown as Parameters<typeof updateRFQ>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockRfqUpdateMany).toHaveBeenCalledTimes(1);
    });

    it("allows a Sales Head to mark a sent RFQ as lost with a reason", async () => {
      mockRfqFindUnique.mockResolvedValue({
        ...mockRFQ,
        status: "QUOTATION_SENT",
        lostReason: null,
      });
      mockRfqUpdate.mockResolvedValue({
        ...mockRFQ,
        status: "LOST",
        lostReason: "Commercial terms were not accepted",
      });

      const req = {
        ...createRequest(
          {
            expectedUpdatedAt: mockRFQ.updatedAt.toISOString(),
            status: "LOST",
            lostReason: "Commercial terms were not accepted",
          },
          {},
          "SALES_HEAD"
        ),
        params: { id: mockRFQId },
      };
      const res = createResponse();

      await updateRFQ(
        req as unknown as Parameters<typeof updateRFQ>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockRfqUpdateMany).toHaveBeenCalledTimes(1);
    });

    it("blocks a Sales Head from changing RFQ detail fields", async () => {
      const req = {
        ...createRequest(
          { expectedUpdatedAt: mockRFQ.updatedAt.toISOString(), status: "LOST", lostReason: "Lost commercially", dueDate: "2026-12-01" },
          {},
          "SALES_HEAD"
        ),
        params: { id: mockRFQId },
      };
      const res = createResponse();

      await updateRFQ(
        req as unknown as Parameters<typeof updateRFQ>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockRfqFindUnique).not.toHaveBeenCalled();
      expect(mockRfqUpdateMany).not.toHaveBeenCalled();
    });

    it("blocks unexpected Sales Head RFQ request fields", async () => {
      const req = {
        ...createRequest(
          { expectedUpdatedAt: mockRFQ.updatedAt.toISOString(), status: "WON", unexpectedField: "must not be accepted" },
          {},
          "SALES_HEAD"
        ),
        params: { id: mockRFQId },
      };
      const res = createResponse();

      await updateRFQ(
        req as unknown as Parameters<typeof updateRFQ>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockRfqFindUnique).not.toHaveBeenCalled();
      expect(mockRfqUpdateMany).not.toHaveBeenCalled();
    });

    it("blocks a Sales Head from changing non-commercial RFQ status", async () => {
      const req = {
        ...createRequest({ expectedUpdatedAt: mockRFQ.updatedAt.toISOString(), status: "ESTIMATING" }, {}, "SALES_HEAD"),
        params: { id: mockRFQId },
      };
      const res = createResponse();

      await updateRFQ(
        req as unknown as Parameters<typeof updateRFQ>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockRfqFindUnique).not.toHaveBeenCalled();
      expect(mockRfqUpdateMany).not.toHaveBeenCalled();
    });

    it("blocks Plant Heads from updating RFQs", async () => {
      const req = {
        ...createRequest({ expectedUpdatedAt: mockRFQ.updatedAt.toISOString(), status: "ESTIMATING" }, {}, "PLANT_HEAD"),
        params: { id: mockRFQId },
      };
      const res = createResponse();

      await updateRFQ(
        req as unknown as Parameters<typeof updateRFQ>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockRfqFindUnique).not.toHaveBeenCalled();
      expect(mockRfqUpdateMany).not.toHaveBeenCalled();
    });

    it("allows an Estimator to edit RFQ details", async () => {
      mockRfqFindUnique.mockResolvedValue({
        ...mockRFQ,
        status: "ESTIMATING",
      });

      const req = {
        ...createRequest(
          { expectedUpdatedAt: mockRFQ.updatedAt.toISOString(), dueDate: "2026-12-01", notes: "Updated estimating notes" },
          {},
          "ESTIMATOR"
        ),
        params: { id: mockRFQId },
      };
      const res = createResponse();

      await updateRFQ(
        req as unknown as Parameters<typeof updateRFQ>[0],
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockRfqUpdateMany).toHaveBeenCalledTimes(1);
    });
  });
});


describe("RFQ intake document linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCustomerFindUnique.mockResolvedValue({ id: mockCustomerId });
    mockUserFindUnique.mockResolvedValue({
      id: mockUserId,
      isActive: true,
      role: "ADMIN",
    });
    mockRfqFindUnique.mockResolvedValue(null);
    mockRfqCreate.mockResolvedValue({
      ...mockRFQ,
      parts: [
        { id: "part-1", ...mockPart },
        { id: "part-2", ...mockPart, partNumber: "RWS-015" },
      ],
    });
    mockRfqUpdate.mockResolvedValue(mockRFQ);
    mockAuditLogCreate.mockResolvedValue({ id: "audit-test-001" });
    mockAttachmentUpdateMany.mockResolvedValue({ count: 2 });
    mockExtractionJobUpdateMany.mockResolvedValue({ count: 2 });
    mockTransaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback === "function") {
        return callback(mockTransactionClient);
      }
      return Promise.all(callback as Promise<unknown>[]);
    });
  });

  const reviewedJobs = [
    {
      id: "job-1",
      status: "COMPLETED",
      attachment: {
        id: "attachment-1",
        rfqId: null,
        uploadedById: mockUserId,
      },
      fields: [{ reviewStatus: "ACCEPTED" }],
    },
    {
      id: "job-2",
      status: "COMPLETED",
      attachment: {
        id: "attachment-2",
        rfqId: null,
        uploadedById: mockUserId,
      },
      fields: [{ reviewStatus: "REJECTED" }],
    },
  ];

  it("creates all reviewed parts and atomically links every selected document", async () => {
    mockExtractionJobFindMany.mockResolvedValue(reviewedJobs);
    const secondPart = {
      ...mockPart,
      partNumber: "RWS-015",
      name: "Rear Wheel Spindle LH",
    };
    const req = createRequest({
      rfqNumber: "RFQ-INTAKE-001",
      customerId: mockCustomerId,
      parts: [mockPart, secondPart],
      extractionJobIds: ["job-1", "job-2"],
    });
    const res = createResponse();

    await createRFQ(req as any, res);

    expect(mockRfqCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parts: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ name: mockPart.name }),
              expect.objectContaining({ name: secondPart.name }),
            ]),
          }),
        }),
      })
    );
    expect(mockAttachmentUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["attachment-1", "attachment-2"] },
        rfqId: null,
      },
      data: { rfqId: mockRFQId },
    });
    expect(mockExtractionJobUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["job-1", "job-2"] },
        rfqId: null,
      },
      data: { rfqId: mockRFQId },
    });
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "DOCUMENTS_LINKED_TO_RFQ",
          details: expect.objectContaining({
            extractionJobIds: ["job-1", "job-2"],
            attachmentIds: ["attachment-1", "attachment-2"],
          }),
        }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects pending extracted fields before creating an RFQ", async () => {
    mockExtractionJobFindMany.mockResolvedValue([
      {
        ...reviewedJobs[0],
        fields: [{ reviewStatus: "PENDING" }],
      },
    ]);
    const req = createRequest({
      rfqNumber: "RFQ-INTAKE-002",
      customerId: mockCustomerId,
      parts: [mockPart],
      extractionJobIds: ["job-1"],
    });
    const res = createResponse();

    await createRFQ(req as any, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockRfqCreate).not.toHaveBeenCalled();
    expect(mockAttachmentUpdateMany).not.toHaveBeenCalled();
  });

  it("audits the document-qualified source group for each reviewed part", async () => {
    mockExtractionJobFindMany.mockResolvedValue(reviewedJobs.map((job) => ({ ...job, fields: [{ reviewStatus: "ACCEPTED", groupKey: "part:row-2" }] })));
    const req = createRequest({ rfqNumber: "RFQ-SOURCES", customerId: mockCustomerId,
      parts: [{ ...mockPart, sourceGroupKey: "job-1::part:row-2" }, { ...mockPart, partNumber: "OTHER-PART", sourceGroupKey: "job-2::part:row-2" }],
      extractionJobIds: ["job-1", "job-2"] });
    const res = createResponse();
    await createRFQ(req as unknown as Parameters<typeof createRFQ>[0], res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: "DOCUMENTS_LINKED_TO_RFQ", details: expect.objectContaining({ partSources: [
        expect.objectContaining({ partNumber: mockPart.partNumber, sourceGroupKey: "job-1::part:row-2" }),
        expect.objectContaining({ partNumber: "OTHER-PART", sourceGroupKey: "job-2::part:row-2" }),
      ] }),
    }) }));
  });

  it.each(["unknown group", "duplicate group", "duplicate part"])("rejects %s before creating records", async (kind) => {
    mockExtractionJobFindMany.mockResolvedValue(reviewedJobs.map((job) => ({ ...job, fields: [{ reviewStatus: "ACCEPTED", groupKey: "part:row-2" }] })));
    const first = { ...mockPart, sourceGroupKey: "job-1::part:row-2" };
    const second = { ...mockPart, partNumber: kind === "duplicate part" ? mockPart.partNumber : "SECOND-PART",
      sourceGroupKey: kind === "unknown group" ? "other-job::part:row-2" : kind === "duplicate group" ? first.sourceGroupKey : "job-2::part:row-2" };
    const req = createRequest({ rfqNumber: "RFQ-INVALID-SOURCES", customerId: mockCustomerId,
      parts: [first, second], extractionJobIds: ["job-1", "job-2"] });
    const res = createResponse();
    await createRFQ(req as unknown as Parameters<typeof createRFQ>[0], res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockRfqCreate).not.toHaveBeenCalled();
  });

  it("rejects another estimator's selected document", async () => {
    mockExtractionJobFindMany.mockResolvedValue([
      {
        ...reviewedJobs[0],
        attachment: {
          ...reviewedJobs[0].attachment,
          uploadedById: "other-estimator",
        },
      },
    ]);
    const req = createRequest(
      {
        rfqNumber: "RFQ-INTAKE-003",
        customerId: mockCustomerId,
        parts: [mockPart],
        extractionJobIds: ["job-1"],
      },
      {},
      "ESTIMATOR"
    );
    const res = createResponse();

    await createRFQ(req as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockRfqCreate).not.toHaveBeenCalled();
  });

  it("fails linking safely when an attachment was concurrently linked", async () => {
    mockExtractionJobFindMany.mockResolvedValue(reviewedJobs);
    mockAttachmentUpdateMany.mockResolvedValue({ count: 1 });
    const req = createRequest({
      rfqNumber: "RFQ-INTAKE-004",
      customerId: mockCustomerId,
      parts: [mockPart],
      extractionJobIds: ["job-1", "job-2"],
    });
    const res = createResponse();

    await createRFQ(req as any, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockExtractionJobUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["ADMIN", "admin", true], ["ESTIMATOR", "uploader", true],
    ["ESTIMATOR", "creator", true], ["ESTIMATOR", "owner", true],
    ["ESTIMATOR", "unrelated", false], ["SALES_HEAD", "uploader", false],
    ["PLANT_HEAD", "technical", true], ["UNKNOWN", "uploader", false],
  ])("RFQ details enforce raw document access for %s %s", async (role, userId, allowed) => {
    const attachment = { id: "attachment-1", uploadedById: "uploader", fileName: "SECRET-drawing.pdf" };
    mockRfqFindUnique.mockResolvedValue({ ...mockRFQ, createdById: "creator", assignedToId: "owner",
      attachments: [attachment], extractionJobs: [{ id: "job-1", attachment,
        errorMessage: "SECRET-provider-diagnostic", fields: [{ extractedValue: "SECRET-value", acceptedValue: "SECRET-review-value", evidenceText: "SECRET-drawing-title-block", sourceReference: "SECRET-page", sourceId: "SECRET-source", groupKey: "SECRET-provenance" }] }],
      parts: [{ name: "Accepted business part" }], quotations: [],
    });
    const res = createResponse();
    await getRFQById({ user: { role, userId }, params: { id: mockRFQId } } as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = vi.mocked(res.json).mock.calls[0][0];
    expect(payload.data.extractionJobs).toHaveLength(allowed ? 1 : 0);
    expect(payload.data.attachments).toHaveLength(allowed ? 1 : 0);
    expect(JSON.stringify(payload).includes("SECRET")).toBe(allowed);
    expect(payload.data.parts[0].name).toBe("Accepted business part");
    expect(mockRfqFindUnique.mock.calls[0][0].include.extractionJobs.select.attachment.select.storagePath).toBeUndefined();
  });
  it("requires authentication before retrieving RFQ details", async () => {
    const res = createResponse();
    await getRFQById({ params: { id: mockRFQId } } as any, res);
    expect(res.status).toHaveBeenCalledWith(401); expect(mockRfqFindUnique).not.toHaveBeenCalled();
  });

  it("selects safe attachment fields and never requests storagePath in RFQ responses", async () => {
    mockRfqFindUnique.mockResolvedValue({
      ...mockRFQ,
      attachments: [{
        id: "attachment-1",
        rfqId: mockRFQId,
        partId: null,
        uploadedById: mockUserId,
        fileName: "customer.pdf",
        mimeType: "application/pdf",
        fileSize: 123,
        createdAt: new Date(),
      }],
      extractionJobs: [],
      quotations: [],
    });
    const res = createResponse();

    await getRFQById({ ...createRequest(), params: { id: mockRFQId } } as any, res);

    const query = mockRfqFindUnique.mock.calls[0]?.[0]
    expect(query.include.attachments.select.storagePath).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
