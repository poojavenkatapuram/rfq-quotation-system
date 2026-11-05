import { Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

const operationSchema = z.object({
  sequence: z.number().int().positive(),
  operationName: z.string().trim().min(2).max(100),
  machineRateId: z.string().min(1),
  cycleTimeMin: z.number().positive(),
  setupTimeMin: z.number().min(0).optional(),
});

const routingSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  operations: z.array(operationSchema)
    .min(1)
    .max(30)
    .refine(
      (operations) =>
        new Set(operations.map((operation) => operation.sequence)).size ===
        operations.length,
      "Operation sequence numbers must be unique"
    ),
});

const isEffectiveRate = (
  rate: {
    isActive: boolean;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  },
  date: Date
): boolean =>
  rate.isActive &&
  rate.effectiveFrom <= date &&
  (rate.effectiveTo === null || date < rate.effectiveTo);

// GET /api/routings/part/:partId
export const getRoutingByPart = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const partId = req.params.partId;

    if (typeof partId !== "string" || !partId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Invalid part ID",
      });
    }

    const routing = await prisma.routing.findUnique({
      where: { partId },
      include: {
        part: {
          select: {
            id: true,
            name: true,
            partNumber: true,
            materialGrade: true,
            grossWeightKg: true,
            rfq: {
              select: {
                id: true,
                rfqNumber: true,
              },
            },
          },
        },
        operations: {
          include: {
            machineRate: true,
          },
          orderBy: {
            sequence: "asc",
          },
        },
      },
    });

    if (!routing) {
      return res.status(404).json({
        success: false,
        message: "Routing not found for this part",
      });
    }

    return res.status(200).json({
      success: true,
      data: routing,
    });
  } catch (error) {
    console.error("Get routing error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve routing",
    });
  }
};

// PUT /api/routings/part/:partId
export const saveRouting = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const actorId = req.user?.userId;

    if (!actorId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const partId = req.params.partId;

    if (typeof partId !== "string" || !partId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Invalid part ID",
      });
    }

    const parsed = routingSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid routing data",
        errors: parsed.error.flatten(),
      });
    }

    const { name, operations } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const part = await tx.part.findUnique({
        where: { id: partId },
        select: {
          id: true,
          name: true,
        },
      });

      if (!part) {
        throw new Error("PART_NOT_FOUND");
      }

      const machineRateIds = [
        ...new Set(operations.map((operation) => operation.machineRateId)),
      ];

      const machineRates = await tx.machineRate.findMany({
        where: {
          id: { in: machineRateIds },
        },
      });

      if (machineRates.length !== machineRateIds.length) {
        throw new Error("MACHINE_RATE_NOT_FOUND");
      }

      const now = new Date();

      const invalidRate = machineRates.some(
        (rate) => !isEffectiveRate(rate, now)
      );

      if (invalidRate) {
        throw new Error("MACHINE_RATE_NOT_EFFECTIVE");
      }

      const routing = await tx.routing.upsert({
        where: { partId },
        create: {
          partId,
          name,
          operations: {
            create: operations.map((operation) => ({
              sequence: operation.sequence,
              operationName: operation.operationName,
              machineRateId: operation.machineRateId,
              cycleTimeMin: operation.cycleTimeMin,
              setupTimeMin: operation.setupTimeMin,
            })),
          },
        },
        update: {
          name,
          operations: {
            deleteMany: {},
            create: operations.map((operation) => ({
              sequence: operation.sequence,
              operationName: operation.operationName,
              machineRateId: operation.machineRateId,
              cycleTimeMin: operation.cycleTimeMin,
              setupTimeMin: operation.setupTimeMin,
            })),
          },
        },
        include: {
          operations: {
            include: {
              machineRate: true,
            },
            orderBy: {
              sequence: "asc",
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "ROUTING_SAVED",
          entityType: "Routing",
          entityId: routing.id,
          details: {
            partId,
            partName: part.name,
            operationCount: operations.length,
            operations: operations.map((operation) => ({
              sequence: operation.sequence,
              operationName: operation.operationName,
              machineRateId: operation.machineRateId,
              cycleTimeMin: operation.cycleTimeMin,
            })),
          },
        },
      });

      return routing;
    });

    return res.status(200).json({
      success: true,
      message: "Routing saved successfully",
      data: result,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "PART_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Part not found",
        });
      }

      if (error.message === "MACHINE_RATE_NOT_FOUND") {
        return res.status(400).json({
          success: false,
          message: "One or more machine rates do not exist",
        });
      }

      if (error.message === "MACHINE_RATE_NOT_EFFECTIVE") {
        return res.status(400).json({
          success: false,
          message: "All selected machine rates must be currently effective",
        });
      }
    }

    console.error("Save routing error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to save routing",
    });
  }
};
