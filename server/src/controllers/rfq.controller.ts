import { canReadDocument, canManageIntakeDocument } from "../services/document-access.service.js";
import { getLockedRFQ, nextRFQUpdatedAt, RFQLifecycleError } from "../services/rfq-lifecycle.service.js";

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import {
  ExtractionFieldReviewStatus,
  ExtractionStatus,
  RFQStatus,
} from "@prisma/client";
import { z } from "zod";

import prisma from "../lib/prisma.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

// --------------------------------------------------
// Validation schemas
// --------------------------------------------------

const partSchema = z.object({
  partNumber: z.string().trim().max(100).optional(),
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(1000).optional(),
  materialGrade: z.string().trim().max(100).optional(),
  grossWeightKg: z.number().positive().optional(),
  annualVolume: z.number().int().positive().optional(),
  drawingNumber: z.string().trim().max(100).optional(),
  revision: z.string().trim().max(100).optional(),
  sourceGroupKey: z.string().trim().max(300).optional(),
});

const createRFQSchema = z.object({
  rfqNumber: z.string().trim().min(3).max(50),
  customerId: z.string().min(1),
  assignedToId: z.string().min(1).optional(),
  receivedDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
  parts: z.array(partSchema).min(1).max(100),
  extractionJobIds: z.array(z.string().min(1)).min(1).max(20).optional(),

}).refine(
  (data) =>
    !data.receivedDate ||
    !data.dueDate ||
    data.dueDate >= data.receivedDate,
  {
    message: "Due date cannot be before received date",
    path: ["dueDate"],
  }
);

const updateRFQSchema = z.strictObject({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  assignedToId: z.string().min(1).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: z.nativeEnum(RFQStatus).optional(),
  lostReason: z.string().trim().min(2).max(500).optional(),
}).refine(
  (data) => Object.keys(data).some(key => key !== "expectedUpdatedAt"),
  { message: "At least one field is required" }
);

const listRFQQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  status: z.nativeEnum(RFQStatus).optional(),
  customerId: z.string().optional(),
  assignedToId: z.string().optional(),
  search: z.string().trim().max(100).optional(),
});

// --------------------------------------------------
// Shared helpers
// --------------------------------------------------

const rfqInclude = {
  customer: true,
  assignedTo: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  parts: true,
  _count: {
    select: {
      quotations: true,
    },
  },
} satisfies Prisma.RFQInclude;

const isPrismaUniqueConstraintError = (
  error: unknown
): boolean => {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
};

class IntakeLinkingError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "NOT_COMPLETED"
      | "NOT_REVIEWED"
      | "ALREADY_LINKED",
    message: string
  ) {
    super(message);
  }
}

const allowedTransitions: Record<RFQStatus, RFQStatus[]> = {
  RECEIVED: [
    RFQStatus.ESTIMATING,
    RFQStatus.LOST,
  ],
  ESTIMATING: [
    RFQStatus.LOST,
  ],
  PENDING_APPROVAL: [RFQStatus.LOST],
  QUOTATION_SENT: [
    RFQStatus.WON,
    RFQStatus.LOST,
  ],
  WON: [],
  LOST: [],
};

// --------------------------------------------------
// Create RFQ with parts and audit log
// --------------------------------------------------

export const createRFQ = async (
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
        message: "Only estimators or administrators can create RFQs",
      });
    }

    const validation = createRFQSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid RFQ details",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const data = validation.data;

    if (
      data.extractionJobIds &&
      new Set(data.extractionJobIds).size !== data.extractionJobIds.length
    ) {
      return res.status(400).json({
        success: false,
        message: "Duplicate extraction job IDs are not allowed",
      });
    }


    const [customer, creator, assignee] = await Promise.all([
      prisma.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { id: true, isActive: true },
      }),
      data.assignedToId
        ? prisma.user.findUnique({
            where: { id: data.assignedToId },
            select: {
              id: true,
              isActive: true,
              role: true,
            },
          })
        : Promise.resolve(null),
    ]);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if (!creator || !creator.isActive) {
      return res.status(401).json({
        success: false,
        message: "Active creator account not found",
      });
    }

    if (
      data.assignedToId &&
      (!assignee ||
        !assignee.isActive ||
        assignee.role !== "ESTIMATOR")
    ) {
      return res.status(400).json({
        success: false,
        message: "Assigned user must be an active estimator",
      });
    }

    const existingRFQ = await prisma.rFQ.findUnique({
      where: { rfqNumber: data.rfqNumber },
      select: { id: true },
    });

    if (existingRFQ) {
      return res.status(409).json({
        success: false,
        message: "RFQ number already exists",
      });
    }

    const rfq = await prisma.$transaction(async (tx) => {
      const extractionJobs = data.extractionJobIds
        ? await tx.extractionJob.findMany({
            where: { id: { in: data.extractionJobIds } },
            include: {
              attachment: {
                select: {
                  id: true,
                  rfqId: true,
                  uploadedById: true,
                },
              },
              fields: {
                select: { reviewStatus: true, groupKey: true },
              },
            },
          })
        : [];

      if (extractionJobs.length !== (data.extractionJobIds?.length || 0)) {
        throw new IntakeLinkingError(
          "NOT_FOUND",
          "One or more extraction jobs were not found"
        );
      }

      for (const job of extractionJobs) {
        if (job.status !== ExtractionStatus.COMPLETED) {
          throw new IntakeLinkingError(
            "NOT_COMPLETED",
            "Only completed extraction jobs can be linked"
          );
        }

        if (job.attachment.rfqId) {
          throw new IntakeLinkingError(
            "ALREADY_LINKED",
            "An extraction job is already linked to an RFQ"
          );
        }

        if (
          !canManageIntakeDocument(req.user, job.attachment.uploadedById)
        ) {
          throw new IntakeLinkingError(
            "FORBIDDEN",
            "You do not have access to one or more extraction jobs"
          );
        }

        if (
          job.fields.some(
            (field) =>
              field.reviewStatus === ExtractionFieldReviewStatus.PENDING
          )
        ) {
          throw new IntakeLinkingError(
            "NOT_REVIEWED",
            "Review every extracted field before creating the RFQ"
          );
        }
      }

      const sourceGroups = new Set(extractionJobs.flatMap((job) => job.fields.map((field) => `${job.id}::${field.groupKey || "document"}`)));
      const usedGroups = new Set<string>();
      const partIdentifiers = new Set<string>();
      for (const part of data.parts) {
        if (part.sourceGroupKey) {
          if (!sourceGroups.has(part.sourceGroupKey) || usedGroups.has(part.sourceGroupKey)) {
            throw new IntakeLinkingError("NOT_REVIEWED", "Each part must reference a distinct reviewed source group from the linked documents");
          }
          usedGroups.add(part.sourceGroupKey);
        }
        if (extractionJobs.length && (part.partNumber || part.drawingNumber)) {
          const identifier = `${part.partNumber || part.drawingNumber}:${part.revision || ""}`.toLowerCase();
          if (partIdentifiers.has(identifier)) throw new IntakeLinkingError("NOT_REVIEWED", "Duplicate part identifiers must be resolved before creating an intake RFQ");
          partIdentifiers.add(identifier);
        }
      }

      const createdRFQ = await tx.rFQ.create({
        data: {
          rfqNumber: data.rfqNumber,
          customerId: data.customerId,
          createdById: req.user!.userId,
          assignedToId: data.assignedToId,
          receivedDate: data.receivedDate,
          dueDate: data.dueDate,
          notes: data.notes,
          parts: {
            create: data.parts.map((part) => ({
              partNumber: part.partNumber,
              name: part.name,
              description: part.description,
              materialGrade: part.materialGrade,
              grossWeightKg: part.grossWeightKg,
              annualVolume: part.annualVolume,
              drawingNumber: part.drawingNumber,
              revision: part.revision,
            })),
          },
        },
        include: {
          customer: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          assignedTo: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          parts: true,
        },
      });

      if (extractionJobs.length > 0) {
        const attachmentIds = extractionJobs.map(
          (job) => job.attachment.id
        );
        const jobIds = extractionJobs.map((job) => job.id);

        const linkedAttachments = await tx.attachment.updateMany({
          where: {
            id: { in: attachmentIds },
            rfqId: null,
          },
          data: { rfqId: createdRFQ.id },
        });
        if (linkedAttachments.count !== attachmentIds.length) {
          throw new IntakeLinkingError(
            "ALREADY_LINKED",
            "An attachment was linked while this RFQ was being created"
          );
        }

        const linkedJobs = await tx.extractionJob.updateMany({
          where: {
            id: { in: jobIds },
            rfqId: null,
          },
          data: { rfqId: createdRFQ.id },
        });

        if (linkedJobs.count !== jobIds.length) {
          throw new IntakeLinkingError(
            "ALREADY_LINKED",
            "An extraction job was linked while this RFQ was being created"
          );
        }

        await tx.auditLog.create({
          data: {
            actorId: req.user!.userId,
            action: "DOCUMENTS_LINKED_TO_RFQ",
            entityType: "RFQ",
            entityId: createdRFQ.id,
            details: {
              extractionJobIds: jobIds,
              attachmentIds,
              partSources: data.parts.map((part) => ({
                partNumber: part.partNumber ?? null, name: part.name,
                drawingNumber: part.drawingNumber ?? null, revision: part.revision ?? null,
                sourceGroupKey: part.sourceGroupKey ?? null,
              })),
            },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "RFQ_CREATED",
          entityType: "RFQ",
          entityId: createdRFQ.id,
          details: {
            rfqNumber: createdRFQ.rfqNumber,
            partCount: createdRFQ.parts.length,
            linkedExtractionJobCount: extractionJobs.length,
          },
        },
      });

      return createdRFQ;
    });

    return res.status(201).json({
      success: true,
      message: "RFQ created successfully",
      data: rfq,
    });
  } catch (error) {
    if (error instanceof IntakeLinkingError) {
      const status = error.code === "FORBIDDEN"
        ? 403
        : error.code === "ALREADY_LINKED"
          ? 409
          : 400;

      return res.status(status).json({
        success: false,
        message: error.message,
      });
    }

    if (isPrismaUniqueConstraintError(error)) {
      return res.status(409).json({
        success: false,
        message: "RFQ number already exists",
      });
    }

    console.error("Create RFQ error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create RFQ",
    });
  }
};

// --------------------------------------------------
// Get all RFQs with filters and pagination
// --------------------------------------------------

export const getRFQs = async (
  req: Request,
  res: Response
) => {
  try {
    const validation = listRFQQuerySchema.safeParse(req.query);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid RFQ filters",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const {
      page,
      limit,
      status,
      customerId,
      assignedToId,
      search,
    } = validation.data;

    const where: Prisma.RFQWhereInput = {
      ...(status && { status }),
      ...(customerId && { customerId }),
      ...(assignedToId && { assignedToId }),
      ...(search && {
        OR: [
          {
            rfqNumber: {
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
          {
            parts: {
              some: {
                name: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
          },
        ],
      }),
    };

    const [rfqs, total] = await prisma.$transaction([
      prisma.rFQ.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        skip: (page - 1) * limit,
        take: limit,
        include: rfqInclude,
      }),
      prisma.rFQ.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      count: rfqs.length,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      data: rfqs,
    });
  } catch (error) {
    console.error("Get RFQs error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve RFQs",
    });
  }
};

// --------------------------------------------------
// Get one RFQ by ID
// --------------------------------------------------

export const getRFQById = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ success: false, message: "Authentication required" });
    const rfqId = req.params.id;

    if (typeof rfqId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid RFQ ID",
      });
    }

    const rfq = await prisma.rFQ.findUnique({
      where: { id: rfqId },
      include: {
        customer: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        parts: {
          include: {
            routing: {
              include: {
                operations: true,
              },
            },
          },
        },
        attachments: {
          select: {
            id: true,
            rfqId: true,
            partId: true,
            uploadedById: true,
            fileName: true,
            mimeType: true,
            fileSize: true,
            createdAt: true,
          },
        },
        extractionJobs: {
          select: {
            id: true,
            rfqId: true,
            attachmentId: true,
            status: true,
            provider: true,
            errorMessage: true,
            createdAt: true,
            completedAt: true,
            attachment: {
              select: {
                id: true,
                uploadedById: true,
                fileName: true,
                mimeType: true,
                fileSize: true,
                createdAt: true,
              },
            },
            fields: {
              select: {
                id: true,
                fieldName: true,
                extractedValue: true,
                confidence: true,
                sourceReference: true,
                sourceId: true,
                evidenceText: true,
                extractionMethod: true,
                groupKey: true,
                acceptedValue: true,
                isAccepted: true,
                reviewStatus: true,
                reviewedAt: true,
                createdAt: true,
              },
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: { createdAt: "asc" },
        },

        quotations: true,
      },
    });

    if (!rfq) {
      return res.status(404).json({
        success: false,
        message: "RFQ not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...rfq,
        attachments: rfq.attachments.filter(attachment => canReadDocument(req.user, attachment.uploadedById, rfq)),
        extractionJobs: rfq.extractionJobs.filter(job => canReadDocument(req.user, job.attachment.uploadedById, rfq)),
      },
    });
  } catch (error) {
    console.error("Get RFQ error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve RFQ",
    });
  }
};

// --------------------------------------------------
// Update RFQ and audit log
// --------------------------------------------------

export const updateRFQ = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const rfqId = req.params.id;

    if (typeof rfqId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid RFQ ID",
      });
    }

    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const role = req.user.role;

    if (!["ESTIMATOR", "ADMIN", "SALES_HEAD"].includes(role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to update RFQs",
      });
    }

    if (role === "SALES_HEAD") {
      const submittedFields =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? Object.keys(req.body)
          : [];
      const allowedOutcomeFields = new Set(["status", "lostReason", "expectedUpdatedAt"]);

      if (
        submittedFields.some((field) => !allowedOutcomeFields.has(field))
      ) {
        return res.status(403).json({
          success: false,
          message: "Sales Heads may only record RFQ commercial outcomes",
        });
      }
    }

    const validation = updateRFQSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid RFQ update",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const data = validation.data;

    if (
      role === "SALES_HEAD" &&
      data.status !== RFQStatus.WON &&
      data.status !== RFQStatus.LOST
    ) {
      return res.status(403).json({
        success: false,
        message: "Sales Heads may only mark RFQs as won or lost",
      });
    }

    if (data.status === RFQStatus.QUOTATION_SENT || data.status === RFQStatus.PENDING_APPROVAL) {
      return res.status(403).json({ success: false, message: "Pending approval and quotation sent are set only by the quotation workflow" });
    }

    const updatedRFQ = await prisma.$transaction(async (tx) => {
      const existingRFQ = await getLockedRFQ(tx, rfqId);
      if (existingRFQ.updatedAt.getTime() !== new Date(data.expectedUpdatedAt).getTime()) {
        throw new RFQLifecycleError("The RFQ changed since you loaded it. Refresh before changing its owner or status.");
      }
      if (data.status && data.status !== existingRFQ.status && !allowedTransitions[existingRFQ.status].includes(data.status)) {
        throw new RFQLifecycleError(`Cannot change RFQ status from ${existingRFQ.status} to ${data.status}`, 400);
      }
      if (data.status === RFQStatus.LOST && !data.lostReason?.trim()) {
        throw new RFQLifecycleError("A reason is required when marking an RFQ as lost", 400);
      }
      if (data.status && data.status !== RFQStatus.LOST && data.lostReason) {
        throw new RFQLifecycleError("Lost reason is only allowed for lost RFQs", 400);
      }
      if (data.assignedToId && data.assignedToId !== existingRFQ.assignedToId) {
        const estimator = await tx.user.findUnique({ where: { id: data.assignedToId }, select: { id: true, isActive: true, role: true } });
        if (!estimator || !estimator.isActive || estimator.role !== "ESTIMATOR") {
          throw new RFQLifecycleError("Assigned user must be an active estimator", 400);
        }
      }
      const { expectedUpdatedAt: _expectedUpdatedAt, lostReason, ...updateData } = data;
      const transition = await tx.rFQ.updateMany({
        where: { id: rfqId, status: existingRFQ.status, updatedAt: existingRFQ.updatedAt },
        data: {
          ...updateData,
          updatedAt: nextRFQUpdatedAt(existingRFQ.updatedAt),
          ...(data.status === RFQStatus.LOST ? { lostReason } : data.status ? { lostReason: null } : {}),
        },
      });
      if (transition.count !== 1) throw new RFQLifecycleError("The RFQ changed during this update. Refresh and try again.");
      const updated = await tx.rFQ.findUnique({ where: { id: rfqId }, include: rfqInclude });
      if (!updated) throw new RFQLifecycleError("RFQ not found", 404);
      await tx.auditLog.create({ data: {
        actorId: req.user!.userId, action: "RFQ_UPDATED", entityType: "RFQ", entityId: rfqId,
        details: {
          updatedFields: Object.keys(data).filter(key => key !== "expectedUpdatedAt"), previousStatus: existingRFQ.status, newStatus: updated.status,
          previousAssignedToId: existingRFQ.assignedToId, assignedToId: updated.assignedToId,
        },
      } });
      return updated;
    });

    return res.status(200).json({
      success: true,
      message: "RFQ updated successfully",
      data: updatedRFQ,
    });
  } catch (error) {
    if (error instanceof RFQLifecycleError) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Update RFQ error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update RFQ",
    });
  }
};


export const getRFQAssignees = async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user?.userId) return res.status(401).json({ success: false, message: "Authentication required" });
  if (!["ADMIN", "ESTIMATOR"].includes(req.user.role)) return res.status(403).json({ success: false, message: "Only administrators and estimators can assign RFQ owners" });
  try {
    const data = await prisma.user.findMany({ where: { role: "ESTIMATOR", isActive: true }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("RFQ assignee lookup failed:", error);
    return res.status(500).json({ success: false, message: "Unable to load RFQ owners" });
  }
};
