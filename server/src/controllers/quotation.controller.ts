import { Request, Response } from "express";
import { Prisma, QuotationStatus, ApprovalStatus } from "@prisma/client";
import { z } from "zod";

import prisma from "../lib/prisma.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

const APPROVAL_THRESHOLD = 2500000;

const createQuotationSchema = z.object({
  rfqId: z.string().min(1),
  validUntil: z.coerce.date().optional(),
  gstPercentage: z.number().min(0).max(100).default(18),
  notes: z.string().trim().max(2000).optional(),
  parts: z.array(
    z.object({
      partId: z.string().min(1),
      costingId: z.string().min(1),
      annualVolume: z.number().int().positive(),
    })
  ).min(1).max(100),
});

const rejectQuotationSchema = z.object({
  comments: z.string().trim().min(5).max(1000),
});

const listQuotationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  status: z.nativeEnum(QuotationStatus).optional(),
  customerId: z.string().optional(),
  rfqId: z.string().optional(),
  search: z.string().trim().max(100).optional(),
});

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

const quotationInclude = {
  customer: true,
  createdBy: {
    select: { id: true, name: true, email: true },
  },
  parts: {
    include: {
      part: true,
      costing: {
        include: {
          volumes: true,
          components: true,
        },
      },
    },
  },
  approvals: {
    include: {
      approver: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
  },
} satisfies Prisma.QuotationInclude;

const generateQuotationNumber = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const suffix = `${Date.now().toString(36).toUpperCase()}`;
  return `QUO-${year}${month}${day}-${suffix}`;
};

const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

// --------------------------------------------------
// Create quotation
// --------------------------------------------------

export const createQuotation = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!["ESTIMATOR", "ADMIN"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only estimators or administrators can create quotations",
      });
    }

    const validation = createQuotationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid quotation details",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const data = validation.data;

    if (data.validUntil && data.validUntil <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "Quotation validity date must be in the future",
      });
    }

    const quotation = await prisma.$transaction(async (tx) => {
      const rfq = await tx.rFQ.findUnique({
        where: { id: data.rfqId },
        include: {
          customer: true,
          parts: true,
        },
      });

      if (!rfq) throw new Error("RFQ_NOT_FOUND");

      if (["WON", "LOST"].includes(rfq.status)) {
        throw new Error("RFQ_CLOSED");
      }

      const requestedPartIds = data.parts.map((item) => item.partId);

      if (new Set(requestedPartIds).size !== requestedPartIds.length) {
        throw new Error("DUPLICATE_PART");
      }

      const rfqPartIds = new Set(rfq.parts.map((part) => part.id));

      for (const item of data.parts) {
        if (!rfqPartIds.has(item.partId)) {
          throw new Error("PART_NOT_IN_RFQ");
        }
      }

      const quotationParts: {
        partId: string;
        costingId: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
      }[] = [];

      let subtotal = 0;
      let annualQuotationValue = 0;

      for (const item of data.parts) {
        const costing = await tx.costing.findFirst({
          where: {
            id: item.costingId,
            partId: item.partId,
          },
          include: {
            volumes: {
              where: { annualVolume: item.annualVolume },
            },
          },
        });

        if (!costing) throw new Error("COSTING_NOT_FOUND");

        const selectedVolume = costing.volumes[0];

        if (!selectedVolume) {
          throw new Error("COSTING_VOLUME_NOT_FOUND");
        }

        const unitPrice = Number(selectedVolume.unitPrice);

        if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
          throw new Error("INVALID_COSTING_PRICE");
        }

        const totalPrice = roundMoney(unitPrice * item.annualVolume);

        subtotal += totalPrice;
        annualQuotationValue += totalPrice;

        quotationParts.push({
          partId: item.partId,
          costingId: item.costingId,
          quantity: item.annualVolume,
          unitPrice,
          totalPrice,
        });
      }

      subtotal = roundMoney(subtotal);

      const gstAmount = roundMoney(
        subtotal * (data.gstPercentage / 100)
      );

      const grandTotal = roundMoney(subtotal + gstAmount);

      const requiresApproval =
        annualQuotationValue > APPROVAL_THRESHOLD;

      const quotationNumber = generateQuotationNumber();

      const created = await tx.quotation.create({
        data: {
          quotationNumber,
          rfqId: rfq.id,
          customerId: rfq.customerId,
          createdById: req.user!.userId,
          status: QuotationStatus.DRAFT,
          validUntil: data.validUntil,
          gstPercentage: data.gstPercentage,
          subtotal,
          gstAmount,
          grandTotal,
          notes: data.notes,
          parts: {
            create: quotationParts,
          },
        },
        include: quotationInclude,
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "QUOTATION_CREATED",
          entityType: "QUOTATION",
          entityId: created.id,
          details: {
            quotationNumber: created.quotationNumber,
            rfqNumber: rfq.rfqNumber,
            subtotal,
            gstAmount,
            grandTotal,
            annualQuotationValue,
            requiresApproval,
          },
        },
      });

      return {
        quotation: created,
        annualQuotationValue,
        requiresApproval,
      };
    });

    return res.status(201).json({
      success: true,
      message: "Quotation created successfully",
      data: quotation,
    });
  } catch (error) {
    const knownErrors: Record<string, { status: number; message: string }> = {
      RFQ_NOT_FOUND: { status: 404, message: "RFQ not found" },
      RFQ_CLOSED: { status: 400, message: "Cannot quote against a closed RFQ" },
      DUPLICATE_PART: {
        status: 400,
        message: "A part can only appear once in a quotation",
      },
      PART_NOT_IN_RFQ: {
        status: 400,
        message: "A selected part does not belong to this RFQ",
      },
      COSTING_NOT_FOUND: {
        status: 404,
        message: "Costing not found for the selected part",
      },
      COSTING_VOLUME_NOT_FOUND: {
        status: 400,
        message: "No saved costing exists for the selected annual volume",
      },
      INVALID_COSTING_PRICE: {
        status: 400,
        message: "The saved costing price is invalid",
      },
    };

    if (error instanceof Error && knownErrors[error.message]) {
      const known = knownErrors[error.message];

      return res.status(known.status).json({
        success: false,
        message: known.message,
      });
    }

    if (isUniqueConstraintError(error)) {
      return res.status(409).json({
        success: false,
        message: "A quotation with this number already exists. Please retry.",
      });
    }

    console.error("Create quotation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create quotation",
    });
  }
};

// --------------------------------------------------
// List quotations
// --------------------------------------------------

export const getQuotations = async (
  req: Request,
  res: Response
) => {
  try {
    const validation = listQuotationQuerySchema.safeParse(req.query);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid quotation filters",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { page, limit, status, customerId, rfqId, search } =
      validation.data;

    const where: Prisma.QuotationWhereInput = {
      ...(status && { status }),
      ...(customerId && { customerId }),
      ...(rfqId && { rfqId }),
      ...(search && {
        OR: [
          {
            quotationNumber: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            customer: {
              name: {
                contains: search,
                mode: "insensitive",
              },
            },
          },
        ],
      }),
    };

    const [quotations, total] = await prisma.$transaction([
      prisma.quotation.findMany({
        where,
        include: quotationInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.quotation.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      count: quotations.length,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      data: quotations,
    });
  } catch (error) {
    console.error("Get quotations error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve quotations",
    });
  }
};

// --------------------------------------------------
// Get quotation by ID
// --------------------------------------------------

export const getQuotationById = async (
  req: Request,
  res: Response
) => {
  try {
    const quotationId = req.params.id;

    if (typeof quotationId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid quotation ID",
      });
    }

    const quotation = await prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        ...quotationInclude,
        rfq: {
          include: {
            parts: true,
          },
        },
      },
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: "Quotation not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: quotation,
    });
  } catch (error) {
    console.error("Get quotation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve quotation",
    });
  }
};

// --------------------------------------------------
// Submit quotation for approval
// --------------------------------------------------

export const submitQuotation = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!["ESTIMATOR", "ADMIN"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only estimators or administrators can submit quotations",
      });
    }

    const quotationId = req.params.id;

    if (typeof quotationId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid quotation ID",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findUnique({
        where: { id: quotationId },
        include: { parts: true },
      });

      if (!quotation) throw new Error("QUOTATION_NOT_FOUND");

      if (quotation.status !== QuotationStatus.DRAFT) {
        throw new Error("INVALID_QUOTATION_STATUS");
      }

      const annualQuotationValue = roundMoney(
        quotation.parts.reduce(
          (total, part) =>
            total + Number(part.unitPrice) * part.quantity,
          0
        )
      );

      const requiresApproval =
        annualQuotationValue > APPROVAL_THRESHOLD;

      let nextStatus: QuotationStatus = QuotationStatus.APPROVED;

      if (requiresApproval) {
        const salesHead = await tx.user.findFirst({
          where: {
            role: "SALES_HEAD",
            isActive: true,
          },
          orderBy: { createdAt: "asc" },
        });

        if (!salesHead) throw new Error("SALES_HEAD_NOT_FOUND");

        await tx.approval.create({
          data: {
            quotationId,
            approverId: salesHead.id,
            status: ApprovalStatus.PENDING,
          },
        });

        nextStatus = QuotationStatus.PENDING_APPROVAL;
      }

      const updatedQuotation = await tx.quotation.update({
        where: { id: quotationId },
        data: { status: nextStatus },
        include: quotationInclude,
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "QUOTATION_SUBMITTED",
          entityType: "QUOTATION",
          entityId: quotationId,
          details: {
            quotationNumber: quotation.quotationNumber,
            annualQuotationValue,
            requiresApproval,
            status: nextStatus,
          },
        },
      });

      return {
        quotation: updatedQuotation,
        annualQuotationValue,
        requiresApproval,
      };
    });

    return res.status(200).json({
      success: true,
      message: result.requiresApproval
        ? "Quotation submitted for Sales Head approval"
        : "Quotation approved automatically",
      data: result,
    });
  } catch (error) {
    const knownErrors: Record<string, { status: number; message: string }> = {
      QUOTATION_NOT_FOUND: {
        status: 404,
        message: "Quotation not found",
      },
      INVALID_QUOTATION_STATUS: {
        status: 400,
        message: "Only draft quotations can be submitted",
      },
      SALES_HEAD_NOT_FOUND: {
        status: 409,
        message: "No active Sales Head is available to approve this quotation",
      },
    };

    if (error instanceof Error && knownErrors[error.message]) {
      const known = knownErrors[error.message];

      return res.status(known.status).json({
        success: false,
        message: known.message,
      });
    }

    console.error("Submit quotation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to submit quotation",
    });
  }
};

// --------------------------------------------------
// Approve quotation
// --------------------------------------------------

export const approveQuotation = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (req.user.role !== "SALES_HEAD") {
      return res.status(403).json({
        success: false,
        message: "Only Sales Heads can approve quotations",
      });
    }

    const quotationId = req.params.id;

    if (typeof quotationId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid quotation ID",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findUnique({
        where: { id: quotationId },
      });

      if (!quotation) throw new Error("QUOTATION_NOT_FOUND");

      if (quotation.status !== QuotationStatus.PENDING_APPROVAL) {
        throw new Error("QUOTATION_NOT_PENDING");
      }

      const approval = await tx.approval.findFirst({
        where: {
          quotationId,
          approverId: req.user!.userId,
          status: ApprovalStatus.PENDING,
        },
      });

      if (!approval) throw new Error("APPROVAL_NOT_ASSIGNED");

      await tx.approval.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatus.APPROVED,
          approvedAt: new Date(),
        },
      });

      const updatedQuotation = await tx.quotation.update({
        where: { id: quotationId },
        data: { status: QuotationStatus.APPROVED },
        include: quotationInclude,
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "QUOTATION_APPROVED",
          entityType: "QUOTATION",
          entityId: quotationId,
          details: {
            quotationNumber: quotation.quotationNumber,
          },
        },
      });

      return updatedQuotation;
    });

    return res.status(200).json({
      success: true,
      message: "Quotation approved successfully",
      data: result,
    });
  } catch (error) {
    const knownErrors: Record<string, { status: number; message: string }> = {
      QUOTATION_NOT_FOUND: {
        status: 404,
        message: "Quotation not found",
      },
      QUOTATION_NOT_PENDING: {
        status: 400,
        message: "Quotation is not awaiting approval",
      },
      APPROVAL_NOT_ASSIGNED: {
        status: 403,
        message: "You are not the assigned approver for this quotation",
      },
    };

    if (error instanceof Error && knownErrors[error.message]) {
      const known = knownErrors[error.message];

      return res.status(known.status).json({
        success: false,
        message: known.message,
      });
    }

    console.error("Approve quotation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to approve quotation",
    });
  }
};

// --------------------------------------------------
// Reject quotation
// --------------------------------------------------

export const rejectQuotation = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (req.user.role !== "SALES_HEAD") {
      return res.status(403).json({
        success: false,
        message: "Only Sales Heads can reject quotations",
      });
    }

    const quotationId = req.params.id;

    if (typeof quotationId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid quotation ID",
      });
    }

    const validation = rejectQuotationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "A rejection reason of at least 5 characters is required",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findUnique({
        where: { id: quotationId },
      });

      if (!quotation) throw new Error("QUOTATION_NOT_FOUND");

      if (quotation.status !== QuotationStatus.PENDING_APPROVAL) {
        throw new Error("QUOTATION_NOT_PENDING");
      }

      const approval = await tx.approval.findFirst({
        where: {
          quotationId,
          approverId: req.user!.userId,
          status: ApprovalStatus.PENDING,
        },
      });

      if (!approval) throw new Error("APPROVAL_NOT_ASSIGNED");

      await tx.approval.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatus.REJECTED,
          comments: validation.data.comments,
        },
      });

      const updatedQuotation = await tx.quotation.update({
        where: { id: quotationId },
        data: { status: QuotationStatus.REJECTED },
        include: quotationInclude,
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "QUOTATION_REJECTED",
          entityType: "QUOTATION",
          entityId: quotationId,
          details: {
            quotationNumber: quotation.quotationNumber,
            reason: validation.data.comments,
          },
        },
      });

      return updatedQuotation;
    });

    return res.status(200).json({
      success: true,
      message: "Quotation rejected successfully",
      data: result,
    });
  } catch (error) {
    const knownErrors: Record<string, { status: number; message: string }> = {
      QUOTATION_NOT_FOUND: {
        status: 404,
        message: "Quotation not found",
      },
      QUOTATION_NOT_PENDING: {
        status: 400,
        message: "Quotation is not awaiting approval",
      },
      APPROVAL_NOT_ASSIGNED: {
        status: 403,
        message: "You are not the assigned approver for this quotation",
      },
    };

    if (error instanceof Error && knownErrors[error.message]) {
      const known = knownErrors[error.message];

      return res.status(known.status).json({
        success: false,
        message: known.message,
      });
    }

    console.error("Reject quotation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to reject quotation",
    });
  }
};

// --------------------------------------------------
// Send approved quotation
// --------------------------------------------------

export const sendQuotation = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!["ESTIMATOR", "ADMIN"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only estimators or administrators can send quotations",
      });
    }

    const quotationId = req.params.id;

    if (typeof quotationId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid quotation ID",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findUnique({
        where: { id: quotationId },
        include: { rfq: true },
      });

      if (!quotation) throw new Error("QUOTATION_NOT_FOUND");

      if (quotation.status !== QuotationStatus.APPROVED) {
        throw new Error("QUOTATION_NOT_APPROVED");
      }

      if (
        !["ESTIMATING", "PENDING_APPROVAL"].includes(
          quotation.rfq.status
        )
      ) {
        throw new Error("INVALID_RFQ_STATUS");
      }

      const updatedQuotation = await tx.quotation.update({
        where: { id: quotationId },
        data: { status: QuotationStatus.SENT },
        include: quotationInclude,
      });

      await tx.rFQ.update({
        where: { id: quotation.rfqId },
        data: { status: "QUOTATION_SENT" },
      });

      await tx.auditLog.createMany({
        data: [
          {
            actorId: req.user!.userId,
            action: "QUOTATION_SENT",
            entityType: "QUOTATION",
            entityId: quotationId,
            details: {
              quotationNumber: quotation.quotationNumber,
            },
          },
          {
            actorId: req.user!.userId,
            action: "RFQ_QUOTATION_SENT",
            entityType: "RFQ",
            entityId: quotation.rfqId,
            details: {
              quotationNumber: quotation.quotationNumber,
            },
          },
        ],
      });

      return updatedQuotation;
    });

    return res.status(200).json({
      success: true,
      message: "Quotation marked as sent successfully",
      data: result,
    });
  } catch (error) {
    const knownErrors: Record<string, { status: number; message: string }> = {
      QUOTATION_NOT_FOUND: {
        status: 404,
        message: "Quotation not found",
      },
      QUOTATION_NOT_APPROVED: {
        status: 400,
        message: "Only approved quotations can be sent",
      },
      INVALID_RFQ_STATUS: {
        status: 400,
        message: "The RFQ is not in a state that allows sending a quotation",
      },
    };

    if (error instanceof Error && knownErrors[error.message]) {
      const known = knownErrors[error.message];

      return res.status(known.status).json({
        success: false,
        message: known.message,
      });
    }

    console.error("Send quotation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to send quotation",
    });
  }
};
