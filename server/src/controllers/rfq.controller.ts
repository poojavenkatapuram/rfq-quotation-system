
import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { RFQStatus } from "@prisma/client";
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
});

const createRFQSchema = z.object({
  rfqNumber: z.string().trim().min(3).max(50),
  customerId: z.string().min(1),
  assignedToId: z.string().min(1).optional(),
  receivedDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
  parts: z.array(partSchema).min(1).max(100),
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

const updateRFQSchema = z.object({
  assignedToId: z.string().min(1).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: z.nativeEnum(RFQStatus).optional(),
  lostReason: z.string().trim().min(2).max(500).optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
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

const allowedTransitions: Record<RFQStatus, RFQStatus[]> = {
  RECEIVED: [
    RFQStatus.ESTIMATING,
    RFQStatus.LOST,
  ],
  ESTIMATING: [
    RFQStatus.PENDING_APPROVAL,
    RFQStatus.QUOTATION_SENT,
    RFQStatus.LOST,
  ],
  PENDING_APPROVAL: [
    RFQStatus.ESTIMATING,
    RFQStatus.QUOTATION_SENT,
    RFQStatus.LOST,
  ],
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
    const validation = createRFQSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid RFQ details",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const data = validation.data;

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

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "RFQ_CREATED",
          entityType: "RFQ",
          entityId: createdRFQ.id,
          details: {
            rfqNumber: createdRFQ.rfqNumber,
            partCount: createdRFQ.parts.length,
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
  req: Request,
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
        attachments: true,
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
      data: rfq,
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

    const validation = updateRFQSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid RFQ update",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const data = validation.data;

    const existingRFQ = await prisma.rFQ.findUnique({
      where: { id: rfqId },
    });

    if (!existingRFQ) {
      return res.status(404).json({
        success: false,
        message: "RFQ not found",
      });
    }

    if (
      data.status &&
      data.status !== existingRFQ.status &&
      !allowedTransitions[existingRFQ.status].includes(data.status)
    ) {
      return res.status(400).json({
        success: false,
        message: `Cannot change RFQ status from ${existingRFQ.status} to ${data.status}`,
      });
    }

    if (
      data.status === RFQStatus.LOST &&
      !data.lostReason?.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "A reason is required when marking an RFQ as lost",
      });
    }

    if (
      data.status &&
      data.status !== RFQStatus.LOST &&
      data.lostReason
    ) {
      return res.status(400).json({
        success: false,
        message: "Lost reason is only allowed for lost RFQs",
      });
    }

    if (
      data.assignedToId &&
      data.assignedToId !== existingRFQ.assignedToId
    ) {
      const estimator = await prisma.user.findUnique({
        where: { id: data.assignedToId },
        select: {
          id: true,
          isActive: true,
          role: true,
        },
      });

      if (
        !estimator ||
        !estimator.isActive ||
        estimator.role !== "ESTIMATOR"
      ) {
        return res.status(400).json({
          success: false,
          message: "Assigned user must be an active estimator",
        });
      }
    }

    const { lostReason, ...updateData } = data;

    const updatedRFQ = await prisma.$transaction(async (tx) => {
      const updated = await tx.rFQ.update({
        where: { id: rfqId },
        data: {
          ...updateData,
          ...(data.status === RFQStatus.LOST
            ? { lostReason }
            : data.status
              ? { lostReason: null }
              : {}),
        },
        include: rfqInclude,
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          action: "RFQ_UPDATED",
          entityType: "RFQ",
          entityId: rfqId,
          details: {
            updatedFields: Object.keys(data),
            previousStatus: existingRFQ.status,
            newStatus: updated.status,
          },
        },
      });

      return updated;
    });

    return res.status(200).json({
      success: true,
      message: "RFQ updated successfully",
      data: updatedRFQ,
    });
  } catch (error) {
    console.error("Update RFQ error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update RFQ",
    });
  }
};
