import { gstPercentageSchema } from "../services/gst-validation.service.js";
import { lockRFQ, getLockedRFQ, assertRFQOpen, syncRFQLifecycle, RFQLifecycleError } from "../services/rfq-lifecycle.service.js";
import { getCompanySettings } from "../services/company-settings.service.js";
import { requireApprovedRoutings, TechnicalReviewConflict } from "../services/routing-review.service.js";
import { Request, Response } from "express";
import { Prisma, QuotationStatus, ApprovalStatus } from "@prisma/client";
import { z } from "zod";

import prisma from "../lib/prisma.js";
import { generateQuotationPdf } from "../services/quotation-pdf.service.js";
import {
  buildApprovedQuotationSnapshot,
  isApprovedQuotationSnapshot,
} from "../services/quotation-snapshot.service.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

const APPROVAL_THRESHOLD = 2500000;

const createQuotationSchema = z.object({
  rfqId: z.string().min(1),
  validUntil: z.coerce.date().optional(),
  gstPercentage: gstPercentageSchema.default(18),
  notes: z.string().trim().max(2000).optional(),
  paymentTerms: z.string().trim().max(1000).optional(),
  deliveryTerms: z.string().trim().max(1000).optional(),
  commercialTerms: z.string().trim().max(2000).optional(),
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

const isApprovedSnapshotValidationError = (error: unknown): boolean =>
  error instanceof Error && (
    error.message === "APPROVED_SNAPSHOT_INVALID" ||
    error.message.startsWith("Invalid snapshot field:") ||
    error.message.startsWith("Approved snapshots require saved")
  );

const quotationInclude = {
  rfq: { select: { rfqNumber: true } },
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
      await lockRFQ(tx, data.rfqId);
      const rfq = await tx.rFQ.findUnique({
        where: { id: data.rfqId },
        include: {
          customer: true,
          parts: true,
        },
      });

      if (!rfq) throw new Error("RFQ_NOT_FOUND");

      assertRFQOpen(rfq);

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
          paymentTerms: data.paymentTerms,
          deliveryTerms: data.deliveryTerms,
          commercialTerms: data.commercialTerms,
          parts: {
            create: quotationParts,
          },
        },
        include: quotationInclude,
      });

      await syncRFQLifecycle(tx, rfq, req.user!.userId);
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
    if (error instanceof RFQLifecycleError) return res.status(error.status).json({ success: false, message: error.message });
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
        include: quotationInclude,
      });

      if (!quotation) throw new Error("QUOTATION_NOT_FOUND");

      if (quotation.status !== QuotationStatus.DRAFT) {
        throw new Error("QUOTATION_TRANSITION_CONFLICT");
      }

      const technicalReviews = await requireApprovedRoutings(tx, quotation.parts);
      const parentRFQ = await getLockedRFQ(tx, quotation.rfqId);
      assertRFQOpen(parentRFQ);

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

      const approvedAt = nextStatus === QuotationStatus.APPROVED
        ? new Date()
        : null;
      const companySettings = approvedAt ? await getCompanySettings(tx) : null;
      const approvedSnapshot = approvedAt
        ? buildApprovedQuotationSnapshot(quotation, {
            mode: "AUTOMATIC_THRESHOLD",
            approvedAt,
          }, companySettings!.company)
        : undefined;

      const transition = await tx.quotation.updateMany({
        where: { id: quotationId, status: QuotationStatus.DRAFT },
        data: {
          status: nextStatus,
          ...(approvedAt && {
            approvedAt,
            approvedSnapshot,
          }),
        },
      });
      if (transition.count !== 1) throw new Error("QUOTATION_TRANSITION_CONFLICT");

      await syncRFQLifecycle(tx, parentRFQ, req.user!.userId);
      const updatedQuotation = await tx.quotation.findUnique({
        where: { id: quotationId },
        include: quotationInclude,
      });
      if (!updatedQuotation) throw new Error("QUOTATION_NOT_FOUND");

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "QUOTATION_SUBMITTED",
          entityType: "QUOTATION",
          entityId: quotationId,
          details: {
            quotationNumber: quotation.quotationNumber,
            annualQuotationValue,
            technicalReviews,
            ...(companySettings && { companyProfileVersion: companySettings.version, companyDetailsSource: companySettings.source }),
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
    if (error instanceof RFQLifecycleError) return res.status(error.status).json({ success: false, message: error.message });
    if (error instanceof TechnicalReviewConflict) return res.status(409).json({ success: false, message: error.message });
    if (isApprovedSnapshotValidationError(error)) {
      return res.status(409).json({
        success: false,
        message: "Saved quotation data is incomplete or inconsistent; correct it before approval",
      });
    }

    const knownErrors: Record<string, { status: number; message: string }> = {
      QUOTATION_NOT_FOUND: {
        status: 404,
        message: "Quotation not found",
      },
      QUOTATION_TRANSITION_CONFLICT: {
        status: 409,
        message: "The quotation changed while this request was being processed; refresh and try again",
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
        include: quotationInclude,
      });

      if (!quotation) throw new Error("QUOTATION_NOT_FOUND");

      if (quotation.status !== QuotationStatus.PENDING_APPROVAL) {
        throw new Error("QUOTATION_TRANSITION_CONFLICT");
      }

      const parentRFQ = await getLockedRFQ(tx, quotation.rfqId);
      assertRFQOpen(parentRFQ);

      const approval = await tx.approval.findFirst({
        where: {
          quotationId,
          approverId: req.user!.userId,
          status: ApprovalStatus.PENDING,
        },
        include: {
          approver: {
            select: { name: true, role: true },
          },
        },
      });

      if (!approval) {
        const priorAssignment = await tx.approval.findFirst({
          where: { quotationId, approverId: req.user!.userId },
        });
        if (priorAssignment) throw new Error("QUOTATION_TRANSITION_CONFLICT");
        throw new Error("APPROVAL_NOT_ASSIGNED");
      }

      const approvedAt = new Date();

      const approvalTransition = await tx.approval.updateMany({
        where: {
          id: approval.id,
          quotationId,
          approverId: req.user!.userId,
          status: ApprovalStatus.PENDING,
        },
        data: {
          status: ApprovalStatus.APPROVED,
          approvedAt,
        },
      });
      if (approvalTransition.count !== 1) {
        throw new Error("QUOTATION_TRANSITION_CONFLICT");
      }

      const companySettings = await getCompanySettings(tx);
      const approvedSnapshot = buildApprovedQuotationSnapshot(quotation, {
        mode: "SALES_HEAD",
        approvedAt,
        approverName: approval.approver.name,
        approverRole: approval.approver.role,
      }, companySettings.company);

      const quotationTransition = await tx.quotation.updateMany({
        where: { id: quotationId, status: QuotationStatus.PENDING_APPROVAL },
        data: {
          status: QuotationStatus.APPROVED,
          approvedAt,
          approvedSnapshot,
        },
      });
      if (quotationTransition.count !== 1) {
        throw new Error("QUOTATION_TRANSITION_CONFLICT");
      }
      await syncRFQLifecycle(tx, parentRFQ, req.user!.userId);
      const updatedQuotation = await tx.quotation.findUnique({
        where: { id: quotationId },
        include: quotationInclude,
      });
      if (!updatedQuotation) throw new Error("QUOTATION_NOT_FOUND");

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "QUOTATION_APPROVED",
          entityType: "QUOTATION",
          entityId: quotationId,
          details: {
            quotationNumber: quotation.quotationNumber,
            companyProfileVersion: companySettings.version,
            companyDetailsSource: companySettings.source,
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
    if (error instanceof RFQLifecycleError) return res.status(error.status).json({ success: false, message: error.message });
    if (isApprovedSnapshotValidationError(error)) {
      return res.status(409).json({
        success: false,
        message: "Saved quotation data is incomplete or inconsistent; correct it before approval",
      });
    }

    const knownErrors: Record<string, { status: number; message: string }> = {
      QUOTATION_NOT_FOUND: {
        status: 404,
        message: "Quotation not found",
      },
      QUOTATION_TRANSITION_CONFLICT: {
        status: 409,
        message: "The quotation approval was already processed; refresh to see its current status",
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
        throw new Error("QUOTATION_TRANSITION_CONFLICT");
      }

      const parentRFQ = await getLockedRFQ(tx, quotation.rfqId);
      assertRFQOpen(parentRFQ);

      const approval = await tx.approval.findFirst({
        where: {
          quotationId,
          approverId: req.user!.userId,
          status: ApprovalStatus.PENDING,
        },
      });

      if (!approval) {
        const priorAssignment = await tx.approval.findFirst({
          where: { quotationId, approverId: req.user!.userId },
        });
        if (priorAssignment) throw new Error("QUOTATION_TRANSITION_CONFLICT");
        throw new Error("APPROVAL_NOT_ASSIGNED");
      }

      const approvalTransition = await tx.approval.updateMany({
        where: {
          id: approval.id,
          quotationId,
          approverId: req.user!.userId,
          status: ApprovalStatus.PENDING,
        },
        data: {
          status: ApprovalStatus.REJECTED,
          comments: validation.data.comments,
        },
      });
      if (approvalTransition.count !== 1) {
        throw new Error("QUOTATION_TRANSITION_CONFLICT");
      }

      const quotationTransition = await tx.quotation.updateMany({
        where: { id: quotationId, status: QuotationStatus.PENDING_APPROVAL },
        data: { status: QuotationStatus.REJECTED },
      });
      if (quotationTransition.count !== 1) {
        throw new Error("QUOTATION_TRANSITION_CONFLICT");
      }
      await syncRFQLifecycle(tx, parentRFQ, req.user!.userId);
      const updatedQuotation = await tx.quotation.findUnique({
        where: { id: quotationId },
        include: quotationInclude,
      });
      if (!updatedQuotation) throw new Error("QUOTATION_NOT_FOUND");

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
    if (error instanceof RFQLifecycleError) return res.status(error.status).json({ success: false, message: error.message });
    const knownErrors: Record<string, { status: number; message: string }> = {
      QUOTATION_NOT_FOUND: {
        status: 404,
        message: "Quotation not found",
      },
      QUOTATION_TRANSITION_CONFLICT: {
        status: 409,
        message: "The quotation approval was already processed; refresh to see its current status",
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

    if (req.user.role !== "SALES_HEAD") {
      return res.status(403).json({
        success: false,
        message: "Only Sales Heads can send quotations",
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
        include: { ...quotationInclude, rfq: true },
      });

      if (!quotation) throw new Error("QUOTATION_NOT_FOUND");

      if (quotation.status !== QuotationStatus.APPROVED) {
        throw new Error("QUOTATION_TRANSITION_CONFLICT");
      }

      if (!isApprovedQuotationSnapshot(quotation.approvedSnapshot)) {
        throw new Error("APPROVED_SNAPSHOT_MISSING");
      }
      const technicalReviews = await requireApprovedRoutings(tx, quotation.parts);
      const parentRFQ = await getLockedRFQ(tx, quotation.rfqId);
      assertRFQOpen(parentRFQ);

      const transition = await tx.quotation.updateMany({
        where: { id: quotationId, status: QuotationStatus.APPROVED },
        data: { status: QuotationStatus.SENT },
      });
      if (transition.count !== 1) throw new Error("QUOTATION_TRANSITION_CONFLICT");

      await syncRFQLifecycle(tx, parentRFQ, req.user!.userId);

      await tx.auditLog.createMany({
        data: [
          {
            actorId: req.user!.userId,
            action: "QUOTATION_SENT",
            entityType: "QUOTATION",
            entityId: quotationId,
            details: {
              quotationNumber: quotation.quotationNumber,
              deliveryMethod: "INTERNAL_STATUS_ONLY",
              externalMessageSent: false,
              technicalReviews,
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

      const updatedQuotation = await tx.quotation.findUnique({
        where: { id: quotationId },
        include: quotationInclude,
      });
      if (!updatedQuotation) throw new Error("QUOTATION_NOT_FOUND");
      return updatedQuotation;
    });

    return res.status(200).json({
      success: true,
      message: "Quotation marked as sent internally; no external message was sent",
      data: result,
    });
  } catch (error) {
    if (error instanceof RFQLifecycleError) return res.status(error.status).json({ success: false, message: error.message });
    if (error instanceof TechnicalReviewConflict) return res.status(409).json({ success: false, message: error.message });
    const knownErrors: Record<string, { status: number; message: string }> = {
      QUOTATION_NOT_FOUND: {
        status: 404,
        message: "Quotation not found",
      },
      QUOTATION_TRANSITION_CONFLICT: {
        status: 409,
        message: "The quotation changed while this request was being processed; refresh and try again",
      },
      INVALID_RFQ_STATUS: {
        status: 400,
        message: "The RFQ is not in a state that allows sending a quotation",
      },
      APPROVED_SNAPSHOT_MISSING: {
        status: 409,
        message:
          "An immutable approved quotation snapshot is required before it can be marked sent",
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

// --------------------------------------------------
// Generate approved quotation PDF
// --------------------------------------------------

export const downloadQuotationPdf = async (
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
      select: {
        quotationNumber: true,
        status: true,
        approvedSnapshot: true,
      },
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: "Quotation not found",
      });
    }

    if (
      quotation.status !== QuotationStatus.APPROVED &&
      quotation.status !== QuotationStatus.SENT
    ) {
      return res.status(409).json({
        success: false,
        message: "PDF is available only for approved or sent quotations",
      });
    }

    if (!isApprovedQuotationSnapshot(quotation.approvedSnapshot)) {
      return res.status(409).json({
        success: false,
        message:
          "An immutable approved quotation snapshot is unavailable for this record",
      });
    }

    const pdf = await generateQuotationPdf(quotation.approvedSnapshot);


    const filename = `${quotation.quotationNumber}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.setHeader("Content-Length", pdf.length);

    return res.status(200).send(pdf);
  } catch (error) {
    console.error("Generate quotation PDF error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to generate quotation PDF",
    });
  }
};
